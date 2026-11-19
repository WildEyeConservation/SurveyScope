import type { DeleteQueueHandler } from '../../data/resource';
import { env } from '$amplify/env/deleteQueue';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { SQSClient } from '@aws-sdk/client-sqs';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { finishShadowWorkflowRun } from '../workflowStats/runWriter';
import { authorizeSurveyAdmin } from '../shared/authorizeSurveyAdmin';
import { deleteBoundQueue } from '../shared/queueNames';

const getQueueQuery = /* GraphQL */ `
  query GetQueue($id: ID!) {
    getQueue(id: $id) {
      id
      url
      name
      tag
      projectId
      annotationSetId
      locationManifestS3Key
      group
    }
  }
`;

const getProjectQuery = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) {
      id
      organizationId
      group
    }
  }
`;

const getAnnotationSetProjectQuery = /* GraphQL */ `
  query GetAnnotationSetProject($id: ID!) {
    getAnnotationSet(id: $id) { id projectId }
  }
`;

const deleteQueueMutation = /* GraphQL */ `
  mutation DeleteQueue($input: DeleteQueueInput!) {
    deleteQueue(input: $input) { id group }
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
const sqsClient = new SQSClient();

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

export const handler: DeleteQueueHandler = async (event) => {
  try {
    console.log('Invoked deleteQueue with event:', JSON.stringify(event));
    const { queueId } = event.arguments;

    // 1. Fetch the Queue record
    const queueData = await executeGraphql<{
      getQueue?: { id: string; url: string | null; name: string | null; tag: string | null; projectId: string; annotationSetId: string | null; locationManifestS3Key: string | null } | null;
    }>(getQueueQuery, { id: queueId });

    const queue = queueData.getQueue;
    if (!queue) {
      throw new Error(`Queue not found: ${queueId}`);
    }

    // 2. Fetch the Project to get organizationId
    const projectData = await executeGraphql<{
      getProject?: { id: string; organizationId: string } | null;
    }>(getProjectQuery, { id: queue.projectId });

    const project = projectData.getProject;
    if (!project) {
      throw new Error(`Project not found: ${queue.projectId}`);
    }

    // 3. Authorization check
    const identity = event.identity;
    await authorizeSurveyAdmin(
      identity && 'sub' in identity ? identity : null,
      project,
      executeGraphql
    );
    const sub = (identity as { sub: string }).sub;

    // 4. Delete the SQS queue if it is bound to this row
    const outcome = await deleteBoundQueue(sqsClient, queue, executeGraphql);
    console.log('SQS queue deletion', { queueId, outcome });

    // 5. Delete the Queue DynamoDB record
    await executeGraphql(deleteQueueMutation, {
      input: { id: queueId },
    });

    // A queue deleted here was cancelled by a person, not drained.
    await finishShadowWorkflowRun({
      runId: queueId,
      status: 'cancelled',
      reason: 'user',
      finishedBy: sub,
    });

    // 6. Trigger homography reconciliation for homography queues
    if (queue.tag === 'homography' && queue.annotationSetId) {
      try {
        const functionName = (env as any).RECONCILE_HOMOGRAPHIES_FUNCTION_NAME;
        const setData = await executeGraphql<{
          getAnnotationSet?: { projectId: string } | null;
        }>(getAnnotationSetProjectQuery, { id: queue.annotationSetId });
        if (setData.getAnnotationSet?.projectId !== queue.projectId) {
          console.error('Skipping reconciliation: annotation set is not in the queue project', {
            queueId,
            annotationSetId: queue.annotationSetId,
            queueProjectId: queue.projectId,
            setProjectId: setData.getAnnotationSet?.projectId ?? null,
          });
        } else if (functionName) {
          const lambdaClient = new LambdaClient({
            region: env.AWS_REGION,
            credentials: {
              accessKeyId: env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
              sessionToken: env.AWS_SESSION_TOKEN,
            },
          });
          await lambdaClient.send(
            new InvokeCommand({
              FunctionName: functionName,
              InvocationType: 'Event',
              Payload: new TextEncoder().encode(
                JSON.stringify({
                  annotationSetId: queue.annotationSetId,
                  queueId,
                  projectId: queue.projectId,
                  manifestS3Key: queue.locationManifestS3Key,
                })
              ),
            })
          );
          console.log('Triggered homography reconciliation', {
            annotationSetId: queue.annotationSetId,
            queueId,
          });
        }
      } catch (err) {
        console.error('Failed to trigger homography reconciliation', err);
      }
    }

    console.log(`Queue ${queueId} deleted successfully`);
    return JSON.stringify({ success: true });
  } catch (err) {
    console.error('deleteQueue failed:', err instanceof Error ? err.message : String(err));
    throw err instanceof Error ? err : new Error(String(err));
  }
};
