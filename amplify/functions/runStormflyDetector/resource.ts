import { defineFunction } from '@aws-amplify/backend';

export const runStormflyDetector = defineFunction({
  name: 'runStormflyDetector',
  timeoutSeconds: 900,
  runtime: 24,
});

