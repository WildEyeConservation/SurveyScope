import { defineFunction } from '@aws-amplify/backend';

export const launchAnnotationSet = defineFunction({
  name: 'launchAnnotationSet',
  resourceGroupName: 'launchers',
  timeoutSeconds: 900,
  runtime: 24,
});

