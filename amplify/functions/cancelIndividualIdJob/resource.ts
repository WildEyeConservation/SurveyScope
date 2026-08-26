import { defineFunction } from '@aws-amplify/backend';

export const cancelIndividualIdJob = defineFunction({
  name: 'cancelIndividualIdJob',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 30,
});
