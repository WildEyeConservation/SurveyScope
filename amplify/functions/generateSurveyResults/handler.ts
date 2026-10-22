import { randomUUID } from 'node:crypto';
import { env } from '$amplify/env/generateSurveyResults';
import { Amplify } from 'aws-amplify';
import { generateClient, type GraphQLResult } from 'aws-amplify/data';
import type { GenerateSurveyResultsHandler } from '../../data/resource';
import { authorizeRequest } from '../shared/authorizeRequest';
import { boundaryRecomputePending } from '../../../shared/boundaryStatus';
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  SFNClient,
  StartExecutionCommand,
} from '@aws-sdk/client-sfn';

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
        clearCredentialsAndIdentityId: () => undefined,
      },
    },
  }
);

const client = generateClient({ authMode: 'iam' });
const sdkConfig = { region: env.AWS_REGION, maxAttempts: 5 };
const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient(sdkConfig),
  { marshallOptions: { removeUndefinedValues: true } }
);
const s3 = new S3Client(sdkConfig);
const stepFunctions = new SFNClient(sdkConfig);

const getProjectOrganizationId = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) {
      organizationId
      boundaryRecomputeRequested
      boundaryRecomputeLeaseUntil
    }
  }
`;

interface JobItem {
  jobKey: string;
  jobId: string;
  surveyId: string;
  annotationSetId: string;
  categoryIds: string[];
  organizationId: string;
  status: string;
  phase: string;
  statusKey: string;
  heartbeatAt: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
}

interface LaunchResponse {
  jobId: string;
  statusKey: string;
  reused: boolean;
}

const activeStatuses = new Set([
  'PENDING',
  'RUNNING',
  'ROLLING_BACK',
]);
// The worker heartbeats every 30s while paging DynamoDB and while committing,
// but `calculate()` is a single synchronous pass over the whole survey and
// cannot heartbeat part-way through. This window has to exceed the worst-case
// compute phase, or a second launch will treat a healthy worker as dead and
// claim its job. 30 minutes buys headroom; the cost is that a genuinely dead
// worker blocks relaunch for that long.
const staleAfterMilliseconds = 30 * 60 * 1000;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// The job table and state machine only exist when the Fargate pipeline is
// deployed (AMPLIFY_ENABLE_ECS + AMPLIFY_ENABLE_JOLLY_FARGATE). The mutation
// itself is always deployed, so without this the caller gets a bare
// "JOLLY_JOB_TABLE_NAME is required" instead of an actionable message.
function requireJollyPipeline(): {
  jobTableName: string;
  stateMachineArn: string;
} {
  const jobTableName = process.env.JOLLY_JOB_TABLE_NAME;
  const stateMachineArn = process.env.JOLLY_STATE_MACHINE_ARN;
  if (!jobTableName || !stateMachineArn) {
    throw new Error(
      'Results generation is not enabled in this environment'
    );
  }
  return { jobTableName, stateMachineArn };
}

function isFreshActiveJob(
  item: Record<string, unknown> | undefined
): item is Record<string, unknown> & JobItem {
  return Boolean(
    item &&
      typeof item.status === 'string' &&
      activeStatuses.has(item.status) &&
      typeof item.heartbeatAt === 'number' &&
      item.heartbeatAt > Date.now() - staleAfterMilliseconds &&
      typeof item.jobId === 'string' &&
      typeof item.statusKey === 'string'
  );
}

function sameCategorySelection(
  existing: unknown,
  requested: string[]
): boolean {
  if (
    !Array.isArray(existing) ||
    existing.some((value) => typeof value !== 'string')
  ) {
    return false;
  }
  const existingIds = [...new Set(existing)].sort();
  const requestedIds = [...new Set(requested)].sort();
  return (
    existingIds.length === requestedIds.length &&
    existingIds.every(
      (categoryId, index) => categoryId === requestedIds[index]
    )
  );
}

async function getJob(
  tableName: string,
  jobKey: string
): Promise<Record<string, unknown> | undefined> {
  const response = await dynamo.send(
    new GetCommand({
      TableName: tableName,
      Key: { jobKey },
      ConsistentRead: true,
    })
  );
  return response.Item;
}

async function claimJob(
  tableName: string,
  input: Omit<
    JobItem,
    'jobId' | 'statusKey' | 'heartbeatAt' | 'createdAt' | 'updatedAt' | 'expiresAt' | 'status' | 'phase'
  >
): Promise<{ item: JobItem; reused: boolean }> {
  const existing = await getJob(tableName, input.jobKey);
  if (isFreshActiveJob(existing)) {
    if (!sameCategorySelection(existing.categoryIds, input.categoryIds)) {
      throw new Error(
        'A results job is already running for this annotation set with a different label selection'
      );
    }
    return { item: existing, reused: true };
  }

  const nowMilliseconds = Date.now();
  const now = new Date(nowMilliseconds).toISOString();
  const jobId = randomUUID();
  const item: JobItem = {
    ...input,
    jobId,
    statusKey: `jolly-status/jobs/${jobId}.json`,
    status: 'PENDING',
    phase: 'PENDING',
    heartbeatAt: nowMilliseconds,
    createdAt: now,
    updatedAt: now,
    expiresAt: Math.floor(nowMilliseconds / 1000) + 30 * 24 * 60 * 60,
  };
  try {
    await dynamo.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression:
          'attribute_not_exists(jobKey) OR heartbeatAt < :staleBefore OR NOT (#status IN (:pending, :running, :rollingBack))',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':staleBefore': nowMilliseconds - staleAfterMilliseconds,
          ':pending': 'PENDING',
          ':running': 'RUNNING',
          ':rollingBack': 'ROLLING_BACK',
        },
      })
    );
    return { item, reused: false };
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    const winner = await getJob(tableName, input.jobKey);
    if (!isFreshActiveJob(winner)) throw error;
    if (!sameCategorySelection(winner.categoryIds, input.categoryIds)) {
      throw new Error(
        'A results job is already running for this annotation set with a different label selection'
      );
    }
    return { item: winner, reused: true };
  }
}

async function putStatus(
  bucketName: string,
  item: JobItem,
  status: string,
  error: string | null
): Promise<void> {
  const now = new Date().toISOString();
  const body = {
    jobId: item.jobId,
    surveyId: item.surveyId,
    annotationSetId: item.annotationSetId,
    status,
    phase: status,
    updatedAt: now,
    error,
  };
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: item.statusKey,
      Body: JSON.stringify(body),
      ContentType: 'application/json',
    })
  );
}

async function failLaunch(
  tableName: string,
  bucketName: string,
  item: JobItem,
  error: unknown
): Promise<void> {
  const message =
    error instanceof Error ? error.message : String(error);
  const now = new Date().toISOString();
  await dynamo.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { jobKey: item.jobKey },
      ConditionExpression: 'jobId = :jobId',
      UpdateExpression:
        'SET #status = :failed, phase = :failed, updatedAt = :updatedAt, heartbeatAt = :heartbeatAt, #error = :error',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#error': 'error',
      },
      ExpressionAttributeValues: {
        ':jobId': item.jobId,
        ':failed': 'FAILED',
        ':updatedAt': now,
        ':heartbeatAt': Date.now(),
        ':error': message,
      },
    })
  );
  await putStatus(bucketName, item, 'FAILED', message);
}

export const handler: GenerateSurveyResultsHandler = async (event) => {
  const surveyId = event.arguments.surveyId;
  const annotationSetId = event.arguments.annotationSetId;
  const categoryIds = [
    ...new Set(event.arguments.categoryIds ?? []),
  ];
  if (categoryIds.length === 0) {
    throw new Error('At least one category is required');
  }

  const projectResponse = await client.graphql({
    query: getProjectOrganizationId,
    variables: { id: surveyId },
  });
  const project = (
    projectResponse as GraphQLResult<{
      getProject?: {
        organizationId?: string | null;
        boundaryRecomputeRequested?: boolean | null;
        boundaryRecomputeLeaseUntil?: string | null;
      } | null;
    }>
  ).data?.getProject;
  const organizationId = project?.organizationId;
  if (!organizationId) {
    throw new Error('Project does not have an organizationId');
  }
  authorizeRequest(event.identity, organizationId);
  // Strata and transect assignments are incomplete until the recompute ends.
  if (boundaryRecomputePending(project)) {
    throw new Error(
      'The survey area and strata are still being applied to the images. Try again in a few minutes.'
    );
  }

  const { jobTableName, stateMachineArn } = requireJollyPipeline();
  const bucketName = requiredEnvironment('OUTPUTS_BUCKET_NAME');
  const jobKey = `${surveyId}#${annotationSetId}`;
  const claimed = await claimJob(jobTableName, {
    jobKey,
    surveyId,
    annotationSetId,
    categoryIds,
    organizationId,
  });
  if (claimed.reused) {
    return {
      jobId: claimed.item.jobId,
      statusKey: claimed.item.statusKey,
      reused: true,
    } satisfies LaunchResponse;
  }

  try {
    await putStatus(
      bucketName,
      claimed.item,
      'PENDING',
      null
    );
    await stepFunctions.send(
      new StartExecutionCommand({
        stateMachineArn,
        name: `jolly-${claimed.item.jobId}`,
        input: JSON.stringify({
          jobId: claimed.item.jobId,
          jobKey,
          surveyId,
          annotationSetId,
          categoryIds,
          organizationId,
          statusKey: claimed.item.statusKey,
        }),
      })
    );
    return {
      jobId: claimed.item.jobId,
      statusKey: claimed.item.statusKey,
      reused: false,
    } satisfies LaunchResponse;
  } catch (error) {
    await failLaunch(
      jobTableName,
      bucketName,
      claimed.item,
      error
    );
    throw error;
  }
};
