export interface EventTotals {
  workflowType: string;
  userId: string;
  completedUnits: number;
  skippedUnits: number;
  activeTimeMs: number;
  waitingTimeMs: number;
  metrics: Record<string, number>;
}

// Drop annotationsProcessed if any event lacks it.
export function summariseEvents(
  events: {
    workflowType: string;
    userId: string;
    skipped: boolean;
    activeTimeMs: number;
    waitingTimeMs: number;
    metrics: Record<string, number>;
  }[],
): EventTotals[] {
  const groups = new Map<string, EventTotals & { partial: boolean }>();
  for (const event of events) {
    const key = `${event.workflowType}\u0000${event.userId}`;
    const group = groups.get(key) ?? {
      workflowType: event.workflowType,
      userId: event.userId,
      completedUnits: 0,
      skippedUnits: 0,
      activeTimeMs: 0,
      waitingTimeMs: 0,
      metrics: {},
      partial: false,
    };
    group.completedUnits += 1;
    group.skippedUnits += event.skipped ? 1 : 0;
    group.activeTimeMs += event.activeTimeMs;
    group.waitingTimeMs += event.waitingTimeMs;
    if (event.metrics.annotationsProcessed === undefined) group.partial = true;
    for (const [name, value] of Object.entries(event.metrics)) {
      group.metrics[name] = (group.metrics[name] ?? 0) + value;
    }
    groups.set(key, group);
  }
  return [...groups.values()].map(({ partial, ...totals }) => {
    if (partial) delete totals.metrics.annotationsProcessed;
    return totals;
  });
}
