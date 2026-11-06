import { defineFunction } from '@aws-amplify/backend';

export const monitorModelProgress = defineFunction({
  name: 'monitorModelProgress',
  resourceGroupName: 'scheduled',
  schedule: 'every 15m',
  timeoutSeconds: 900,
  runtime: 24,
});