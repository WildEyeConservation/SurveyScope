import { defineFunction } from '@aws-amplify/backend';

export const deleteQueue = defineFunction({
  name: 'deleteQueue',
  entry: './handler.ts',
  runtime: 24,
  timeoutSeconds: 30,
});
