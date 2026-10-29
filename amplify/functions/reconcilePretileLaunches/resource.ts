import { defineFunction } from '@aws-amplify/backend';

export const reconcilePretileLaunches = defineFunction({
  name: 'reconcilePretileLaunches',
  entry: './handler.ts',
  runtime: 24,
  schedule: 'every 5m',
  timeoutSeconds: 300,
  memoryMB: 1024,
});
