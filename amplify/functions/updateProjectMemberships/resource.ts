import { defineFunction } from '@aws-amplify/backend';

export const updateProjectMemberships = defineFunction({
  name: 'updateProjectMemberships',
  entry: './handler.ts',
  timeoutSeconds: 60,
  runtime: 24,
});
