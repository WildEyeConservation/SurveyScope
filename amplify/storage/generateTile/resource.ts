import { defineFunction } from '@aws-amplify/backend-function';

export const generateTile = defineFunction({
  name: 'generateTile',
  resourceGroupName: 'data',
  entry: './handler.mjs',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 2048,
});
