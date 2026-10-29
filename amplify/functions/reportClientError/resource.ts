import { defineFunction } from '@aws-amplify/backend';

export const reportClientError = defineFunction({
  name: 'reportClientError',
  entry: './handler.ts',
  runtime: 24,
  timeoutSeconds: 15,
});
