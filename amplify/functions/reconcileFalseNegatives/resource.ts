import { defineFunction } from '@aws-amplify/backend';

export const reconcileFalseNegatives = defineFunction({
  name: 'reconcileFalseNegatives',
  timeoutSeconds: 900,
  runtime: 24,
  memoryMB: 2048,
});
