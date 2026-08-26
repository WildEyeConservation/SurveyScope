import { WORKFLOW_REGISTRY, type WorkflowType } from './workflowRegistry';
import type { WorkflowContribution } from './workflowStatsSections';

export interface WorkflowEvent {
  eventId: string;
  workflowType: string;
  workflowRunId: string;
  annotationSetId: string;
  userId: string;
  workItemType: string;
  workItemId: string;
  startedAt?: string;
  completedAt: string;
  activeTimeMs: number;
  waitingTimeMs: number;
  outcome: string;
  skipped: boolean;
  metrics: Record<string, number>;
}

export interface WorkflowEventsRequest {
  projectId: string;
  runIds: string[];
  /** ISO timestamps; either bound may be omitted. */
  startAt?: string;
  endAt?: string;
}

interface QueryPage {
  events?: WorkflowEvent[];
  nextToken?: string | null;
}

type EventsQuery = (
  input: Record<string, unknown>
) => Promise<{ data?: unknown; errors?: { message?: string }[] }>;

// Resolved at runtime for the same reason as queryWorkflowStats: generated
// client types come from the deployed outputs, which may predate this query.
function resolveEventsQuery(client: unknown): EventsQuery | undefined {
  const queries = (client as { queries?: Record<string, unknown> }).queries;
  const query = queries?.queryWorkflowEvents;
  return typeof query === 'function' ? (query as EventsQuery) : undefined;
}

export const EVENTS_QUERY_UNAVAILABLE =
  'The workflow events query is not available in this environment yet. It ships with the backend deploy that adds it.';

/**
 * Pages through every task event for the given runs. `onProgress` receives
 * the running total so a long export can report where it is.
 */
export async function fetchAllWorkflowEvents(
  client: unknown,
  request: WorkflowEventsRequest,
  onProgress?: (count: number) => void
): Promise<WorkflowEvent[]> {
  const query = resolveEventsQuery(client);
  if (!query) throw new Error(EVENTS_QUERY_UNAVAILABLE);
  if (request.runIds.length === 0) return [];

  const events: WorkflowEvent[] = [];
  let nextToken: string | null | undefined;
  do {
    const { data, errors } = await query({
      projectId: request.projectId,
      runIds: request.runIds,
      startAt: request.startAt,
      endAt: request.endAt,
      nextToken: nextToken ?? undefined,
    });
    if (errors?.length) {
      throw new Error(
        errors.map((entry) => entry.message ?? 'Unknown error').join('; ')
      );
    }
    const page = (
      typeof data === 'string' ? JSON.parse(data) : data ?? {}
    ) as QueryPage;
    events.push(...(page.events ?? []));
    onProgress?.(events.length);
    nextToken = page.nextToken;
  } while (nextToken);
  return events;
}

export function eventToContribution(event: WorkflowEvent): WorkflowContribution {
  return {
    workflowType: event.workflowType,
    userId: event.userId,
    completedUnits: 1,
    skippedUnits: event.skipped ? 1 : 0,
    activeTimeMs: event.activeTimeMs,
    waitingTimeMs: event.waitingTimeMs,
    metrics: event.metrics,
  };
}

export function eventToCsvRow(
  event: WorkflowEvent,
  userName: (userId: string) => string,
  runName: (runId: string) => string
): Record<string, string | number | boolean> {
  return {
    workflow:
      WORKFLOW_REGISTRY[event.workflowType as WorkflowType]?.label ??
      event.workflowType,
    workflowType: event.workflowType,
    run: runName(event.workflowRunId),
    workflowRunId: event.workflowRunId,
    annotationSetId: event.annotationSetId,
    user: userName(event.userId),
    userId: event.userId,
    workItemType: event.workItemType,
    workItemId: event.workItemId,
    startedAt: event.startedAt ?? '',
    completedAt: event.completedAt,
    activeTimeMs: event.activeTimeMs,
    waitingTimeMs: event.waitingTimeMs,
    outcome: event.outcome,
    skipped: event.skipped,
    ...Object.fromEntries(
      Object.entries(event.metrics).map(([key, value]) => [
        `metric_${key}`,
        value,
      ])
    ),
    eventId: event.eventId,
  };
}
