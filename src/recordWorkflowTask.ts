export interface RecordWorkflowTaskInput {
  /** The durable Workflow Run this unit belongs to. */
  workflowRunId: string;
  workItemType: string;
  workItemId: string;
  outcome: string;
  /** Defaults server-side to `<workItemType>:<workItemId>`. */
  idempotencyKey?: string;
  activeTimeMs?: number;
  waitingTimeMs?: number;
  skipped?: boolean;
  metrics?: Record<string, number>;
}

/**
 * Records one completed unit of work for statistics.
 *
 * Deliberately best-effort: statistics must never interfere with the workflow
 * itself, so a failure is logged and swallowed. The server derives the credited
 * user, project, annotation set and organization from the request identity and
 * the named run, so nothing here can be spoofed by a caller.
 *
 * The mutation is resolved at runtime because generated client types come from
 * the deployed outputs, and non-master branches reuse master's outputs.
 */
export async function recordWorkflowTask(
  client: unknown,
  input: RecordWorkflowTaskInput
): Promise<void> {
  try {
    const mutations = (client as { mutations?: Record<string, unknown> })
      .mutations;
    const mutate = mutations?.recordWorkflowTask;
    if (typeof mutate !== 'function') return;

    const response = (await (
      mutate as (
        args: Record<string, unknown>,
        options?: Record<string, unknown>
      ) => Promise<{ errors?: { message?: string }[] }>
    )(
      {
        workflowRunId: input.workflowRunId,
        workItemType: input.workItemType,
        workItemId: input.workItemId,
        outcome: input.outcome,
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
        activeTimeMs: input.activeTimeMs ?? 0,
        waitingTimeMs: input.waitingTimeMs ?? 0,
        skipped: input.skipped ?? false,
        metrics: JSON.stringify(input.metrics ?? {}),
      },
      { retry: false }
    )) ?? {};

    if (response.errors?.length) {
      console.error(
        'Failed to record workflow task',
        response.errors.map((error) => error.message).join('; ')
      );
    }
  } catch (error) {
    console.error('Failed to record workflow task', error);
  }
}
