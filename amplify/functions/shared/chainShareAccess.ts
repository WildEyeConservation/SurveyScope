import {
  AdminListGroupsForUserCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

export interface ShareMembershipStore {
  share(
    shareId: string,
  ): Promise<{ status?: unknown; group?: unknown } | undefined>;
  groups(username: string): Promise<string[]>;
}

export interface ShareUser {
  sub?: string;
  username?: string;
  groups?: string[] | null;
}

// Reads current Cognito membership so a removed reviewer's token stops working.
export async function isActiveShareReviewer(
  store: ShareMembershipStore,
  user: ShareUser,
  shareId: string,
): Promise<boolean> {
  const group = `chainshare-${shareId}`;
  const share = await store.share(shareId);
  if (share?.status !== 'active' || share.group !== group) return false;
  if (user.groups?.includes('sysadmin')) return true;
  const username = user.username || user.sub;
  if (!username) return false;
  return (await store.groups(username)).includes(group);
}

export async function listUserGroups(
  cognito: CognitoIdentityProviderClient,
  userPoolId: string | undefined,
  username: string,
): Promise<string[]> {
  if (!userPoolId) throw new Error('Missing configuration: USER_POOL_ID');
  const groups: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = await cognito.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        NextToken: nextToken,
      }),
    );
    for (const group of page.Groups ?? [])
      if (group.GroupName) groups.push(group.GroupName);
    nextToken = page.NextToken;
  } while (nextToken);
  return groups;
}
