import type { CompleteIndividualIdTransectHandler } from '../../data/resource';
import { env } from '$amplify/env/completeIndividualIdTransect';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { finishShadowWorkflowRun } from '../workflowStats/runWriter';

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

const client = generateClient({ authMode: 'iam' });

const getTransectQuery = /* GraphQL */ `
  query GetIndividualIdTransect($id: ID!) {
    getIndividualIdTransect(id: $id) {
      id
      jobId
      projectId
      status
      assignedUserId
    }
  }
`;

const updateTransectMutation = /* GraphQL */ `
  mutation UpdateIndividualIdTransect(
    $input: UpdateIndividualIdTransectInput!
    $condition: ModelIndividualIdTransectConditionInput
  ) {
    updateIndividualIdTransect(input: $input, condition: $condition) {
      id
      group
    }
  }
`;

const decrementMutation = /* GraphQL */ `
  mutation Dec($id: ID!) {
    decrementIndividualIdRemainingTransects(id: $id)
  }
`;

const updateJobMutation = /* GraphQL */ `
  mutation UpdateIndividualIdJob($input: UpdateIndividualIdJobInput!) {
    updateIndividualIdJob(input: $input) { id group }
  }
`;

const updateProjectMembershipsMutation = /* GraphQL */ `
  mutation UpdateProjectMemberships($projectId: String!) {
    updateProjectMemberships(projectId: $projectId)
  }
`;

type TransectRow = {
  id: string;
  jobId: string;
  projectId: string;
  status: string | null;
  assignedUserId: string | null;
};

async function executeGraphql<T>(
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const resp = (await client.graphql({
    query,
    variables,
  } as any)) as GraphQLResult<T>;
  if (resp.errors && resp.errors.length > 0) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(resp.errors.map((e) => e.message))}`
    );
  }
  if (!resp.data) throw new Error('GraphQL response missing data');
  return resp.data;
}

function isConditionalCheckFailed(err: any): boolean {
  const msgs: string[] = [];
  if (err?.message) msgs.push(String(err.message));
  if (Array.isArray(err?.errors)) {
    for (const e of err.errors) if (e?.message) msgs.push(String(e.message));
  }
  return msgs.some((m) => m.includes('ConditionalCheckFailed'));
}

export const handler: CompleteIndividualIdTransectHandler = async (event) => {
  try {
    const transectRowId = event.arguments?.transectRowId;
    if (!transectRowId) return { ok: false, message: 'transectRowId required' };

    const userId =
      (event.identity as any)?.sub ?? (event.identity as any)?.username;
    if (!userId) return { ok: false, message: 'No caller identity' };

    const data = await executeGraphql<{
      getIndividualIdTransect?: TransectRow | null;
    }>(getTransectQuery, { id: transectRowId });
    const row = data.getIndividualIdTransect;
    if (!row) return { ok: false, message: 'Transect not found' };

    if (row.status === 'completed') {
      // Idempotent: already finished (double-fire / retry). No decrement.
      return { ok: true, alreadyComplete: true };
    }

    // Atomically transition assigned -> completed. The condition is the
    // exactly-once guard for the counter decrement: only the holder, and only
    // on a real transition, proceeds.
    try {
      await executeGraphql(updateTransectMutation, {
        input: { id: transectRowId, status: 'completed' },
        condition: {
          status: { eq: 'assigned' },
          assignedUserId: { eq: userId },
        },
      });
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        // Not ours, or already completed by another path — no-op, no decrement.
        return { ok: true, noop: true };
      }
      throw err;
    }

    const decResult = await executeGraphql<{
      decrementIndividualIdRemainingTransects?: number | null;
    }>(decrementMutation, { id: row.jobId });
    const remaining =
      decResult.decrementIndividualIdRemainingTransects ?? null;

    const jobComplete = remaining !== null && remaining <= 0;
    if (jobComplete) {
      // Last transect done: finish the job. Marking the job 'completed' drops
      // it from the Jobs page (only 'active' jobs are listed); the project
      // itself is already 'active' so it simply has no launched job anymore.
      await executeGraphql(updateJobMutation, {
        input: { id: row.jobId, status: 'completed' },
      });
      // The job ID is the ChainLinker run ID.
      await finishShadowWorkflowRun({
        runId: row.jobId,
        status: 'completed',
        reason: 'drained',
      });
      try {
        await executeGraphql(updateProjectMembershipsMutation, {
          projectId: row.projectId,
        });
      } catch (e) {
        console.warn('updateProjectMemberships failed', e);
      }
    }

    return { ok: true, remaining, jobComplete };
  } catch (error: any) {
    console.error('completeIndividualIdTransect error', error);
    return { ok: false, error: error?.message ?? 'Unknown error' };
  }
};
