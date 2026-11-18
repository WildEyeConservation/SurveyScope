import type { Handler } from 'aws-lambda';
import { env } from '$amplify/env/processTilingBatch';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import pLimit from 'p-limit';
import { getTilingBatch, tilingBatchesByTaskId } from './graphql/queries';
import { isUnder, TILING_BATCH_PREFIX } from '../shared/s3Keys';

// Inline minimal mutations – return key fields + `group` to avoid nested-resolver
// auth failures while still enabling subscription delivery via groupDefinedIn('group').
const createLocationMutation = /* GraphQL */ `
  mutation CreateLocation($input: CreateLocationInput!) {
    createLocation(input: $input) { id group }
  }
`;

const updateTilingBatchMutation = /* GraphQL */ `
  mutation UpdateTilingBatch($input: UpdateTilingBatchInput!) {
    updateTilingBatch(input: $input) { id group }
  }
`;

const getProjectOrganizationId = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) { organizationId }
  }
`;

// Configure Amplify for IAM-based GraphQL access.
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

const client = generateClient({
  authMode: 'iam',
});

const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

const lambdaClient = new LambdaClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

// Location data structure from the input S3 file
type LocationInput = {
  x: number;
  y: number;
  width: number;
  height: number;
  imageId: string;
  projectId: string;
  setId: string;
};

const MAX_INVOCATION_DEPTH = 100;

type ProcessBatchPayload = {
  batchId: string;
  depth: number;
};

// Entry point invoked by the orchestrating lambda.
export const handler: Handler = async (event) => {
  const payload = parsePayload(event);
  const { batchId, depth } = payload;

  console.log('processTilingBatch invoked', { batchId, depth });

  if (depth >= MAX_INVOCATION_DEPTH) {
    console.error('MAX_INVOCATION_DEPTH reached — aborting chain to prevent infinite loop', {
      batchId,
      depth,
    });
    await updateBatchFailed(batchId, `Invocation depth limit (${MAX_INVOCATION_DEPTH}) reached — possible infinite loop`);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Invocation depth limit reached', batchId, depth }),
    };
  }

  try {
    // Mark batch as processing
    await updateBatchStatus(batchId, 'processing');

    // Fetch batch info
    const batch = await fetchBatchInfo(batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    if (!isUnder(batch.inputS3Key, TILING_BATCH_PREFIX)) {
      throw new Error(`Batch ${batchId} input key is outside tiling batches`);
    }

    console.log('Fetched batch info', {
      batchId,
      inputS3Key: batch.inputS3Key,
      locationCount: batch.locationCount,
    });

    // Download location data from S3
    const locations = await downloadLocationsFromS3(batch.inputS3Key);
    console.log('Downloaded locations from S3', {
      batchId,
      locationCount: locations.length,
    });

    // Fetch organizationId from the project (once, before the loop)
    const projectId = locations[0]?.projectId;
    if (!projectId) {
      throw new Error('No projectId found in location data');
    }
    const projectResult = await executeGraphql<{
      getProject?: { organizationId: string };
    }>(getProjectOrganizationId, { id: projectId });
    const organizationId = projectResult.getProject?.organizationId;
    if (!organizationId) {
      throw new Error(`Could not fetch organizationId for project ${projectId}`);
    }
    console.log('Fetched organizationId for group field', { projectId, organizationId });

    // Create locations in DB with concurrency of 100
    const createdLocationIds = await createLocationsInDb(locations, organizationId);
    console.log('Created locations in DB', {
      batchId,
      createdCount: createdLocationIds.length,
    });

    // Delete input S3 file
    await deleteS3File(batch.inputS3Key);
    console.log('Deleted input S3 file', { batchId, key: batch.inputS3Key });

    // Write output S3 file with created location IDs
    const outputS3Key = await writeOutputToS3(batchId, createdLocationIds);
    console.log('Wrote output to S3', { batchId, outputS3Key });

    // Update batch record as complete
    await updateBatchComplete(batchId, outputS3Key, createdLocationIds.length);
    console.log('Batch processing complete', { batchId });

    // Chain to next batch for sequential processing
    try {
      await invokeNextBatch(batch.tilingTaskId, batch.batchIndex, depth);
    } catch (chainError: any) {
      console.error('Failed to invoke next batch', {
        batchId,
        tilingTaskId: batch.tilingTaskId,
        error: chainError?.message,
      });
      // Don't fail the current batch if chaining fails - monitor will pick up
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Batch processed successfully',
        batchId,
        createdCount: createdLocationIds.length,
      }),
    };
  } catch (error: any) {
    const errorMessage = error?.message ?? (typeof error === 'string' ? error : JSON.stringify(error));
    console.error('Error processing batch', { batchId, error: errorMessage, stack: error?.stack, raw: error });

    // Update batch as failed
    await updateBatchFailed(batchId, errorMessage ?? 'Unknown error');

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to process batch',
        batchId,
        error: errorMessage ?? 'Unknown error',
      }),
    };
  }
};

function parsePayload(event: any): ProcessBatchPayload {
  // Handle both direct invocation and Lambda event formats
  if (event.batchId) {
    return { batchId: event.batchId, depth: event.depth ?? 0 };
  }
  if (event.arguments?.batchId) {
    return { batchId: event.arguments.batchId, depth: event.arguments.depth ?? 0 };
  }
  if (typeof event.body === 'string') {
    const parsed = JSON.parse(event.body);
    if (parsed.batchId) {
      return { batchId: parsed.batchId, depth: parsed.depth ?? 0 };
    }
  }
  throw new Error('batchId is required');
}

async function fetchBatchInfo(batchId: string) {
  const response = await executeGraphql<{
    getTilingBatch?: {
      id: string;
      tilingTaskId: string;
      batchIndex: number;
      status: string;
      inputS3Key: string;
      locationCount: number;
    };
  }>(getTilingBatch, { id: batchId });

  return response.getTilingBatch;
}

async function downloadLocationsFromS3(key: string): Promise<LocationInput[]> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('OUTPUTS_BUCKET_NAME environment variable not set');
  }

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  );

  const bodyStr = await response.Body?.transformToString();
  if (!bodyStr) {
    throw new Error('Empty file from S3');
  }

  return JSON.parse(bodyStr) as LocationInput[];
}

async function createLocationsInDb(locations: LocationInput[], organizationId: string): Promise<any[]> {
  const limit = pLimit(100);
  const createdLocations: any[] = [];
  let createdCount = 0;

  const tasks = locations.map((location) =>
    limit(async () => {
      const result = await executeGraphql<{
        createLocation?: { id: string };
      }>(createLocationMutation, {
        input: {
          x: location.x,
          y: location.y,
          width: location.width,
          height: location.height,
          imageId: location.imageId,
          projectId: location.projectId,
          confidence: 1,
          source: 'manual',
          setId: location.setId,
          group: organizationId,
        },
      });

      const locationId = result.createLocation?.id;
      if (!locationId) {
        throw new Error('Failed to create location');
      }

      createdCount += 1;
      if (createdCount % 1000 === 0) {
        console.log('Location creation progress', { createdCount, total: locations.length });
      }

      return {
        locationId,
        imageId: location.imageId,
        x: location.x,
        y: location.y,
        width: location.width,
        height: location.height,
      };
    })
  );

  const results = await Promise.all(tasks);
  createdLocations.push(...results);

  return createdLocations;
}

async function deleteS3File(key: string): Promise<void> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    console.warn('OUTPUTS_BUCKET_NAME not set, cannot delete file');
    return;
  }

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  );
}

async function writeOutputToS3(batchId: string, locations: any[]): Promise<string> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('OUTPUTS_BUCKET_NAME environment variable not set');
  }

  const outputKey = `tiling-outputs/${batchId}-output.json`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: outputKey,
      Body: JSON.stringify(locations),
      ContentType: 'application/json',
    })
  );

  return outputKey;
}

async function updateBatchStatus(batchId: string, status: string): Promise<void> {
  await executeGraphql<{ updateTilingBatch?: { id: string } }>(
    updateTilingBatchMutation,
    {
      input: {
        id: batchId,
        status,
      },
    }
  );
}

async function updateBatchComplete(
  batchId: string,
  outputS3Key: string,
  createdCount: number
): Promise<void> {
  await executeGraphql<{ updateTilingBatch?: { id: string } }>(
    updateTilingBatchMutation,
    {
      input: {
        id: batchId,
        status: 'completed',
        outputS3Key,
        createdCount,
      },
    }
  );
}

async function updateBatchFailed(batchId: string, errorMessage: string): Promise<void> {
  await executeGraphql<{ updateTilingBatch?: { id: string } }>(
    updateTilingBatchMutation,
    {
      input: {
        id: batchId,
        status: 'failed',
        errorMessage,
      },
    }
  );
}

async function invokeNextBatch(tilingTaskId: string, currentBatchIndex: number, depth: number): Promise<void> {
  const nextBatchIndex = currentBatchIndex + 1;

  // Query for the next batch by index
  const response = await executeGraphql<{
    tilingBatchesByTaskId?: {
      items?: Array<{
        id: string;
        batchIndex: number;
        status: string;
      }>;
    };
  }>(tilingBatchesByTaskId, {
    tilingTaskId,
    batchIndex: { eq: nextBatchIndex },
    limit: 1,
  });

  const nextBatch = response.tilingBatchesByTaskId?.items?.[0];

  if (!nextBatch) {
    console.log('No next batch found, chain complete', { tilingTaskId, currentBatchIndex });
    return;
  }

  if (nextBatch.status !== 'pending') {
    console.log('Next batch is not pending, skipping', {
      tilingTaskId,
      nextBatchIndex,
      status: nextBatch.status,
    });
    return;
  }

  console.log('Invoking next batch', {
    tilingTaskId,
    nextBatchId: nextBatch.id,
    nextBatchIndex,
  });

  // Use built-in AWS_LAMBDA_FUNCTION_NAME to invoke ourselves (avoids circular dependency)
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!functionName) {
    console.error('AWS_LAMBDA_FUNCTION_NAME not set, cannot chain to next batch');
    return;
  }

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify({ batchId: nextBatch.id, depth: depth + 1 }),
    })
  );

  console.log('Successfully invoked next batch', { nextBatchId: nextBatch.id });
}

async function executeGraphql<T>(
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const response = (await client.graphql({
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

