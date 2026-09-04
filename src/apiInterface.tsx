import { useState, useEffect } from 'react';
import { client } from './stores/appClient';
import type { UserType } from '../amplify/shared/types';

export const useUsers = () => {
  const [result, setResult] = useState<UserType[]>([]);
  useEffect(() => {
    let isMounted = true;
    const fetchAllUsers = async () => {
      try {
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
        if (isMounted) setResult(aggregated);
      } catch (error) {
        console.error('Failed to list users', error);
      }
    };
    fetchAllUsers();
    return () => {
      isMounted = false;
    };
  }, []);
  return { users: result };
};
