import { defineFunction } from '@aws-amplify/backend';

export const createChainShare = defineFunction({
  name: 'createChainShare',
  timeoutSeconds: 900,
  entry: './handler.ts',
  runtime: 24,
});
