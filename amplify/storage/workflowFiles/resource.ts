import { defineFunction } from '@aws-amplify/backend-function';

export const workflowFiles = defineFunction({
  name: 'workflowFiles',
  resourceGroupName: 'data',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 512,
});
