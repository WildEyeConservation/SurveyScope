export type ClientCallOptions = {
  /** Set to false to skip retry logic (e.g. for long-running launch mutations). Defaults to true. */
  retry?: boolean;
  /** Aborting drops the request if it is still queued and cancels it if in flight. */
  signal?: AbortSignal;
};

export function splitCallOptions(args: unknown[]): {
  args: unknown[];
  options: ClientCallOptions;
} {
  const lastArg = args[args.length - 1];
  if (
    !lastArg ||
    typeof lastArg !== 'object' ||
    !('retry' in lastArg || 'signal' in lastArg)
  ) {
    return { args, options: {} };
  }
  const { retry, signal, ...rest } = lastArg as ClientCallOptions &
    Record<string, unknown>;
  return {
    args: Object.keys(rest).length
      ? [...args.slice(0, -1), rest]
      : args.slice(0, -1),
    options: { retry, signal },
  };
}

export function startCancellable<T>(
  start: () => T,
  signal: AbortSignal | undefined,
  cancel: (request: Promise<unknown>) => void
): T {
  signal?.throwIfAborted();
  const request = start();
  if (!signal || !(request instanceof Promise)) return request;
  const onAbort = () => cancel(request);
  signal.addEventListener('abort', onAbort, { once: true });
  return request.finally(() =>
    signal.removeEventListener('abort', onAbort)
  ) as T;
}
