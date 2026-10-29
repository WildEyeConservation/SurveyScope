import { defineFunction } from '@aws-amplify/backend';

export const registrationBucketCleanup = defineFunction({
  name: 'registrationBucketCleanup',
  timeoutSeconds: 900,
  runtime: 24,
});
