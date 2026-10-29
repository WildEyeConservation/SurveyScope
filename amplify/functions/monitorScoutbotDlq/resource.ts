import { defineFunction } from '@aws-amplify/backend';

export const monitorScoutbotDlq = defineFunction({
  name: 'monitorScoutbotDlq',
  schedule: 'every 30m',
  timeoutSeconds: 900,
  entry: './handler.ts',
  runtime: 24,
});

