import { defineFunction } from '@aws-amplify/backend';

export const reconcileIndividualId = defineFunction({
  name: 'reconcileIndividualId',
  entry: './handler.ts',
  schedule: 'every 5m',
  timeoutSeconds: 300,
  runtime: 24,
  memoryMB: 1024,
});
