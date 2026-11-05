export interface StatsBucket {
  workflowType: string;
  annotationSetId: string;
  date: string;
  userId: string;
  workflowRunId: string;
  completedUnits: number;
  skippedUnits: number;
  activeTimeMs: number;
  waitingTimeMs: number;
  metrics: Record<string, number>;
}

export interface RunSummary {
  runId: string;
  workflowType: string;
  annotationSetId: string;
  displayName: string;
  status: string;
  launchedAt: string;
  finishedAt?: string | null;
  finishReason?: string | null;
}

export interface StatsQueryResult {
  buckets?: StatsBucket[];
  runs?: RunSummary[];
  truncated?: boolean;
}

interface QueryWorkflowStatsInput {
  projectId: string;
  annotationSetIds: string[];
  startDate?: string;
  endDate?: string;
}

// Generated client types may omit queries that are not deployed yet.
export function resolveStatsQuery(client: unknown) {
  const queries = (client as { queries?: Record<string, unknown> }).queries;
  const query = queries?.queryWorkflowStats;
  return typeof query === 'function'
    ? (query as (
        input: QueryWorkflowStatsInput,
      ) => Promise<{ data?: unknown; errors?: { message?: string }[] }>)
    : undefined;
}
