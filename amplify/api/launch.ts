import type { Access } from './access';
import { badRequest, forbidden } from './errors';
import type { Row } from './schema';

export type ReferenceModel =
  | 'AnnotationSet'
  | 'Category'
  | 'LocationSet'
  | 'Location'
  | 'Image'
  | 'Transect';

export interface ImageRef {
  projectId: string;
  originalPath: string | null;
}

export interface DispatchTargets {
  bucket?: string;
  queues?: Record<string, string>;
}

export interface LaunchStore {
  readJson(key: string): Promise<unknown>;
  writeJson(prefix: string, value: unknown): Promise<string>;
  remove(key: string): Promise<void>;
  projectsOf(
    model: ReferenceModel,
    ids: string[],
  ): Promise<Map<string, string>>;
  imagesOf(ids: string[]): Promise<Map<string, ImageRef>>;
  dispatchTargets(): Promise<DispatchTargets | null>;
}

const SCALARS: Record<string, ReferenceModel> = {
  annotationSetId: 'AnnotationSet',
  categoryId: 'Category',
  locationSetId: 'LocationSet',
  existingLocationSetId: 'LocationSet',
  locationId: 'Location',
  imageId: 'Image',
  image1Id: 'Image',
  image2Id: 'Image',
};
const LISTS: Record<string, ReferenceModel> = {
  categoryIds: 'Category',
  locationSetIds: 'LocationSet',
  locationIds: 'Location',
  launchImageIds: 'Image',
  annotatedImageIds: 'Image',
  incompleteTransectIds: 'Transect',
};
// Objects under these keys are rows of the model, named by their `id`.
const ROWS: Record<string, ReferenceModel> = {
  images: 'Image',
  primaryImage: 'Image',
  secondaryImage: 'Image',
  locationTiles: 'Location',
};
const PAYLOAD_PREFIX = 'launch-payloads/';
const MANIFEST_PREFIX = 'queue-manifests/';
const MANIFEST_KEYS = ['locationManifestS3Key', 'manifestS3Key'];

const isObject = (v: unknown): v is Row =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function collectReferences(value: unknown) {
  const refs = new Map<ReferenceModel, Set<string>>();
  const projects = new Set<string>();
  const add = (model: ReferenceModel, id: unknown) => {
    if (id === undefined || id === null || id === '') return;
    if (typeof id !== 'string') throw badRequest(`Invalid ${model} id`);
    if (!refs.has(model)) refs.set(model, new Set());
    refs.get(model)!.add(id);
  };
  const visit = (node: unknown, rowModel?: ReferenceModel) => {
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, rowModel));
      return;
    }
    if (!isObject(node)) return;
    if (rowModel) add(rowModel, node.id);
    for (const [key, child] of Object.entries(node)) {
      if (key === 'projectId') {
        if (typeof child !== 'string') throw badRequest('Invalid projectId');
        projects.add(child);
      } else if (SCALARS[key]) add(SCALARS[key], child);
      else if (LISTS[key] && Array.isArray(child))
        child.forEach((id) => add(LISTS[key], id));
      else visit(child, ROWS[key]);
    }
  };
  visit(value);
  return { refs, projects };
}

async function requireOneSurvey(
  store: LaunchStore,
  projectId: string,
  value: unknown,
) {
  const { refs, projects } = collectReferences(value);
  if ([...projects].some((p) => p !== projectId))
    throw forbidden('The request names another survey');
  for (const [model, ids] of refs) {
    const found = await store.projectsOf(model, [...ids]);
    for (const id of ids) {
      if (found.get(id) !== projectId)
        throw forbidden(`${model} ${id} is not in this survey`);
    }
  }
}

function storedKey(value: unknown, prefix: string) {
  if (
    typeof value !== 'string' ||
    !value.startsWith(prefix) ||
    value.includes('..')
  ) {
    throw badRequest('Invalid file key');
  }
  return value;
}

// Copy checked files to prevent caller changes before launch.
export async function authorizeLaunch(
  access: Access,
  store: LaunchStore,
  args: Row,
): Promise<Row> {
  let request: unknown;
  try {
    request = JSON.parse(String(args.request));
  } catch {
    throw badRequest('Invalid request');
  }
  if (!isObject(request)) throw badRequest('Invalid request');
  const payloadKey = request.payloadS3Key
    ? storedKey(request.payloadS3Key, PAYLOAD_PREFIX)
    : undefined;
  const payload = payloadKey ? await store.readJson(payloadKey) : request;
  if (!isObject(payload) || typeof payload.projectId !== 'string') {
    throw badRequest('The request needs a projectId');
  }
  const projectId = payload.projectId;
  await access.requireSurveyAdmin(projectId);

  const checked: Row = { ...payload };
  delete checked.payloadS3Key;
  const replaced: string[] = [];
  for (const field of MANIFEST_KEYS) {
    if (checked[field] === undefined || checked[field] === null) continue;
    const key = storedKey(checked[field], MANIFEST_PREFIX);
    const manifest = await store.readJson(key);
    await requireOneSurvey(store, projectId, manifest);
    checked[field] = await store.writeJson(MANIFEST_PREFIX, manifest);
    replaced.push(key);
  }
  await requireOneSurvey(store, projectId, checked);

  let request2: Row = checked;
  if (payloadKey) {
    request2 = { payloadS3Key: await store.writeJson(PAYLOAD_PREFIX, checked) };
    replaced.push(payloadKey);
  }
  await Promise.all(replaced.map((key) => store.remove(key)));
  return { ...args, request: JSON.stringify(request2) };
}
