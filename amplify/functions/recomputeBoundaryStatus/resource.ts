import { defineFunction } from '@aws-amplify/backend';

export const recomputeBoundaryStatus = defineFunction({
  name: 'recomputeBoundaryStatus',
  // Reads the model tables directly; in the data stack to avoid a cycle.
  resourceGroupName: 'data',
  entry: './handler.ts',
  runtime: 20,
  timeoutSeconds: 900,
  memoryMB: 1024,
});
