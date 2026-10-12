import { generateClient } from 'aws-amplify/api';
import pLimit from 'p-limit';
import { graphqlErrorMessage } from '../reportClientErrorCore';
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

const client = generateClient({ authMode: 'userPool' });
const limit = pLimit(8);

const PAGE_SIZE = 10000;
const MAX_ATTEMPTS = 5;
const NEIGHBOUR_BATCH = 40;
const NEIGHBOUR_WORKERS = 6;

export const DETECTORS = [
  { prefix: 'scoutbot', label: 'ScoutBot' },
  { prefix: 'heatmap', label: 'Elephant Nadir' },
  { prefix: 'mad', label: 'MAD' },
  { prefix: 'owl-d', label: 'OWL-D' },
  { prefix: 'stormfly', label: 'Stormfly' },
] as const;

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

function isDeterministic(message: string): boolean {
  return /validation|unauthori[sz]ed|not authori[sz]ed|FieldUndefined|UnknownType/i.test(
    message
  );
}

async function runQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  signal: AbortSignal
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    throwIfAborted(signal);
    try {
      const result = await limit(() => {
        throwIfAborted(signal);
        return client.graphql({ query, variables }) as Promise<{
          data?: T;
          errors?: unknown[];
        }>;
      });
      // A partial page would silently under-report, so any error fails it.
      if (result.errors?.length) throw result;
      if (!result.data) throw new Error('GraphQL response missing data');
      return result.data;
    } catch (error) {
      if (error instanceof AbortError) throw error;
      const message = graphqlErrorMessage(error);
      if (attempt >= MAX_ATTEMPTS || isDeterministic(message)) {
        throw new Error(message);
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(500 * 2 ** attempt, 15000))
      );
    }
  }
}

type Page<Row> = { items: Row[]; nextToken?: string | null };

function listQuery(
  field: string,
  args: Record<string, string>,
  fields: string
) {
  const declared = Object.entries(args)
    .map(([name, type]) => `$${name}: ${type}`)
    .join(', ');
  const passed = Object.keys(args)
    .map((name) => `${name}: $${name}`)
    .join(', ');
  return `query SurveyMetrics_${field}($limit: Int, $nextToken: String, ${declared}) {
    ${field}(limit: $limit, nextToken: $nextToken, ${passed}) {
      items { ${fields} }
      nextToken
    }
  }`;
}

async function forEachPage<Row>(
  field: string,
  args: Record<string, string>,
  fields: string,
  variables: Record<string, unknown>,
  signal: AbortSignal,
  onPage: (rows: Row[]) => void,
  startToken?: string
): Promise<void> {
  const query = listQuery(field, args, fields);
  let nextToken: string | null | undefined = startToken;
  do {
    const data: Record<string, Page<Row>> = await runQuery(
      query,
      { ...variables, limit: PAGE_SIZE, nextToken },
      signal
    );
    const page = data[field];
    onPage(page.items);
    nextToken = page.nextToken;
  } while (nextToken);
}

async function fetchAll<Row>(
  field: string,
  args: Record<string, string>,
  fields: string,
  variables: Record<string, unknown>,
  signal: AbortSignal,
  onRows?: (count: number) => void,
  startToken?: string
): Promise<Row[]> {
  const rows: Row[] = [];
  await forEachPage<Row>(
    field,
    args,
    fields,
    variables,
    signal,
    (page) => {
      for (const row of page) rows.push(row);
      onRows?.(page.length);
    },
    startToken
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

const BY_PROJECT = { projectId: 'ID!' };

export async function loadProject(
  projectId: string,
  ctx: LoadContext
): Promise<ProjectRow> {
  const data = await runQuery<{ getProject: ProjectRow | null }>(
    `query SurveyMetrics_getProject($id: ID!) {
      getProject(id: $id) { id name status createdAt organizationId }
    }`,
    { id: projectId },
    ctx.signal
  );
  if (!data.getProject) throw new Error(`No survey with id ${projectId}`);
  ctx.onProgress(1, 1);
  return data.getProject;
}

export function loadImageSets(projectId: string, ctx: LoadContext) {
  return fetchAll<ImageSetRow>(
    'imageSetsByProjectId',
    BY_PROJECT,
    'id name imageCount',
    { projectId },
    ctx.signal,
    counted(ctx)
  );
}

export function loadAnnotationSets(projectId: string, ctx: LoadContext) {
  return fetchAll<AnnotationSetRow>(
    'annotationSetsByProjectId',
    BY_PROJECT,
    'id name register createdAt',
    { projectId },
    ctx.signal,
    counted(ctx)
  );
}

export function loadLocationSets(projectId: string, ctx: LoadContext) {
  return fetchAll<LocationSetRow>(
    'locationSetsByProjectId',
    BY_PROJECT,
    'id name description locationCount createdAt',
    { projectId },
    ctx.signal,
    counted(ctx)
  );
}

export function loadQueues(projectId: string, ctx: LoadContext) {
  return fetchAll<QueueRow>(
    'queuesByProjectId',
    BY_PROJECT,
    'id name tag annotationSetId locationSetId confidenceThreshold launchedCount observedCount approximateSize requeuesCompleted lastObservationAt createdAt',
    { projectId },
    ctx.signal,
    counted(ctx)
  );
}

export async function loadRegistration(
  projectId: string,
  ctx: LoadContext
): Promise<RegistrationRows> {
  const onRows = counted(ctx);
  const [progress, buckets] = await Promise.all([
    runQuery<{ getRegistrationProgress: RegistrationProgressRow | null }>(
      `query SurveyMetrics_getRegistrationProgress($projectId: ID!) {
        getRegistrationProgress(projectId: $projectId) {
          pairsCreated pairsProcessed pendingCount lastKickoffAt lastChangeAt cleanupState
        }
      }`,
      { projectId },
      ctx.signal
    ),
    fetchAll<RegistrationBucketRow>(
      'registrationBucketStatsByProjectId',
      BY_PROJECT,
      'cameraPairKey bucketIndex successCount',
      { projectId },
      ctx.signal,
      onRows
    ),
  ]);
  return { progress: progress.getRegistrationProgress, buckets };
}

export function loadImages(
  projectId: string,
  ctx: LoadContext,
  totalHint?: number
) {
  return fetchAll<ImageRow>(
    'imagesByProjectId',
    BY_PROJECT,
    'id width height timestamp originalPath cameraId',
    { projectId },
    ctx.signal,
    counted(ctx, totalHint)
  );
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

function neighbourBatchQuery(size: number) {
  const declared: string[] = [];
  const fields: string[] = [];
  for (let i = 0; i < size; i++) {
    declared.push(`$i${i}: ID!`);
    fields.push(
      `n${i}: imageNeighboursByImage1key(image1Id: $i${i}, limit: ${PAGE_SIZE}) { items { ${NEIGHBOUR_FIELDS} } nextToken }`
    );
  }
  return `query SurveyMetrics_neighbours(${declared.join(
    ', '
  )}) { ${fields.join(' ')} }`;
}

// No project index; each pair is stored under one image1Id.
export async function loadNeighbours(
  imageIds: string[],
  ctx: LoadContext
): Promise<NeighbourRow[]> {
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

  let scanned = 0;
  ctx.onProgress(0, imageIds.length);

  const batches: string[][] = [];
  for (let i = 0; i < imageIds.length; i += NEIGHBOUR_BATCH) {
    batches.push(imageIds.slice(i, i + NEIGHBOUR_BATCH));
  }

  // A small worker pool keeps the shared request queue free for other loads.
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const variables: Record<string, string> = {};
      batch.forEach((id, index) => (variables[`i${index}`] = id));
      const data = await runQuery<Record<string, Page<RawNeighbour>>>(
        neighbourBatchQuery(batch.length),
        variables,
        ctx.signal
      );
      for (let index = 0; index < batch.length; index++) {
        const page = data[`n${index}`];
        page.items.forEach(add);
        if (page.nextToken) {
          await forEachPage<RawNeighbour>(
            'imageNeighboursByImage1key',
            { image1Id: 'ID!' },
            NEIGHBOUR_FIELDS,
            { image1Id: batch[index] },
            ctx.signal,
            (rest) => rest.forEach(add),
            page.nextToken
          );
        }
      }
      scanned += batch.length;
      ctx.onProgress(scanned, imageIds.length);
    }
  };
  await Promise.all(Array.from({ length: NEIGHBOUR_WORKERS }, worker));
  return rows;
}

export function loadProcessedBy(projectId: string, ctx: LoadContext) {
  return fetchAll<ProcessedByRow>(
    'processedByProjectIdAndSource',
    BY_PROJECT,
    'imageId source',
    { projectId },
    ctx.signal,
    counted(ctx)
  );
}

// Source-prefix queries exclude the much larger tile grid.
export async function scanDetectorLocations(
  projectId: string,
  ctx: LoadContext,
  onPage: (rows: LocationRow[]) => void
): Promise<number> {
  const onRows = counted(ctx);
  let total = 0;
  await Promise.all(
    DETECTORS.map((detector) =>
      forEachPage<LocationRow>(
        'locationsByProjectIdAndSource',
        { ...BY_PROJECT, source: 'ModelStringKeyConditionInput' },
        'id imageId x y width height source confidence',
        { projectId, source: { beginsWith: detector.prefix } },
        ctx.signal,
        (rows) => {
          onPage(rows);
          total += rows.length;
          onRows(rows.length);
        }
      )
    )
  );
  return total;
}

export function loadAnnotations(setId: string, ctx: LoadContext) {
  return fetchAll<AnnotationRow>(
    'annotationsByAnnotationSetId',
    { setId: 'ID!' },
    'id imageId categoryId objectId x y source oov obscured owner reviewedBy infoTaggedBy createdAt',
    { setId },
    ctx.signal,
    counted(ctx)
  );
}

export function loadObservations(setId: string, ctx: LoadContext) {
  return fetchAll<ObservationRow>(
    'observationsByAnnotationSetId',
    { annotationSetId: 'ID!' },
    'locationId owner source createdAt',
    { annotationSetId: setId },
    ctx.signal,
    counted(ctx)
  );
}

export function loadCategories(setId: string, ctx: LoadContext) {
  return fetchAll<CategoryRow>(
    'categoriesByAnnotationSetId',
    { annotationSetId: 'ID!' },
    'id name',
    { annotationSetId: setId },
    ctx.signal,
    counted(ctx)
  );
}

export function loadTasks(setId: string, ctx: LoadContext) {
  return fetchAll<TaskRow>(
    'locationSetsByAnnotationSetId',
    { annotationSetId: 'ID!' },
    'locationSetId createdAt',
    { annotationSetId: setId },
    ctx.signal,
    counted(ctx)
  );
}
