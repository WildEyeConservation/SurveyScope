import { defineFunction } from '@aws-amplify/backend';

export const customMessage = defineFunction({
  name: 'customMessage',
  entry: './handler.ts',
  runtime: 24,
  timeoutSeconds: 5,
});
