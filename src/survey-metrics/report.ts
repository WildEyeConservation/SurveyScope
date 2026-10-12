import {
  addDetection,
  finishDetections,
  scanConfidenceCoverage,
  summariseAnnotations,
  summariseChainLinking,
  summariseHomographies,
  summariseObservations,
  summariseProcessedBy,
  summariseSetHomographies,
  type AnnotationSummary,
  type ChainLinkSummary,
  type ConfidenceCoverage,
  type DetectionScan,
  type DetectionSummary,
  type HomographySummary,
  type ObservationSummary,
  type ProcessedBySummary,
  type SetHomographySummary,
} from './collectors';
import {
  AbortError,
  loadAnnotationSets,
  loadAnnotations,
  loadCategories,
  loadImageSets,
  loadImages,
  loadLocationSets,
  loadNeighbours,
  loadObservations,
  loadProcessedBy,
  loadProject,
  loadQueues,
  loadRegistration,
  loadTasks,
  scanDetectorLocations,
  type LoadContext,
} from './loaders';
import type {
  AnnotationRow,
  AnnotationSetRow,
  CategoryRow,
  ImageRow,
  ImageSetRow,
  LocationSetRow,
  NeighbourRow,
  ObservationRow,
  ProcessedByRow,
  ProjectRow,
  QueueRow,
  RegistrationRows,
  TaskRow,
} from './types';

export type LocationScan = {
  rows: number;
  detections: DetectionScan;
  coverage: ConfidenceCoverage | null;
};

export type SurveyData = {
  project: ProjectRow;
  imageSets: ImageSetRow[];
  annotationSets: AnnotationSetRow[];
  locationSets: LocationSetRow[];
  queues: QueueRow[];
  registration: RegistrationRows;
  images: ImageRow[];
  neighbours: NeighbourRow[];
  processedBy: ProcessedByRow[];
  locationScan: LocationScan;
  annotations: AnnotationRow[];
  observations: ObservationRow[];
  categories: CategoryRow[];
  tasks: TaskRow[];
};

export type EntityKey = keyof SurveyData;

const SET_ENTITIES: EntityKey[] = [
  'annotations',
  'observations',
  'categories',
  'tasks',
];

const ENTITY_LABELS: Record<EntityKey, string> = {
  project: 'Survey',
  imageSets: 'Image sets',
  annotationSets: 'Annotation sets',
  locationSets: 'Location sets',
  queues: 'Queues',
  registration: 'Registration counters',
  images: 'Images',
  neighbours: 'Image pairs (images scanned)',
  processedBy: 'Processed-by records',
  locationScan: 'Detector locations',
  annotations: 'Annotations',
  observations: 'Observations',
  categories: 'Categories',
  tasks: 'Launched location sets',
};

export type OverviewResult = {
  project: ProjectRow;
  imageSets: ImageSetRow[];
  annotationSets: AnnotationSetRow[];
  locationSets: LocationSetRow[];
  queues: QueueRow[];
};

export type SetLaunchesResult = {
  locationSets: { id: string; name: string; launchedAt: string | null }[];
  queues: QueueRow[];
};

export type StatResults = {
  overview: OverviewResult;
  detectionModels: ProcessedBySummary;
  detectorOutput: DetectionSummary;
  homographies: HomographySummary;
  setLaunches: SetLaunchesResult;
  annotations: AnnotationSummary;
  observations: ObservationSummary;
  confidenceCoverage: ConfidenceCoverage;
  setHomographies: SetHomographySummary;
  chainLinking: ChainLinkSummary;
};

export type StatId = keyof StatResults;
export type StatCost = 'light' | 'heavy' | 'very heavy';

type StatDefinition<Id extends StatId> = {
  id: Id;
  label: string;
  description: string;
  cost: StatCost;
  needsSet: boolean;
  needs: EntityKey[];
  compute: (data: SurveyData) => StatResults[Id];
};

function define<Id extends StatId>(definition: StatDefinition<Id>) {
  return definition;
}

function totalImageCount(imageSets: ImageSetRow[]): number | null {
  const total = imageSets.reduce((sum, set) => sum + (set.imageCount ?? 0), 0);
  return total > 0 ? total : null;
}

export const STATS = [
  define({
    id: 'overview',
    label: 'Survey overview',
    description:
      'Image, annotation and location sets with their stored counters, plus queues.',
    cost: 'light',
    needsSet: false,
    needs: ['project', 'imageSets', 'annotationSets', 'locationSets', 'queues'],
    compute: ({
      project,
      imageSets,
      annotationSets,
      locationSets,
      queues,
    }) => ({
      project,
      imageSets,
      annotationSets,
      locationSets,
      queues,
    }),
  }),
  define({
    id: 'detectionModels',
    label: 'Detection models run',
    description:
      'Which models processed the survey and how many images each one covered.',
    cost: 'heavy',
    needsSet: false,
    needs: ['processedBy', 'imageSets'],
    compute: ({ processedBy, imageSets }) =>
      summariseProcessedBy(processedBy, totalImageCount(imageSets)),
  }),
  define({
    id: 'detectorOutput',
    label: 'Detector output',
    description:
      'Detections per model: images with detections, empty images, images never processed, and the confidence spread.',
    cost: 'very heavy',
    needsSet: false,
    needs: ['locationScan', 'images'],
    compute: ({ locationScan, images }) =>
      finishDetections(locationScan.detections, images),
  }),
  define({
    id: 'homographies',
    label: 'Homographies',
    description:
      'Image pairs by registration outcome, homography source, camera pair, and how fragmented the pair graph is.',
    cost: 'very heavy',
    needsSet: false,
    needs: ['images', 'neighbours', 'registration'],
    compute: ({ neighbours, images, registration }) =>
      summariseHomographies(neighbours, images, registration),
  }),
  define({
    id: 'setLaunches',
    label: 'Launched for annotation',
    description:
      'Location sets and queues launched against the annotation set, with confidence thresholds.',
    cost: 'light',
    needsSet: true,
    needs: ['tasks', 'locationSets', 'queues'],
    compute: ({ tasks, locationSets, queues }) => {
      const names = new Map(locationSets.map((set) => [set.id, set.name]));
      return {
        locationSets: tasks.map((task) => ({
          id: task.locationSetId,
          name: names.get(task.locationSetId) ?? task.locationSetId,
          launchedAt: task.createdAt,
        })),
        queues,
      };
    },
  }),
  define({
    id: 'annotations',
    label: 'Annotations',
    description:
      'Annotations by source, annotator and category, with primary, secondary and unlinked counts.',
    cost: 'heavy',
    needsSet: true,
    needs: ['annotations', 'categories'],
    compute: ({ annotations, categories }) =>
      summariseAnnotations(annotations, categories),
  }),
  define({
    id: 'observations',
    label: 'Observations',
    description:
      'Locations reviewed in the annotation set, by source and reviewer.',
    cost: 'heavy',
    needsSet: true,
    needs: ['observations'],
    compute: ({ observations }) => summariseObservations(observations),
  }),
  define({
    id: 'confidenceCoverage',
    label: 'Model detections reviewed',
    description:
      'Per model and confidence band: detections, how many were observed, and how many hold an annotation.',
    cost: 'very heavy',
    needsSet: true,
    needs: ['locationScan', 'observations', 'annotations'],
    compute: ({ locationScan }) => {
      if (!locationScan.coverage) {
        throw new Error(
          'Detector locations were not matched against this set.'
        );
      }
      return locationScan.coverage;
    },
  }),
  define({
    id: 'setHomographies',
    label: 'Homographies for annotated images',
    description:
      'Registration outcome of the pairs that touch an image annotated in this set.',
    cost: 'very heavy',
    needsSet: true,
    needs: ['images', 'neighbours', 'annotations'],
    compute: ({ neighbours, annotations }) =>
      summariseSetHomographies(neighbours, annotations),
  }),
  define({
    id: 'chainLinking',
    label: 'Chain linking',
    description:
      'Whether annotations in overlapping image regions are already linked, or are being counted twice.',
    cost: 'very heavy',
    needsSet: true,
    needs: ['images', 'neighbours', 'annotations'],
    compute: ({ neighbours, images, annotations }) =>
      summariseChainLinking(neighbours, images, annotations),
  }),
] as const;

export type StatOutcome<Id extends StatId = StatId> = {
  id: Id;
  label: string;
  status: 'ok' | 'error';
  error: string | null;
  durationMs: number;
  data: StatResults[Id] | null;
};

export type FetchTask = {
  entity: EntityKey;
  label: string;
  state: 'pending' | 'running' | 'cached' | 'done' | 'error';
  count: number;
  total?: number;
  error?: string;
  fetchedAt?: string;
};

export type ReportProgress = {
  phase: 'fetching' | 'computing' | 'done';
  tasks: FetchTask[];
  computing: string | null;
  computed: number;
  toCompute: number;
};

export type SurveyReport = {
  generatedAt: string;
  durationMs: number;
  surveyId: string;
  annotationSetId: string | null;
  fetchedAt: Partial<Record<EntityKey, string>>;
  stats: { [Id in StatId]?: StatOutcome<Id> };
};

type CacheEntry = { data: unknown; fetchedAt: string };
export type ReportCache = Map<string, CacheEntry>;

export type ReportRequest = {
  surveyId: string;
  annotationSetId: string | null;
  statIds: StatId[];
  // Denominators for progress only.
  imageCountHint?: number;
  annotationCountHint?: number;
  cache: ReportCache;
  reuseCache: boolean;
  signal: AbortSignal;
  onProgress: (progress: ReportProgress) => void;
};

export function entitiesFor(statIds: StatId[]): EntityKey[] {
  const needed = new Set<EntityKey>();
  for (const stat of STATS) {
    if (statIds.includes(stat.id)) stat.needs.forEach((key) => needed.add(key));
  }
  return (Object.keys(ENTITY_LABELS) as EntityKey[]).filter((key) =>
    needed.has(key)
  );
}

function cacheKey(
  request: ReportRequest,
  entity: EntityKey,
  forSet = SET_ENTITIES.includes(entity)
) {
  return forSet
    ? `${request.surveyId}:${entity}:${request.annotationSetId}`
    : `${request.surveyId}:${entity}`;
}

function rowCount(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  return (data as { rows?: number } | null)?.rows ?? 1;
}

const nextPaint = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function runReport(request: ReportRequest): Promise<SurveyReport> {
  const started = Date.now();
  const { surveyId, annotationSetId, signal } = request;
  const stats = STATS.filter(
    (stat) =>
      request.statIds.includes(stat.id) && (!stat.needsSet || annotationSetId)
  );
  const entities = entitiesFor(stats.map((stat) => stat.id));
  const wantsCoverage = stats.some((stat) => stat.id === 'confidenceCoverage');
  const tasks: FetchTask[] = entities.map((entity) => ({
    entity,
    label: ENTITY_LABELS[entity],
    state: 'pending',
    count: 0,
  }));
  const progress: ReportProgress = {
    phase: 'fetching',
    tasks,
    computing: null,
    computed: 0,
    toCompute: stats.length,
  };

  let lastEmit = 0;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 150) return;
    lastEmit = now;
    request.onProgress({
      ...progress,
      tasks: tasks.map((task) => ({ ...task })),
    });
  };

  const loads = new Map<EntityKey, Promise<unknown>>();

  const load = (entity: EntityKey): Promise<unknown> => {
    const existing = loads.get(entity);
    if (existing) return existing;
    const task = tasks.find((candidate) => candidate.entity === entity)!;
    // A location scan matched against a set is only reusable for that set.
    const key =
      entity === 'locationScan'
        ? cacheKey(request, entity, wantsCoverage)
        : cacheKey(request, entity);

    const promise = (async () => {
      const cached = request.reuseCache ? request.cache.get(key) : undefined;
      if (cached) {
        task.state = 'cached';
        task.fetchedAt = cached.fetchedAt;
        task.count = rowCount(cached.data);
        emit(true);
        return cached.data;
      }

      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort);
      const ctx: LoadContext = {
        signal: controller.signal,
        onProgress: (count, total) => {
          task.count = count;
          task.total = total;
          emit();
        },
      };

      try {
        const needs: Dependencies = {};
        if (entity === 'neighbours') {
          needs.images = (await load('images')) as ImageRow[];
        }
        if (entity === 'locationScan' && wantsCoverage) {
          try {
            const observations = (await load(
              'observations'
            )) as ObservationRow[];
            needs.annotations = (await load('annotations')) as AnnotationRow[];
            needs.observations = observations;
          } catch {
            // Detector output does not need the set.
          }
        }
        task.state = 'running';
        emit(true);
        const data = await fetchEntity(entity, request, ctx, needs);
        const fetchedAt = new Date().toISOString();
        if (entity === 'annotations' || entity === 'observations') {
          request.cache.delete(cacheKey(request, 'locationScan', true));
        }
        if (entity === 'locationScan') {
          const scan = data as LocationScan;
          const prefix = `${cacheKey(request, entity, false)}:`;
          for (const cached of [...request.cache.keys()]) {
            if (cached.startsWith(prefix)) request.cache.delete(cached);
          }
          request.cache.set(cacheKey(request, entity, false), {
            data: { ...scan, coverage: null },
            fetchedAt,
          });
          if (scan.coverage) {
            request.cache.set(cacheKey(request, entity, true), {
              data,
              fetchedAt,
            });
          }
        } else {
          request.cache.set(key, { data, fetchedAt });
        }
        task.state = 'done';
        task.fetchedAt = fetchedAt;
        task.count = rowCount(data);
        emit(true);
        return data;
      } catch (error) {
        controller.abort();
        task.state = 'error';
        task.error = error instanceof Error ? error.message : String(error);
        emit(true);
        throw error;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    })();
    loads.set(entity, promise);
    return promise;
  };

  emit(true);
  await Promise.allSettled(entities.map(load));
  if (signal.aborted) throw new AbortError();

  const data: Partial<Record<EntityKey, unknown>> = {};
  const failures = new Map<EntityKey, string>();
  for (const entity of entities) {
    try {
      data[entity] = await loads.get(entity);
    } catch (error) {
      failures.set(
        entity,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  progress.phase = 'computing';
  const report: SurveyReport = {
    generatedAt: new Date().toISOString(),
    durationMs: 0,
    surveyId,
    annotationSetId,
    fetchedAt: Object.fromEntries(
      tasks
        .filter((task) => task.fetchedAt)
        .map((task) => [task.entity, task.fetchedAt])
    ),
    stats: {},
  };

  for (const stat of stats) {
    progress.computing = stat.label;
    emit(true);
    await nextPaint();
    if (signal.aborted) throw new AbortError();

    const computeStarted = Date.now();
    const outcome: StatOutcome = {
      id: stat.id,
      label: stat.label,
      status: 'ok',
      error: null,
      durationMs: 0,
      data: null,
    };
    const failed = stat.needs.find((entity) => failures.has(entity));
    try {
      if (failed) {
        throw new Error(
          `Could not fetch ${ENTITY_LABELS[
            failed
          ].toLowerCase()}: ${failures.get(failed)}`
        );
      }
      const queues = (data.queues as QueueRow[] | undefined) ?? [];
      outcome.data = (
        stat.compute as (data: SurveyData) => StatResults[StatId]
      )({
        ...(data as SurveyData),
        queues: stat.needsSet
          ? queues.filter((queue) => queue.annotationSetId === annotationSetId)
          : queues,
      });
    } catch (error) {
      outcome.status = 'error';
      outcome.error = error instanceof Error ? error.message : String(error);
    }
    outcome.durationMs = Date.now() - computeStarted;
    (report.stats as Record<string, StatOutcome>)[stat.id] = outcome;
    progress.computed += 1;
  }

  progress.phase = 'done';
  progress.computing = null;
  emit(true);
  report.durationMs = Date.now() - started;
  return report;
}

type Dependencies = {
  images?: ImageRow[];
  observations?: ObservationRow[];
  annotations?: AnnotationRow[];
};

async function scanLocations(
  surveyId: string,
  ctx: LoadContext,
  needs: Dependencies
): Promise<LocationScan> {
  const detections: DetectionScan = new Map();
  const coverage =
    needs.observations && needs.annotations
      ? scanConfidenceCoverage(needs.observations, needs.annotations)
      : null;
  const rows = await scanDetectorLocations(surveyId, ctx, (page) => {
    for (const location of page) {
      addDetection(detections, location);
      coverage?.add(location);
    }
  });
  return { rows, detections, coverage: coverage?.finish() ?? null };
}

function fetchEntity(
  entity: EntityKey,
  request: ReportRequest,
  ctx: LoadContext,
  needs: Dependencies
): Promise<unknown> {
  const { surveyId } = request;
  const setId = request.annotationSetId ?? '';
  switch (entity) {
    case 'project':
      return loadProject(surveyId, ctx);
    case 'imageSets':
      return loadImageSets(surveyId, ctx);
    case 'annotationSets':
      return loadAnnotationSets(surveyId, ctx);
    case 'locationSets':
      return loadLocationSets(surveyId, ctx);
    case 'queues':
      return loadQueues(surveyId, ctx);
    case 'registration':
      return loadRegistration(surveyId, ctx);
    case 'images':
      return loadImages(surveyId, ctx, request.imageCountHint);
    case 'neighbours':
      return loadNeighbours(
        (needs.images ?? []).map((image) => image.id),
        ctx
      );
    case 'processedBy':
      return loadProcessedBy(surveyId, ctx);
    case 'locationScan':
      return scanLocations(surveyId, ctx, needs);
    case 'annotations':
      return loadAnnotations(setId, ctx, request.annotationCountHint);
    case 'observations':
      return loadObservations(setId, ctx);
    case 'categories':
      return loadCategories(setId, ctx);
    case 'tasks':
      return loadTasks(setId, ctx);
  }
}
