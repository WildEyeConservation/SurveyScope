export type BufferedEntry<T extends object> = T & { id: string };

/** Insert an urgent task without discarding already-preloaded entries. */
export function insertBufferedTaskAfter<T extends object>(
  buffer: BufferedEntry<T>[],
  index: number,
  task: T,
  id: string
): BufferedEntry<T>[] {
  return [
    ...buffer.slice(0, index + 1),
    { ...task, id },
    ...buffer.slice(index + 1),
  ];
}

/** Move an already-mounted standby entry into the active sequence. */
export function promoteStandbyTaskAfter<T extends object>(
  buffer: BufferedEntry<T>[],
  index: number,
  standby: BufferedEntry<T>,
  overrides?: Partial<T>
): BufferedEntry<T>[] {
  const promoted = overrides
    ? { ...standby, ...overrides, id: standby.id }
    : standby;
  return [
    ...buffer.slice(0, index + 1),
    promoted,
    ...buffer.slice(index + 1),
  ];
}
