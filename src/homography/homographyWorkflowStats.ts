import type { RecordWorkflowTaskInput } from '../recordWorkflowTask';

type PointIdentity = { id: string };
export const SUGGESTED_POINT_ID_PREFIX = 'suggested-';

export function countSuggestedPointsKept(points: {
  p1: PointIdentity[];
  p2: PointIdentity[];
}): number {
  return points.p1.filter(
    (point, index) =>
      point.id.startsWith(SUGGESTED_POINT_ID_PREFIX) &&
      point.id === points.p2[index]?.id,
  ).length;
}

export function homographyWorkflowTask(input: {
  runId: string;
  pairKey: string;
  skipped: boolean;
  points: { p1: PointIdentity[]; p2: PointIdentity[] };
  activeTimeMs: number;
  waitingTimeMs: number;
}): RecordWorkflowTaskInput {
  return {
    workflowRunId: input.runId,
    workItemType: 'image-pair',
    workItemId: input.pairKey,
    idempotencyKey: `pair:${input.pairKey}`,
    outcome: input.skipped ? 'skipped' : 'saved',
    skipped: input.skipped,
    activeTimeMs: input.activeTimeMs,
    waitingTimeMs: input.waitingTimeMs,
    metrics: {
      saved: input.skipped ? 0 : 1,
      controlPointPairs: input.skipped
        ? 0
        : Math.min(input.points.p1.length, input.points.p2.length),
      suggestedPointsRetained: input.skipped
        ? 0
        : countSuggestedPointsKept(input.points),
    },
  };
}

/** Persist first; failed writes never receive credit or acknowledge the pair. */
export async function finalizeHomographyTask(options: {
  persist: () => Promise<{ data?: unknown; errors?: { message?: string }[] }>;
  progress: { counted: boolean };
  incrementCount: () => Promise<
    { errors?: { message?: string }[] } | undefined
  >;
  recordStatistics: () => Promise<void>;
  acknowledge: () => Promise<void>;
}) {
  const saved = await options.persist();
  if (!saved.data || saved.errors?.length) {
    throw new Error(
      saved.errors?.map((error) => error.message).join('; ') ||
        'Failed to save homography decision',
    );
  }
  if (!options.progress.counted) {
    const counted = await options.incrementCount();
    if (counted?.errors?.length)
      throw new Error(counted.errors.map((error) => error.message).join('; '));
    options.progress.counted = true;
  }
  await options.recordStatistics();
  await options.acknowledge();
}
