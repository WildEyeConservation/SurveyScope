import { defineFunction } from '@aws-amplify/backend';

export const runOwlDDetector = defineFunction({
  name: 'runOwlDDetector',
  resourceGroupName: 'launchers',
  timeoutSeconds: 900,
  runtime: 24,
});