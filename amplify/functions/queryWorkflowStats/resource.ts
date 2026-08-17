import { defineFunction } from '@aws-amplify/backend';

// Table names are injected from backend.ts. They are pinned literals rather
// than CloudFormation references, so this function can read the workflow
// statistics tables without the function stack depending on any other stack.
export const queryWorkflowStats = defineFunction({
  name: 'queryWorkflowStats',
  runtime: 20,
  timeoutSeconds: 30,
  memoryMB: 512,
});
