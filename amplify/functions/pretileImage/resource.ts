import { defineFunction } from '@aws-amplify/backend';

export const pretileImage = defineFunction({
  name: 'pretileImage',
  entry: './handler.mjs',
  runtime: 24,
  timeoutSeconds: 600,
  memoryMB: 3008,
});
