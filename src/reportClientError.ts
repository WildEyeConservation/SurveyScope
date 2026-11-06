// Configures Amplify.

import './limitedClient';

import { apiRequest } from './api/httpClient';
import {
  createReportBudget,
  describeError,
  graphqlErrorMessage,
} from './reportClientErrorCore';

const shouldReport = createReportBudget(5);

export async function reportClientError(error: unknown): Promise<void> {
  if (process.env.NODE_ENV === 'development') return;

  const details = describeError(error);
  if (!details || !shouldReport(details)) return;

  try {
    const result = (await apiRequest('/operation', {
      type: 'mutation',
      name: 'reportClientError',
      args: {
        ...details,
        url: window.location.href,
        userAgent: navigator.userAgent,
      },
    })) as { errors?: unknown[] } | null;
    if (result?.errors?.length) throw result;
  } catch (reportingError) {
    console.error(
      'Failed to report the error automatically:',
      graphqlErrorMessage(reportingError),
    );
  }
}
