import fs from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import pLimit from 'p-limit';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { env } from '$amplify/env/pretileImage';
import { decodeForTiling } from '../shared/tilingDecode.mjs';

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

// Best-effort snapshot of the ephemeral /tmp volume. Used only on the failure
// path to help confirm whether the intermittent `ENOENT mkdir /tmp/tiles-*`
// stems from the volume being absent, full, or out of inodes. Every probe is
// guarded so this never throws and never masks the original error.
async function tmpDiagnostics(tmpDir = '/tmp') {
  const diag = {};
  try {
    const st = await fs.stat(tmpDir);
    diag.exists = true;
    diag.isDirectory = st.isDirectory();
  } catch (err) {
    diag.exists = false;
    diag.statError = describeError(err);
  }
  try {
    // Node 18.15+ — free space and inode usage on the ephemeral volume.
    const vfs = await fs.statfs(tmpDir);
    const bsize = Number(vfs.bsize) || 0;
    diag.totalMB = +((Number(vfs.blocks) * bsize) / (1024 * 1024)).toFixed(1);
    diag.freeMB = +((Number(vfs.bavail) * bsize) / (1024 * 1024)).toFixed(1);
    diag.inodesTotal = Number(vfs.files);
    diag.inodesFree = Number(vfs.ffree);
  } catch (err) {
    diag.statfsError = describeError(err);
  }
  try {
    const entries = await fs.readdir(tmpDir);
    diag.entryCount = entries.length;
    diag.sampleEntries = entries.slice(0, 20);
  } catch (err) {
    diag.readdirError = describeError(err);
  }
  return diag;
}

// Create a unique scratch directory for one image's tiles.
//
// mkdtemp is atomic and returns a guaranteed-unique path (`/tmp/tiles-<id>-XXXXXX`),
// so it can't collide with a directory leaked by a prior warm invocation — which
// also lets us drop the old rm-then-mkdir dance entirely.
//
// The intermittent failure we're guarding against is `ENOENT` from directory
// creation, where the ephemeral /tmp volume is unavailable. Two shapes are
// possible and we handle both:
//
//   1. Transient in time — the volume settles within this same execution
//      environment (the identical SQS message succeeded on a later attempt with
//      no other change). A few short in-process retries ride this out cheaply
//      with no cold start, instead of burning a whole ~12-minute SQS visibility
//      cycle and edging messages toward the DLQ during high-concurrency surveys.
//
//   2. Environment poisoned — the volume on THIS environment never recovers.
//      Reporting a normal error would hand the redelivered message back to the
//      same warm (poisoned) container, and leave it pulling and failing OTHER
//      images' messages too. So once the retries are exhausted we kill the
//      runtime process (process.exit): Lambda discards this environment and
//      provisions a fresh one for the next invocation. The in-flight message is
//      still reported failed, so SQS redelivers it (up to maxReceiveCount → DLQ)
//      exactly as before — we've just removed a poisoned host from the fleet.
async function makeScratchDir(imageId, launchId, context, maxAttempts = 3) {
  const prefix = `/tmp/tiles-${imageId}-`;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fs.mkdtemp(prefix);
    } catch (err) {
      lastErr = err;
      const diag = await tmpDiagnostics('/tmp').catch((e) => ({ diagError: String(e) }));
      console.warn(
        JSON.stringify({
          msg: 'pretile_mkdir_retry',
          imageId,
          launchId,
          attempt,
          prefix,
          logStreamName: context?.logStreamName,
          awsRequestId: context?.awsRequestId,
          error: describeError(err),
          tmpDiagnostics: diag,
        })
      );
      if (attempt < maxAttempts - 1) {
        const backoffMs = 50 * Math.pow(2, attempt) + Math.random() * 50;
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  // Retries exhausted — treat this environment as poisoned and recycle it.
  const diag = await tmpDiagnostics('/tmp').catch((e) => ({ diagError: String(e) }));
  console.error(
    JSON.stringify({
      msg: 'pretile_mkdir_failed',
      action: 'recycle_environment',
      imageId,
      launchId,
      prefix,
      attempts: maxAttempts,
      logGroupName: context?.logGroupName,
      logStreamName: context?.logStreamName,
      awsRequestId: context?.awsRequestId,
      error: describeError(lastErr),
      tmpDiagnostics: diag,
    })
  );
  // Let stdout flush to CloudWatch before the abrupt exit — process.exit can
  // otherwise truncate the diagnostic line above, which is the whole reason we
  // bailed. 150ms is ample for the runtime's log pipe.
  await new Promise((r) => setTimeout(r, 150));
  process.exit(1);
  // Unreachable under Lambda (the process is gone). Kept as a safety net so that
  // if process.exit is ever stubbed/no-op, we still fail the invocation — SQS
  // will redeliver — rather than returning undefined and tiling to a bad path.
  throw lastErr instanceof Error
    ? lastErr
    : new Error(
        `mkdtemp failed for prefix="${prefix}" after ${maxAttempts} attempt(s): ${JSON.stringify(
          describeError(lastErr)
        )}`
      );
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

async function uploadDir(localDir, s3Prefix, bucket) {
  const entries = await fs.readdir(localDir);
  const limit = pLimit(4);
  await Promise.all(
    entries.map((entry) =>
      limit(async () => {
        const localPath = path.join(localDir, entry);
        const s3Path = `${s3Prefix}/${entry}`;
        const stats = await fs.stat(localPath);
        if (stats.isFile()) {
          return s3PutWithRetry({
            Bucket: bucket,
            Key: s3Path,
            Body: await fs.readFile(localPath),
            ContentType: entry.endsWith('.png') ? 'image/png' : undefined,
          });
        } else if (stats.isDirectory()) {
          return uploadDir(localPath, s3Path, bucket);
        }
      })
    )
  );
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

export const handler = async (event, context) => {
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

    const localTmpPath = await makeScratchDir(imageId, launchId, context);
    try {
      console.log(JSON.stringify({ msg: 'pretile_sharp_start', imageId }));
      const sharpStart = Date.now();
      await decodeForTiling(buffer)
        .png()
        .tile({ layout: 'google' })
        .toFile(localTmpPath);
      const sharpMs = Date.now() - sharpStart;

      // Match the key shape used by the on-demand generator:
      // slippymaps/<sourceKey-without-'images/'-prefix>/z/r/c.png
      const outputPrefix = sourceKey.replace(/^images\//, 'slippymaps/');
      console.log(
        JSON.stringify({ msg: 'pretile_upload_start', imageId, outputPrefix })
      );
      const uploadStart = Date.now();
      await uploadDir(localTmpPath, outputPrefix, env.OUTPUTS_BUCKET_NAME);
      const uploadMs = Date.now() - uploadStart;

      await stampTiledAt(imageId);

      console.log(
        JSON.stringify({
          msg: 'pretile_complete',
          imageId,
          launchId,
          sourceMB,
          fetchMs,
          sharpMs,
          uploadMs,
        })
      );
    } finally {
      // Always remove the scratch dir — on success and on failure alike — so a
      // warm container doesn't accumulate leaked tile dirs that could later
      // starve /tmp of space or inodes. (The old code only cleaned up on the
      // success path, leaking on every sharp/upload failure.)
      try {
        await fs.rm(localTmpPath, { recursive: true, force: true });
      } catch (err) {
        console.warn(
          JSON.stringify({
            msg: 'pretile_post_cleanup_failed',
            imageId,
            launchId,
            localTmpPath,
            error: describeError(err),
          })
        );
      }
    }
  }
};
