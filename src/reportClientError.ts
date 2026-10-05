import { generateClient } from 'aws-amplify/api';
import { isRouteErrorResponse } from 'react-router-dom';
// Importing this module configures Amplify, which the error page cannot rely on
// the crashed application having done.
import './limitedClient';

const client = generateClient({ authMode: 'userPool' });

const reportClientErrorMutation = /* GraphQL */ `
  mutation ReportClientError(
    $message: String!
    $stack: String
    $status: String
    $url: String
    $userAgent: String
  ) {
    reportClientError(
      message: $message
      stack: $stack
      status: $status
      url: $url
      userAgent: $userAgent
    )
  }
`;

interface ErrorWithDetails {
  message?: string;
  statusText?: string;
  status?: number;
  stack?: string;
}

// A crash that re-renders the error page, or a crash loop, must not turn into a
// stream of identical emails: each distinct error is sent once per page load,
// up to a small total.
const MAX_REPORTS_PER_PAGE_LOAD = 5;
const reported = new Set<string>();

/**
 * Sends a crash that reached the error page to the sysadmins. Never throws:
 * the error page is the last thing standing, so a failed report is only logged.
 */
export async function reportClientError(error: unknown): Promise<void> {
  // Local development crashes are the developer's own and already on screen.
  if (process.env.NODE_ENV === 'development') return;
  // A mistyped or stale URL is not a crash.
  if (isRouteErrorResponse(error) && error.status === 404) return;

  const details = (error ?? {}) as ErrorWithDetails;
  const message =
    typeof error === 'string'
      ? error
      : details.message || details.statusText || 'Unknown error';
  const stack = typeof details.stack === 'string' ? details.stack : undefined;

  const key = `${message}\n${stack ?? ''}`;
  if (reported.has(key) || reported.size >= MAX_REPORTS_PER_PAGE_LOAD) return;
  reported.add(key);

  try {
    const result = (await client.graphql({
      query: reportClientErrorMutation,
      variables: {
        message,
        stack,
        status: details.status != null ? String(details.status) : undefined,
        url: window.location.href,
        userAgent: navigator.userAgent,
      },
    })) as { errors?: { message: string }[] };
    if (result.errors?.length) {
      throw new Error(result.errors.map((e) => e.message).join('; '));
    }
  } catch (reportingError) {
    console.error('Failed to report the error automatically:', reportingError);
  }
}
