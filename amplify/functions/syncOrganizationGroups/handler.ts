import type { SyncOrganizationGroupsHandler } from '../../data/resource';
import { env } from '$amplify/env/syncOrganizationGroups';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const listMembershipsByUserId = /* GraphQL */ `
  query OrganizationsByUserId($userId: String!, $nextToken: String) {
    organizationsByUserId(userId: $userId, nextToken: $nextToken) {
      items {
        organizationId
      }
      nextToken
    }
  }
`;

const getMembershipQuery = /* GraphQL */ `
  query GetOrganizationMembership($organizationId: ID!, $userId: String!) {
    getOrganizationMembership(organizationId: $organizationId, userId: $userId) {
      organizationId
    }
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
  },
);

const gqlClient = generateClient({ authMode: 'iam' });
const cognitoClient = new CognitoIdentityProviderClient();

type MembershipPage = {
  organizationsByUserId: {
    items: { organizationId: string }[];
    nextToken: string | null;
  };
};

async function membershipExists(organizationId: string, userId: string) {
  const response = (await gqlClient.graphql({
    query: getMembershipQuery,
    variables: { organizationId, userId },
  })) as GraphQLResult<{ getOrganizationMembership: { organizationId: string } | null }>;
  if (response.errors?.length || !response.data) {
    throw new Error(`GraphQL error: ${JSON.stringify(response.errors)}`);
  }
  return Boolean(response.data.getOrganizationMembership);
}

export const handler: SyncOrganizationGroupsHandler = async (event) => {
  const userId = event.identity?.username;
  if (!userId) throw new Error('User identity not found');

  const organizationIds: string[] = [];
  let nextToken: string | null = null;
  do {
    const response = (await gqlClient.graphql({
      query: listMembershipsByUserId,
      variables: { userId, nextToken },
    })) as GraphQLResult<MembershipPage>;
    if (response.errors?.length || !response.data) {
      throw new Error(`GraphQL error: ${JSON.stringify(response.errors)}`);
    }
    organizationIds.push(
      ...response.data.organizationsByUserId.items.map((m) => m.organizationId),
    );
    nextToken = response.data.organizationsByUserId.nextToken;
  } while (nextToken);

  const groups = new Set<string>();
  let groupsToken: string | undefined;
  do {
    const result = await cognitoClient.send(
      new AdminListGroupsForUserCommand({
        Username: userId,
        UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
        NextToken: groupsToken,
      }),
    );
    result.Groups?.forEach((g) => groups.add(g.GroupName!));
    groupsToken = result.NextToken;
  } while (groupsToken);

  const missing = organizationIds.filter((id) => !groups.has(id));
  let added = 0;
  for (const organizationId of missing) {
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        Username: userId,
        GroupName: organizationId,
        UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
      }),
    );
    // A concurrent removal may have deleted the row after it was listed.
    if (await membershipExists(organizationId, userId)) {
      added++;
    } else {
      await cognitoClient.send(
        new AdminRemoveUserFromGroupCommand({
          Username: userId,
          GroupName: organizationId,
          UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
        }),
      );
    }
  }
  if (added) {
    console.log(`Added user ${userId} to ${added} organisation group(s)`);
  }
  return added > 0;
};
