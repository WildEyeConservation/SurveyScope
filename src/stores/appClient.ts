import outputs from '../../amplify_outputs.json';
import { limitedClient } from '../limitedClient';
import type { BackendOutputs } from '../data/types';

// Static app client. No React needed: import these directly. Keeps data
// access independent of tree position.
export const appClient = limitedClient;
export const backendOutputs = outputs as BackendOutputs;
export const appRegion: string = outputs.auth.aws_region;

// Preferred import for components: `import { client } from './stores/appClient'`.
export const client = limitedClient;
