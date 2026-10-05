import { generateClient } from 'aws-amplify/api';
// Configures Amplify.
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

const shouldReport = createReportBudget(5);

export async function reportClientError(error: unknown): Promise<void> {
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
