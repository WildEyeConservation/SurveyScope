import { generateClient } from 'aws-amplify/api';
// Importing this module configures Amplify, which the error page cannot rely on
// the crashed application having done.
import './limitedClient';
import {
  createReportBudget,
  describeError,
  graphqlErrorMessage,
} from './reportClientErrorCore';

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

// Per page load; the server enforces its own per-user limits as well.
const shouldReport = createReportBudget(5);

/**
 * Sends a crash that reached the error page to the sysadmins. Never throws:
 * the error page is the last thing standing, so a failed report is only logged.
 */
export async function reportClientError(error: unknown): Promise<void> {
  // Local development crashes are the developer's own and already on screen.
  if (process.env.NODE_ENV === 'development') return;

  const details = describeError(error);
  if (!details || !shouldReport(details)) return;

  try {
    await client.graphql({
      query: reportClientErrorMutation,
      variables: {
        ...details,
        url: window.location.href,
        userAgent: navigator.userAgent,
      },
    });
  } catch (reportingError) {
    console.error(
      'Failed to report the error automatically:',
      graphqlErrorMessage(reportingError)
    );
  }
}
