import { defineFunction } from '@aws-amplify/backend';

export const processTilingBatch = defineFunction({
  name: 'processTilingBatch',
  resourceGroupName: 'launchers',
  timeoutSeconds: 900,
  entry: './handler.ts',
  runtime: 24,
});

