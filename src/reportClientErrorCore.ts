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

export function describeError(error: unknown): ClientErrorDetails | null {
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

export function graphqlErrorMessage(error: unknown): string {
  const errors = (error as { errors?: { message?: string }[] } | null)?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((e) => e?.message ?? 'Unknown error').join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}
