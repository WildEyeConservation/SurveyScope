import { defineFunction } from '@aws-amplify/backend';

export const launchInfoTags = defineFunction({
  name: 'launchInfoTags',
  timeoutSeconds: 900,
  runtime: 24,
  memoryMB: 2048,
});
