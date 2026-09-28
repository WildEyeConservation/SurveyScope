import type { RunElephantDetectorHandler } from '../../data/resource';
import { env } from '$amplify/env/runElephantDetector';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
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
        clearCredentialsAndIdentityId: () => {},
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

export const handler: RunElephantDetectorHandler = async (event) => {
  const projectId = event.arguments.projectId;
  const projectResponse = (await gqlClient.graphql({
    query: getProjectOrganizationId,
    variables: { id: projectId },
  })) as GraphQLResult<{ getProject?: { organizationId?: string | null } }>;
  const organizationId = projectResponse.data?.getProject?.organizationId;
  if (organizationId) {
    authorizeRequest(event.identity, organizationId);
  }

  const setId = event.arguments.setId;
  const bucket = event.arguments.bucket;
  const queueUrl = event.arguments.queueUrl;
  // Optional CCW rotation (90/180/270) + orientation guard for images whose true
  // orientation is missing from EXIF. The unified worker rotates before inference
  // (only when dimensions match, if `landscape` is set) and maps detections back.
  const rotation = event.arguments.rotation ?? undefined;
  const landscape = event.arguments.landscape ?? undefined;

  const images = (event.arguments.images ?? []).map((image) => {
    const [imageId, originalPath] = image.split('---');
    return { imageId, key: `images/${originalPath}` };
  });

  const sqsClient = new SQSClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      sessionToken: env.AWS_SESSION_TOKEN,
    },
  });

  // One image per message: heatmap generation runs a single full-resolution image
  // through the model at a time, and the AutoProcessor scales tasks on queue depth.
  let queued = 0;
  for (const image of images) {
    try {
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            imageId: image.imageId,
            key: image.key,
            projectId,
            bucket,
            setId,
            ...(organizationId ? { group: organizationId } : {}),
            ...(rotation !== undefined ? { rotation } : {}),
            ...(landscape !== undefined ? { landscape } : {}),
          }),
        })
      );
      queued += 1;
    } catch (err) {
      console.error(`Error queueing elephant-detector message for ${image.imageId}`, err);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Elephant detector images queued', count: queued }),
  };
};
