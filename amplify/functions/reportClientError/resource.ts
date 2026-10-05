import { defineFunction } from '@aws-amplify/backend';

export const reportClientError = defineFunction({
  name: 'reportClientError',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 15,
});
