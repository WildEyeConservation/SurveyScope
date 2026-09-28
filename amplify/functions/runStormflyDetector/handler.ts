import type { RunStormflyDetectorHandler } from '../../data/resource';
import { env } from '$amplify/env/runStormflyDetector';
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

export const handler: RunStormflyDetectorHandler = async (event) => {
  const projectId = event.arguments.projectId;
  const projectResponse = (await gqlClient.graphql({
    query: getProjectOrganizationId,
    variables: { id: projectId },
  })) as GraphQLResult<{ getProject?: { organizationId?: string | null } }>;
  const organizationId = projectResponse.data?.getProject?.organizationId;
  if (organizationId) {
    authorizeRequest(event.identity, organizationId);
  }

  const images = (event.arguments.images ?? []).map((image) => {
    const [imageId, key] = image.split('---');
    return { imageId, key: `images/${key}` };
  });
  // Optional CCW rotation (90/180/270) and orientation guard for images whose
  // orientation is missing from EXIF. Forwarded in the SQS body so the processor
  // rotates before inference (and only when dimensions match, if `landscape` is set).
  const rotation = event.arguments.rotation ?? undefined;
  const landscape = event.arguments.landscape ?? undefined;
  const sqsClient = new SQSClient({ region: env.AWS_REGION });

  // Stormfly is testing-only and deliberately uses small messages because a
  // full-resolution aerial image can require hundreds of ONNX tile calls.
  for (let index = 0; index < images.length; index += 2) {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: event.arguments.queueUrl,
        MessageBody: JSON.stringify({
          images: images.slice(index, index + 2),
          projectId,
          bucket: event.arguments.bucket,
          setId: event.arguments.setId,
          ...(organizationId ? { group: organizationId } : {}),
          ...(rotation !== undefined ? { rotation } : {}),
          ...(landscape !== undefined ? { landscape } : {}),
        }),
      })
    );
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Stormfly images queued', count: images.length }),
  };
};

