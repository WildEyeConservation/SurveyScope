import { defineFunction } from '@aws-amplify/backend';

export const launchAnnotationSet = defineFunction({
  name: 'launchAnnotationSet',
  timeoutSeconds: 900,
  memoryMB: 3008,
  runtime: 24,
});
