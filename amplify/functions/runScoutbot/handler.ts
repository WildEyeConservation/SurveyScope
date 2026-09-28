import type { RunScoutbotHandler } from '../../data/resource';
import { env } from '$amplify/env/runScoutbot';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { authorizeRequest } from '../shared/authorizeRequest';

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

const getProjectOrganizationId = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) { organizationId }
  }
`;

export const handler: RunScoutbotHandler = async (event, context) => {
  try {
    const imagesFromEvent = event.arguments.images ?? [];
    const projectId = event.arguments.projectId;

    // Authorize: fetch project org and verify user membership
    const projResp = (await gqlClient.graphql({
      query: getProjectOrganizationId,
      variables: { id: projectId },
    })) as GraphQLResult<{ getProject?: { organizationId?: string | null } }>;
    const organizationId = projResp.data?.getProject?.organizationId;
    if (organizationId) {
      authorizeRequest(event.identity, organizationId);
    }
    const setId = event.arguments.setId;
    const bucket = event.arguments.bucket;
    // Optional CCW rotation (90/180/270) for images whose orientation is missing
    // from EXIF. Forwarded in the SQS body so the processor rotates before inference.
    const rotation = event.arguments.rotation ?? undefined;
    // Optional orientation guard: only rotate images whose dimensions match
    // (true -> width > height, false -> height > width).
    const landscape = event.arguments.landscape ?? undefined;

    const images = imagesFromEvent.map((imageStr) => {
      const [id, originalPath] = imageStr.split('---');
      return {
        id,
        originalPath,
      };
    });

    const queueUrl = event.arguments.queueUrl;

    const TIME_THRESHOLD_MS = 60000;
    const sqsClient = new SQSClient({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        sessionToken: env.AWS_SESSION_TOKEN,
      },
    });
    const lambdaClient = new LambdaClient({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        sessionToken: env.AWS_SESSION_TOKEN,
      },
    });
    const chunkSize = 4;
    let processed = 0;
    while (processed < images.length) {
      const chunk = images.slice(processed, processed + chunkSize);
      try {
        await sqsClient.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({
              images: chunk.map((image) => ({
                imageId: image.id,
                key: 'images/' + image.originalPath,
              })),
              projectId,
              bucket,
              setId,
              // Stamped as Location.group on every detection the worker writes.
              ...(organizationId ? { group: organizationId } : {}),
              ...(rotation !== undefined ? { rotation } : {}),
              ...(landscape !== undefined ? { landscape } : {}),
            }),
          })
        );
      } catch (err: any) {
        console.error(
          `Error sending SQS message for chunk starting at index ${processed}`,
          err
        );
      }
      processed += chunk.length;
      const remainingTime = context.getRemainingTimeInMillis();
      if (
        remainingTime < TIME_THRESHOLD_MS &&
        processed < images.length
      ) {
        const remainingImageStrings = imagesFromEvent.slice(processed);
        try {
          await lambdaClient.send(
            new InvokeCommand({
              FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
              InvocationType: 'Event',
              Payload: Buffer.from(
                JSON.stringify({
                  images: remainingImageStrings,
                  projectId,
                  setId,
                  bucket,
                  queueUrl,
                  ...(rotation !== undefined ? { rotation } : {}),
                  ...(landscape !== undefined ? { landscape } : {}),
                })
              ),
            })
          );
        } catch (err: any) {
          console.error(
            'Error re-invoking lambda with remaining images',
            err
          );
        }
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: 'Lambda re-invoked with remaining images',
            remainingCount: remainingImageStrings.length,
          }),
        };
      }
    }
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Images received',
        count: images.length,
      }),
    };
  } catch (error: any) {
    console.error('Error in runScoutbot:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error running scoutbot',
        error: error.message,
      }),
    };
  }
};
