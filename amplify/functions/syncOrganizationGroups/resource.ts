import { defineFunction } from '@aws-amplify/backend';

export const syncOrganizationGroups = defineFunction({
  name: 'syncOrganizationGroups',
  entry: './handler.ts',
  runtime: 24,
  timeoutSeconds: 60,
});
