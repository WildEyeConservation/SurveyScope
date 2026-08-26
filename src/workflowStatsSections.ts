import {
  WORKFLOW_METRIC_DEFINITIONS,
  WORKFLOW_REGISTRY,
  isWorkflowType,
  type WorkflowMetricKey,
} from './workflowRegistry';

/**
 * One unit of credit towards a workflow's per-user totals. Daily stats buckets
 * and individual task events both reduce to this shape, so the statistics
 * screen and the snapshot modal build their tables from the same code.
 */
export interface WorkflowContribution {
  workflowType: string;
  userId: string;
  completedUnits: number;
  skippedUnits: number;
  activeTimeMs: number;
  waitingTimeMs: number;
  metrics: Record<string, number>;
}

export interface TableHeading {
  content: string;
  description?: string;
  sort?: boolean;
}

export interface WorkflowSection {
  workflowType: string;
  label: string;
  unitPlural: string;
  headings: TableHeading[];
  /** One row per user; cells are already formatted for display. */
  rows: { id: string; userId: string; cells: (string | number)[] }[];
  footer: (string | number)[];
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(
    seconds
  ).padStart(2, '0')}`;
}

export function localDateString(date: Date | null): string | undefined {
  if (!date) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Start of the given local day as an ISO timestamp. */
export function localDayStart(date: Date): string {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  ).toISOString();
}

/** End of the given local day as an ISO timestamp. */
export function localDayEnd(date: Date): string {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  ).toISOString();
}

export function metricLabel(key: string): string {
  return WORKFLOW_METRIC_DEFINITIONS[key as WorkflowMetricKey]?.label ?? key;
}

export function metricDescription(key: string): string | undefined {
  return WORKFLOW_METRIC_DEFINITIONS[key as WorkflowMetricKey]?.description;
}

function isDurationMetric(key: string): boolean {
  return (
    WORKFLOW_METRIC_DEFINITIONS[key as WorkflowMetricKey]?.unit ===
    'milliseconds'
  );
}

export function formatMetric(key: string, value: number): string {
  return isDurationMetric(key) ? formatDuration(value) : String(value);
}

// Species Labelling's search speed is search time over empty searches only:
// dividing over sightings as well would dilute it in proportion to how many
// animals were found, which is the opposite of what a search rate should do.
function searchAverage(metrics: Record<string, number>): string {
  const emptySearches = metrics.emptySearches ?? 0;
  return emptySearches > 0
    ? ((metrics.searchTimeMs ?? 0) / 1000 / emptySearches).toFixed(1)
    : '0.0';
}

function perUnitAverage(activeTimeMs: number, completedUnits: number): string {
  return completedUnits > 0
    ? (activeTimeMs / 1000 / completedUnits).toFixed(1)
    : '0.0';
}

export const COMMON_COLUMN_DESCRIPTIONS = {
  username: 'The person credited with the work.',
  completed: (unit: string) =>
    `Number of ${unit} this user completed in the selected period.`,
  skipped: 'Units the user chose to skip rather than complete.',
  timeSpent:
    'Total active time on completed units (H:MM:SS). Excludes waiting time.',
  average: (unit: string) =>
    `Time spent divided by the number of ${unit} completed. Includes every completed unit, whether or not anything was found.`,
  waiting:
    'Time spent waiting for the next unit to load (H:MM:SS). Not counted as time spent.',
  searchAverage:
    'Search time divided by the number of empty searches: how long it takes, on average, to clear a location that has no animals.',
};

interface Totals {
  completedUnits: number;
  skippedUnits: number;
  activeTimeMs: number;
  waitingTimeMs: number;
  metrics: Record<string, number>;
}

function emptyTotals(): Totals {
  return {
    completedUnits: 0,
    skippedUnits: 0,
    activeTimeMs: 0,
    waitingTimeMs: 0,
    metrics: {},
  };
}

function accumulate(totals: Totals, contribution: WorkflowContribution) {
  totals.completedUnits += contribution.completedUnits;
  totals.skippedUnits += contribution.skippedUnits;
  totals.activeTimeMs += contribution.activeTimeMs;
  totals.waitingTimeMs += contribution.waitingTimeMs;
  Object.entries(contribution.metrics).forEach(([key, value]) => {
    totals.metrics[key] = (totals.metrics[key] ?? 0) + value;
  });
}

/**
 * Groups contributions by workflow, then by user, producing one table per
 * workflow. The metric columns come from the shared registry, so an
 * instrumented workflow needs no change here.
 */
export function buildWorkflowSections(
  contributions: WorkflowContribution[],
  userName: (userId: string) => string
): WorkflowSection[] {
  const byWorkflow = new Map<string, WorkflowContribution[]>();
  contributions.forEach((contribution) => {
    const list = byWorkflow.get(contribution.workflowType) ?? [];
    list.push(contribution);
    byWorkflow.set(contribution.workflowType, list);
  });

  return [...byWorkflow.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([workflowType, items]) => {
      const definition = isWorkflowType(workflowType)
        ? WORKFLOW_REGISTRY[workflowType]
        : undefined;
      const metricKeys = definition
        ? definition.metricKeys.filter((key) =>
            items.some((item) => item.metrics[key] !== undefined)
          )
        : [...new Set(items.flatMap((item) => Object.keys(item.metrics)))].sort();

      const unitPlural = definition?.unit.plural ?? 'units';
      const unitSingular = definition?.unit.singular ?? 'unit';
      const showSearchAverage = workflowType === 'species-labelling';

      const byUser = new Map<string, Totals>();
      const overall = emptyTotals();
      items.forEach((item) => {
        const totals = byUser.get(item.userId) ?? emptyTotals();
        accumulate(totals, item);
        byUser.set(item.userId, totals);
        accumulate(overall, item);
      });

      const cellsFor = (totals: Totals): (string | number)[] => [
        totals.completedUnits,
        totals.skippedUnits,
        formatDuration(totals.activeTimeMs),
        perUnitAverage(totals.activeTimeMs, totals.completedUnits),
        ...(showSearchAverage ? [searchAverage(totals.metrics)] : []),
        formatDuration(totals.waitingTimeMs),
        ...metricKeys.map((key) => formatMetric(key, totals.metrics[key] ?? 0)),
      ];

      const rows = [...byUser.entries()]
        .sort(([, left], [, right]) => right.completedUnits - left.completedUnits)
        .map(([userId, totals]) => ({
          id: `${workflowType}:${userId}`,
          userId,
          cells: [userName(userId), ...cellsFor(totals)],
        }));

      return {
        workflowType,
        label: definition?.label ?? workflowType,
        unitPlural,
        headings: [
          {
            content: 'Username',
            description: COMMON_COLUMN_DESCRIPTIONS.username,
          },
          {
            content: `${unitPlural} completed`,
            sort: true,
            description: COMMON_COLUMN_DESCRIPTIONS.completed(unitPlural),
          },
          { content: 'Skipped', description: COMMON_COLUMN_DESCRIPTIONS.skipped },
          {
            content: 'Time spent',
            description: COMMON_COLUMN_DESCRIPTIONS.timeSpent,
          },
          {
            content: `Seconds per ${unitSingular}`,
            description: COMMON_COLUMN_DESCRIPTIONS.average(unitPlural),
          },
          ...(showSearchAverage
            ? [
                {
                  content: 'Seconds per empty search',
                  description: COMMON_COLUMN_DESCRIPTIONS.searchAverage,
                },
              ]
            : []),
          {
            content: 'Waiting time',
            description: COMMON_COLUMN_DESCRIPTIONS.waiting,
          },
          ...metricKeys.map((key) => ({
            content: metricLabel(key),
            description: metricDescription(key),
          })),
        ],
        rows,
        footer: ['All users', ...cellsFor(overall)],
      };
    });
}

/** Flattens a section into CSV-ready rows keyed by its column headings. */
export function sectionToCsvRows(
  section: WorkflowSection
): Record<string, string | number>[] {
  const keys = section.headings.map((heading) => heading.content);
  return [...section.rows.map((row) => row.cells), section.footer].map(
    (cells) => Object.fromEntries(keys.map((key, index) => [key, cells[index]]))
  );
}
