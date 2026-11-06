import { defineFunction } from '@aws-amplify/backend';

export const releaseIndividualIdTransects = defineFunction({
  name: 'releaseIndividualIdTransects',
  resourceGroupName: 'scheduled',
  entry: './handler.ts',
  schedule: 'every 10m',
  timeoutSeconds: 120,
  runtime: 24,
});
