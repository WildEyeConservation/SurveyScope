import type { ReportCache } from './cache';
import {
  addDetection,
  scanConfidenceCoverage,
  type DetectionScan,
} from './collectors';
import {
  AbortError,
  DEFAULT_BAND_WIDTHS,
  bandWidthFor,
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
  type BandWidths,
  type LoadContext,
} from './loaders';
import {
  ENTITY_LABELS,
  SET_ENTITIES,
  STATS,
  entitiesFor,
  type EntityKey,
  type LocationScan,
  type StatId,
  type StatResults,
  type SurveyData,
} from './stats';
import type {
  AnnotationRow,
  ImageRow,
  ObservationRow,
  QueueRow,
} from './types';

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

export type ReportRequest = {
  surveyId: string;
  annotationSetId: string | null;
  statIds: StatId[];
  // Denominators for progress only.
  imageCountHint?: number;
  bandWidths?: BandWidths;
  cache: ReportCache;
  reuseCache: boolean;
  signal: AbortSignal;
  onProgress: (progress: ReportProgress) => void;
};

function cacheKey(
  request: ReportRequest,
  entity: EntityKey,
  forSet = SET_ENTITIES.includes(entity),
) {
  // Confidence bands are counted during the scan, so they key its cache.
  const name =
    entity === 'locationScan'
      ? `${entity}@${JSON.stringify(request.bandWidths ?? DEFAULT_BAND_WIDTHS)}`
      : entity;
  return forSet
    ? `${request.surveyId}:${name}:${request.annotationSetId}`
    : `${request.surveyId}:${name}`;
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
      request.statIds.includes(stat.id) && (!stat.needsSet || annotationSetId),
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
      const needs: Dependencies = {};
      // Loaded first: fetching either afresh drops the scans matched to it.
      if (entity === 'locationScan' && wantsCoverage) {
        try {
          const observations = (await load('observations')) as ObservationRow[];
          needs.annotations = (await load('annotations')) as AnnotationRow[];
          needs.observations = observations;
        } catch {
          // Detector output does not need the set.
        }
      }
      const cached = request.reuseCache
        ? await request.cache.get(key)
        : undefined;
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
        if (entity === 'neighbours') {
          needs.images = () => load('images') as Promise<ImageRow[]>;
        }
        task.state = 'running';
        emit(true);
        const data = await fetchEntity(entity, request, ctx, needs);
        const fetchedAt = new Date().toISOString();
        if (entity === 'annotations' || entity === 'observations') {
          const scanPrefix = `${surveyId}:locationScan@`;
          const setSuffix = `:${annotationSetId}`;
          for (const cached of request.cache.keys()) {
            if (cached.startsWith(scanPrefix) && cached.endsWith(setSuffix))
              request.cache.delete(cached);
          }
        }
        if (entity === 'locationScan') {
          const scan = data as LocationScan;
          const prefix = `${cacheKey(request, entity, false)}:`;
          for (const cached of request.cache.keys()) {
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
        error instanceof Error ? error.message : String(error),
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
        .map((task) => [task.entity, task.fetchedAt]),
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
          ].toLowerCase()}: ${failures.get(failed)}`,
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
  images?: () => Promise<ImageRow[]>;
  observations?: ObservationRow[];
  annotations?: AnnotationRow[];
};

async function scanLocations(
  surveyId: string,
  widths: BandWidths,
  ctx: LoadContext,
  needs: Dependencies,
): Promise<LocationScan> {
  const widthFor = (source: string) => bandWidthFor(widths, source);
  const detections: DetectionScan = new Map();
  const coverage =
    needs.observations && needs.annotations
      ? scanConfidenceCoverage(needs.observations, needs.annotations, widthFor)
      : null;
  const rows = await scanDetectorLocations(surveyId, ctx, (page) => {
    for (const location of page) {
      addDetection(detections, location, widthFor);
      coverage?.add(location);
    }
  });
  return { rows, detections, coverage: coverage?.finish() ?? null };
}

function fetchEntity(
  entity: EntityKey,
  request: ReportRequest,
  ctx: LoadContext,
  needs: Dependencies,
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
      return loadNeighbours(surveyId, needs.images ?? (async () => []), ctx);
    case 'processedBy':
      return loadProcessedBy(surveyId, ctx);
    case 'locationScan':
      return scanLocations(
        surveyId,
        request.bandWidths ?? DEFAULT_BAND_WIDTHS,
        ctx,
        needs,
      );
    case 'annotations':
      return loadAnnotations(setId, ctx);
    case 'observations':
      return loadObservations(setId, ctx);
    case 'categories':
      return loadCategories(setId, ctx);
    case 'tasks':
      return loadTasks(setId, ctx);
  }
}
