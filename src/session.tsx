import { createContext, useCallback, useContext, useMemo } from 'react';
import { SQSClient } from '@aws-sdk/client-sqs';
import { AuthUser, fetchAuthSession } from '@aws-amplify/auth';
import { appRegion } from './stores/appClient';

// Identity is the one thing that is genuinely global to the signed-in app.
// Everything else (server data, UI state) lives in query hooks or stores.
export interface Session {
  user: AuthUser;
  cognitoGroups: string[];
  isSysadmin: boolean;
  getSqsClient: () => Promise<SQSClient>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  user,
  cognitoGroups,
  children,
}: {
  user: AuthUser;
  cognitoGroups: string[];
  children: React.ReactNode;
}) {
  const getSqsClient = useCallback(async () => {
    const { credentials } = await fetchAuthSession();
    return new SQSClient({ region: appRegion, credentials });
  }, []);
  const value = useMemo<Session>(
    () => ({
      user,
      cognitoGroups,
      isSysadmin: cognitoGroups.includes('sysadmin'),
      getSqsClient,
    }),
    [user, cognitoGroups, getSqsClient]
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return session;
}
