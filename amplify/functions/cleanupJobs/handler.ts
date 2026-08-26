import type { Handler } from "aws-lambda";
import { env } from "$amplify/env/cleanupJobs";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { listQueues, getProject } from "./graphql/queries";
import type { GraphQLResult } from "@aws-amplify/api-graphql";
import {
  DeleteQueueCommand,
  type GetQueueAttributesCommandInput,
  GetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import { Queue } from "./graphql/API";
import { SQSClient } from "@aws-sdk/client-sqs";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { finishShadowWorkflowRun } from "../workflowStats/runWriter";

// Inline minimal mutations – return key fields + `group` to avoid nested-resolver
// auth failures while still enabling subscription delivery via groupDefinedIn('group').
const updateQueue = /* GraphQL */ `
  mutation UpdateQueue($input: UpdateQueueInput!) {
    updateQueue(input: $input) { id group }
  }
`;

const deleteQueue = /* GraphQL */ `
  mutation DeleteQueue($input: DeleteQueueInput!) {
    deleteQueue(input: $input) { id group }
  }
`;

const updateProjectMembershipsMutation = /* GraphQL */ `
  mutation UpdateProjectMemberships($projectId: String!) {
    updateProjectMemberships(projectId: $projectId)
  }
`;

// Constants
const MAX_REQUEUES = 1;
const STALE_QUEUE_DAYS = 60;

Amplify.configure(
  {
    API: {
      GraphQL: {
        endpoint: env.AMPLIFY_DATA_GRAPHQL_ENDPOINT,
        region: env.AWS_REGION,
        defaultAuthMode: "iam",
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

const client = generateClient({
  authMode: "iam",
});

const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

interface PagedList<T> {
  items: T[];
  nextToken: string | null | undefined;
}

// Helper function to handle pagination for GraphQL queries
async function fetchAllPages<T, K extends string>(
  queryFn: (
    nextToken?: string
  ) => Promise<GraphQLResult<{ [key in K]: PagedList<T> }>>,
  queryName: K
): Promise<T[]> {
  const allItems: T[] = [];
  let nextToken: string | undefined;

  do {
    console.log(`Fetching ${queryName} next page`);
    const response = await queryFn(nextToken);
    const items = response.data?.[queryName]?.items ?? [];
    allItems.push(...(items as T[]));
    nextToken = response.data?.[queryName]?.nextToken ?? undefined;
  } while (nextToken);

  console.log(
    `Completed fetching all ${queryName} pages. Total items: ${allItems.length}`
  );
  return allItems;
}

export const handler: Handler = async (event, context) => {
  console.log("Starting cleanupJobs function execution");
  try {
    console.log("Fetching all queues");
    const allQueues = await fetchAllPages<Queue, "listQueues">(
      (nextToken) =>
        client.graphql({
          query: listQueues,
          variables: {
            nextToken,
          },
        }) as Promise<GraphQLResult<{ listQueues: PagedList<Queue> }>>,
      "listQueues"
    );

    const deletedProjectIds = new Set<string>();

    for (const queue of allQueues) {
      if (!queue.url) {
        continue;
      }

      // Delete queues with no activity for 60+ days. Null lastObservationAt
      // (pre-existing queues that haven't had an observation since deploy)
      // are left alone to avoid mass-deletion on first deploy.
      if (
        queue.lastObservationAt &&
        Date.now() - Date.parse(queue.lastObservationAt) > STALE_QUEUE_DAYS * 24 * 60 * 60 * 1000
      ) {
        console.log(JSON.stringify({
          msg: 'deleting_stale_queue',
          queueId: queue.id,
          projectId: queue.projectId,
          lastObservationAt: queue.lastObservationAt,
        }));

        if (queue.locationManifestS3Key) {
          try {
            const bucketName = env.OUTPUTS_BUCKET_NAME;
            if (bucketName) {
              await s3Client.send(
                new DeleteObjectCommand({
                  Bucket: bucketName,
                  Key: queue.locationManifestS3Key,
                })
              );
            }
          } catch (s3Error) {
            console.warn("Failed to delete S3 manifest for stale queue:", s3Error);
          }
        }

        await client.graphql({
          query: deleteQueue,
          variables: { input: { id: queue.id } },
        });

        const sqsClient = new SQSClient({
          region: env.AWS_REGION,
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            sessionToken: env.AWS_SESSION_TOKEN,
          },
        });
        await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queue.url }));

        // The Queue is the run's only liveness signal, so its deletion is the
        // moment the run's outcome is known.
        await finishShadowWorkflowRun({
          runId: queue.id,
          status: 'cancelled',
          reason: 'stale',
          launchedCount: queue.launchedCount ?? undefined,
          observedCount: queue.observedCount ?? undefined,
        });

        deletedProjectIds.add(queue.projectId);
        continue;
      }

      const params: GetQueueAttributesCommandInput = {
        QueueUrl: queue.url,
        AttributeNames: ["ApproximateNumberOfMessages"],
      };

      const sqsClient = new SQSClient({
        region: env.AWS_REGION,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          sessionToken: env.AWS_SESSION_TOKEN,
        },
      });

      const result = await sqsClient.send(
        new GetQueueAttributesCommand(params)
      );

      const sqsMessageCount = parseInt(result.Attributes?.ApproximateNumberOfMessages ?? "0");

      if (
        (!queue.approximateSize || queue.approximateSize === 0) &&
        sqsMessageCount === 0
      ) {
        // Queue is empty - check if it might need requeuing
        const hasTrackingFields = queue.launchedCount != null && queue.launchedCount > 0;
        const mayHaveMissing = hasTrackingFields &&
          (queue.observedCount ?? 0) < queue.launchedCount!;
        const underRequeueLimit = (queue.requeuesCompleted ?? 0) < MAX_REQUEUES;

        // If queue might need requeuing, set emptyQueueTimestamp but don't delete yet
        if (hasTrackingFields && mayHaveMissing && underRequeueLimit) {
          console.log("Queue may need requeuing, setting emptyQueueTimestamp", {
            queueId: queue.id,
            launchedCount: queue.launchedCount,
            observedCount: queue.observedCount,
            requeuesCompleted: queue.requeuesCompleted,
          });

          // Only set if not already set
          if (!queue.emptyQueueTimestamp) {
            await client.graphql({
              query: updateQueue,
              variables: {
                input: {
                  id: queue.id,
                  approximateSize: 0,
                  emptyQueueTimestamp: new Date().toISOString(),
                }
              },
            });
          } else {
            // Just update approximateSize
            await client.graphql({
              query: updateQueue,
              variables: {
                input: {
                  id: queue.id,
                  approximateSize: 0,
                },
              },
            });
          }
          continue;
        }

        // Queue should be deleted (no tracking, counts match, or requeue limit reached)
        // Fetch project name for logging
        let projectName = "Unknown";
        let organizationId: string | undefined;
        try {
          const projectResponse = await client.graphql({
            query: getProject,
            variables: { id: queue.projectId },
          });
          projectName = projectResponse.data?.getProject?.name || "Unknown";
          organizationId = projectResponse.data?.getProject?.organizationId ?? undefined;
        } catch (err) {
          console.error(`Failed to fetch project name for ${queue.projectId}:`, err);
        }

        // Delete the S3 manifest if it exists (skip for homography queues —
        // reconcileHomographies reads the manifest for targeted dedup, then deletes it)
        const isHomographyQueue = queue.tag === 'homography';
        if (queue.locationManifestS3Key && !isHomographyQueue) {
          try {
            const bucketName = env.OUTPUTS_BUCKET_NAME;
            if (bucketName) {
              await s3Client.send(
                new DeleteObjectCommand({
                  Bucket: bucketName,
                  Key: queue.locationManifestS3Key,
                })
              );
              console.log("Deleted S3 manifest", { key: queue.locationManifestS3Key });
            }
          } catch (s3Error) {
            console.warn("Failed to delete S3 manifest:", s3Error);
          }
        }

        // NOTE: FN pool and history manifests are NOT deleted on queue cleanup.
        // They persist until the user explicitly resets via the UI, enabling
        // cumulative sampling across multiple launches.

        await client.graphql({
          query: deleteQueue,
          variables: {
            input: {
              id: queue.id,
            },
          },
        });

        await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queue.url }));

        // Log the cleanup action
        const queueName = queue.tag || queue.name || "Unknown";
        const logMessage = `Cancelled queue job "${queueName}" for project "${projectName}"`;

        try {
          await client.graphql({
            query: /* GraphQL */ `
              mutation CreateAdminActionLog($input: CreateAdminActionLogInput!) {
                createAdminActionLog(input: $input) {
                  id
                  userId
                  message
                  projectId
                  group
                  createdAt
                }
              }
            `,
            variables: {
              input: {
                userId: "SurveyScope",
                message: logMessage,
                projectId: queue.projectId,
                group: organizationId,
              },
            },
          });
        } catch (logError) {
          // Log error but don't fail the cleanup
          console.error("Failed to log admin action:", logError);
        }

        // Trigger post-completion Lambdas based on queue type
        const isFnQueue = queue.name === 'False Negatives';

        if (isHomographyQueue && queue.annotationSetId) {
          // Trigger homography reconciliation — pass manifest key for targeted dedup
          try {
            const functionName = (env as any).RECONCILE_HOMOGRAPHIES_FUNCTION_NAME;
            if (functionName) {
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
                      queueId: queue.id,
                      manifestS3Key: queue.locationManifestS3Key ?? null,
                    })
                  ),
                })
              );
              console.log('Triggered homography reconciliation', {
                annotationSetId: queue.annotationSetId,
                manifestS3Key: queue.locationManifestS3Key,
              });
            }
          } catch (err) {
            console.error('Failed to trigger homography reconciliation', err);
          }
        } else if (!isFnQueue && !isHomographyQueue && queue.annotationSetId) {
          // Trigger FN pool reconciliation for species labelling queues
          try {
            const functionName = (env as any).RECONCILE_FALSE_NEGATIVES_FUNCTION_NAME;
            if (functionName) {
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
                    JSON.stringify({ annotationSetId: queue.annotationSetId })
                  ),
                })
              );
              console.log('Triggered FN reconciliation', {
                annotationSetId: queue.annotationSetId,
              });
            }
          } catch (err) {
            console.error('Failed to trigger FN reconciliation', err);
          }
        }

        await finishShadowWorkflowRun({
          runId: queue.id,
          status: 'completed',
          reason: hasTrackingFields && mayHaveMissing ? 'requeue-limit' : 'drained',
          launchedCount: queue.launchedCount ?? undefined,
          observedCount: queue.observedCount ?? undefined,
        });

        deletedProjectIds.add(queue.projectId);
        continue;
      }

      await client.graphql({
        query: updateQueue,
        variables: {
          input: {
            id: queue.id,
            approximateSize: sqsMessageCount,
          },
        },
      });
    }

    for (const projectId of deletedProjectIds) {
      (client.graphql({
        query: updateProjectMembershipsMutation,
        variables: { projectId },
      }) as Promise<any>).catch((err: any) => console.warn('Failed to update project memberships', err));
    }

    console.log("Job status monitoring completed successfully");
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Job status monitoring completed successfully",
      }),
    };
  } catch (error: any) {
    console.error("Error in cleanupJobs:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error monitoring job status",
        error: error.message,
      }),
    };
  }
};
