import pLimit from 'p-limit';
import outputs from '../../amplify_outputs.json';
import {
  ROW_SOURCES,
  type FieldOf,
  type RowSourceName,
} from '../../shared/rowSources';
import { limitedClient as client } from '../limitedClient';
import { forEachRowChunk, loadRows, streamRows } from '../rowChunks';
import type {
  AnnotationRow,
  AnnotationSetRow,
  CategoryRow,
  ImageRow,
  ImageSetRow,
  LocationRow,
  LocationSetRow,
  NeighbourRow,
  ObservationRow,
  ProcessedByRow,
  ProjectRow,
  QueueRow,
  RegistrationBucketRow,
  RegistrationProgressRow,
  RegistrationRows,
  TaskRow,
} from './types';

const limit = pLimit(8);

const PAGE_SIZE = 10000;
const NEIGHBOUR_WORKERS = 6;

export const DETECTORS = [
  { prefix: 'scoutbot', label: 'ScoutBot', bandWidth: 0.05 },
  { prefix: 'heatmap', label: 'Elephant Nadir', bandWidth: 0.05 },
  { prefix: 'mad', label: 'MAD', bandWidth: 0.05 },
  { prefix: 'owl-d', label: 'OWL-D', bandWidth: 0.02 },
] as const;

export const BAND_WIDTHS = [0.02, 0.05] as const;

// Confidence band width per detector prefix.
export type BandWidths = Record<string, number>;

export const DEFAULT_BAND_WIDTHS: BandWidths = Object.fromEntries(
  DETECTORS.map((detector) => [detector.prefix, detector.bandWidth]),
);

export function bandWidthFor(widths: BandWidths, source: string): number {
  const detector = DETECTORS.find((d) => source.startsWith(d.prefix));
  return (detector && widths[detector.prefix]) || 0.05;
}

export function detectorLabel(source: string): string {
  const detector = DETECTORS.find((d) => source.startsWith(d.prefix));
  return detector ? `${detector.label} (${source})` : source;
}

export type LoadContext = {
  signal: AbortSignal;
  onProgress: (count: number, total?: number) => void;
};

export class AbortError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AbortError';
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new AbortError();
}

type Introspection = {
  models: Record<
    string,
    { attributes?: { type: string; properties?: { queryField?: string } }[] }
  >;
};
type ListOperation = (
  input: Record<string, unknown>,
  options: Record<string, unknown>,
) => Promise<{ data: unknown[]; nextToken?: string | null }>;

function listOperation(field: string): ListOperation {
  const models = (outputs.data.model_introspection as unknown as Introspection)
    .models;
  const model = Object.keys(models).find((name) =>
    models[name].attributes?.some(
      (a) => a.type === 'key' && a.properties?.queryField === field,
    ),
  );
  if (!model) throw new Error(`Unknown query ${field}`);
  return (
    client.models as unknown as Record<string, Record<string, ListOperation>>
  )[model][field];
}

async function forEachPage<Row>(
  field: string,
  fields: string,
  variables: Record<string, unknown>,
  signal: AbortSignal,
  onPage: (rows: Row[]) => void,
  startToken?: string,
): Promise<void> {
  const list = listOperation(field);
  let nextToken: string | null | undefined = startToken;
  do {
    throwIfAborted(signal);
    const page = await limit(() =>
      list(variables, {
        limit: PAGE_SIZE,
        nextToken,
        selectionSet: fields.split(' '),
        signal,
      }),
    );
    onPage(page.data as Row[]);
    nextToken = page.nextToken;
  } while (nextToken);
}

async function fetchAll<Row>(
  field: string,
  fields: string,
  variables: Record<string, unknown>,
  signal: AbortSignal,
  onRows?: (count: number) => void,
  startToken?: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  await forEachPage<Row>(
    field,
    fields,
    variables,
    signal,
    (page) => {
      for (const row of page) rows.push(row);
      onRows?.(page.length);
    },
    startToken,
  );
  return rows;
}

function counted(ctx: LoadContext, total?: number) {
  let count = 0;
  ctx.onProgress(0, total);
  return (rows: number) => {
    count += rows;
    ctx.onProgress(count, total);
  };
}

function loadChunked<S extends RowSourceName>(
  source: S,
  fields: readonly FieldOf<S>[],
  scopeId: string,
  ctx: LoadContext,
  total?: number,
): Promise<unknown[]> {
  const variables = { [ROW_SOURCES[source].partitionKey]: scopeId };
  ctx.onProgress(0, total);
  return loadRows(client, source, scopeId, fields, {
    signal: ctx.signal,
    onProgress: (count) => ctx.onProgress(count, total),
    fallback: () =>
      fetchAll(
        source,
        fields.join(' '),
        variables,
        ctx.signal,
        counted(ctx, total),
      ),
  });
}

export async function loadProject(
  projectId: string,
  ctx: LoadContext,
): Promise<ProjectRow> {
  const { data } = await client.models.Project.get(
    { id: projectId },
    {
      selectionSet: ['id', 'name', 'status', 'createdAt', 'organizationId'],
      signal: ctx.signal,
    },
  );
  if (!data) throw new Error(`No survey with id ${projectId}`);
  ctx.onProgress(1, 1);
  return data as ProjectRow;
}

export function loadImageSets(projectId: string, ctx: LoadContext) {
  return fetchAll<ImageSetRow>(
    'imageSetsByProjectId',
    'id name imageCount',
    { projectId },
    ctx.signal,
    counted(ctx),
  );
}

export function loadAnnotationSets(projectId: string, ctx: LoadContext) {
  return fetchAll<AnnotationSetRow>(
    'annotationSetsByProjectId',
    'id name register createdAt',
    { projectId },
    ctx.signal,
    counted(ctx),
  );
}

export function loadLocationSets(projectId: string, ctx: LoadContext) {
  return fetchAll<LocationSetRow>(
    'locationSetsByProjectId',
    'id name description locationCount createdAt',
    { projectId },
    ctx.signal,
    counted(ctx),
  );
}

export function loadQueues(projectId: string, ctx: LoadContext) {
  return fetchAll<QueueRow>(
    'queuesByProjectId',
    'id name tag annotationSetId locationSetId confidenceThreshold launchedCount observedCount approximateSize requeuesCompleted lastObservationAt createdAt',
    { projectId },
    ctx.signal,
    counted(ctx),
  );
}

export async function loadRegistration(
  projectId: string,
  ctx: LoadContext,
): Promise<RegistrationRows> {
  const onRows = counted(ctx);
  const [progress, buckets] = await Promise.all([
    client.models.RegistrationProgress.get(
      { projectId },
      {
        selectionSet: [
          'pairsCreated',
          'pairsProcessed',
          'pendingCount',
          'lastKickoffAt',
          'lastChangeAt',
          'cleanupState',
        ],
        signal: ctx.signal,
      },
    ),
    fetchAll<RegistrationBucketRow>(
      'registrationBucketStatsByProjectId',
      'cameraPairKey bucketIndex successCount',
      { projectId },
      ctx.signal,
      onRows,
    ),
  ]);
  return { progress: progress.data as RegistrationProgressRow | null, buckets };
}

export function loadImages(
  projectId: string,
  ctx: LoadContext,
  totalHint?: number,
) {
  return loadChunked(
    'imagesByProjectId',
    ['id', 'width', 'height', 'timestamp', 'originalPath', 'cameraId'],
    projectId,
    ctx,
    totalHint,
  ) as Promise<ImageRow[]>;
}

const NEIGHBOUR_FIELDS =
  'image1Id image2Id homography homographySource skipped suggestedPointsKept cameraPairKey registrationProcessedAt registrationFailedAt';

type RawNeighbour = Omit<
  NeighbourRow,
  'registrationProcessed' | 'registrationFailed'
> & {
  registrationProcessedAt: string | null;
  registrationFailedAt: string | null;
};

function neighbourCollector(imageIds: string[] = []) {
  const rows: NeighbourRow[] = [];
  const interned = new Map<string, string>(imageIds.map((id) => [id, id]));
  const intern = (value: string) => {
    const existing = interned.get(value);
    if (existing !== undefined) return existing;
    interned.set(value, value);
    return value;
  };
  const add = (raw: RawNeighbour) => {
    rows.push({
      image1Id: intern(raw.image1Id),
      image2Id: intern(raw.image2Id),
      homography: raw.homography,
      homographySource: raw.homographySource && intern(raw.homographySource),
      skipped: raw.skipped,
      suggestedPointsKept: raw.suggestedPointsKept,
      cameraPairKey: raw.cameraPairKey && intern(raw.cameraPairKey),
      registrationProcessed: Boolean(raw.registrationProcessedAt),
      registrationFailed: Boolean(raw.registrationFailedAt),
    });
  };
  return { rows, add };
}

// Match the per-image fallback by excluding pairs whose image1 left the survey.
export async function loadNeighbours(
  projectId: string,
  loadImages: () => Promise<ImageRow[]>,
  ctx: LoadContext,
): Promise<NeighbourRow[]> {
  const { rows, add } = neighbourCollector();
  const images = loadImages();
  ctx.onProgress(0);
  const loaded = await forEachRowChunk(
    client,
    'imageNeighboursByProjectId',
    projectId,
    NEIGHBOUR_FIELDS.split(' ') as (keyof RawNeighbour)[],
    (page) => {
      for (const raw of page) add(raw as RawNeighbour);
      ctx.onProgress(rows.length);
    },
    { signal: ctx.signal },
  ).catch((error) => {
    if (ctx.signal.aborted) throw error;
    console.warn('Neighbour chunks failed, querying per image instead', error);
    return false;
  });
  const imageIds = (await images).map((image) => image.id);
  if (!loaded) return loadNeighboursByImage(imageIds, ctx);
  const current = new Map(imageIds.map((id) => [id, id]));
  return rows.filter((row) => {
    const image1Id = current.get(row.image1Id);
    if (image1Id === undefined) return false;
    row.image1Id = image1Id;
    row.image2Id = current.get(row.image2Id) ?? row.image2Id;
    return true;
  });
}

async function loadNeighboursByImage(
  imageIds: string[],
  ctx: LoadContext,
): Promise<NeighbourRow[]> {
  const { rows, add } = neighbourCollector(imageIds);

  let scanned = 0;
  ctx.onProgress(0, imageIds.length);

  // A small worker pool keeps the shared request queue free for other loads.
  let next = 0;
  const worker = async () => {
    while (next < imageIds.length) {
      const image1Id = imageIds[next++];
      await forEachPage<RawNeighbour>(
        'imageNeighboursByImage1key',
        NEIGHBOUR_FIELDS,
        { image1Id },
        ctx.signal,
        (rows) => rows.forEach(add),
      );
      scanned += 1;
      ctx.onProgress(scanned, imageIds.length);
    }
  };
  await Promise.all(Array.from({ length: NEIGHBOUR_WORKERS }, worker));
  return rows;
}

export function loadProcessedBy(projectId: string, ctx: LoadContext) {
  return loadChunked(
    'processedByProjectIdAndSource',
    ['imageId', 'source'],
    projectId,
    ctx,
  ) as Promise<ProcessedByRow[]>;
}

// Source-prefix queries exclude the much larger tile grid.
export async function scanDetectorLocations(
  projectId: string,
  ctx: LoadContext,
  onPage: (rows: LocationRow[]) => void,
): Promise<number> {
  const onRows = counted(ctx);
  let total = 0;
  const handle = (rows: unknown[]) => {
    onPage(rows as LocationRow[]);
    total += rows.length;
    onRows(rows.length);
  };
  const fields = [
    'id',
    'imageId',
    'x',
    'y',
    'width',
    'height',
    'source',
    'confidence',
  ] as const;
  await Promise.all(
    DETECTORS.map((detector) =>
      streamRows(
        client,
        'locationsByProjectIdAndSource',
        projectId,
        fields,
        handle,
        {
          signal: ctx.signal,
          beginsWith: detector.prefix,
          fallback: (onPage) =>
            forEachPage(
              'locationsByProjectIdAndSource',
              fields.join(' '),
              { projectId, source: { beginsWith: detector.prefix } },
              ctx.signal,
              onPage,
            ),
        },
      ),
    ),
  );
  return total;
}

export function loadAnnotations(setId: string, ctx: LoadContext) {
  return loadChunked(
    'annotationsByAnnotationSetId',
    [
      'id',
      'imageId',
      'categoryId',
      'objectId',
      'x',
      'y',
      'source',
      'oov',
      'obscured',
      'owner',
      'reviewedBy',
      'infoTaggedBy',
      'createdAt',
    ],
    setId,
    ctx,
  ) as Promise<AnnotationRow[]>;
}

export function loadObservations(setId: string, ctx: LoadContext) {
  return loadChunked(
    'observationsByAnnotationSetId',
    ['locationId', 'owner', 'source', 'createdAt'],
    setId,
    ctx,
  ) as Promise<ObservationRow[]>;
}

export function loadCategories(setId: string, ctx: LoadContext) {
  return loadChunked(
    'categoriesByAnnotationSetId',
    ['id', 'name'],
    setId,
    ctx,
  ) as Promise<CategoryRow[]>;
}

export function loadTasks(setId: string, ctx: LoadContext) {
  return fetchAll<TaskRow>(
    'locationSetsByAnnotationSetId',
    'locationSetId createdAt',
    { annotationSetId: setId },
    ctx.signal,
    counted(ctx),
  );
}
