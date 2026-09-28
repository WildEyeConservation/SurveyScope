import {
  parseLaunchResponse,
  type LaunchMutationResult,
} from '../../survey/launchResponse';

export function checkShareResponse(
  result: LaunchMutationResult | null | undefined,
  description: string
) {
  const body = parseLaunchResponse(result, description);
  if (result?.data == null) throw new Error(`${description}: no response data`);
  return body;
}
