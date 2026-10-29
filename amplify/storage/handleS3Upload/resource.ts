import { defineFunction } from '@aws-amplify/backend';

export const handleS3Upload =
    //(imageTable: string, outputBucketName: string) =>
    defineFunction({
    name: 'handleS3Upload',
    entry: './app.mjs',
        runtime: 24,
        timeoutSeconds: 720,
    memoryMB: 4096,
    environment: {
        // Eager tiling is disabled by default — workflow launches now pre-tile
        // only the images they actually need via the pretileImage worker.
        EAGER_TILING_ENABLED: 'false',
    },
    });