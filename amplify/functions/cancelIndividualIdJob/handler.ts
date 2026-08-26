import type { CancelIndividualIdJobHandler } from '../../data/resource';
import { env } from '$amplify/env/cancelIndividualIdJob';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { finishShadowWorkflowRun } from '../workflowStats/runWriter';

const getJobQuery = /* GraphQL */ `
  query GetIndividualIdJob($id: ID!) {
    getIndividualIdJob(id: $id) {
      id
      projectId
      status
      group
    }
  }
`;

const getProjectQuery = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) {
      id
      organizationId
    }
  }
`;

const getUserProjectMembershipQuery = /* GraphQL */ `
  query UserProjectMembershipsByUserId($userId: String!, $limit: Int) {
    userProjectMembershipsByUserId(userId: $userId, limit: $limit) {
      items { userId projectId isAdmin group }
    }
  }
`;

const updateJobMutation = /* GraphQL */ `
  mutation UpdateIndividualIdJob(
    $input: UpdateIndividualIdJobInput!
    $condition: ModelIndividualIdJobConditionInput
  ) {
    updateIndividualIdJob(input: $input, condition: $condition) { id group }
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

async function executeGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = (await gqlClient.graphql({
    query,
    variables,
  } as never)) as GraphQLResult<T>;
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

function isConditionalCheckFailed(error: unknown): boolean {
  return /ConditionalCheckFailed/.test(
    error instanceof Error ? error.message : String(error)
  );
}

// Cancelling a ChainLinker job used to be a direct model update from the
// browser. It goes through here so the run behind the job can be closed with
// the same authorization the queue cancel path applies.
export const handler: CancelIndividualIdJobHandler = async (event) => {
  const { jobId } = event.arguments;

  const jobData = await executeGraphql<{
    getIndividualIdJob?: {
      id: string;
      projectId: string;
      status: string | null;
    } | null;
  }>(getJobQuery, { id: jobId });
  const job = jobData.getIndividualIdJob;
  if (!job) throw new Error(`ChainLinker job not found: ${jobId}`);

  const projectData = await executeGraphql<{
    getProject?: { id: string; organizationId: string } | null;
  }>(getProjectQuery, { id: job.projectId });
  const project = projectData.getProject;
  if (!project) throw new Error(`Project not found: ${job.projectId}`);

  const identity = event.identity;
  if (!identity || !('sub' in identity) || !identity.sub) {
    throw new Error('Unauthorized: no identity');
  }
  const groups = ('groups' in identity ? identity.groups : null) ?? [];
  if (!groups.includes('sysadmin')) {
    if (!groups.includes(project.organizationId)) {
      throw new Error('Unauthorized: user does not belong to this organization');
    }
    const membershipData = await executeGraphql<{
      userProjectMembershipsByUserId?: {
        items: { projectId: string; isAdmin: boolean | null }[];
      };
    }>(getUserProjectMembershipQuery, { userId: identity.sub, limit: 1000 });
    const membership = membershipData.userProjectMembershipsByUserId?.items?.find(
      (m) => m.projectId === job.projectId
    );
    if (!membership?.isAdmin) {
      throw new Error('Unauthorized: user is not a project admin');
    }
  }

  if (job.status !== 'active' && job.status !== 'launching') {
    return JSON.stringify({ success: true, alreadyFinished: true });
  }

  try {
    await executeGraphql(updateJobMutation, {
      input: { id: jobId, status: 'cancelled' },
      condition: { or: [{ status: { eq: 'active' } }, { status: { eq: 'launching' } }] },
    });
  } catch (error) {
    // Lost a race with completion or another cancel; nothing left to do.
    if (isConditionalCheckFailed(error)) {
      return JSON.stringify({ success: true, alreadyFinished: true });
    }
    throw error;
  }

  await finishShadowWorkflowRun({
    runId: jobId,
    status: 'cancelled',
    reason: 'user',
    finishedBy: identity.sub,
  });

  return JSON.stringify({ success: true });
};
