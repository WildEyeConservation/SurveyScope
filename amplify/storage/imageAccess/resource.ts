import { defineFunction } from '@aws-amplify/backend-function';
export const imageAccess = defineFunction({
  name: 'imageAccess',
  resourceGroupName: 'data',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 512,
});
