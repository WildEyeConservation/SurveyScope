import { defineFunction } from '@aws-amplify/backend';

export const launchHomography = defineFunction({
  name: 'launchHomography',
  timeoutSeconds: 900,
  runtime: 24,
  memoryMB: 2048,
});
