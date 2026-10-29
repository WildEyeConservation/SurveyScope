import { defineFunction } from '@aws-amplify/backend';

export const handleNewUser = defineFunction({
    name: 'handleNewUser',
    environment:{
        GROUP: 'annotator'
    },
    runtime: 24,
});