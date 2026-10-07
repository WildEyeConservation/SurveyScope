import {
  generateClient,
  type GraphQLQuery,
  type GraphQLSubscription,
} from 'aws-amplify/api';
import type { MaintenanceInput, MaintenanceState } from './state';

// Explicit documents work before deployment refreshes the generated model client.
const client = generateClient({ authMode: 'userPool' });
const fields = 'revision message messageType publishAt denyAccessAt serverTime';
export type UserAnnouncement = MaintenanceState & { userId: string };

async function run<T>(
  query: string,
  field: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) throw new Error('Availability check cancelled.');
  const request = client.graphql<GraphQLQuery<Record<string, T>>>({
    query,
    variables,
  });
  const cancel = () => client.cancel(request, 'Availability check cancelled.');
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await request;
    if (result.errors?.length || !result.data?.[field])
      throw new Error(
        'Unable to read or save announcement. Refresh and try again.'
      );
    return result.data[field];
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
function watch<T>(
  field: string,
  selection: string,
  next: (state: T) => void,
  error: () => void
) {
  return client
    .graphql<GraphQLSubscription<Record<string, T>>>({
      query: `subscription { ${field} { ${selection} } }`,
    })
    .subscribe({
      next: ({ data }) => (data?.[field] ? next(data[field]) : error()),
      error,
    });
}
const writeArguments =
  '$expectedRevision: Int!, $message: String!, $messageType: String!, $publishAt: AWSDateTime, $denyAccessAt: AWSDateTime';
const writeValues =
  'expectedRevision: $expectedRevision, message: $message, messageType: $messageType, publishAt: $publishAt, denyAccessAt: $denyAccessAt';

export const getMaintenance = (signal?: AbortSignal) =>
  run<MaintenanceState>(
    `query { getSystemMaintenance { ${fields} } }`,
    'getSystemMaintenance',
    undefined,
    signal
  );
export const setMaintenance = (input: MaintenanceInput) =>
  run<MaintenanceState>(
    `mutation (${writeArguments}) { setSystemMaintenance(${writeValues}) { ${fields} } }`,
    'setSystemMaintenance',
    input
  );
export const subscribeMaintenance = (
  next: (state: MaintenanceState) => void,
  error: () => void
) => watch('onSystemMaintenanceChange', fields, next, error);

export const getUserAnnouncement = (userId?: string, signal?: AbortSignal) =>
  run<UserAnnouncement>(
    `query ($userId: String) { getUserAnnouncement(userId: $userId) { userId ${fields} } }`,
    'getUserAnnouncement',
    { userId },
    signal
  );
export const setUserAnnouncement = (
  input: MaintenanceInput & { userId: string }
) =>
  run<UserAnnouncement>(
    `mutation ($userId: String!, ${writeArguments}) { setUserAnnouncement(userId: $userId, ${writeValues}) { userId ${fields} } }`,
    'setUserAnnouncement',
    input
  );
export const subscribeUserAnnouncement = (
  next: (state: UserAnnouncement) => void,
  error: () => void
) => watch('onUserAnnouncementChange', `userId ${fields}`, next, error);
