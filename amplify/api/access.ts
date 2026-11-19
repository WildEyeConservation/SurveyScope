import type { Box } from '../../shared/locationGeometry';
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
  ): Promise<{ isAdmin?: boolean | null; isTested?: boolean | null } | null>;
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
  presetLocations(presetId: string): Promise<PresetLocation[]>;
  // The job is active and the user still holds one of its transects.
  holdsJob(jobId: string, userId: string): Promise<boolean>;
}

export interface PresetLocation {
  locationId: string;
  annotationSetId: string;
  createdAt?: string | null;
  location?: {
    imageId?: string | null;
    x?: number | null;
    y?: number | null;
    width?: number | null;
    height?: number | null;
  } | null;
}

export interface TestBox {
  testPresetId: string;
  locationId: string;
  setId: string;
  box: Box;
}

export interface TestPool {
  presetIds: Set<string>;
  locations: Set<string>;
  setIds: Set<string>;
  // Test boxes by image, kept from the tester's leases.
  boxes: Map<string, TestBox[]>;
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
      const leases = (await this.store.activeLeases(this.userId)).filter(
        (l) => !l.released,
      );
      // A job grant ends with the job or the tester's last transect.
      const jobs = await Promise.all(
        leases.map((l) =>
          l.kind === 'job' && l.leaseId.startsWith('job-')
            ? this.store.holdsJob(l.leaseId.slice(4), this.userId)
            : true,
        ),
      );
      const standing = await Promise.all(
        leases.map((l) =>
          this.surveyStanding(l.grantedFor ?? l.projectId).catch(() => null),
        ),
      );
      return new TaskScope(leases.filter((_, i) => standing[i] && jobs[i]));
    });
  }

  // Only organisations that test this user hand them tests.
  async isTested(projectId: string): Promise<boolean> {
    const organizationId = await this.organizationOfProject(projectId);
    if (!organizationId) return false;
    return this.once(`tested:${organizationId}`, async () =>
      Boolean(
        (await this.store.organizationMembership(organizationId, this.userId))
          ?.isTested,
      ),
    );
  }

  testPool(): Promise<TestPool> {
    return this.once('testPool', async () => {
      const pool: TestPool = {
        presetIds: new Set(),
        locations: new Set(),
        setIds: new Set(),
        boxes: new Map(),
      };
      const projectIds = await this.store.memberProjectIds(this.userId);
      const eligible = await Promise.all(
        projectIds.map(
          async (id) =>
            Boolean(await this.surveyStanding(id)) && this.isTested(id),
        ),
      );
      const presetIds = new Set(
        (
          await Promise.all(
            projectIds
              .filter((_, i) => eligible[i])
              .map((id) => this.store.presetIdsOfProject(id)),
          )
        ).flat(),
      );
      for (const presetId of presetIds) {
        pool.presetIds.add(presetId);
        for (const entry of await this.store.presetLocations(presetId)) {
          pool.locations.add(`${entry.locationId}|${entry.annotationSetId}`);
          pool.setIds.add(entry.annotationSetId);
          const at = entry.location;
          if (!at?.imageId) continue;
          const boxes = pool.boxes.get(at.imageId) ?? [];
          boxes.push({
            testPresetId: presetId,
            locationId: entry.locationId,
            setId: entry.annotationSetId,
            box: {
              x: Number(at.x),
              y: Number(at.y),
              width: Number(at.width),
              height: Number(at.height),
            },
          });
          pool.boxes.set(at.imageId, boxes);
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

  // Whether someone else belongs to the survey's organisation.
  async inSurveyOrganization(projectId: string, userId: string) {
    const organizationId = await this.organizationOfProject(projectId);
    if (!organizationId) return false;
    return Boolean(
      await this.store.organizationMembership(organizationId, userId),
    );
  }

  async isSurveyAdmin(projectId: string) {
    return (await this.surveyStanding(projectId))?.role === 'admin';
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
