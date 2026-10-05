import type { ReportClientErrorHandler } from '../../data/resource';
import { env } from '$amplify/env/reportClientError';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

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
    createClientErrorReport(input: $input) { id }
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

// Any signed-in user can call this mutation, so cap what one call can store
// and email. The stack limit keeps the whole item far below DynamoDB's 400 KB.
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 20000;
const MAX_FIELD_LENGTH = 2000;
// SNS rejects subjects over 100 characters.
const MAX_SUBJECT_LENGTH = 100;

function bounded(
  value: string | null | undefined,
  maxLength: number
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}… [truncated]`
    : trimmed;
}

// The email is only there to make the report readable, so a failed lookup must
// not cost us the report itself.
async function lookUpEmail(userId: string): Promise<string | undefined> {
  try {
    const user = await cognitoClient.send(
      new AdminGetUserCommand({
        Username: userId,
        UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
      })
    );
    return user.UserAttributes?.find((attribute) => attribute.Name === 'email')
      ?.Value;
  } catch (error) {
    console.warn('Could not look up the reporting user email', error);
    return undefined;
  }
}

export const handler: ReportClientErrorHandler = async (event) => {
  const userId = event.identity?.sub;
  if (!userId) {
    throw new Error('Unauthorized: a user identity is required');
  }

  const report = {
    message:
      bounded(event.arguments.message, MAX_MESSAGE_LENGTH) ?? 'Unknown error',
    stack: bounded(event.arguments.stack, MAX_STACK_LENGTH),
    status: bounded(event.arguments.status, MAX_FIELD_LENGTH),
    url: bounded(event.arguments.url, MAX_FIELD_LENGTH),
    userAgent: bounded(event.arguments.userAgent, MAX_FIELD_LENGTH),
    userId,
    userEmail: await lookUpEmail(userId),
  };

  // Saving and emailing are independent: a failure in one must not hide the
  // crash from the other channel.
  let reportId: string | undefined;
  let saveError: unknown;
  try {
    const response = (await gqlClient.graphql({
      query: createClientErrorReportMutation,
      variables: { input: report },
    })) as GraphQLResult<{ createClientErrorReport?: { id: string } }>;
    if (response.errors && response.errors.length > 0) {
      throw new Error(
        `GraphQL error: ${JSON.stringify(response.errors.map((err) => err.message))}`
      );
    }
    reportId = response.data?.createClientErrorReport?.id;
  } catch (error) {
    saveError = error;
    console.error('Failed to save the client error report', error, report);
  }

  let notified = false;
  const topicArn = process.env.CLIENT_ERROR_TOPIC_ARN;
  if (topicArn) {
    const environment = process.env.ENVIRONMENT_NAME ?? 'unknown';
    try {
      await snsClient.send(
        new PublishCommand({
          TopicArn: topicArn,
          // SNS subjects must be printable ASCII without line breaks.
          Subject: `[SurveyScope ${environment}] Client error: ${report.message}`
            .replace(/[^\x20-\x7E]+/g, ' ')
            .slice(0, MAX_SUBJECT_LENGTH),
          Message: [
            'A user reached the SurveyScope error page.',
            '',
            `Environment: ${environment}`,
            `User: ${report.userEmail ?? 'unknown email'} (${userId})`,
            `URL: ${report.url ?? 'N/A'}`,
            `Status: ${report.status ?? 'N/A'}`,
            `User agent: ${report.userAgent ?? 'N/A'}`,
            `Report ID: ${reportId ?? 'not saved - see the function logs'}`,
            '',
            `Message: ${report.message}`,
            '',
            'Stack trace:',
            report.stack ?? 'No stack trace available',
          ].join('\n'),
        })
      );
      notified = true;
    } catch (error) {
      console.error('Failed to send the client error notification', error);
    }
  }

  if (saveError) throw saveError;
  return JSON.stringify({ id: reportId, notified });
};
