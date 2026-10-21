import { Buffer } from 'node:buffer';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { env } from '$amplify/env/pretileImage';
import { buildTilePack } from '../shared/tilePackBuilder.mjs';
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

// ── GraphQL ──

const getImageTiledAtQuery = /* GraphQL */ `
  query GetImage($id: ID!) {
    getImage(id: $id) {
      id
      tiledAt
    }
  }
`;

const updateImageMutation = /* GraphQL */ `
  mutation UpdateImage($input: UpdateImageInput!) {
    updateImage(input: $input) {
      id
    }
  }
`;

// ── Helpers ──

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function describeError(err) {
  if (!err || typeof err !== 'object') return { raw: String(err) };
  return {
    name: err.name,
    message: typeof err.message === 'string' ? err.message : JSON.stringify(err.message),
    code: err.Code ?? err.code,
    errno: err.errno,
    syscall: err.syscall,
    path: err.path,
    httpStatus: err.$metadata?.httpStatusCode,
    requestId: err.$metadata?.requestId,
    extendedRequestId: err.$metadata?.extendedRequestId,
  };
}

async function s3PutWithRetry(params, maxRetries = 5) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await s3.send(new PutObjectCommand(params));
    } catch (err) {
      const retryable =
        err.name === 'SlowDown' ||
        err.name === 'ThrottlingException' ||
        err.$metadata?.httpStatusCode === 503 ||
        err.$metadata?.httpStatusCode === 429;
      if (!retryable || attempt >= maxRetries) {
        const wrapped = new Error(
          `s3PutWithRetry failed for key="${params.Key}" after ${attempt + 1} attempt(s): ${
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

async function readTiledAt(imageId) {
  const resp = await client.graphql({ query: getImageTiledAtQuery, variables: { id: imageId } });
  return resp.data?.getImage?.tiledAt ?? null;
}

async function stampTiledAt(imageId) {
  await client.graphql({
    query: updateImageMutation,
    variables: { input: { id: imageId, tiledAt: new Date().toISOString() } },
  });
}

// ── Handler ──

export const handler = async (event) => {
  for (const record of event.Records ?? []) {
    const body = JSON.parse(record.body);
    const { imageId, sourceKey, launchId, manifestCreatedAt } = body;

    if (!imageId || !sourceKey) {
      throw new Error(
        `pretileImage: missing imageId/sourceKey in message body: ${record.body}`
      );
    }

    // Race guard — only skip if another launch tiled this image AFTER our
    // manifest was created. A tiledAt that predates the manifest means the
    // stamp is stale (this is exactly why this image was routed here), so we
    // must re-tile and re-stamp it; otherwise the reconciler will wait forever.
    const existingTiledAt = await readTiledAt(imageId);
    const manifestCreatedAtMs = manifestCreatedAt ? Date.parse(manifestCreatedAt) : NaN;
    const existingTiledAtMs = existingTiledAt ? Date.parse(existingTiledAt) : NaN;
    const tiledByLaterLaunch =
      Number.isFinite(existingTiledAtMs) &&
      Number.isFinite(manifestCreatedAtMs) &&
      existingTiledAtMs >= manifestCreatedAtMs;
    if (tiledByLaterLaunch) {
      console.log(
        JSON.stringify({
          msg: 'pretile_skip_already_tiled',
          imageId,
          launchId,
          existingTiledAt,
          manifestCreatedAt,
        })
      );
      continue;
    }

    console.log(
      JSON.stringify({ msg: 'pretile_fetch_source', imageId, sourceKey, launchId })
    );
    const fetchStart = Date.now();
    const getResp = await s3.send(
      new GetObjectCommand({ Bucket: env.INPUTS_BUCKET_NAME, Key: sourceKey })
    );
    const buffer = await streamToBuffer(getResp.Body);
    const fetchMs = Date.now() - fetchStart;
    const sourceMB = +(buffer.length / (1024 * 1024)).toFixed(2);

    const buildStart = Date.now();
    const { pack, tileCount } = await buildTilePack(buffer);
    const buildMs = Date.now() - buildStart;

    const packKey = tilePackKey(sourceKey.replace(/^images\//, ''));
    const uploadStart = Date.now();
    await s3PutWithRetry({
      Bucket: env.OUTPUTS_BUCKET_NAME,
      Key: packKey,
      Body: pack,
      ContentType: 'application/octet-stream',
    });
    const uploadMs = Date.now() - uploadStart;

    await stampTiledAt(imageId);

    console.log(
      JSON.stringify({
        msg: 'pretile_complete',
        imageId,
        launchId,
        sourceMB,
        fetchMs,
        buildMs,
        uploadMs,
        packKey,
        packBytes: pack.length,
        tileCount,
      })
    );
  }
};
