import { defineFunction } from '@aws-amplify/backend';

export const requeueProjectQueues = defineFunction({
  name: 'requeueProjectQueues',
  timeoutSeconds: 900,
  schedule: '0 0 * * ? *',
  runtime: 24,
});

