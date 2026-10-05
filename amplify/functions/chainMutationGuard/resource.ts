import { defineFunction } from '@aws-amplify/backend';

export const chainMutationGuard = defineFunction({
  name: 'chainMutationGuard',
  resourceGroupName: 'data',
  runtime: 20,
  timeoutSeconds: 30,
});
