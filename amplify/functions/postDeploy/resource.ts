import { defineFunction } from '@aws-amplify/backend';

export const postDeploy = defineFunction({
    name: 'postDeploy',
    runtime: 24,
});