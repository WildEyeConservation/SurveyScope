import type { InviteUserToOrganizationHandler } from '../../data/resource';
import { env } from '$amplify/env/inviteUserToOrganization';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  DynamoDBClient,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { authorizeOrgAdmin } from '../shared/authorizeOrgAdmin';
import {
  InviteLimitError,
  SENDER,
  isValidEmail,
  limitUpdates,
  organizationInviteEmail,
  type LimitUpdate,
} from './core';

const getOrganizationQuery = /* GraphQL */ `
  query GetOrganization($id: ID!) {
    getOrganization(id: $id) { id name }
  }
`;

const organizationInvitesByUsernameQuery = /* GraphQL */ `
  query OrganizationInvitesByUsername($username: String!, $limit: Int, $nextToken: String) {
    organizationInvitesByUsername(username: $username, limit: $limit, nextToken: $nextToken) {
      items { id organizationId username status group }
      nextToken
    }
  }
`;

const getOrganizationMembershipQuery = /* GraphQL */ `
  query GetOrganizationMembership($organizationId: ID!, $userId: String!) {
    getOrganizationMembership(organizationId: $organizationId, userId: $userId) {
      organizationId
      userId
    }
  }
`;

const createOrganizationInviteMutation = /* GraphQL */ `
  mutation CreateOrganizationInvite($input: CreateOrganizationInviteInput!) {
    createOrganizationInvite(input: $input) { id organizationId username organizationName group }
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
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient());
const sesClient = new SESv2Client();

async function reserveInvite(updates: LimitUpdate[]): Promise<void> {
  const TableName = process.env.INVITE_LIMITS_TABLE;
  try {
    await documentClient.send(
      new TransactWriteCommand({
        TransactItems: updates.map((update) => ({
          Update:
            update.limit === 'recipient'
              ? {
                  TableName,
                  Key: { pk: update.key },
                  UpdateExpression: 'SET expiresAt = :expiresAt',
                  ConditionExpression: 'attribute_not_exists(pk) OR expiresAt < :now',
                  ExpressionAttributeValues: {
                    ':expiresAt': update.expiresAt,
                    ':now': update.now,
                  },
                }
              : {
                  TableName,
                  Key: { pk: update.key },
                  UpdateExpression: 'SET expiresAt = :expiresAt ADD inviteCount :one',
                  ConditionExpression:
                    'attribute_not_exists(inviteCount) OR inviteCount < :max',
                  ExpressionAttributeValues: {
                    ':expiresAt': update.expiresAt,
                    ':one': 1,
                    ':max': update.max,
                  },
                },
        })),
      })
    );
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      const index = error.CancellationReasons?.findIndex(
        (reason) => reason.Code === 'ConditionalCheckFailed'
      );
      if (index !== undefined && index >= 0) {
        throw new InviteLimitError(updates[index].limit);
      }
    }
    throw error;
  }
}

async function sendInviteEmail(to: string, organizationName: string): Promise<void> {
  const { subject, html, text } = organizationInviteEmail(organizationName);
  const replyTo = process.env.INVITE_REPLY_TO_EMAIL;
  await sesClient.send(
    new SendEmailCommand({
      FromEmailAddress: SENDER,
      Destination: { ToAddresses: [to] },
      ReplyToAddresses: replyTo ? [replyTo] : undefined,
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            Text: { Data: text, Charset: 'UTF-8' },
          },
        },
      },
    })
  );
}

function serializeError(err: unknown): string {
  if (err === null || err === undefined) return String(err);
  if (typeof err !== 'object') return String(err);
  return JSON.stringify(err, Object.getOwnPropertyNames(err));
}

async function executeGraphql<T>(
  query: string,
  variables: Record<string, any>
): Promise<T> {
  let response: GraphQLResult<T>;
  try {
    response = (await gqlClient.graphql({
      query,
      variables,
    } as any)) as GraphQLResult<T>;
  } catch (thrown) {
    // Amplify throws the raw response object on AppSync errors
    const asResult = thrown as GraphQLResult<T>;
    if (asResult?.errors?.length) {
      const messages = asResult.errors.map(
        (e) => (e as any).message ?? serializeError(e)
      );
      throw new Error(`GraphQL error: ${messages.join('; ')}`);
    }
    throw new Error(`GraphQL request failed: ${serializeError(thrown)}`);
  }
  if (response.errors && response.errors.length > 0) {
    const messages = response.errors.map(
      (e) => (e as any).message ?? serializeError(e)
    );
    throw new Error(`GraphQL error: ${messages.join('; ')}`);
  }
  if (!response.data) {
    throw new Error('GraphQL response missing data');
  }
  return response.data;
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

export const handler: InviteUserToOrganizationHandler = async (event) => {
  try {
    console.log('Invoked inviteUserToOrganization with event:', JSON.stringify(event));
    const { organizationId } = event.arguments;
    const email = event.arguments.email.trim();

    // 1. Authorize caller as org admin
    await authorizeOrgAdmin(event.identity, organizationId, executeGraphql);

    if (!isValidEmail(email)) {
      throw new Error('Enter a valid email address');
    }

    // 2. Look up user by email in Cognito
    const listResult = await cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
        Filter: `email = "${email}"`,
        Limit: 1,
      })
    );

    const cognitoUser = listResult.Users?.[0];
    const userId = cognitoUser?.Username;

    if (userId) {
      // 3. Check if user is already a member
      const membershipData = await executeGraphql<{
        getOrganizationMembership?: { organizationId: string; userId: string } | null;
      }>(getOrganizationMembershipQuery, { organizationId, userId });

      if (membershipData.getOrganizationMembership) {
        throw new Error('User is already a member of this organization');
      }

      // 4. Check for existing pending invite
      const allInvites = await fetchAllPages<
        { id: string; organizationId: string; status: string },
        'organizationInvitesByUsername'
      >(organizationInvitesByUsernameQuery, { username: userId, limit: 100 }, 'organizationInvitesByUsername');

      const existingPending = allInvites.find(
        (inv) => inv.organizationId === organizationId && inv.status === 'pending'
      );
      if (existingPending) {
        throw new Error('User already has a pending invitation to this organization');
      }
    }

    // 5. Rate limit org admins, counting addresses without an account too
    const identity = event.identity as { sub?: string; groups?: string[] | null } | null;
    if (identity?.sub && !identity.groups?.includes('sysadmin')) {
      await reserveInvite(limitUpdates(organizationId, email, Date.now()));
    }

    // The same response either way, so invites can't reveal who has an account.
    if (!userId) {
      console.log(`No account for the invited address to org ${organizationId}`);
      return JSON.stringify({ success: true });
    }

    // 6. Get organization name
    const orgData = await executeGraphql<{
      getOrganization?: { id: string; name: string } | null;
    }>(getOrganizationQuery, { id: organizationId });

    const organizationName = orgData.getOrganization?.name ?? 'Unknown Organization';

    // 7. Create invite
    await executeGraphql(createOrganizationInviteMutation, {
      input: {
        organizationId,
        username: userId,
        invitedBy: event.identity!.sub,
        organizationName,
        group: organizationId,
      },
    });

    // 8. Email the invitee; the invite stands even if this fails
    const recipient =
      cognitoUser?.Attributes?.find((attribute) => attribute.Name === 'email')?.Value ?? email;
    try {
      await sendInviteEmail(recipient, organizationName);
    } catch (error) {
      console.error('Failed to send the invite email:', serializeError(error));
    }

    console.log(`Invite created for ${userId} to org ${organizationId}`);
    return JSON.stringify({ success: true });
  } catch (err) {
    console.error('inviteUserToOrganization failed:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    throw err instanceof Error ? err : new Error(JSON.stringify(err, Object.getOwnPropertyNames(err)));
  }
};
