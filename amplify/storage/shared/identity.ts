export interface StorageIdentity {
  sub: string;
  groups: string[];
}

export interface ProjectRow {
  id: string;
  organizationId: string;
  group?: string;
  tags?: string[];
}

const SYSADMIN = 'sysadmin';

export function isSysadmin(user: StorageIdentity): boolean {
  return user.groups.includes(SYSADMIN);
}

export function requireStorageUser(identity: unknown): StorageIdentity {
  const value = identity as Partial<StorageIdentity> | null;
  if (!value || typeof value.sub !== 'string' || !value.sub) {
    throw new Error('Unauthorized: sign in to access files');
  }
  return {
    sub: value.sub,
    groups: Array.isArray(value.groups)
      ? value.groups.filter((g): g is string => typeof g === 'string')
      : [],
  };
}

export function authorizeProject(
  user: StorageIdentity,
  project: ProjectRow | undefined
): asserts project is ProjectRow {
  if (
    !project ||
    !project.organizationId ||
    project.group !== project.organizationId
  ) {
    throw new Error('Unauthorized: invalid project ownership');
  }
  if (!isSysadmin(user) && !user.groups.includes(project.organizationId)) {
    throw new Error('Unauthorized: project belongs to another organization');
  }
}

export function requireString(
  args: Record<string, unknown>,
  name: string,
  maxLength = 1024
): string {
  const value = args[name];
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}
