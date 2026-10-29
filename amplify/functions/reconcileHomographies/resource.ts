import { defineFunction } from '@aws-amplify/backend';

export const reconcileHomographies = defineFunction({
  name: 'reconcileHomographies',
  timeoutSeconds: 900,
  runtime: 24,
  memoryMB: 2048,
});
