import { useSyncExternalStore } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

let groups: string[] = [];
const listeners = new Set<() => void>();

function setGroups(next: string[]) {
  const sorted = [...next].sort();
  if (sorted.join('|') === groups.join('|')) return;
  groups = sorted;
  listeners.forEach((listener) => listener());
}

export async function loadCognitoGroups(forceRefresh = false) {
  const session = await fetchAuthSession({ forceRefresh });
  setGroups(
    (session.tokens?.accessToken?.payload['cognito:groups'] as
      string[] | undefined) ?? [],
  );
  return session;
}

Hub.listen('auth', ({ payload }) => {
  if (payload.event === 'tokenRefresh' || payload.event === 'signedIn') {
    loadCognitoGroups().catch((err) =>
      console.error('Failed to read cognito groups', err),
    );
  } else if (payload.event === 'signedOut') {
    setGroups([]);
  }
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCognitoGroups() {
  return useSyncExternalStore(subscribe, () => groups);
}
