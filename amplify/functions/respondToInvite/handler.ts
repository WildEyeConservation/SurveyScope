import type { RespondToInviteHandler } from '../../data/resource';
import { env } from '$amplify/env/respondToInvite';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const getOrganizationInviteQuery = /* GraphQL */ `
  query GetOrganizationInvite($id: ID!) {
    getOrganizationInvite(id: $id) {
      id organizationId username invitedBy status group
    }
  }
`;

const updateOrganizationInviteMutation = /* GraphQL */ `
  mutation UpdateOrganizationInvite(
    $input: UpdateOrganizationInviteInput!
    $condition: ModelOrganizationInviteConditionInput
  ) {
    updateOrganizationInvite(input: $input, condition: $condition) {
      id
      status
      group
    }
  }
`;

const createOrganizationMembershipMutation = /* GraphQL */ `
  mutation CreateOrganizationMembership($input: CreateOrganizationMembershipInput!) {
    createOrganizationMembership(input: $input) { organizationId userId group }
  }
`;

Amplify.configure(
  {
    API: {
      GraphQL: {
        endpoint: env.AMPLIFY_DATA_GRAPHQL_ENDPOINT,
        region: env.AWS_REGION,
        defaultAuthMode: 'iam',
      },
    },
  },
  {
    Auth: {
      credentialsProvider: {
        getCredentialsAndIdentityId: async () => ({
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            sessionToken: env.AWS_SESSION_TOKEN,
          },
        }),
        clearCredentialsAndIdentityId: () => {
          /* noop */
        },
      },
    },
  }
);

const gqlClient = generateClient({ authMode: 'iam' });
const cognitoClient = new CognitoIdentityProviderClient();

async function executeGraphql<T>(
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const response = (await gqlClient.graphql({
    query,
    variables,
  } as any)) as GraphQLResult<T>;
  if (response.errors && response.errors.length > 0) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(response.errors.map((err) => err.message))}`
    );
  }
  if (!response.data) {
    throw new Error('GraphQL response missing data');
  }
  return response.data;
}

type ErrorLike = { message?: string; errors?: { message?: string }[] };

function isConditionFailure(error: unknown): boolean {
  const e = (error ?? {}) as ErrorLike;
  return [e.message, ...(e.errors ?? []).map((inner) => inner?.message)].some(
    (message) => /conditional request failed|ConditionalCheckFailed/i.test(message ?? ''),
  );
}

// Moves the invite only if it is still in one of the given states.
async function transition(
  inviteId: string,
  from: string[],
  to: string,
): Promise<boolean> {
  try {
    await executeGraphql(updateOrganizationInviteMutation, {
      input: { id: inviteId, status: to },
      condition: { or: from.map((status) => ({ status: { eq: status } })) },
    });
    return true;
  } catch (error) {
    if (isConditionFailure(error)) return false;
    throw error;
  }
}

async function currentStatus(inviteId: string): Promise<string> {
  const data = await executeGraphql<{
    getOrganizationInvite?: { status: string } | null;
  }>(getOrganizationInviteQuery, { id: inviteId });
  return data.getOrganizationInvite?.status ?? 'removed';
}

// Returns false when the membership already existed.
async function createMembership(organizationId: string, userId: string) {
  try {
    await executeGraphql(createOrganizationMembershipMutation, {
      input: { organizationId, userId, isAdmin: false, group: organizationId },
    });
    return true;
  } catch (error) {
    if (isConditionFailure(error)) return false;
    throw error;
  }
}

// pending -> accepting -> accepted, or pending -> declined. An accept that
// fails after its claim leaves "accepting", which a repeated accept finishes.
export const handler: RespondToInviteHandler = async (event) => {
  try {
    console.log('Invoked respondToInvite with event:', JSON.stringify(event));
    const { inviteId, accept } = event.arguments;
    const callerSub = event.identity!.sub;

    const inviteData = await executeGraphql<{
      getOrganizationInvite?: {
        id: string;
        organizationId: string;
        username: string;
        status: string;
        group: string;
      } | null;
    }>(getOrganizationInviteQuery, { id: inviteId });

    const invite = inviteData.getOrganizationInvite;
    if (!invite) {
      throw new Error('Invite not found');
    }
    if (invite.username !== callerSub) {
      throw new Error('Unauthorized: this invite belongs to another user');
    }

    if (!accept) {
      if (!(await transition(inviteId, ['pending'], 'declined'))) {
        throw new Error(`Invite has already been ${await currentStatus(inviteId)}`);
      }
      console.log(`Invite ${inviteId} declined`);
      return JSON.stringify({ success: true, action: 'declined' });
    }

    if (!(await transition(inviteId, ['pending', 'accepting'], 'accepting'))) {
      throw new Error(`Invite has already been ${await currentStatus(inviteId)}`);
    }

    let created: boolean;
    try {
      created = await createMembership(invite.organizationId, callerSub);
    } catch (error) {
      // Nothing was granted, so the invite can go back to pending.
      await transition(inviteId, ['accepting'], 'pending').catch((rollback) =>
        console.error('Could not return the invite to pending', rollback),
      );
      throw error;
    }

    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        Username: callerSub,
        GroupName: invite.organizationId,
        UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
      })
    );

    if (!(await transition(inviteId, ['accepting'], 'accepted'))) {
      // A concurrent accept may have finished first.
      const status = await currentStatus(inviteId);
      if (status !== 'accepted') throw new Error(`Invite has already been ${status}`);
    }

    console.log(
      `Invite ${inviteId} accepted, user ${callerSub} ${created ? 'added to' : 'already in'} org ${invite.organizationId}`
    );
    return JSON.stringify({ success: true, action: 'accepted' });
  } catch (err) {
    console.error('respondToInvite failed:', err instanceof Error ? err.message : String(err));
    throw err instanceof Error ? err : new Error(String(err));
  }
};
