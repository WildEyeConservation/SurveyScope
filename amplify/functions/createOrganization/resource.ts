import { defineFunction } from '@aws-amplify/backend';

export const createOrganization = defineFunction({
  name: 'createOrganization',
  entry: './handler.ts',
  runtime: 24,
  timeoutSeconds: 60,
});
