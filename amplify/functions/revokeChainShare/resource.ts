import { defineFunction } from '@aws-amplify/backend';

export const revokeChainShare = defineFunction({
  name: 'revokeChainShare',
  resourceGroupName: 'data',
  timeoutSeconds: 900,
  entry: './handler.ts',
  runtime: 20,
});
