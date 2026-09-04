import { useQuery } from '@tanstack/react-query';
import type { UserType } from '../../amplify/shared/types';
import { client } from '../stores/appClient';

export function useAllUsers() {
  const { data } = useQuery({
    queryKey: ['allUsers'],
    queryFn: async () => {
      let nextToken: string | null | undefined = undefined;
      const aggregated: UserType[] = [];
      do {
        const { data } = await client.queries.listUsers(
          nextToken ? { nextToken } : {}
        );
        const users = data?.Users as UserType[] | undefined;
        if (users) aggregated.push(...users);
        nextToken = data?.NextToken ?? null;
      } while (nextToken);
      return aggregated;
    },
    // The old hook refetched on every mount; keep that freshness while still
    // sharing one in-flight request between simultaneous callers.
    staleTime: 0,
  });

  return { users: data ?? [] };
}
