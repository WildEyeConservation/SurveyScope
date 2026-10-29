import { defineFunction } from '@aws-amplify/backend';

export const deleteRegistrationNeighbour = defineFunction({
  name: 'deleteRegistrationNeighbour',
  timeoutSeconds: 60,
  runtime: 24,
});
