import { defineFunction } from '@aws-amplify/backend';

export const refreshTiles = defineFunction({
  name: 'refreshTiles',
  entry: './handler.mjs',
  runtime: 24,
  timeoutSeconds: 120,
  memoryMB: 512,
});
