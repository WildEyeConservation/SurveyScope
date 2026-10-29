import { defineFunction } from '@aws-amplify/backend';

export const respondToInvite = defineFunction({
  name: 'respondToInvite',
  entry: './handler.ts',
  runtime: 24,
  timeoutSeconds: 60,
});
