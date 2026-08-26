export const WORKFLOW_TYPES = [
  'species-labelling',
  'false-negatives',
  'qc-review',
  'info-tags',
  'homographies',
  'individual-id',
] as const;

export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

export const WORKFLOW_RUN_STATUSES = [
  'launching',
  'active',
  'completed',
  'failed',
  'cancelled',
] as const;

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_METRIC_DEFINITIONS = {
  sightings: {
    label: 'Sightings',
    unit: 'count',
    description: 'Locations where at least one annotation was placed.',
  },
  annotationsAdded: {
    label: 'Annotations added',
    unit: 'count',
    description: 'Total annotations placed across all completed locations.',
  },
  emptySearches: {
    label: 'Empty searches',
    unit: 'count',
    description: 'Locations completed without placing any annotation.',
  },
  searchTimeMs: {
    label: 'Search time',
    unit: 'milliseconds',
    description:
      'Time spent on locations that ended with no annotation (empty searches).',
  },
  annotationTimeMs: {
    label: 'Annotation time',
    unit: 'milliseconds',
    description:
      'Time spent on locations where at least one annotation was placed (sightings). Search time plus annotation time equals time spent.',
  },
  missedAnimalsFound: {
    label: 'Missed animals found',
    unit: 'count',
    description: 'Annotations added on tiles the detector had marked empty.',
  },
  approved: {
    label: 'Approved',
    unit: 'count',
    description: 'Annotations confirmed as correct.',
  },
  relabelled: {
    label: 'Relabelled',
    unit: 'count',
    description: 'Annotations whose label was changed.',
  },
  falsePositive: {
    label: 'False positives',
    unit: 'count',
    description: 'Annotations rejected as not an animal.',
  },
  annotationsTagged: {
    label: 'Annotations tagged',
    unit: 'count',
    description: 'Annotations that had at least one info tag changed.',
  },
  tagsAdded: {
    label: 'Tags added',
    unit: 'count',
    description: 'Info tags attached to annotations.',
  },
  tagsRemoved: {
    label: 'Tags removed',
    unit: 'count',
    description: 'Info tags detached from annotations.',
  },
  markersRepositioned: {
    label: 'Markers repositioned',
    unit: 'count',
    description: 'Annotation markers moved to a new position.',
  },
  saved: {
    label: 'Saved',
    unit: 'count',
    description: 'Image pairs whose homography was saved.',
  },
  controlPointPairs: {
    label: 'Control-point pairs',
    unit: 'count',
    description: 'Matching point pairs placed across both images.',
  },
  suggestedPointsRetained: {
    label: 'Suggested points retained',
    unit: 'count',
    description: 'Automatically suggested point pairs the user kept.',
  },
  annotationsLinked: {
    label: 'Annotations linked',
    unit: 'count',
    description:
      'Animals matched between the two images of a pair. Pairs vary greatly in size, so read this alongside pairs completed.',
  },
} as const;

export type WorkflowMetricKey = keyof typeof WORKFLOW_METRIC_DEFINITIONS;

export interface WorkflowDefinition {
  label: string;
  unit: { singular: string; plural: string };
  metricKeys: readonly WorkflowMetricKey[];
}

export const WORKFLOW_REGISTRY: Record<WorkflowType, WorkflowDefinition> = {
  'species-labelling': {
    label: 'Species Labelling',
    unit: { singular: 'location', plural: 'locations' },
    metricKeys: [
      'sightings',
      'annotationsAdded',
      'emptySearches',
      'searchTimeMs',
      'annotationTimeMs',
    ],
  },
  'false-negatives': {
    label: 'False Negatives',
    unit: { singular: 'tile', plural: 'tiles' },
    metricKeys: ['missedAnimalsFound', 'annotationsAdded'],
  },
  'qc-review': {
    label: 'Review',
    unit: { singular: 'annotation', plural: 'annotations' },
    metricKeys: ['approved', 'relabelled', 'falsePositive'],
  },
  'info-tags': {
    label: 'Info Tags',
    unit: { singular: 'image', plural: 'images' },
    metricKeys: [
      'annotationsTagged',
      'tagsAdded',
      'tagsRemoved',
      'markersRepositioned',
    ],
  },
  homographies: {
    label: 'Homographies',
    unit: { singular: 'image pair', plural: 'image pairs' },
    metricKeys: ['saved', 'controlPointPairs', 'suggestedPointsRetained'],
  },
  'individual-id': {
    label: 'ChainLinker',
    // A pair is the unit of work, not a transect: transects vary enormously in
    // size. Pair count alone is still misleading, because a pair holding 200
    // buffalo is far more work than one holding 6 elephants, so annotations
    // linked is reported alongside it.
    unit: { singular: 'pair', plural: 'pairs' },
    metricKeys: ['annotationsLinked'],
  },
};

export function isWorkflowType(value: unknown): value is WorkflowType {
  return (
    typeof value === 'string' &&
    (WORKFLOW_TYPES as readonly string[]).includes(value)
  );
}

export function isMetricAllowed(
  workflowType: WorkflowType,
  metricKey: string
): metricKey is WorkflowMetricKey {
  return (WORKFLOW_REGISTRY[workflowType].metricKeys as readonly string[]).includes(
    metricKey
  );
}
