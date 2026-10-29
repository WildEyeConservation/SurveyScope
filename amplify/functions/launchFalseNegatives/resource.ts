import { defineFunction } from '@aws-amplify/backend';

export const launchFalseNegatives = defineFunction({
  name: 'launchFalseNegatives',
  timeoutSeconds: 900,
  runtime: 24,
  memoryMB: 2048,
});

