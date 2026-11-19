import type { RemoveUserFromOrganizationHandler } from '../../data/resource';
import { env } from '$amplify/env/removeUserFromOrganization';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  CognitoIdentityProviderClient,
  AdminRemoveUserFromGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { authorizeOrgAdmin } from '../shared/authorizeOrgAdmin';

const listProjectsByOrgQuery = /* GraphQL */ `
  query ListProjects($filter: ModelProjectFilterInput, $limit: Int, $nextToken: String) {
    listProjects(filter: $filter, limit: $limit, nextToken: $nextToken) {
      items { id group }
      nextToken
    }
  }
`;

const listUserProjectMembershipsQuery = /* GraphQL */ `
  query UserProjectMembershipsByUserId($userId: String!, $limit: Int, $nextToken: String) {
    userProjectMembershipsByUserId(userId: $userId, limit: $limit, nextToken: $nextToken) {
      items { id projectId group }
      nextToken
    }
  }
`;

const deleteUserProjectMembershipMutation = /* GraphQL */ `
  mutation DeleteUserProjectMembership($input: DeleteUserProjectMembershipInput!) {
    deleteUserProjectMembership(input: $input) {
      id
      userId
      projectId
      isAdmin
      queueId
      backupQueueId
      group
      createdAt
      updatedAt
    }
  }
`;

const deleteOrganizationMembershipMutation = /* GraphQL */ `
  mutation DeleteOrganizationMembership($input: DeleteOrganizationMembershipInput!) {
    deleteOrganizationMembership(input: $input) { organizationId userId group }
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

// A retry after a partial failure finds some rows already deleted.
async function ignoreAlreadyGone(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/conditional request failed|ConditionalCheckFailed/i.test(message)) throw err;
  }
}

interface PagedList<T> {
  items: T[];
  nextToken: string | null | undefined;
}

async function fetchAllPages<T, K extends string>(
  queryString: string,
  variables: Record<string, any>,
  queryName: K
): Promise<T[]> {
  const allItems: T[] = [];
  let nextToken: string | undefined;

  do {
    const data = await executeGraphql<{ [key in K]: PagedList<T> }>(
      queryString,
      { ...variables, nextToken }
    );
    const items = data[queryName]?.items ?? [];
    allItems.push(...items);
    nextToken = data[queryName]?.nextToken ?? undefined;
  } while (nextToken);

  return allItems;
}

export const handler: RemoveUserFromOrganizationHandler = async (event) => {
  try {
    console.log('Invoked removeUserFromOrganization with event:', JSON.stringify(event));
    const { organizationId, userId } = event.arguments;

    // 1. Authorize caller as org admin
    await authorizeOrgAdmin(event.identity, organizationId, executeGraphql);

    // 2. Prevent self-removal
    if (event.identity?.sub === userId) {
      throw new Error('Cannot remove yourself from the organization');
    }

    // 3. Rows go before the group: syncOrganizationGroups re-adds groups from rows.
    const orgProjects = await fetchAllPages<
      { id: string },
      'listProjects'
    >(listProjectsByOrgQuery, {
      filter: { organizationId: { eq: organizationId } },
      limit: 10000,
    }, 'listProjects');

    const orgProjectIds = new Set(orgProjects.map((p) => p.id));

    const userMemberships = await fetchAllPages<
      { id: string; projectId: string },
      'userProjectMembershipsByUserId'
    >(listUserProjectMembershipsQuery, { userId, limit: 10000 }, 'userProjectMembershipsByUserId');

    const toDelete = userMemberships.filter((m) => orgProjectIds.has(m.projectId));

    for (const membership of toDelete) {
      await ignoreAlreadyGone(
        executeGraphql(deleteUserProjectMembershipMutation, {
          input: { id: membership.id },
        })
      );
    }

    await ignoreAlreadyGone(
      executeGraphql(deleteOrganizationMembershipMutation, {
        input: { organizationId, userId },
      })
    );

    // 4. Remove user from Cognito group
    await cognitoClient.send(
      new AdminRemoveUserFromGroupCommand({
        Username: userId,
        GroupName: organizationId,
        UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
      })
    );

    console.log(`User ${userId} removed from org ${organizationId}`);
    return JSON.stringify({ success: true });
  } catch (err) {
    console.error('removeUserFromOrganization failed:', err instanceof Error ? err.message : String(err));
    throw err instanceof Error ? err : new Error(String(err));
  }
};
