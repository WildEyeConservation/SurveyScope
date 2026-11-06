import { defineFunction } from '@aws-amplify/backend';

export const monitorTilingTasks = defineFunction({
  name: 'monitorTilingTasks',
  resourceGroupName: 'scheduled',
  schedule: 'every 15m',
  timeoutSeconds: 900,
  entry: './handler.ts',
  runtime: 24,
});

