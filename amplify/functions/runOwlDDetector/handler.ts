import type { RunOwlDDetectorHandler } from '../../data/resource';
import { env } from '$amplify/env/runOwlDDetector';
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

export const handler: RunOwlDDetectorHandler = async (event) => {
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

  let queued = 0;
  for (const image of images) {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          images: [image],
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
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'OWL-D images queued', count: queued }),
  };
};