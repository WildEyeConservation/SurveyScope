import { defineFunction } from "@aws-amplify/backend";

// STATS_RECEIPT_TABLE is injected via addEnvironment in backend.ts (the table
// is created there); declaring it here as well duplicates the generated
// $amplify/env identifier and breaks type checking.
export const updateUserStats = defineFunction({
  name: "updateUserStats",
  runtime: 20,
  timeoutSeconds: 60,
});
