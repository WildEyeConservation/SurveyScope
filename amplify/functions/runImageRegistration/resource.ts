import { defineFunction } from '@aws-amplify/backend';

export const runImageRegistration = defineFunction({
  name: 'runImageRegistration',
  resourceGroupName: 'launchers',
  timeoutSeconds: 900,
  runtime: 24,
});