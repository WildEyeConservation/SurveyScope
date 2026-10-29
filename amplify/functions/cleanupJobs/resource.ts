import { defineFunction } from "@aws-amplify/backend";

export const cleanupJobs = defineFunction({
  name: "cleanupJobs",
  schedule: "every 1m",
  timeoutSeconds: 60,
  entry: "./handler.ts",
  runtime: 24,
});
