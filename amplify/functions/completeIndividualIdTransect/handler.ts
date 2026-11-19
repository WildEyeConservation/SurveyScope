import type { CompleteIndividualIdTransectHandler } from '../../data/resource';
import { env } from '$amplify/env/completeIndividualIdTransect';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { finishShadowWorkflowRun } from '../workflowStats/runWriter';
import { completeTransect, type JobRow, type TransectTables } from './transition';

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

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION }));
const ssm = new SSMClient({ region: env.AWS_REGION });
let transectTables: Promise<TransectTables> | undefined;
const tables = () =>
  (transectTables ??= ssm
    .send(
      new GetParameterCommand({
        Name: process.env.INDIVIDUAL_ID_TABLES_PARAMETER,
      })
    )
    .then((result) => JSON.parse(result.Parameter!.Value!) as TransectTables)
    .catch((error) => {
      transectTables = undefined;
      throw error;
    }));

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

// Idempotent, so a retry can finish a job whose last transect already completed.
async function finishJob(job: JobRow): Promise<boolean> {
  const remaining = job.remainingTransects ?? null;
  if (remaining === null || remaining > 0 || job.status === 'completed') return false;
  // Marking the job 'completed' drops it from the Jobs page (only 'active'
  // jobs are listed); the project itself is already 'active'.
  await executeGraphql(updateJobMutation, {
    input: { id: job.id, status: 'completed' },
  });
  // The job ID is the ChainLinker run ID.
  await finishShadowWorkflowRun({
    runId: job.id,
    status: 'completed',
    reason: 'drained',
  });
  try {
    await executeGraphql(updateProjectMembershipsMutation, {
      projectId: job.projectId,
    });
  } catch (e) {
    console.warn('updateProjectMemberships failed', e);
  }
  return true;
}

export const handler: CompleteIndividualIdTransectHandler = async (event) => {
  try {
    const transectRowId = event.arguments?.transectRowId;
    if (!transectRowId) return { ok: false, message: 'transectRowId required' };

    const userId =
      (event.identity as any)?.sub ?? (event.identity as any)?.username;
    if (!userId) return { ok: false, message: 'No caller identity' };

    const result = await completeTransect(db, await tables(), transectRowId, userId);
    if (result.kind === 'missing') return { ok: false, message: 'Transect not found' };
    if (result.kind === 'mismatch') {
      return { ok: false, message: 'Transect job does not belong to its project' };
    }
    if (result.kind === 'noop') return { ok: true, noop: true };
    if (result.kind === 'alreadyComplete') {
      await finishJob(result.job);
      return { ok: true, alreadyComplete: true };
    }

    const remaining = result.job.remainingTransects ?? null;
    const jobComplete = remaining !== null && remaining <= 0;
    if (jobComplete) await finishJob(result.job);

    return { ok: true, remaining, jobComplete };
  } catch (error: any) {
    console.error('completeIndividualIdTransect error', error);
    return { ok: false, error: error?.message ?? 'Unknown error' };
  }
};
