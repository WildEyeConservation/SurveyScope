import { defineFunction } from '@aws-amplify/backend';

// Table names are injected from backend.ts as pinned literals, matching
// queryWorkflowStats, so this function stack does not depend on the
// DetwebWorkflowStats stack.
export const queryWorkflowEvents = defineFunction({
  name: 'queryWorkflowEvents',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 512,
});
