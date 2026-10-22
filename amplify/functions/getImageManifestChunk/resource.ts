import { defineFunction } from '@aws-amplify/backend';

export const getImageManifestChunk = defineFunction({
  name: 'getImageManifestChunk',
  // Reads the model tables directly; in the data stack to avoid a cycle.
  resourceGroupName: 'data',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
  // More memory buys more CPU for gzip.
  memoryMB: 2048,
});
