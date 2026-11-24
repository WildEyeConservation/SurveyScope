import { useQuery } from '@tanstack/react-query';
import { useContext, useMemo } from 'react';
import { GlobalContext, UserContext } from '../../Context';
import { extractUserIdFromOwner } from '../../sightingQueries';

type ListedUser = { id: string; name?: string | null; email?: string | null };

// Cached across pair remounts so each pair doesn't re-list every user.
export function useUserNames() {
  const { client } = useContext(GlobalContext)!;
  const viewerId = useContext(UserContext)?.user?.userId;
  const { data } = useQuery({
    queryKey: ['individual-id', 'user-names', viewerId],
    staleTime: Infinity,
    // Holds other users' emails, and the list depends on who is signed in.
    meta: { persist: false },
    queryFn: async () => {
      const users: ListedUser[] = [];
      let nextToken: string | null | undefined = undefined;
      do {
        const args: { nextToken?: string } = nextToken ? { nextToken } : {};
        const { data: page, errors } = await client.queries.listUsers(args);
        if (errors?.length || !page) {
          throw new Error(errors?.[0]?.message ?? 'listUsers returned no data');
        }
        users.push(...((page.Users ?? []) as ListedUser[]));
        nextToken = page.NextToken ?? null;
      } while (nextToken);
      return users;
    },
  });
  return useMemo(() => {
    const byId = new Map<string, string>();
    for (const u of data ?? []) byId.set(u.id, u.name || u.email || u.id);
    return (owner: string | null | undefined) => {
      const id = extractUserIdFromOwner(owner);
      if (!id || !data) return undefined;
      return byId.get(id) ?? id;
    };
  }, [data]);
}
