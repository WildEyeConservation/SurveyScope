import { isRouteErrorResponse } from 'react-router-dom';

export type ClientErrorDetails = {
  message: string;
  stack?: string;
  status?: string;
};

interface ErrorWithDetails {
  message?: string;
  statusText?: string;
  status?: number;
  stack?: string;
}

/** What to report for a value caught by the error page, or null for nothing. */
export function describeError(error: unknown): ClientErrorDetails | null {
  // A mistyped or stale URL is not a crash.
  if (isRouteErrorResponse(error) && error.status === 404) return null;

  const details = (error ?? {}) as ErrorWithDetails;
  return {
    message:
      typeof error === 'string'
        ? error
        : details.message || details.statusText || 'Unknown error',
    stack: typeof details.stack === 'string' ? details.stack : undefined,
    status: details.status != null ? String(details.status) : undefined,
  };
}

/**
 * Decides which errors are worth sending. A crash that re-renders the error
 * page, or a crash loop, must not turn into a stream of identical reports, so
 * each distinct error is allowed once, up to `maxReports` in total.
 */
export function createReportBudget(
  maxReports: number
): (details: ClientErrorDetails) => boolean {
  const reported = new Set<string>();
  return (details) => {
    const key = `${details.message}\n${details.stack ?? ''}`;
    if (reported.has(key) || reported.size >= maxReports) return false;
    reported.add(key);
    return true;
  };
}

/**
 * Amplify rejects with the raw `{ data, errors }` response when GraphQL reports
 * errors. Turns that, or anything else thrown, into a readable message.
 */
export function graphqlErrorMessage(error: unknown): string {
  const errors = (error as { errors?: { message?: string }[] } | null)?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e) => e?.message ?? 'Unknown error').join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}
