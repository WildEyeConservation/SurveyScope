import { defineFunction } from '@aws-amplify/backend';

export const requeueProjectQueues = defineFunction({
  name: 'requeueProjectQueues',
  resourceGroupName: 'scheduled',
  timeoutSeconds: 900,
  schedule: '0 0 * * ? *',
  runtime: 24,
});

