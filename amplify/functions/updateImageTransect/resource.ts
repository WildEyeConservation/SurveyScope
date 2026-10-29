import { defineFunction } from '@aws-amplify/backend';

export const updateImageTransect = defineFunction({
  name: 'updateImageTransect',
  entry: './handler.ts',
  timeoutSeconds: 120,
  runtime: 24,
  memoryMB: 512,
});
