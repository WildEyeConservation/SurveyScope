import { defineFunction } from '@aws-amplify/backend';

export const handleUpload = defineFunction({
    name: 'handleUpload',
    runtime: 24,
});