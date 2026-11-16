import {
  finishDetections,
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

export const SET_ENTITIES: EntityKey[] = [
  'annotations',
  'observations',
  'categories',
  'tasks',
];

export const ENTITY_LABELS: Record<EntityKey, string> = {
  project: 'Survey',
  imageSets: 'Image sets',
  annotationSets: 'Annotation sets',
  locationSets: 'Location sets',
  queues: 'Queues',
  registration: 'Registration counters',
  images: 'Images',
  neighbours: 'Image pairs',
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
          'Detector locations were not matched against this set.',
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

const REVIEW_STATS: StatId[] = [
  'annotations',
  'observations',
  'confidenceCoverage',
];

export type StatTile = {
  id: string;
  label: string;
  description: string;
  cost: StatCost;
  needsSet: boolean;
  stats: StatId[];
};

// What the picker offers; one tile can fetch several stats.
export const TILES: StatTile[] = STATS.flatMap((stat): StatTile[] => {
  if (!REVIEW_STATS.includes(stat.id)) {
    const { id, label, description, cost, needsSet } = stat;
    return [{ id, label, description, cost, needsSet, stats: [id] }];
  }
  if (stat.id !== REVIEW_STATS[0]) return [];
  return [
    {
      id: 'review',
      label: 'Annotations and review',
      description:
        'Annotations and observations by source, person and category, plus per model and confidence band: detections reviewed, precision, and how far down review is complete.',
      cost: 'very heavy',
      needsSet: true,
      stats: ['detectorOutput', ...REVIEW_STATS],
    },
  ];
});

// Small enough that reading them never decides what comes along.
const LOOKUPS: EntityKey[] = [
  'project',
  'imageSets',
  'annotationSets',
  'locationSets',
  'queues',
  'registration',
  'categories',
  'tasks',
];

function bulkData(tile: StatTile): EntityKey[] {
  return entitiesFor(tile.stats).filter((entity) => !LOOKUPS.includes(entity));
}

// Offered tiles whose bulk data the ticked tiles already read, mapped to the
// ticked tiles they come with.
export function includedTiles(
  ticked: StatTile[],
  offered: StatTile[] = TILES,
): Map<string, StatTile[]> {
  let roots = ticked;
  for (const tile of ticked) {
    const rest = roots.filter((other) => other.id !== tile.id);
    const needs = bulkData(tile);
    if (needs.length > 0 && needs.every((e) => rest.some(reads(e)))) {
      roots = rest;
    }
  }
  const included = new Map<string, StatTile[]>();
  for (const tile of offered) {
    const needs = bulkData(tile);
    if (roots.includes(tile) || needs.length === 0) continue;
    if (!needs.every((entity) => roots.some(reads(entity)))) continue;
    const whole = roots.find((root) => needs.every((e) => reads(e)(root)));
    included.set(
      tile.id,
      whole
        ? [whole]
        : roots.filter((root) => needs.some((e) => reads(e)(root))),
    );
  }
  return included;
}

function reads(entity: EntityKey) {
  return (tile: StatTile) => bulkData(tile).includes(entity);
}

export function entitiesFor(statIds: StatId[]): EntityKey[] {
  const needed = new Set<EntityKey>();
  for (const stat of STATS) {
    if (statIds.includes(stat.id)) stat.needs.forEach((key) => needed.add(key));
  }
  return (Object.keys(ENTITY_LABELS) as EntityKey[]).filter((key) =>
    needed.has(key),
  );
}
