import type { ProjectRow } from '../shared/identity';

export {
  authorizeProject,
  isSysadmin,
  requireStorageUser,
  type ProjectRow,
  type StorageIdentity,
} from '../shared/identity';

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

export function isLegacyProject(project: ProjectRow): boolean {
  return project.tags?.includes('legacy') ?? false;
}

export function projectPrefix(project: ProjectRow): string {
  return `${project.organizationId}/${project.id}/`;
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
