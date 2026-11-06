import { apiRequest, cancelApiRequest } from '../api/httpClient';
import { startCancellable } from '../clientCancellation';
import { runWithClientLimit } from '../limitedClient';

export * from './operations';

export async function storageOperation<T>(
  query: string,
  variables: Record<string, unknown>,
  field: string,
  signal?: AbortSignal,
): Promise<T> {
  const result = (await runWithClientLimit(() =>
    startCancellable(
      () =>
        apiRequest('/operation', {
          type: query.trimStart().startsWith('mutation') ? 'mutation' : 'query',
          name: field,
          args: variables,
        }),
      signal,
      cancelApiRequest,
    ),
  )) as { data?: unknown; errors?: { message: string }[] };
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join('; '));
  }
  const value = result.data;
  if (value == null) throw new Error(`No result from ${field}`);
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export async function imageDownloadUrl(imageId: string, sourceKey: string) {
  return storageOperation<{ url: string; expiresAt: number }>(
    `query ImageDownloadUrl($imageId: ID!, $sourceKey: String!) {
    imageDownloadUrl(imageId: $imageId, sourceKey: $sourceKey)
  }`,
    { imageId, sourceKey },
    'imageDownloadUrl',
  );
}

export async function registerImageFile(
  projectId: string,
  imageId: string,
  originalPath: string,
) {
  return storageOperation<{ id: string }>(
    `mutation RegisterImageFile($projectId: ID!, $imageId: ID!, $originalPath: String!) {
    registerImageFile(projectId: $projectId, imageId: $imageId, originalPath: $originalPath)
  }`,
    { projectId, imageId, originalPath },
    'registerImageFile',
  );
}
