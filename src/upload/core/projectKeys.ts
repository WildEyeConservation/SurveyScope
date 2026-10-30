import type { UploadClient } from './types';

// S3 key layout for legacy and organization-scoped projects.
export interface ProjectKeyInfo {
  organizationId?: string;
  isLegacyProject: boolean;
  makeKey: (originalPath: string) => string;
}

export async function getProjectKeyInfo(
  client: UploadClient,
  projectId: string,
): Promise<ProjectKeyInfo> {
  const { data: project } = await client.models.Project.get(
    { id: projectId },
    { selectionSet: ['id', 'organizationId', 'tags'] as const },
  );
  const record = (project ?? {}) as Record<string, unknown>;
  const organizationId: string | undefined =
    typeof record['organizationId'] === 'string'
      ? (record['organizationId'] as string)
      : undefined;
  const tags = record['tags'];
  const isLegacyProject = Array.isArray(tags)
    ? (tags as unknown[]).some((t) => t === 'legacy')
    : false;

  const makeKey = (originalPath: string): string =>
    !isLegacyProject && organizationId
      ? `${organizationId}/${projectId}/${originalPath}`
      : originalPath;

  return { organizationId, isLegacyProject, makeKey };
}
