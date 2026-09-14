import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PART_SIZE,
  uploadOriginal,
  type PutResult,
  type UploadDependencies,
} from './upload';

interface Call {
  field: string;
  variables: Record<string, unknown>;
}

interface PutCall {
  url: string;
  size: number;
}

function fixture(
  options: {
    putResults?: (call: PutCall, attempt: number) => PutResult | Error;
  } = {}
) {
  const calls: Call[] = [];
  const puts: PutCall[] = [];
  const attempts = new Map<string, number>();
  const deps: UploadDependencies = {
    operation: async <T>(
      _query: string,
      variables: Record<string, unknown>,
      field: string
    ): Promise<T> => {
      calls.push({ field, variables });
      const responses: Record<string, () => unknown> = {
        prepareImageUpload: () => ({
          exists: false,
          sourceKey: 'k',
          url: 'https://s3/put',
          headers: { 'If-None-Match': '*' },
        }),
        createImageMultipartUpload: () => ({
          exists: false,
          sourceKey: 'k',
          uploadId: 'u1',
          partSize: PART_SIZE,
        }),
        signImageUploadParts: () => ({
          expiresAt: Date.now() + 3600000,
          parts: (variables.partNumbers as number[]).map((partNumber) => ({
            partNumber,
            url: `https://s3/part/${partNumber}`,
          })),
        }),
        completeImageMultipartUpload: () => ({ sourceKey: 'k' }),
        abortImageMultipartUpload: () => true,
      };
      return responses[field]() as T;
    },
    put: async ({ url, body, onProgress, signal }) => {
      if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
      const call = { url, size: body.size };
      puts.push(call);
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      const result = options.putResults?.(call, attempt) ?? {
        status: 200,
        eTag: `"etag-${puts.length}"`,
      };
      if (result instanceof Error) throw result;
      onProgress(body.size);
      return result;
    },
    sleep: async () => {},
  };
  return { deps, calls, puts };
}

function fileOf(size: number): File {
  return new File([new Uint8Array(size)], 'photo.tif', { type: 'image/tiff' });
}

test('small originals use one signed PUT with the server-provided headers', async () => {
  const { deps, calls, puts } = fixture();
  const progress: number[] = [];
  await uploadOriginal(
    {
      projectId: 'p',
      originalPath: 'photo.tif',
      file: fileOf(1024),
      rotation: 90,
      onProgress: (bytes) => progress.push(bytes),
    },
    deps
  ).result;
  assert.deepEqual(
    calls.map((c) => c.field),
    ['prepareImageUpload']
  );
  assert.equal(calls[0].variables.rotation, 90);
  assert.deepEqual(puts, [{ url: 'https://s3/put', size: 1024 }]);
  assert.equal(progress.at(-1), 1024);
});

test('large originals are split into parts, uploaded concurrently, then completed in order', async () => {
  const { deps, calls, puts } = fixture();
  const size = PART_SIZE * 2 + 10;
  const progress: number[] = [];
  await uploadOriginal(
    {
      projectId: 'p',
      originalPath: 'photo.tif',
      file: fileOf(size),
      rotation: 0,
      onProgress: (bytes) => progress.push(bytes),
    },
    deps
  ).result;
  assert.deepEqual(
    calls.map((c) => c.field),
    [
      'createImageMultipartUpload',
      'signImageUploadParts',
      'completeImageMultipartUpload',
    ]
  );
  assert.deepEqual(calls[1].variables.partNumbers, [1, 2, 3]);
  assert.deepEqual(
    puts.map((p) => p.size).sort((a, b) => a - b),
    [10, PART_SIZE, PART_SIZE]
  );
  const parts = JSON.parse(calls[2].variables.parts as string) as {
    partNumber: number;
    eTag: string;
  }[];
  assert.deepEqual(
    parts.map((p) => p.partNumber).sort((a, b) => a - b),
    [1, 2, 3]
  );
  assert(parts.every((p) => p.eTag.startsWith('"etag-')));
  assert.equal(progress.at(-1), size);
  assert(progress.every((v, i) => i === 0 || v >= progress[i - 1]));
});

test('a failed part is retried with a fresh URL and never double-counts progress', async () => {
  const { deps, calls, puts } = fixture({
    putResults: (call, attempt) =>
      call.url.endsWith('/2') && attempt === 1
        ? { status: 503, eTag: null }
        : { status: 200, eTag: '"ok"' },
  });
  const size = PART_SIZE * 2;
  let last = 0;
  await uploadOriginal(
    {
      projectId: 'p',
      originalPath: 'photo.tif',
      file: fileOf(size),
      rotation: 0,
      onProgress: (bytes) => {
        assert(bytes <= size);
        last = bytes;
      },
    },
    deps
  ).result;
  assert.equal(puts.filter((p) => p.url.endsWith('/2')).length, 2);
  assert.equal(
    calls.filter((c) => c.field === 'signImageUploadParts').length,
    2,
    'retry re-signs the failed part'
  );
  assert.equal(last, size);
});

test('client errors are not retried and the multipart upload is aborted', async () => {
  const { deps, calls } = fixture({
    putResults: () => ({ status: 403, eTag: null }),
  });
  await assert.rejects(
    uploadOriginal(
      {
        projectId: 'p',
        originalPath: 'photo.tif',
        file: fileOf(PART_SIZE + 1),
        rotation: 0,
        onProgress: () => {},
      },
      deps
    ).result,
    /403/
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(calls.some((c) => c.field === 'abortImageMultipartUpload'));
  assert(!calls.some((c) => c.field === 'completeImageMultipartUpload'));
});

test('cancellation aborts in-flight parts and reports AbortError', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { deps } = fixture();
  const put = deps.put;
  deps.put = async (request) => {
    await gate;
    return put(request);
  };
  const task = uploadOriginal(
    {
      projectId: 'p',
      originalPath: 'photo.tif',
      file: fileOf(PART_SIZE + 1),
      rotation: 0,
      onProgress: () => {},
    },
    deps
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  task.cancel();
  release();
  await assert.rejects(
    task.result,
    (error: unknown) =>
      error instanceof DOMException && error.name === 'AbortError'
  );
});

test('an original that already exists is reported complete without a transfer', async () => {
  const { deps, puts } = fixture();
  deps.operation = async <T>() => ({ exists: true, sourceKey: 'k' } as T);
  let reported = 0;
  await uploadOriginal(
    {
      projectId: 'p',
      originalPath: 'photo.tif',
      file: fileOf(PART_SIZE * 3),
      rotation: 0,
      onProgress: (bytes) => {
        reported = bytes;
      },
    },
    deps
  ).result;
  assert.equal(puts.length, 0);
  assert.equal(reported, PART_SIZE * 3);
});
