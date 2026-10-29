import { defineFunction } from '@aws-amplify/backend';

export const deleteProject = defineFunction({
  name: 'deleteProject',
  timeoutSeconds: 900,
  entry: './handler.ts',
  runtime: 24,
});