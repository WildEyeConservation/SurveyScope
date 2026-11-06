import { defineFunction } from '@aws-amplify/backend';

export const expireInactiveQueues = defineFunction({
  name: 'expireInactiveQueues',
  resourceGroupName: 'scheduled',
  entry: './handler.ts',
  runtime: 24,
  schedule: '0 6 * * ? *',
  timeoutSeconds: 600,
});
