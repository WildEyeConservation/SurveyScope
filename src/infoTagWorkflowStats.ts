export interface InfoTagChange {
  beforeTags: ReadonlySet<string>;
  afterTags: ReadonlySet<string>;
}

/** One initial/final comparison per annotation, so undo does not inflate work. */
export function infoTagWorkflowMetrics(changes: Iterable<InfoTagChange>) {
  const metrics = {
    annotationsProcessed: 0,
    annotationsTagged: 0,
    tagsAdded: 0,
  };
  for (const change of changes) {
    metrics.annotationsProcessed += 1;
    const added = [...change.afterTags].filter(
      (id) => !change.beforeTags.has(id),
    ).length;
    const removed = [...change.beforeTags].filter(
      (id) => !change.afterTags.has(id),
    ).length;
    if (added || removed) metrics.annotationsTagged += 1;
    metrics.tagsAdded += added;
  }
  return metrics;
}
