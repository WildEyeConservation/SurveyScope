import { defineFunction } from '@aws-amplify/backend';

export const extendTileLifecycles = defineFunction({
  name: 'extendTileLifecycles',
  entry: './handler.ts',
  runtime: 24,
  schedule: 'every day',
  timeoutSeconds: 900,
  memoryMB: 512,
});
