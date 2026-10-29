import { defineFunction } from '@aws-amplify/backend';

export const getRowChunk = defineFunction({
  name: 'getRowChunk',
  // Reads the model tables directly; in the data stack to avoid a cycle.
  resourceGroupName: 'data',
  entry: './handler.ts',
  runtime: 24,
  timeoutSeconds: 30,
  // More memory buys more CPU for gzip.
  memoryMB: 2048,
});
