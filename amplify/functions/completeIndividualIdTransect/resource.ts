import { defineFunction } from '@aws-amplify/backend';

export const completeIndividualIdTransect = defineFunction({
  name: 'completeIndividualIdTransect',
  entry: './handler.ts',
  timeoutSeconds: 60,
  runtime: 24,
});
