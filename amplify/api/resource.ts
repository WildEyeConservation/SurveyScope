import { defineFunction, secret } from '@aws-amplify/backend';

export const api = defineFunction({
  name: 'api',
  resourceGroupName: 'api',
  entry: './handler.ts',
  runtime: 24,
  timeoutSeconds: 30,
  memoryMB: 1024,
  environment: {
    JWT_SECRET: secret('JWT_SECRET'),
  },
});

export const dataEvents = defineFunction({
  name: 'dataEvents',
  resourceGroupName: 'api',
  entry: './publish.ts',
  runtime: 24,
  timeoutSeconds: 60,
});
