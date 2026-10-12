export function createExclusive(onBusy: (key: string | null) => void) {
  let busy = false;
  return async function runExclusive<T>(
    key: string,
    task: () => Promise<T>
  ): Promise<T | undefined> {
    if (busy) return undefined;
    busy = true;
    onBusy(key);
    try {
      return await task();
    } finally {
      busy = false;
      onBusy(null);
    }
  };
}
