import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { S3Client } from '@aws-sdk/client-s3';
import { clearAccessCache, db, resolveImageAccess } from './repository';
import {
  createImageAccessHandler,
  MAX_SIGNED_PARTS,
  type AppSyncEvent,
} from './handler';

type Row = Record<string, unknown>;

interface DynamoInput {
  TableName: string;
  Key?: Record<string, string>;
  Item?: Row;
  IndexName?: string;
  ConsistentRead?: boolean;
  KeyConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
}

interface S3Call {
  command: string;
  input: Row;
}

const user = { sub: 'user-a', groups: ['org-a'] };
const project: Row = {
  id: 'p',
  organizationId: 'org-a',
  group: 'org-a',
  tags: ['legacy'],
};
const image: Row = {
  id: 'i',
  projectId: 'p',
  group: 'org-a',
  originalPath: 'old/photo.jpg',
  width: 1024,
  height: 768,
};
const file: Row = {
  id: 'f',
  imageId: 'i',
  projectId: 'p',
  group: 'org-a',
  key: 'old/photo.jpg',
  path: 'old/photo.jpg',
};

function fixture(t: TestContext) {
  for (const model of [
    'Image',
    'ImageFile',
    'Project',
    'SharedChainImage',
    'ChainShare',
  ]) {
    process.env[`STORAGE_${model.toUpperCase()}_TABLE`] = model;
  }
  process.env.INPUTS_BUCKET_NAME = 'test-inputs';
  process.env.OUTPUTS_BUCKET_NAME = 'test-outputs';
  clearAccessCache();

  const records: Record<string, Row[]> = {
    Project: [{ ...project }],
    Image: [{ ...image }],
    ImageFile: [{ ...file }],
    SharedChainImage: [],
    ChainShare: [],
  };
  const calls: DynamoInput[] = [];
  t.mock.method(db, 'send', async (command: { input: DynamoInput }) => {
    const input = command.input;
    calls.push(input);
    if (input.Item) {
      records[input.TableName].push(input.Item);
      return {};
    }
    if (input.Key) {
      const key = input.Key;
      return {
        Item: records[input.TableName].find((row) =>
          Object.entries(key).every(([k, v]) => row[k] === v)
        ),
      };
    }
    const field = input.ExpressionAttributeNames!['#key'];
    return {
      Items: records[input.TableName].filter(
        (row) => row[field] === input.ExpressionAttributeValues![':value']
      ),
    };
  });

  // Synthetic signing material: no AWS calls or local credential lookup.
  const s3 = new S3Client({
    region: 'eu-west-1',
    credentials: {
      accessKeyId: 'TESTONLYACCESSKEY',
      secretAccessKey: 'test-only-not-a-real-secret',
      expiration: new Date(Date.now() + 7200000),
    },
  });
  let object: Row | null = { ContentType: 'image/jpeg' };
  const s3Calls: S3Call[] = [];
  t.mock.method(
    s3,
    'send',
    async (command: { constructor: { name: string }; input: Row }) => {
      const name = command.constructor.name;
      s3Calls.push({ command: name, input: command.input });
      if (name === 'HeadObjectCommand') {
        if (object) return object;
        throw { $metadata: { httpStatusCode: 404 } };
      }
      if (name === 'CreateMultipartUploadCommand')
        return { UploadId: 'upload-1' };
      return {};
    }
  );
  return {
    records,
    calls,
    s3Calls,
    handler: createImageAccessHandler(s3),
    setObject: (value: Row | null) => {
      object = value;
    },
  };
}

function event(
  fieldName: string,
  args: Record<string, unknown>,
  identity: unknown = user
): AppSyncEvent {
  return { identity, fieldName, arguments: args };
}

test('signs exact legacy tiles using bounded indexed file reads', async (t) => {
  const { handler, calls } = fixture(t);
  const result = (await handler(
    event('signImageTiles', {
      imageId: 'i',
      sourceKey: file.key,
      tiles: [{ z: 2, row: 1, col: 1 }],
    })
  )) as { expiresAt: number; tiles: { url: string }[] };
  assert.equal(result.tiles.length, 1);
  assert(
    new URL(result.tiles[0].url).pathname.endsWith(
      '/slippymaps/old/photo.jpg/2/1/1.png'
    )
  );
  assert(result.expiresAt <= Date.now() + 3600000);
  assert(calls.some((c) => c.IndexName === 'imageFilesByImageId'));
  assert(calls.every((c) => c.Key || c.KeyConditionExpression));
  assert(
    calls.filter((c) => c.Key).every((c) => c.ConsistentRead === false),
    'authorization reads are eventually consistent'
  );
  await assert.rejects(
    handler(
      event('signImageTiles', {
        imageId: 'i',
        sourceKey: file.key,
        tiles: [{ z: 3, row: 0, col: 0 }],
      })
    ),
    /Invalid tile/
  );
  await assert.rejects(
    handler(
      event('signImageTiles', {
        imageId: 'i',
        sourceKey: 'other/photo.jpg',
        tiles: [{ z: 0, row: 0, col: 0 }],
      })
    ),
    /Unauthorized/
  );
  await assert.rejects(
    handler(
      event(
        'signImageTiles',
        {
          imageId: 'i',
          sourceKey: file.key,
          tiles: [{ z: 0, row: 0, col: 0 }],
        },
        { sub: 'other', groups: ['org-b'] }
      )
    ),
    /Unauthorized/
  );
});

test('access decisions are cached briefly per identity and never across users', async (t) => {
  const { calls } = fixture(t);
  const args = { imageId: 'i', sourceKey: file.key as string };
  let now = 1_000_000;
  const clock = () => now;
  await resolveImageAccess(user, args, true, clock);
  const reads = calls.length;
  await resolveImageAccess(user, args, true, clock);
  assert.equal(calls.length, reads, 'second call served from cache');
  await assert.rejects(
    resolveImageAccess({ sub: 'other', groups: ['org-b'] }, args, true, clock),
    /Unauthorized/
  );
  now += 31_000;
  await resolveImageAccess(user, args, true, clock);
  assert(calls.length > reads, 'expired entries are re-read');
});

test('shared reviewers get only the snapshot image while active; no original download grant', async (t) => {
  const { records, handler } = fixture(t);
  records.SharedChainImage.push({
    id: 'snapshot',
    sourceImageId: 'i',
    sourceKey: file.key,
    shareId: 's',
    group: 'chainshare-s',
    width: 1024,
    height: 768,
  });
  records.ChainShare.push({ shareId: 's', status: 'active' });
  const reviewer = { sub: 'reviewer', groups: ['chainshare-s'] };
  const args = {
    imageId: 'i',
    sourceKey: file.key as string,
    sharedImageId: 'snapshot',
  };
  assert.equal((await resolveImageAccess(reviewer, args)).shared, true);
  await assert.rejects(
    handler(event('imageDownloadUrl', args, reviewer)),
    /Unauthorized/
  );
  await assert.rejects(
    resolveImageAccess(reviewer, { ...args, sourceKey: 'other.jpg' }),
    /Unauthorized/
  );
  records.ChainShare[0].status = 'revoked';
  clearAccessCache();
  await assert.rejects(resolveImageAccess(reviewer, args), /Unauthorized/);
});

test('upload grant binds ownership metadata and conditional creation; registration is server-owned', async (t) => {
  const { handler, setObject, records } = fixture(t);
  setObject(null);
  const args = {
    projectId: 'p',
    originalPath: image.originalPath,
    contentType: 'image/jpeg',
    rotation: 90,
  };
  const grant = (await handler(event('prepareImageUpload', args))) as {
    exists: boolean;
    url: string;
    headers: Record<string, string>;
  };
  assert.equal(grant.exists, false);
  assert.equal(grant.headers['If-None-Match'], '*');
  assert.equal(grant.headers['x-amz-meta-project-id'], 'p');
  const signed = new URL(grant.url).searchParams.get('X-Amz-SignedHeaders')!;
  for (const header of [
    'if-none-match',
    'x-amz-meta-project-id',
    'x-amz-meta-organization-id',
    'content-type',
  ]) {
    assert(signed.includes(header));
  }
  await assert.rejects(
    handler(event('prepareImageUpload', { ...args, rotation: 45 })),
    /rotation/
  );
  await assert.rejects(
    handler(event('registerImageFile', { ...args, imageId: 'i' })),
    /uploaded/
  );
  setObject({
    ContentType: 'image/jpeg',
    Metadata: { 'project-id': 'p', 'organization-id': 'org-a' },
  });
  const created = await handler(
    event('registerImageFile', { ...args, imageId: 'i' })
  );
  assert.deepEqual(
    await handler(event('registerImageFile', { ...args, imageId: 'i' })),
    created
  );
  assert.equal(
    records.ImageFile.filter((f) => f.id === 'i:original').length,
    1
  );
});

test('multipart uploads fix ownership at creation and complete without overwriting', async (t) => {
  const { handler, setObject, s3Calls } = fixture(t);
  setObject(null);
  const base = { projectId: 'p', originalPath: 'old/big.tif' };
  const created = (await handler(
    event('createImageMultipartUpload', {
      ...base,
      contentType: 'image/tiff',
      rotation: 0,
    })
  )) as {
    exists: boolean;
    uploadId: string;
    sourceKey: string;
    partSize: number;
  };
  assert.equal(created.exists, false);
  assert.equal(created.uploadId, 'upload-1');
  assert.equal(created.sourceKey, 'old/big.tif');
  const create = s3Calls.find(
    (c) => c.command === 'CreateMultipartUploadCommand'
  )!;
  assert.deepEqual(create.input.Metadata, {
    'organization-id': 'org-a',
    'project-id': 'p',
  });
  assert.equal(create.input.Key, 'images/old/big.tif');

  const signed = (await handler(
    event('signImageUploadParts', {
      ...base,
      uploadId: 'upload-1',
      partNumbers: [1, 2, 2],
    })
  )) as { parts: { partNumber: number; url: string }[] };
  assert.deepEqual(
    signed.parts.map((p) => p.partNumber),
    [1, 2]
  );
  const url = new URL(signed.parts[1].url);
  assert.equal(url.searchParams.get('partNumber'), '2');
  assert.equal(url.searchParams.get('uploadId'), 'upload-1');
  assert(url.pathname.endsWith('/images/old/big.tif'));
  await assert.rejects(
    handler(
      event('signImageUploadParts', {
        ...base,
        uploadId: 'upload-1',
        partNumbers: Array.from(
          { length: MAX_SIGNED_PARTS + 1 },
          (_, i) => i + 1
        ),
      })
    ),
    /part numbers/
  );
  await assert.rejects(
    handler(
      event('signImageUploadParts', {
        ...base,
        uploadId: 'upload-1',
        partNumbers: [0],
      })
    ),
    /part numbers/
  );

  await assert.rejects(
    handler(
      event('completeImageMultipartUpload', {
        ...base,
        uploadId: 'upload-1',
        parts: [{ partNumber: 1, eTag: 'not-an-etag' }],
      })
    ),
    /completion/
  );
  await handler(
    event('completeImageMultipartUpload', {
      ...base,
      uploadId: 'upload-1',
      parts: JSON.stringify([
        { partNumber: 2, eTag: '"d41d8cd98f00b204e9800998ecf8427e"' },
        { partNumber: 1, eTag: '"d41d8cd98f00b204e9800998ecf8427e"' },
      ]),
    })
  );
  const complete = s3Calls.find(
    (c) => c.command === 'CompleteMultipartUploadCommand'
  )!;
  assert.equal(complete.input.IfNoneMatch, '*');
  assert.deepEqual(
    (
      complete.input.MultipartUpload as { Parts: { PartNumber: number }[] }
    ).Parts.map((p) => p.PartNumber),
    [1, 2]
  );
  await handler(
    event('abortImageMultipartUpload', { ...base, uploadId: 'upload-1' })
  );
  assert(s3Calls.some((c) => c.command === 'AbortMultipartUploadCommand'));

  // Another organization cannot start, sign or complete uploads into this project.
  for (const fieldName of [
    'createImageMultipartUpload',
    'signImageUploadParts',
    'completeImageMultipartUpload',
    'abortImageMultipartUpload',
  ]) {
    await assert.rejects(
      handler(
        event(
          fieldName,
          {
            ...base,
            contentType: 'image/tiff',
            uploadId: 'upload-1',
            partNumbers: [1],
            parts: [],
          },
          { sub: 'other', groups: ['org-b'] }
        )
      ),
      /Unauthorized/
    );
  }
  // An existing original is reported rather than re-uploaded.
  setObject({
    ContentType: 'image/tiff',
    Metadata: { 'project-id': 'p', 'organization-id': 'org-a' },
  });
  const existing = (await handler(
    event('createImageMultipartUpload', { ...base, contentType: 'image/tiff' })
  )) as { exists: boolean };
  assert.equal(existing.exists, true);
});

test('legacy upload and resume checks reject unowned existing objects without leaking paths', async (t) => {
  const { handler, records } = fixture(t);
  records.ImageFile = [];
  const args = {
    projectId: 'p',
    originalPath: 'old/photo.jpg',
    contentType: 'image/jpeg',
  };
  await assert.rejects(
    handler(event('prepareImageUpload', args)),
    /Unauthorized/
  );
  assert.deepEqual(
    await handler(
      event('uploadedImagePaths', { projectId: 'p', paths: ['old/photo.jpg'] })
    ),
    []
  );
  await assert.rejects(
    handler(event('prepareImageUpload', args, null)),
    /Unauthorized/
  );
  await assert.rejects(
    handler(
      event('uploadedImagePaths', {
        projectId: 'p',
        paths: Array(51).fill('a'),
      })
    ),
    /At most 50/
  );
  await assert.rejects(handler(event('nope', {})), /Unsupported/);
});
