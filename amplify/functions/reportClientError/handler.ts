import type { ReportClientErrorHandler } from '../../data/resource';
import { env } from '$amplify/env/reportClientError';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import {
  createReserve,
  processClientError,
  type ClientErrorReport,
} from './core';

/**
 * Records a crash that reached the browser's error page and emails the
 * sysadmins about it.
 *
 * The reporting user comes from the request identity, never from the payload.
 * Everything else is supplied by the browser, so it is treated as untrusted
 * text: bounded in length, stored as-is and never interpreted.
 */

const createClientErrorReportMutation = /* GraphQL */ `
  mutation CreateClientErrorReport($input: CreateClientErrorReportInput!) {
    createClientErrorReport(input: $input) {
      id
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
  }
);

const gqlClient = generateClient({ authMode: 'iam' });
const cognitoClient = new CognitoIdentityProviderClient();
const snsClient = new SNSClient();
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient());

// Resolves to false when the write's condition fails.
async function conditionalWrite(command: UpdateCommand): Promise<boolean> {
  try {
    await documentClient.send(command);
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

const TableName = process.env.CLIENT_ERROR_LIMITS_TABLE;
const reserve = createReserve({
  claimDuplicate: (key, expiresAt) =>
    conditionalWrite(
      new UpdateCommand({
        TableName,
        Key: { pk: key },
        UpdateExpression: 'SET expiresAt = :expiresAt',
        ConditionExpression: 'attribute_not_exists(pk)',
        ExpressionAttributeValues: { ':expiresAt': expiresAt },
      })
    ),
  incrementRate: (key, expiresAt, max) =>
    conditionalWrite(
      new UpdateCommand({
        TableName,
        Key: { pk: key },
        UpdateExpression: 'SET expiresAt = :expiresAt ADD reportCount :one',
        ConditionExpression:
          'attribute_not_exists(reportCount) OR reportCount < :max',
        ExpressionAttributeValues: {
          ':expiresAt': expiresAt,
          ':one': 1,
          ':max': max,
        },
      })
    ),
  releaseDuplicate: async (key) => {
    await documentClient.send(
      new DeleteCommand({ TableName, Key: { pk: key } })
    );
  },
});

async function lookUpEmail(userId: string): Promise<string | undefined> {
  const user = await cognitoClient.send(
    new AdminGetUserCommand({
      Username: userId,
      UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
    })
  );
  return user.UserAttributes?.find((attribute) => attribute.Name === 'email')
    ?.Value;
}

async function save(report: ClientErrorReport): Promise<string | undefined> {
  let response: GraphQLResult<{ createClientErrorReport?: { id: string } }>;
  try {
    response = (await gqlClient.graphql({
      query: createClientErrorReportMutation,
      variables: { input: report },
    })) as typeof response;
  } catch (error) {
    // Amplify rejects with the raw response when GraphQL reports errors.
    const errors = (error as { errors?: { message: string }[] } | null)?.errors;
    if (!Array.isArray(errors)) throw error;
    response = { errors } as typeof response;
  }
  if (response.errors && response.errors.length > 0) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(
        response.errors.map((err) => err.message)
      )}`
    );
  }
  return response.data?.createClientErrorReport?.id;
}

const topicArn = process.env.CLIENT_ERROR_TOPIC_ARN;
const notify = topicArn
  ? async (subject: string, message: string) => {
      await snsClient.send(
        new PublishCommand({
          TopicArn: topicArn,
          Subject: subject,
          Message: message,
        })
      );
    }
  : undefined;

export const handler: ReportClientErrorHandler = async (event) => {
  const userId = event.identity?.sub;
  if (!userId) {
    throw new Error('Unauthorized: a user identity is required');
  }
  return JSON.stringify(
    await processClientError(
      { reserve, lookUpEmail, save, notify },
      userId,
      event.arguments,
      process.env.ENVIRONMENT_NAME ?? 'unknown'
    )
  );
};
