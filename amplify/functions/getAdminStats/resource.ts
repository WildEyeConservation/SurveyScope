import { defineFunction } from '@aws-amplify/backend';

export const getAdminStats = defineFunction({
  name: 'getAdminStats',
  // Reads the admin stats table; in the data stack to avoid a cycle.
  resourceGroupName: 'data',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 512,
});
