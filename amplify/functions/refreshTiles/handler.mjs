import {
  S3Client,
  HeadObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import {
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { env } from '$amplify/env/refreshTiles';
import { tilePackKey } from '../../../shared/tilePack';

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
const s3 = new S3Client();
const sqs = new SQSClient();

// ── GraphQL ──

const updateImageMutation = /* GraphQL */ `
  mutation UpdateImage($input: UpdateImageInput!) {
    updateImage(input: $input) {
      id
    }
  }
`;

async function stampTiledAt(imageId) {
  try {
    const result = await client.graphql({
      query: updateImageMutation,
      variables: { input: { id: imageId, tiledAt: new Date().toISOString() } },
    });
    if (result?.errors?.length) {
      throw new Error(
        `stampTiledAt GraphQL errors for imageId="${imageId}": ${JSON.stringify(result.errors)}`
      );
    }
  } catch (err) {
    if (err instanceof Error) throw err;
    const wrapped = new Error(
      `stampTiledAt failed for imageId="${imageId}": ${JSON.stringify(describeError(err))}`
    );
    wrapped.cause = err;
    throw wrapped;
  }
}

// ── Helpers ──

async function packExists(bucket, key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

function describeError(err) {
  if (!err || typeof err !== 'object') return { raw: String(err) };
  return {
    name: err.name,
    message: typeof err.message === 'string' ? err.message : JSON.stringify(err.message),
    code: err.Code ?? err.code,
    httpStatus: err.$metadata?.httpStatusCode,
    requestId: err.$metadata?.requestId,
    extendedRequestId: err.$metadata?.extendedRequestId,
  };
}

async function copyInPlaceWithRetry(bucket, key, maxRetries = 5) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: key,
          CopySource: `${bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
          MetadataDirective: 'REPLACE',
          ContentType: 'application/octet-stream',
          Metadata: { 'refreshed-at': new Date().toISOString() },
        })
      );
    } catch (err) {
      const retryable =
        err.name === 'SlowDown' ||
        err.name === 'ThrottlingException' ||
        err.$metadata?.httpStatusCode === 503 ||
        err.$metadata?.httpStatusCode === 429;
      if (!retryable || attempt >= maxRetries) {
        const wrapped = new Error(
          `copyInPlace failed for key="${key}" after ${attempt + 1} attempt(s): ${
            JSON.stringify(describeError(err))
          }`
        );
        wrapped.cause = err;
        throw wrapped;
      }
      const baseMs = Math.min(1000 * Math.pow(2, attempt), 16000);
      const jitter = Math.random() * baseMs;
      await new Promise((r) => setTimeout(r, baseMs + jitter));
    }
  }
}

// ── Handler ──

export const handler = async (event) => {
  for (const record of event.Records ?? []) {
    const body = JSON.parse(record.body);
    const { imageId, sourceKey, launchId, manifestCreatedAt } = body;

    if (!imageId || !sourceKey) {
      throw new Error(
        `refreshTiles: missing imageId/sourceKey in message body: ${record.body}`
      );
    }

    const packKey = tilePackKey(sourceKey.replace(/^images\//, ''));
    const bucket = env.OUTPUTS_BUCKET_NAME;

    let exists;
    try {
      exists = await packExists(bucket, packKey);
    } catch (err) {
      console.error(
        JSON.stringify({
          msg: 'refresh_head_failed',
          imageId,
          launchId,
          packKey,
          error: describeError(err),
        })
      );
      if (err instanceof Error) throw err;
      const wrapped = new Error(
        `packExists failed for imageId="${imageId}": ${JSON.stringify(
          describeError(err)
        )}`
      );
      wrapped.cause = err;
      throw wrapped;
    }

    if (!exists) {
      console.log(
        JSON.stringify({
          msg: 'refresh_fallback_to_pretile',
          imageId,
          packKey,
          launchId,
        })
      );
      try {
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: env.PRETILE_QUEUE_URL,
            MessageBody: JSON.stringify({
              imageId,
              sourceKey,
              launchId,
              manifestCreatedAt,
            }),
          })
        );
      } catch (err) {
        console.error(
          JSON.stringify({
            msg: 'refresh_fallback_enqueue_failed',
            imageId,
            launchId,
            error: describeError(err),
          })
        );
        if (err instanceof Error) throw err;
        const wrapped = new Error(
          `pretileQueue send failed for imageId="${imageId}": ${JSON.stringify(describeError(err))}`
        );
        wrapped.cause = err;
        throw wrapped;
      }
      continue;
    }

    const copyStart = Date.now();
    try {
      await copyInPlaceWithRetry(bucket, packKey);
    } catch (err) {
      console.error(
        JSON.stringify({
          msg: 'refresh_copy_failed',
          imageId,
          launchId,
          packKey,
          error: describeError(err),
          causeError: err?.cause ? describeError(err.cause) : undefined,
          errorMessage: err?.message,
        })
      );
      throw err;
    }
    const copyMs = Date.now() - copyStart;

    try {
      await stampTiledAt(imageId);
    } catch (err) {
      console.error(
        JSON.stringify({
          msg: 'refresh_stamp_failed',
          imageId,
          launchId,
          packKey,
          error: describeError(err),
          causeError: err?.cause ? describeError(err.cause) : undefined,
          errorMessage: err?.message,
        })
      );
      throw err;
    }

    console.log(
      JSON.stringify({
        msg: 'refresh_complete',
        imageId,
        launchId,
        packKey,
        copyMs,
      })
    );
  }
};
