import type { Handler } from 'aws-lambda';
import { env } from '$amplify/env/expireInactiveQueues';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { SQSClient, DeleteQueueCommand } from '@aws-sdk/client-sqs';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { finishShadowWorkflowRun } from '../workflowStats/runWriter';
import { SENDER } from '../inviteUserToOrganization/core';
import {
  NOTICE_MS,
  decide,
  inactiveJobsEmail,
  jobLabel,
  lastActivityMs,
  type WarnedJob,
} from './core';

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

const client = generateClient({ authMode: 'iam' });
const sqs = new SQSClient({ region: env.AWS_REGION });
const s3 = new S3Client({ region: env.AWS_REGION });
const lambda = new LambdaClient({ region: env.AWS_REGION });
const cognito = new CognitoIdentityProviderClient({ region: env.AWS_REGION });
const ses = new SESv2Client({ region: env.AWS_REGION });

const listQueuesQuery = /* GraphQL */ `
  query ListQueues($nextToken: String) {
    listQueues(limit: 1000, nextToken: $nextToken) {
      items {
        id
        url
        name
        tag
        projectId
        annotationSetId
        locationManifestS3Key
        launchedCount
        observedCount
        createdAt
        lastObservationAt
        lastAccessedAt
        inactivityWarnedAt
        cancelAfter
      }
      nextToken
    }
  }
`;

const getProjectQuery = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) { id name organizationId }
  }
`;

const getOrganizationQuery = /* GraphQL */ `
  query GetOrganization($id: ID!) {
    getOrganization(id: $id) { id name }
  }
`;

const orgAdminsQuery = /* GraphQL */ `
  query MembershipsByOrganizationId($organizationId: ID!, $nextToken: String) {
    membershipsByOrganizationId(
      organizationId: $organizationId
      filter: { isAdmin: { eq: true } }
      limit: 1000
      nextToken: $nextToken
    ) {
      items { userId }
      nextToken
    }
  }
`;

const updateQueueMutation = /* GraphQL */ `
  mutation UpdateQueue($input: UpdateQueueInput!, $condition: ModelQueueConditionInput) {
    updateQueue(input: $input, condition: $condition) { id group }
  }
`;

const deleteQueueMutation = /* GraphQL */ `
  mutation DeleteQueue($input: DeleteQueueInput!, $condition: ModelQueueConditionInput) {
    deleteQueue(input: $input, condition: $condition) { id group }
  }
`;

const createAdminActionLogMutation = /* GraphQL */ `
  mutation CreateAdminActionLog($input: CreateAdminActionLogInput!) {
    createAdminActionLog(input: $input) { id group }
  }
`;

const updateProjectMembershipsMutation = /* GraphQL */ `
  mutation UpdateProjectMemberships($projectId: String!) {
    updateProjectMemberships(projectId: $projectId)
  }
`;

type QueueRow = {
  id: string;
  url: string | null;
  name: string;
  tag: string | null;
  projectId: string;
  annotationSetId: string | null;
  locationManifestS3Key: string | null;
  launchedCount: number | null;
  observedCount: number | null;
  createdAt: string;
  lastObservationAt: string | null;
  lastAccessedAt: string | null;
  inactivityWarnedAt: string | null;
  cancelAfter: string | null;
};

type ProjectRow = { id: string; name: string; organizationId: string };

async function executeGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const resp = (await client.graphql(
    { query, variables } as unknown as Parameters<typeof client.graphql>[0]
  )) as GraphQLResult<T>;
  if (resp.errors && resp.errors.length > 0) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(resp.errors.map((e) => (e as { errorType?: string }).errorType ?? e.message))}`
    );
  }
  if (!resp.data) throw new Error('GraphQL response missing data');
  return resp.data;
}

function isConditionFailure(err: unknown): boolean {
  const errors = (err as { errors?: { errorType?: string }[] } | null)?.errors;
  const text = Array.isArray(errors)
    ? errors.map((e) => e.errorType ?? '').join(' ')
    : String((err as Error)?.message ?? err);
  return text.includes('ConditionalCheckFailed');
}

async function listQueues(): Promise<QueueRow[]> {
  const all: QueueRow[] = [];
  let nextToken: string | null = null;
  do {
    const data: { listQueues: { items: QueueRow[]; nextToken?: string | null } } =
      await executeGraphql(listQueuesQuery, { nextToken });
    all.push(...data.listQueues.items);
    nextToken = data.listQueues.nextToken ?? null;
  } while (nextToken);
  return all;
}

const projectCache = new Map<string, Promise<ProjectRow | null>>();
function getProject(id: string): Promise<ProjectRow | null> {
  if (!projectCache.has(id)) {
    projectCache.set(
      id,
      executeGraphql<{ getProject: ProjectRow | null }>(getProjectQuery, { id }).then(
        (data) => data.getProject
      )
    );
  }
  return projectCache.get(id)!;
}

async function adminEmails(organizationId: string): Promise<string[]> {
  const userIds: string[] = [];
  let nextToken: string | null = null;
  do {
    const data: {
      membershipsByOrganizationId: { items: { userId: string }[]; nextToken?: string | null };
    } = await executeGraphql(orgAdminsQuery, { organizationId, nextToken });
    userIds.push(...data.membershipsByOrganizationId.items.map((m) => m.userId));
    nextToken = data.membershipsByOrganizationId.nextToken ?? null;
  } while (nextToken);

  const emails = new Set<string>();
  for (const userId of userIds) {
    try {
      const user = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: env.AMPLIFY_AUTH_USERPOOL_ID,
          Username: userId,
        })
      );
      const attribute = (name: string) =>
        user.UserAttributes?.find((a) => a.Name === name)?.Value;
      const email = attribute('email');
      if (user.Enabled && email && attribute('email_verified') === 'true') {
        emails.add(email.trim().toLowerCase());
      }
    } catch (err) {
      console.warn(JSON.stringify({ msg: 'admin_lookup_failed', organizationId, userId, error: String(err) }));
    }
  }
  return [...emails];
}

async function sendEmail(
  to: string,
  content: { subject: string; html: string; text: string }
): Promise<void> {
  const replyTo = process.env.REPLY_TO_EMAIL;
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: SENDER,
      Destination: { ToAddresses: [to] },
      ReplyToAddresses: replyTo ? [replyTo] : undefined,
      Content: {
        Simple: {
          Subject: { Data: content.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: content.html, Charset: 'UTF-8' },
            Text: { Data: content.text, Charset: 'UTF-8' },
          },
        },
      },
    })
  );
}

async function warnOrganization(
  organizationId: string,
  jobs: { queue: QueueRow; project: ProjectRow }[],
  now: number
): Promise<number> {
  const recipients = await adminEmails(organizationId);
  if (recipients.length === 0) {
    console.warn(JSON.stringify({
      msg: 'inactive_queue_no_recipient',
      organizationId,
      queueIds: jobs.map((j) => j.queue.id),
    }));
    return 0;
  }

  const org = await executeGraphql<{ getOrganization: { name: string } | null }>(
    getOrganizationQuery,
    { id: organizationId }
  );
  const cancelAfter = now + NOTICE_MS;
  const listed: WarnedJob[] = jobs.map(({ queue, project }) => ({
    projectName: project.name,
    jobLabel: jobLabel(queue),
    lastActiveAt: lastActivityMs(queue),
  }));
  const content = inactiveJobsEmail(
    org.getOrganization?.name ?? 'your organisation',
    listed,
    cancelAfter
  );

  let sent = 0;
  for (const to of recipients) {
    try {
      await sendEmail(to, content);
      sent++;
    } catch (err) {
      console.error(JSON.stringify({ msg: 'inactive_queue_email_failed', organizationId, error: String(err) }));
    }
  }
  // The deadline only starts once someone has actually been told.
  if (sent === 0) return 0;

  let warned = 0;
  for (const { queue } of jobs) {
    try {
      await executeGraphql(updateQueueMutation, {
        input: {
          id: queue.id,
          inactivityWarnedAt: new Date(now).toISOString(),
          cancelAfter: new Date(cancelAfter).toISOString(),
        },
        condition: { inactivityWarnedAt: { attributeExists: false } },
      });
      warned++;
    } catch (err) {
      console.error(JSON.stringify({ msg: 'inactive_queue_mark_failed', queueId: queue.id, error: String(err) }));
    }
  }
  console.log(JSON.stringify({
    msg: 'inactive_queues_warned',
    organizationId,
    queueIds: jobs.map((j) => j.queue.id),
    recipients: sent,
    cancelAfter: new Date(cancelAfter).toISOString(),
  }));
  return warned;
}

async function clearWarning(queue: QueueRow): Promise<void> {
  await executeGraphql(updateQueueMutation, {
    input: { id: queue.id, inactivityWarnedAt: null, cancelAfter: null },
  });
  console.log(JSON.stringify({ msg: 'inactive_queue_resumed', queueId: queue.id }));
}

async function invoke(functionName: string | undefined, payload: unknown) {
  if (!functionName) return;
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: new TextEncoder().encode(JSON.stringify(payload)),
      })
    );
  } catch (err) {
    console.error(JSON.stringify({ msg: 'reconcile_invoke_failed', functionName, error: String(err) }));
  }
}

async function cancelQueue(queue: QueueRow): Promise<boolean> {
  const project = await getProject(queue.projectId);

  // Guard against activity since the scan.
  try {
    await executeGraphql(deleteQueueMutation, {
      input: { id: queue.id },
      condition: {
        and: [
          { cancelAfter: { eq: queue.cancelAfter } },
          {
            or: [
              { lastObservationAt: { attributeExists: false } },
              { lastObservationAt: { le: queue.inactivityWarnedAt } },
            ],
          },
        ],
      },
    });
  } catch (err) {
    if (isConditionFailure(err)) {
      console.log(JSON.stringify({ msg: 'inactive_queue_cancel_skipped', queueId: queue.id }));
      return false;
    }
    throw err;
  }

  if (queue.url) {
    try {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: queue.url }));
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name !== 'QueueDoesNotExist' && name !== 'AWS.SimpleQueueService.NonExistentQueue') {
        console.error(JSON.stringify({ msg: 'sqs_delete_failed', queueId: queue.id, error: String(err) }));
      }
    }
  }

  // reconcileHomographies reads the manifest itself, then deletes it.
  const isHomographyQueue = queue.tag === 'homography';
  if (queue.locationManifestS3Key && !isHomographyQueue && env.OUTPUTS_BUCKET_NAME) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: env.OUTPUTS_BUCKET_NAME,
          Key: queue.locationManifestS3Key,
        })
      );
    } catch (err) {
      console.warn(JSON.stringify({ msg: 'manifest_delete_failed', queueId: queue.id, error: String(err) }));
    }
  }

  if (isHomographyQueue && queue.annotationSetId) {
    await invoke(process.env.RECONCILE_HOMOGRAPHIES_FUNCTION_NAME, {
      annotationSetId: queue.annotationSetId,
      queueId: queue.id,
      manifestS3Key: queue.locationManifestS3Key ?? null,
    });
  }

  await finishShadowWorkflowRun({
    runId: queue.id,
    status: 'cancelled',
    reason: 'stale',
    launchedCount: queue.launchedCount ?? undefined,
    observedCount: queue.observedCount ?? undefined,
  });

  try {
    await executeGraphql(createAdminActionLogMutation, {
      input: {
        userId: 'SurveyScope',
        message: `Cancelled inactive job "${queue.tag || queue.name}" for project "${project?.name ?? 'Unknown'}"`,
        projectId: queue.projectId,
        group: project?.organizationId,
      },
    });
  } catch (err) {
    console.error(JSON.stringify({ msg: 'admin_log_failed', queueId: queue.id, error: String(err) }));
  }

  try {
    await executeGraphql(updateProjectMembershipsMutation, { projectId: queue.projectId });
  } catch (err) {
    console.warn(JSON.stringify({ msg: 'update_memberships_failed', projectId: queue.projectId, error: String(err) }));
  }

  console.log(JSON.stringify({ msg: 'inactive_queue_cancelled', queueId: queue.id, projectId: queue.projectId }));
  return true;
}

// Catch failures locally to avoid retrying warning emails.
export const handler: Handler = async () => {
  const now = Date.now();
  const summary = { queues: 0, warned: 0, resumed: 0, cancelled: 0, failed: 0 };
  try {
    const queues = (await listQueues()).filter((q) => q.url);
    summary.queues = queues.length;
    const toWarn = new Map<string, { queue: QueueRow; project: ProjectRow }[]>();

    for (const queue of queues) {
      try {
        const decision = decide(queue, now);
        if (decision === 'clear') {
          await clearWarning(queue);
          summary.resumed++;
        } else if (decision === 'cancel') {
          if (await cancelQueue(queue)) summary.cancelled++;
        } else if (decision === 'warn') {
          const project = await getProject(queue.projectId);
          if (!project) continue;
          const jobs = toWarn.get(project.organizationId) ?? [];
          jobs.push({ queue, project });
          toWarn.set(project.organizationId, jobs);
        }
      } catch (err) {
        summary.failed++;
        console.error(JSON.stringify({ msg: 'inactive_queue_failed', queueId: queue.id, error: String(err) }));
      }
    }

    for (const [organizationId, jobs] of toWarn) {
      try {
        summary.warned += await warnOrganization(organizationId, jobs, now);
      } catch (err) {
        summary.failed++;
        console.error(JSON.stringify({ msg: 'inactive_org_failed', organizationId, error: String(err) }));
      }
    }
  } catch (err) {
    summary.failed++;
    console.error(JSON.stringify({ msg: 'expire_inactive_queues_failed', error: String(err) }));
  }
  console.log(JSON.stringify({ msg: 'expire_inactive_queues_done', ...summary }));
};
