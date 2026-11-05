import { useContext, useEffect, useState } from 'react';
import type { UserType } from '../amplify/shared/types';
import { GlobalContext } from './Context';

export const useUsers = () => {
  const { client } = useContext(GlobalContext)!;
  const [result, setResult] = useState<UserType[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let isMounted = true;
    const fetchAllUsers = async () => {
      try {
        let nextToken: string | null | undefined = undefined;
        const aggregated: UserType[] = [];
        do {
          const { data } = await client.queries.listUsers(
            nextToken ? { nextToken } : {},
          );
          const users = data?.Users as UserType[] | undefined;
          if (users) aggregated.push(...users);
          nextToken = data?.NextToken ?? null;
        } while (nextToken);
        if (isMounted) setResult(aggregated);
      } catch (error) {
        console.error('Failed to list users', error);
      } finally {
        if (isMounted) setLoaded(true);
      }
    };
    fetchAllUsers();
    return () => {
      isMounted = false;
    };
  }, [client]);
  return { users: result, loaded };
};
