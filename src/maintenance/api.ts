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
  variables?: Record<string, unknown>
): Promise<T> {
  const result = await client.graphql<GraphQLQuery<Record<string, T>>>({
    query,
    variables,
  });
  if (result.errors?.length || !result.data?.[field])
    throw new Error(
      'Unable to read or save announcement. Refresh and try again.'
    );
  return result.data[field];
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

export const getMaintenance = () =>
  run<MaintenanceState>(
    `query { getSystemMaintenance { ${fields} } }`,
    'getSystemMaintenance'
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

export const getUserAnnouncement = (userId?: string) =>
  run<UserAnnouncement>(
    `query ($userId: String) { getUserAnnouncement(userId: $userId) { userId ${fields} } }`,
    'getUserAnnouncement',
    { userId }
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
