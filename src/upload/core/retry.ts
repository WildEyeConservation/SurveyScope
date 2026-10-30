import { sleep } from './pool';

// Error classification for upload retry/backoff decisions.
export type ErrorClass = 'retryable' | 'fatal';

/** Marks an error as never worth retrying. */
export class FatalUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalUploadError';
  }
}

/** Extracts a human-readable message, including Amplify GraphQL error arrays. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (Array.isArray(err)) {
    const messages = err
      .map((e) =>
        e && typeof e === 'object' && 'message' in e ? String(e.message) : null,
      )
      .filter(Boolean);
    if (messages.length > 0) return messages.join('; ');
  }
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === 'string') return rec.message;
    if (Array.isArray(rec.errors)) return errorMessage(rec.errors);
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') return json;
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

const FATAL_PATTERNS = [
  'unauthorized',
  'not authorized',
  'forbidden',
  'access denied',
  'accessdenied',
  'validation',
  'invalid input',
  'malformed',
  'unsupported',
];

export function classifyError(err: unknown): ErrorClass {
  if (err instanceof FatalUploadError) return 'fatal';
  // Offline is retryable by definition; the orchestrator additionally
  // auto-pauses on the browser offline event.
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'retryable';
  const msg = errorMessage(err).toLowerCase();
  if (FATAL_PATTERNS.some((p) => msg.includes(p))) return 'fatal';
  return 'retryable';
}

/** Jittered exponential backoff (1s base, capped), attempt is 1-based. */
export function backoffDelayMs(
  attempt: number,
  baseMs = 1000,
  maxMs = 300000,
): number {
  return (
    Math.min(baseMs * Math.pow(2, attempt - 1), maxMs) + Math.random() * 1000
  );
}

/**
 * Retries `fn` on retryable errors with jittered backoff. Fatal errors and
 * exhausted attempts rethrow. Aborting the signal stops further attempts
 * (the abort itself surfaces as the last error).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; baseDelayMs?: number; signal?: AbortSignal },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (
        attempt >= maxAttempts ||
        classifyError(err) === 'fatal' ||
        opts?.signal?.aborted
      ) {
        throw err;
      }
      await sleep(
        backoffDelayMs(attempt, opts?.baseDelayMs ?? 1000, 8000),
        opts?.signal,
      );
    }
  }
}

/**
 * Amplify's data client reports GraphQL failures via `errors` instead of
 * throwing. Normalizes that into a throw so retry/classification applies,
 * and narrows `data` to non-null on success.
 */
export function unwrap<T>(result: {
  data?: T | null;
  errors?: { message?: string }[] | null;
}): T {
  if (result.errors && result.errors.length > 0) {
    throw new Error(errorMessage(result.errors));
  }
  if (result.data === null || result.data === undefined) {
    throw new Error('Mutation returned no data');
  }
  return result.data;
}
