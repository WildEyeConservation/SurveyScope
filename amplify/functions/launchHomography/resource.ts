import { defineFunction } from '@aws-amplify/backend';

export const launchHomography = defineFunction({
  name: 'launchHomography',
  resourceGroupName: 'launchers',
  timeoutSeconds: 900,
  runtime: 24,
  memoryMB: 2048,
});
