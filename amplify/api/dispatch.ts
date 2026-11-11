import { ApiError, badRequest, forbidden } from './errors';
import type { ImageRef, LaunchStore } from './launch';
import type { Row } from './schema';

const SEPARATOR = '---';

const isObject = (v: unknown): v is Row =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function imageKey(project: Row, originalPath: string) {
  const legacy = Array.isArray(project.tags) && project.tags.includes('legacy');
  return !legacy && typeof project.organizationId === 'string'
    ? `${project.organizationId}/${project.id}/${originalPath}`
    : originalPath;
}

async function surveyImages(
  store: LaunchStore,
  projectId: string,
  ids: string[],
): Promise<Map<string, ImageRef>> {
  const found = await store.imagesOf(ids);
  for (const id of ids) {
    if (found.get(id)?.projectId !== projectId)
      throw forbidden(`Image ${id} is not in this survey`);
  }
  return found;
}

export async function requireDetectorImages(
  store: LaunchStore,
  project: Row,
  images: unknown,
) {
  if (images === undefined || images === null) return;
  if (!Array.isArray(images)) throw badRequest('Invalid images');
  const entries = images.map((entry) => {
    const at = typeof entry === 'string' ? entry.indexOf(SEPARATOR) : -1;
    if (at <= 0) throw badRequest('Invalid image entry');
    return {
      id: entry.slice(0, at),
      key: entry.slice(at + SEPARATOR.length),
    };
  });
  const found = await surveyImages(
    store,
    String(project.id),
    entries.map((e) => e.id),
  );
  for (const { id, key } of entries) {
    const path = found.get(id)!.originalPath;
    if (!path || key !== imageKey(project, path))
      throw forbidden(`The key for image ${id} must be its stored key`);
  }
}

export async function requireRegistrationImages(
  store: LaunchStore,
  projectId: string,
  metadata: unknown,
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(metadata));
  } catch {
    throw badRequest('Invalid metadata');
  }
  if (!isObject(parsed)) throw badRequest('Invalid metadata');
  const images = parsed.images ?? [];
  const sessionIds = parsed.sessionIds ?? [];
  if (
    !Array.isArray(images) ||
    !images.every((i) => isObject(i) && typeof i.id === 'string' && i.id) ||
    !Array.isArray(sessionIds) ||
    !sessionIds.every((id) => typeof id === 'string' && id)
  ) {
    throw badRequest('Invalid metadata');
  }
  const found = await surveyImages(store, projectId, [
    ...images.map((i: Row) => String(i.id)),
    ...sessionIds,
  ]);
  for (const image of images as Row[]) {
    if (
      (image.originalPath ?? null) !== found.get(String(image.id))!.originalPath
    )
      throw forbidden(
        `The originalPath of image ${image.id} must match the stored image`,
      );
  }
}

export async function dispatchTarget(store: LaunchStore, operation: string) {
  const targets = await store.dispatchTargets();
  const queueUrl = targets?.queues?.[operation];
  if (!queueUrl || !targets?.bucket)
    throw new ApiError(
      503,
      'Unavailable',
      `${operation} is not available in this deployment`,
    );
  return { queueUrl, bucket: targets.bucket };
}
