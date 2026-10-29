import { defineFunction } from '@aws-amplify/backend';

export const runScoutbot = defineFunction({
  name: 'runScoutbot',
  timeoutSeconds: 900,
  runtime: 24,
});