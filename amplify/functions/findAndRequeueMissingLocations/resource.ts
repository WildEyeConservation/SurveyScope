import { defineFunction } from '@aws-amplify/backend';

export const findAndRequeueMissingLocations = defineFunction({
  name: 'findAndRequeueMissingLocations',
  schedule: 'every 15m',
  timeoutSeconds: 900,  // 15 minutes to handle large location sets
  entry: './handler.ts',
  runtime: 24,
  memoryMB: 1024,  // Extra memory for large sets
});
