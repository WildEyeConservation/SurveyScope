import { defineFunction } from '@aws-amplify/backend';

export const claimIndividualIdTransect = defineFunction({
  name: 'claimIndividualIdTransect',
  entry: './handler.ts',
  timeoutSeconds: 30,
  runtime: 24,
});
