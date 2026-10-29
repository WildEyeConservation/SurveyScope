import { defineFunction } from '@aws-amplify/backend';

export const infoTagWork = defineFunction({
  name: 'infoTagWork',
  resourceGroupName: 'data',
  runtime: 24,
  timeoutSeconds: 60,
  memoryMB: 1024,
});
