/** Abortable sleep used between retry attempts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Flatten an error (thrown error or a GraphQL error object) to a string. */
type ErrorLike = {
  errorType?: string;
  name?: string;
  code?: string;
  message?: string;
  errors?: unknown;
};

export function errToString(input: unknown): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  const err = input as ErrorLike;
  const parts = [err.errorType, err.name, err.code, err.message].filter(
    Boolean,
  );
  if (Array.isArray(err.errors)) {
    for (const e of err.errors as (ErrorLike | null)[]) {
      parts.push(e?.errorType, e?.message);
    }
  }
  return parts.filter(Boolean).join(' ') || String(input);
}

const TRANSIENT_PATTERNS = [
  'throttl',
  'toomanyrequests',
  'too many requests',
  'rate exceeded',
  'serviceunavailable',
  'service unavailable',
  'internalfailure',
  'internal failure',
  'internalservererror',
  'networkerror',
  'network error',
  'failed to fetch',
  'load failed',
  'timeout',
  'timed out',
  'econnreset',
  '429',
  '502',
  '503',
  '504',
];

/** True for errors worth retrying (throttling / transient network / 5xx). */
function isTransientError(err: unknown): boolean {
  const s = errToString(err).toLowerCase();
  if (!s) return false;
  if (s.includes('abort')) return false; // a cancellation, never retry
  return TRANSIENT_PATTERNS.some((p) => s.includes(p));
}

/** Exponential backoff (capped) with full jitter. */
function backoffDelay(attempt: number, baseDelay: number): number {
  const capped = Math.min(baseDelay * Math.pow(2, attempt - 1), 8000);
  return Math.round(capped / 2 + Math.random() * (capped / 2));
}

interface RunOpOpts {
  retries?: number;
  baseDelay?: number;
  signal?: AbortSignal;
}

/**
 * Run an Amplify data operation with retries. The data client resolves with
 * `{ data, errors }` rather than throwing on GraphQL errors, so we inspect
 * BOTH the thrown path and the returned `errors` array. Transient failures are
 * retried with backoff; a non-transient `errors` array is surfaced as a throw
 * so callers can record a real failure (the previous code silently treated
 * GraphQL errors as success).
 */
export async function runOp<T>(
  fn: () => Promise<T>,
  opts: RunOpOpts = {},
): Promise<T> {
  const { retries = 5, baseDelay = 300, signal } = opts;
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let res: T;
    try {
      res = await fn();
    } catch (err) {
      if (!signal?.aborted && attempt < retries && isTransientError(err)) {
        attempt += 1;
        await sleep(backoffDelay(attempt, baseDelay), signal);
        continue;
      }
      throw err;
    }
    const errors = (res as { errors?: (ErrorLike | null)[] | null } | null)
      ?.errors;
    if (errors && errors.length) {
      if (
        !signal?.aborted &&
        attempt < retries &&
        errors.some(isTransientError)
      ) {
        attempt += 1;
        await sleep(backoffDelay(attempt, baseDelay), signal);
        continue;
      }
      const e = new Error(
        errors.map((x) => x?.message || x?.errorType || String(x)).join('; '),
      ) as Error & { graphQLErrors?: unknown[] };
      e.graphQLErrors = errors;
      throw e;
    }
    return res;
  }
}

/**
 * Wrap a paginated query function so each page request retries via runOp.
 * Returns `any` so it slots into `fetchAllPaginatedResults`' overloaded query
 * parameter without fighting its generic inference (the call sites cast the
 * resulting rows, as the rest of this file does).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeRetrying(queryFn: any, signal?: AbortSignal): any {
  return (...args: unknown[]) =>
    runOp(() => (signal ? queryFn(...args, { signal }) : queryFn(...args)), {
      signal,
    });
}
