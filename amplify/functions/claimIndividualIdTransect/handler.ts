import type { ClaimIndividualIdTransectHandler } from '../../data/resource';
import { env } from '$amplify/env/claimIndividualIdTransect';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';

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

const getIndividualIdJobQuery = /* GraphQL */ `
  query GetIndividualIdJob($id: ID!) {
    getIndividualIdJob(id: $id) {
      id
      projectId
      annotationSetId
      categoryId
      status
    }
  }
`;

const transectsByJobIdQuery = /* GraphQL */ `
  query TransectsByJobId($jobId: ID!, $nextToken: String) {
    individualIdTransectsByJobId(jobId: $jobId, limit: 1000, nextToken: $nextToken) {
      items {
        id
        transectId
        status
        assignedUserId
      }
      nextToken
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

type JobRow = {
  id: string;
  projectId: string;
  annotationSetId: string;
  categoryId: string;
  status: string | null;
};

type TransectRow = {
  id: string;
  transectId: string;
  status: string | null;
  assignedUserId: string | null;
};

type TransectsByJobIdResult = {
  individualIdTransectsByJobId: {
    items: TransectRow[];
    nextToken?: string | null;
  };
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

export const handler: ClaimIndividualIdTransectHandler = async (event) => {
  try {
    const jobId = event.arguments?.jobId;
    if (!jobId) return { none: true, message: 'jobId required' };

    const userId =
      (event.identity as any)?.sub ?? (event.identity as any)?.username;
    if (!userId) return { none: true, message: 'No caller identity' };

    const jobData = await executeGraphql<{ getIndividualIdJob?: JobRow | null }>(
      getIndividualIdJobQuery,
      { id: jobId }
    );
    const job = jobData.getIndividualIdJob;
    if (!job || job.status !== 'active') {
      return { none: true, message: 'Job not available' };
    }

    // Load all transect rows for the job.
    const transects: TransectRow[] = [];
    let nextToken: string | null = null;
    do {
      const page: TransectsByJobIdResult =
        await executeGraphql<TransectsByJobIdResult>(transectsByJobIdQuery, {
          jobId,
          nextToken,
        });
      transects.push(...page.individualIdTransectsByJobId.items);
      nextToken = page.individualIdTransectsByJobId.nextToken ?? null;
    } while (nextToken);

    // Idempotent re-grant: the user already holds an in-progress transect for
    // this job (navigated back / refreshed).
    const existing = transects.find(
      (t) => t.assignedUserId === userId && t.status === 'assigned'
    );
    if (existing) {
      return {
        transectRowId: existing.id,
        transectId: existing.transectId,
        // The job id is the Workflow Run id for ChainLinker statistics.
        jobId,
        categoryId: job.categoryId,
        annotationSetId: job.annotationSetId,
        projectId: job.projectId,
      };
    }

    // Atomically claim the first still-available transect. The conditional
    // write (status must still be 'available') is the lock â€” only one
    // concurrent caller can win a given row; losers fall through to the next.
    const now = new Date().toISOString();
    for (const t of transects) {
      if (t.status !== 'available') continue;
      try {
        await executeGraphql(updateTransectMutation, {
          input: {
            id: t.id,
            status: 'assigned',
            assignedUserId: userId,
            assignedAt: now,
            lastActiveAt: now,
          },
          condition: { status: { eq: 'available' } },
        });
        return {
          transectRowId: t.id,
          transectId: t.transectId,
          jobId,
          categoryId: job.categoryId,
          annotationSetId: job.annotationSetId,
          projectId: job.projectId,
        };
      } catch (err) {
        if (isConditionalCheckFailed(err)) continue; // lost the race; try next
        throw err;
      }
    }

    return { none: true, message: 'No transects available' };
  } catch (error: any) {
    console.error('claimIndividualIdTransect error', error);
    return { none: true, error: error?.message ?? 'Unknown error' };
  }
};
