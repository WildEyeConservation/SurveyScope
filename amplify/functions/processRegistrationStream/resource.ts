import { defineFunction } from '@aws-amplify/backend';

export const processRegistrationStream = defineFunction({
  name: 'processRegistrationStream',
  timeoutSeconds: 60,
  runtime: 24,
});
