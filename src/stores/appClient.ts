import outputs from '../../amplify_outputs.json';
import { limitedClient } from '../limitedClient';
import type { BackendOutputs } from '../Context';

// Static app client. No React needed: import this directly instead of going
// through GlobalContext when you only need the API client, backend outputs,
// or region. Keeps data access independent of tree position.
export const appClient = limitedClient;
export const backendOutputs = outputs as BackendOutputs;
export const appRegion: string = outputs.auth.aws_region;

export function useAppClient() {
  return { client: appClient, backend: backendOutputs, region: appRegion };
}
