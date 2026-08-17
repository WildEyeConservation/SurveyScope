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
  sightings: { label: 'Sightings', unit: 'count' },
  annotationsAdded: { label: 'Annotations added', unit: 'count' },
  emptySearches: { label: 'Empty searches', unit: 'count' },
  searchTimeMs: { label: 'Search time', unit: 'milliseconds' },
  annotationTimeMs: { label: 'Annotation time', unit: 'milliseconds' },
  missedAnimalsFound: { label: 'Missed animals found', unit: 'count' },
  approved: { label: 'Approved', unit: 'count' },
  relabelled: { label: 'Relabelled', unit: 'count' },
  falsePositive: { label: 'False positives', unit: 'count' },
  annotationsTagged: { label: 'Annotations tagged', unit: 'count' },
  tagsAdded: { label: 'Tags added', unit: 'count' },
  tagsRemoved: { label: 'Tags removed', unit: 'count' },
  markersRepositioned: { label: 'Markers repositioned', unit: 'count' },
  saved: { label: 'Saved', unit: 'count' },
  controlPointPairs: { label: 'Control-point pairs', unit: 'count' },
  suggestedPointsRetained: {
    label: 'Suggested points retained',
    unit: 'count',
  },
  annotationsLinked: { label: 'Annotations linked', unit: 'count' },
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
