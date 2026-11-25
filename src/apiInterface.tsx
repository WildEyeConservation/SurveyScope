import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { UserType } from '../amplify/shared/types';
import { GlobalContext } from './Context';

export const useUsers = () => {
  const { client } = useContext(GlobalContext)!;
  const [result, setResult] = useState<UserType[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
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
  }, [client, version]);
  // A new member joins their organisation group a moment after the membership.
  const retry = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(retry.current), []);
  const reload = useCallback(() => {
    setVersion((v) => v + 1);
    clearTimeout(retry.current);
    retry.current = setTimeout(() => setVersion((v) => v + 1), 5000);
  }, []);
  return { users: result, loaded, reload };
};
