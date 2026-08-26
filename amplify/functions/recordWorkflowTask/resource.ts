import { defineFunction } from '@aws-amplify/backend';

// The browser-facing entry point to the workflow statistics writer. Table names
// are injected from backend.ts as pinned literals so this function needs no
// reference to the DetwebWorkflowStats stack.
export const recordWorkflowTask = defineFunction({
  name: 'recordWorkflowTask',
  runtime: 20,
  timeoutSeconds: 15,
  memoryMB: 512,
});
