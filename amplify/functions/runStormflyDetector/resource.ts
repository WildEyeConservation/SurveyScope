import { defineFunction } from '@aws-amplify/backend';

export const runStormflyDetector = defineFunction({
  name: 'runStormflyDetector',
  resourceGroupName: 'launchers',
  timeoutSeconds: 900,
  runtime: 24,
});

