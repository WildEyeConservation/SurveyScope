import { defineFunction } from '@aws-amplify/backend';

export const updateAdminStats = defineFunction({
  name: 'updateAdminStats',
  // Reads the model tables directly; in the data stack to avoid a cycle.
  resourceGroupName: 'data',
  entry: './handler.ts',
  runtime: 20,
  schedule: 'every 1h',
  timeoutSeconds: 900,
  memoryMB: 1024,
});
