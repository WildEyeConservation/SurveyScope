/** Reporting is user-facing: unlike internal writers, it never accepts IAM/API-key identities. */
export function requireWorkflowStatsUser(identity: unknown): { sub: string; groups: string[] } {
  const user = identity as { sub?: unknown; groups?: unknown } | null | undefined;
  if (typeof user?.sub !== 'string' || !user.sub.trim()) {
    throw new Error('Unauthorized: sign in to view workflow statistics');
  }
  return {
    sub: user.sub,
    groups: Array.isArray(user.groups) ? user.groups.filter((group): group is string => typeof group === 'string') : [],
  };
}

/** Ownership comes from trusted run/event/aggregate records, never request arguments. */
export function authorizeWorkflowStatsItem(identity: unknown, item: { organizationId?: unknown }): void {
  const user = requireWorkflowStatsUser(identity);
  if (user.groups.includes('sysadmin')) return;
  if (typeof item.organizationId === 'string' && item.organizationId && user.groups.includes(item.organizationId)) return;
  throw new Error('Unauthorized: workflow statistics belong to another organization');
}

/** Raw task events name individual annotators, so only survey admins may export them. */
export async function assertSurveyAdmin(
  identity: unknown,
  projectId: string,
  lookup: {
    organizationOf: (projectId: string) => Promise<string | null>;
    isOrganizationAdmin: (organizationId: string, userId: string) => Promise<boolean>;
    isProjectAdmin: (projectId: string, userId: string) => Promise<boolean>;
  }
): Promise<void> {
  const user = requireWorkflowStatsUser(identity);
  if (user.groups.includes('sysadmin')) return;
  const organizationId = await lookup.organizationOf(projectId);
  if (!organizationId || !user.groups.includes(organizationId)) {
    throw new Error('Unauthorized: survey belongs to another organization');
  }
  if (await lookup.isOrganizationAdmin(organizationId, user.sub)) return;
  if (await lookup.isProjectAdmin(projectId, user.sub)) return;
  throw new Error('Unauthorized: only survey admins can export task events');
}
