import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { env } from '$amplify/env/revokeChainShare';
import { Amplify } from 'aws-amplify';
import { generateClient, GraphQLResult } from 'aws-amplify/data';
import type { RevokeChainShareHandler } from '../../data/resource';
import { checkedGraph, shareLifecycle, mapWithConcurrency } from '../../chain-shares/lifecycle';

/**
 * Tear down a chain share's snapshot: delete every SharedChain* row for the
 * share and mark the ChainShare revoked. Reviewer accounts should be removed
 * from the `chainshare-<shareId>` group separately (via removeUserFromGroup);
 * ChainReviewFeedback is intentionally left intact as study output.
 */

const deleteSharedChainAnnotation = /* GraphQL */ `
  mutation Del($input: DeleteSharedChainAnnotationInput!) {
    deleteSharedChainAnnotation(input: $input) { id }
  }
`;
const deleteSharedChainImage = /* GraphQL */ `
  mutation Del($input: DeleteSharedChainImageInput!) {
    deleteSharedChainImage(input: $input) { id }
  }
`;
const deleteSharedChainLocation = /* GraphQL */ `
  mutation Del($input: DeleteSharedChainLocationInput!) {
    deleteSharedChainLocation(input: $input) { id }
  }
`;
const deleteSharedChainNeighbour = /* GraphQL */ `
  mutation Del($input: DeleteSharedChainNeighbourInput!) {
    deleteSharedChainNeighbour(input: $input) { id }
  }
`;
const deleteSharedChainCategory = /* GraphQL */ `
  mutation Del($input: DeleteSharedChainCategoryInput!) {
    deleteSharedChainCategory(input: $input) { id }
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

const client = generateClient({ authMode: 'iam' });
const graphql = checkedGraph((request) => client.graphql(request) as Promise<GraphQLResult<Record<string, unknown>>>);
const lifecycle = shareLifecycle(graphql);

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const snapshotTables: Record<string, string> = JSON.parse(process.env.SNAPSHOT_TABLES!);

// Cleanup runs only after writers finish (or their Lambda timeout has elapsed).
// Strong base-table reads avoid declaring success while a GSI still omits rows.
async function fetchAllIds(model: string, shareId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new ScanCommand({
      TableName: snapshotTables[model], ConsistentRead: true,
      FilterExpression: 'shareId = :shareId',
      ExpressionAttributeValues: { ':shareId': shareId },
      ProjectionExpression: 'id', ExclusiveStartKey: cursor,
    }));
    for (const item of page.Items ?? []) ids.push(item.id as string);
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return ids;
}

async function deleteAll(
  ids: string[],
  mutation: string,
  limit = 20
): Promise<void> {
  await mapWithConcurrency(ids, limit, async (id) => {
    await graphql({ query: mutation, variables: { input: { id } } });
  });
}

export const handler: RevokeChainShareHandler = async (event) => {
  const { shareId } = event.arguments;
  let started: string | null = null;
  try {
    if (!event.identity?.sub || !event.identity.groups?.includes('sysadmin')) {
      throw new Error('Unauthorized: sysadmin required');
    }
    // Enforce the UI's removal prerequisite on the server as well.
    try {
      const members = await cognito.send(new ListUsersInGroupCommand({
        UserPoolId: process.env.USER_POOL_ID, GroupName: `chainshare-${shareId}`, Limit: 1,
      }));
      if (members.Users?.length) throw new Error('Remove all reviewers before revoking this share');
    } catch (error) {
      // An already deleted group has no members and must not block cleanup.
      if (!(error instanceof Error) || error.name !== 'ResourceNotFoundException') throw error;
    }
    started = await lifecycle.revoke(shareId);
    if (!started) return { statusCode: 200, body: JSON.stringify({ shareId, alreadyRevoked: true }) };

    const [annIds, imgIds, locIds, nbrIds, catIds] = await Promise.all([
      fetchAllIds('SharedChainAnnotation', shareId),
      fetchAllIds('SharedChainImage', shareId),
      fetchAllIds('SharedChainLocation', shareId),
      fetchAllIds('SharedChainNeighbour', shareId),
      fetchAllIds('SharedChainCategory', shareId),
    ]);

    await deleteAll(annIds, deleteSharedChainAnnotation);
    await deleteAll(imgIds, deleteSharedChainImage);
    await deleteAll(locIds, deleteSharedChainLocation);
    await deleteAll(nbrIds, deleteSharedChainNeighbour);
    await deleteAll(catIds, deleteSharedChainCategory);

    await lifecycle.finishRevocation(shareId, started);

    return {
      statusCode: 200,
      body: JSON.stringify({
        shareId,
        deleted: {
          annotations: annIds.length,
          images: imgIds.length,
          locations: locIds.length,
          neighbours: nbrIds.length,
          categories: catIds.length,
        },
      }),
    };
  } catch (error) {
    console.error('revokeChainShare error:', error);
    if (started) {
      await lifecycle.failRevocation(shareId, started, error).catch((failure) =>
        console.error('Could not record cleanup failure; retry after operation timeout', failure));
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error revoking chain share',
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
