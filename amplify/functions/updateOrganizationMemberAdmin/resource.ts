import { defineFunction } from '@aws-amplify/backend';

export const updateOrganizationMemberAdmin = defineFunction({
  name: 'updateOrganizationMemberAdmin',
  entry: './handler.ts',
  runtime: 24,
  timeoutSeconds: 60,
});
