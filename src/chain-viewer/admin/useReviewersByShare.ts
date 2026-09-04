import { useQuery } from '@tanstack/react-query';
import { client } from '../../stores/appClient';
import type { UserType } from '../../../amplify/shared/types';

const PREFIX = 'chainshare-';

/** Shape of the Cognito AdminListGroupsForUser response (returned as JSON). */
type GroupsResponse = {
  Groups?: Array<{ GroupName?: string }>;
  NextToken?: string;
};

/**
 * Maps each user to the chain-share groups they belong to, then buckets users
 * by share id — i.e. "who can currently see share X". There is no
 * `listUsersInGroup` API, so we fan out `listGroupsForUser` across the user
 * list (one pass covers every share). Sysadmin-only and bounded by user count;
 * cached so the Manage Shares table doesn't refetch per render.
 */
export function useReviewersByShare(users: UserType[]) {

  return useQuery<Map<string, UserType[]>>({
    queryKey: ['reviewers-by-share', users.map((u) => u.id).sort()],
    enabled: users.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const byShare = new Map<string, UserType[]>();
      await Promise.all(
        users.map(async (user) => {
          const groups: string[] = [];
          let nextToken: string | undefined;
          do {
            const { data } = await client.queries.listGroupsForUser({
              userId: user.id,
              ...(nextToken ? { nextToken } : {}),
            });
            const parsed = (
              typeof data === 'string' ? JSON.parse(data) : (data ?? {})
            ) as GroupsResponse;
            for (const g of parsed.Groups ?? []) {
              if (g.GroupName) groups.push(g.GroupName);
            }
            nextToken = parsed.NextToken ?? undefined;
          } while (nextToken);

          for (const groupName of groups) {
            if (!groupName.startsWith(PREFIX)) continue;
            const shareId = groupName.slice(PREFIX.length);
            const list = byShare.get(shareId) ?? [];
            list.push(user);
            byShare.set(shareId, list);
          }
        })
      );
      return byShare;
    },
  });
}
