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

export interface ImageRow {
  id: string;
  projectId: string;
  group?: string;
  originalPath?: string;
  width: number;
  height: number;
}

export interface ImageFileRow {
  id: string;
  imageId?: string;
  projectId: string;
  group?: string;
  key: string;
  path: string;
}

export interface SharedImageRow {
  id: string;
  shareId: string;
  sourceImageId: string;
  sourceKey?: string;
  group?: string;
  width: number;
  height: number;
}

export interface ShareRow {
  shareId: string;
  status?: string;
}

const SYSADMIN = 'sysadmin';

export function isSysadmin(user: StorageIdentity): boolean {
  return user.groups.includes(SYSADMIN);
}

export function requireStorageUser(identity: unknown): StorageIdentity {
  const value = identity as Partial<StorageIdentity> | null;
  if (!value || typeof value.sub !== 'string' || !value.sub) {
    throw new Error('Unauthorized: sign in to access images');
  }
  return {
    sub: value.sub,
    groups: Array.isArray(value.groups)
      ? value.groups.filter((g): g is string => typeof g === 'string')
      : [],
  };
}

export function isLegacyProject(project: ProjectRow): boolean {
  return project.tags?.includes('legacy') ?? false;
}

export function projectPrefix(project: ProjectRow): string {
  return `${project.organizationId}/${project.id}/`;
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
    throw new Error('Unauthorized: image belongs to another organization');
  }
}

const hasControlCharacters = (value: string) =>
  Array.from(value).some((c) => c.charCodeAt(0) < 32);

export function safeSourceKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((p) => p === '.' || p === '..') ||
    hasControlCharacters(value)
  ) {
    throw new Error('Invalid image path');
  }
  if (new TextEncoder().encode(`images/${value}`).length > 1024) {
    throw new Error('Image path is too long');
  }
  return value;
}

export function uploadSourceKey(
  project: ProjectRow,
  originalPath: string
): string {
  safeSourceKey(originalPath);
  if (isLegacyProject(project)) {
    if (/^[0-9a-f-]{36}\/[0-9a-f-]{36}\//i.test(originalPath)) {
      throw new Error('Legacy upload cannot use an organization-scoped path');
    }
    return originalPath;
  }
  return safeSourceKey(`${projectPrefix(project)}${originalPath}`);
}

export function assertFileOwnership(
  file: ImageFileRow,
  image: ImageRow,
  project: ProjectRow,
  sourceKey: string
): void {
  if (
    file.imageId !== image.id ||
    file.projectId !== project.id ||
    image.projectId !== project.id ||
    file.group !== project.organizationId ||
    image.group !== project.organizationId ||
    file.key !== sourceKey
  ) {
    throw new Error('Unauthorized: image file does not belong to this project');
  }
  safeSourceKey(file.key);
  if (
    !isLegacyProject(project) &&
    !file.key.startsWith(projectPrefix(project))
  ) {
    throw new Error('Unauthorized: image key is outside its project');
  }
}
