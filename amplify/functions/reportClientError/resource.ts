import { defineFunction } from '@aws-amplify/backend';

// Browser-facing sink for crashes that reach the error page. The alert topic
// ARN and environment label are injected from backend.ts.
export const reportClientError = defineFunction({
  name: 'reportClientError',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 15,
});
