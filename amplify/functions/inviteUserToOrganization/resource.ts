import { defineFunction } from '@aws-amplify/backend';

export const inviteUserToOrganization = defineFunction({
  name: 'inviteUserToOrganization',
  entry: './handler.ts',
  runtime: 24,
  timeoutSeconds: 60,
});
