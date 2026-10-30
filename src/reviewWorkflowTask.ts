import type { RecordWorkflowTaskInput } from './recordWorkflowTask';

/** First completion wins per annotation and run, including after undo/redelivery. */
export function reviewWorkflowTask(input: {
  queueId: string;
  annotationId: string;
  originalCategoryId: string;
  reviewCategoryId: string;
  falsePositive: boolean;
  visibleAt: number | null;
  readyAt: number | null;
  submittedAt: number;
}): RecordWorkflowTaskInput {
  const outcome = input.falsePositive
    ? 'false-positive'
    : input.reviewCategoryId === input.originalCategoryId
      ? 'approved'
      : 'relabelled';
  const visibleAt = input.visibleAt ?? input.submittedAt;
  const readyAt = Math.max(visibleAt, input.readyAt ?? input.submittedAt);
  return {
    workflowRunId: input.queueId,
    workItemType: 'annotation',
    workItemId: input.annotationId,
    idempotencyKey: `annotation:${input.annotationId}`,
    outcome,
    // Review is a short task: bound elapsed work time as for annotated locations.
    activeTimeMs: Math.min(900_000, Math.max(0, input.submittedAt - readyAt)),
    waitingTimeMs: Math.min(
      600_000,
      Math.max(0, Math.min(readyAt, input.submittedAt) - visibleAt),
    ),
    metrics: {
      approved: outcome === 'approved' ? 1 : 0,
      relabelled: outcome === 'relabelled' ? 1 : 0,
      falsePositive: outcome === 'false-positive' ? 1 : 0,
    },
  };
}
