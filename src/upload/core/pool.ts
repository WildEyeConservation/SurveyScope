// Shared worker pool: stop on abort/error, then rethrow the first failure.
export async function runPool<T>(
  items: Iterable<T>,
  concurrency: number,
  worker: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const iterator = items[Symbol.iterator]();
  let firstError: unknown;
  let errored = false;

  const run = async () => {
    while (!signal?.aborted && !errored) {
      const next = iterator.next();
      if (next.done) return;
      try {
        await worker(next.value);
      } catch (err) {
        if (!errored) {
          errored = true;
          firstError = err;
        }
        return;
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.max(1, concurrency); i++) workers.push(run());
  await Promise.all(workers);

  if (errored) throw firstError;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      done();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
