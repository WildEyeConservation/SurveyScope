import { defineFunction } from '@aws-amplify/backend';

export const monitorTilingTasks = defineFunction({
  name: 'monitorTilingTasks',
  schedule: 'every 15m',
  timeoutSeconds: 900,
  entry: './handler.ts',
  runtime: 24,
});

