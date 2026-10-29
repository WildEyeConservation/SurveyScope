import { defineFunction } from '@aws-amplify/backend';

export const removeUserFromOrganization = defineFunction({
  name: 'removeUserFromOrganization',
  entry: './handler.ts',
  runtime: 24,
  timeoutSeconds: 60,
});
