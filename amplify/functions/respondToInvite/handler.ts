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
  mutation UpdateOrganizationInvite($input: UpdateOrganizationInviteInput!) {
    updateOrganizationInvite(input: $input) { id status group }
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

export const handler: RespondToInviteHandler = async (event) => {
  try {
    console.log('Invoked respondToInvite with event:', JSON.stringify(event));
    const { inviteId, accept } = event.arguments;
    const callerSub = event.identity!.sub;

    // 1. Fetch invite
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

    // 2. Verify caller owns this invite and it's still pending
    if (invite.username !== callerSub) {
      throw new Error('Unauthorized: this invite belongs to another user');
    }
    if (invite.status !== 'pending') {
      throw new Error(`Invite has already been ${invite.status}`);
    }

    if (!accept) {
      // 3. Declining
      await executeGraphql(updateOrganizationInviteMutation, {
        input: { id: inviteId, status: 'declined' },
      });
      console.log(`Invite ${inviteId} declined`);
      return JSON.stringify({ success: true, action: 'declined' });
    }

    // 4. Accepting: create membership
    await executeGraphql(createOrganizationMembershipMutation, {
      input: {
        organizationId: invite.organizationId,
        userId: callerSub,
        isAdmin: false,
        group: invite.organizationId,
      },
    });

    // 5. Add user to Cognito group
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        Username: callerSub,
        GroupName: invite.organizationId,
        UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
      })
    );

    // 6. Update invite status
    await executeGraphql(updateOrganizationInviteMutation, {
      input: { id: inviteId, status: 'accepted' },
    });

    console.log(`Invite ${inviteId} accepted, user ${callerSub} added to org ${invite.organizationId}`);
    return JSON.stringify({ success: true, action: 'accepted' });
  } catch (err) {
    console.error('respondToInvite failed:', err instanceof Error ? err.message : String(err));
    throw err instanceof Error ? err : new Error(String(err));
  }
};
