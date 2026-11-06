import { forbidden, notFound } from './errors';
import { type Lease, TaskScope } from './leases';

export interface Actor {
  sub: string;
  username: string;
  groups: string[];
  claims: Record<string, unknown>;
}

export type OrganizationRole = 'admin' | 'member';
export type SurveyRole = 'admin' | 'annotator';

export interface AccessStore {
  organizationMembership(
    organizationId: string,
    userId: string,
  ): Promise<{ isAdmin?: boolean | null } | null>;
  organizationIds(userId: string): Promise<string[]>;
  project(id: string): Promise<{ id: string; organizationId: string } | null>;
  projectMemberships(
    userId: string,
    projectId: string,
  ): Promise<{ isAdmin?: boolean | null }[]>;
  resultsMemberships(
    surveyId: string,
    userId: string,
  ): Promise<{ annotationSetId: string }[]>;
  activeLeases(userId: string): Promise<Lease[]>;
  memberProjectIds(userId: string): Promise<string[]>;
  presetIdsOfProject(projectId: string): Promise<string[]>;
  presetLocations(
    presetId: string,
  ): Promise<{ locationId: string; annotationSetId: string }[]>;
}

export interface TestPool {
  presetIds: Set<string>;
  locations: Set<string>;
  setIds: Set<string>;
}

export interface SurveyStanding {
  projectId: string;
  organizationId: string;
  role: SurveyRole;
}

// Only sysadmin standing comes from the token.
export class Access {
  private readonly memo = new Map<string, Promise<unknown>>();

  constructor(
    readonly actor: Actor,
    private readonly store: AccessStore,
  ) {}

  get userId() {
    return this.actor.username;
  }

  get isSysadmin() {
    return this.actor.groups.includes('sysadmin');
  }

  isSelf(userId: unknown) {
    return (
      typeof userId === 'string' &&
      userId !== '' &&
      (userId === this.actor.username ||
        userId === this.actor.sub ||
        userId === `${this.actor.sub}::${this.actor.username}`)
    );
  }

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.memo.has(key)) this.memo.set(key, load());
    return this.memo.get(key) as Promise<T>;
  }

  organizationRole(organizationId: string): Promise<OrganizationRole | null> {
    return this.once(`org:${organizationId}`, async () => {
      if (this.isSysadmin) return 'admin';
      const membership = await this.store.organizationMembership(
        organizationId,
        this.userId,
      );
      if (!membership) return null;
      return membership.isAdmin ? 'admin' : 'member';
    });
  }

  organizationOfProject(projectId: string): Promise<string | null> {
    return this.once(`project:${projectId}`, async () => {
      const project = await this.store.project(projectId);
      return project?.organizationId ?? null;
    });
  }

  surveyStanding(projectId: string): Promise<SurveyStanding | null> {
    return this.once(`survey:${projectId}`, async () => {
      const organizationId = await this.organizationOfProject(projectId);
      const project = organizationId ? { organizationId } : null;
      if (!project) {
        if (this.isSysadmin) throw notFound('Survey not found');
        return null;
      }
      const base = { projectId, organizationId: project.organizationId };
      const organizationRole = await this.organizationRole(
        project.organizationId,
      );
      if (organizationRole === 'admin')
        return { ...base, role: 'admin' as const };
      // Someone who left the organisation keeps no access through stale survey rows.
      if (organizationRole === null) return null;
      const memberships = await this.store.projectMemberships(
        this.userId,
        projectId,
      );
      if (memberships.length === 0) return null;
      const role: SurveyRole = memberships.some((m) => m.isAdmin)
        ? 'admin'
        : 'annotator';
      return { ...base, role };
    });
  }

  organizationIds(): Promise<string[]> {
    return this.once('orgs', () => this.store.organizationIds(this.userId));
  }

  resultsSets(surveyId: string): Promise<string[]> {
    return this.once(`results:${surveyId}`, async () =>
      (await this.store.resultsMemberships(surveyId, this.userId)).map(
        (m) => m.annotationSetId,
      ),
    );
  }

  tasks(): Promise<TaskScope> {
    return this.once('tasks', async () => {
      const leases = await this.store.activeLeases(this.userId);
      const standing = await Promise.all(
        leases.map((l) =>
          this.surveyStanding(l.grantedFor ?? l.projectId).catch(() => null),
        ),
      );
      return new TaskScope(leases.filter((_, i) => standing[i]));
    });
  }

  testPool(): Promise<TestPool> {
    return this.once('testPool', async () => {
      const pool: TestPool = {
        presetIds: new Set(),
        locations: new Set(),
        setIds: new Set(),
      };
      for (const projectId of await this.store.memberProjectIds(this.userId)) {
        if (!(await this.surveyStanding(projectId))) continue;
        for (const presetId of await this.store.presetIdsOfProject(projectId)) {
          if (pool.presetIds.has(presetId)) continue;
          pool.presetIds.add(presetId);
          for (const location of await this.store.presetLocations(presetId)) {
            pool.locations.add(
              `${location.locationId}|${location.annotationSetId}`,
            );
            pool.setIds.add(location.annotationSetId);
          }
        }
      }
      return pool;
    });
  }

  reviewsShare(shareId: string) {
    return (
      this.isSysadmin || this.actor.groups.includes(`chainshare-${shareId}`)
    );
  }

  requireSysadmin() {
    if (!this.isSysadmin) throw forbidden();
  }

  async requireOrganizationMember(organizationId: string) {
    const role = await this.organizationRole(organizationId);
    if (!role) throw forbidden();
    return role;
  }

  async requireOrganizationAdmin(organizationId: string) {
    if ((await this.organizationRole(organizationId)) !== 'admin')
      throw forbidden();
  }

  async requireSurveyMember(projectId: string) {
    const standing = await this.surveyStanding(projectId);
    if (!standing) throw forbidden();
    return standing;
  }

  async requireSurveyAdmin(projectId: string) {
    const standing = await this.surveyStanding(projectId);
    if (standing?.role !== 'admin') throw forbidden();
    return standing;
  }

  async canReadResults(surveyId: string, annotationSetId: string) {
    if ((await this.surveyStanding(surveyId))?.role === 'admin') return true;
    return (await this.resultsSets(surveyId)).includes(annotationSetId);
  }
}
