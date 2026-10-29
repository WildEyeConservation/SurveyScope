import { defineFunction } from '@aws-amplify/backend';

export const runMadDetector = defineFunction({
  name: 'runMadDetector',
  timeoutSeconds: 900,
  runtime: 24,
});


