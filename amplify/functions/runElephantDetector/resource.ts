import { defineFunction } from '@aws-amplify/backend';

export const runElephantDetector = defineFunction({
  name: 'runElephantDetector',
  resourceGroupName: 'launchers',
  timeoutSeconds: 900,
  runtime: 24,
});
