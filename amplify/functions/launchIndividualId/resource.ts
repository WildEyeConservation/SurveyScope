import { defineFunction } from '@aws-amplify/backend';

export const launchIndividualId = defineFunction({
  name: 'launchIndividualId',
  resourceGroupName: 'launchers',
  entry: './handler.ts',
  timeoutSeconds: 900,
  runtime: 24,
  memoryMB: 2048,
});
