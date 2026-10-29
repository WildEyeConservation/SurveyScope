import type { SyncOrganizationGroupsHandler } from '../../data/resource';
import { env } from '$amplify/env/syncOrganizationGroups';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
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
  for (const organizationId of missing) {
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        Username: userId,
        GroupName: organizationId,
        UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
      }),
    );
  }
  if (missing.length) {
    console.log(
      `Added user ${userId} to ${missing.length} organisation group(s)`,
    );
  }
  return missing.length > 0;
};
