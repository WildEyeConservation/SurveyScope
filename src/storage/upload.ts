import {
  ABORT_IMAGE_MULTIPART_UPLOAD,
  COMPLETE_IMAGE_MULTIPART_UPLOAD,
  CREATE_IMAGE_MULTIPART_UPLOAD,
  PREPARE_IMAGE_UPLOAD,
  SIGN_IMAGE_UPLOAD_PARTS,
  type StorageOperation,
} from './operations';

// Originals up to one part use a single presigned PUT; larger files use S3
// multipart with the same part size, concurrency and retry that
// aws-amplify/storage's uploadData applied.

export const PART_SIZE = 5 * 1024 * 1024;
export const MAX_FILE_SIZE = 5 * 1024 ** 4; // 5 TiB, the S3 object limit
const MAX_PARTS = 10_000;
const PART_CONCURRENCY = 4;
const PART_URL_BATCH = 32;
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;

export interface PutResult {
  status: number;
  eTag: string | null;
}

/** XHR because fetch cannot report upload progress. */
export type PutRequest = (args: {
  url: string;
  headers: Record<string, string>;
  body: Blob;
  onProgress: (loaded: number) => void;
  signal: AbortSignal;
}) => Promise<PutResult>;

export interface UploadDependencies {
  operation: StorageOperation;
  put: PutRequest;
  sleep: (ms: number) => Promise<void>;
}

interface SingleGrant {
  exists: boolean;
  sourceKey: string;
  url?: string;
  headers?: Record<string, string>;
}

interface MultipartGrant {
  exists: boolean;
  sourceKey: string;
  uploadId?: string;
  partSize?: number;
}

interface SignedParts {
  expiresAt: number;
  parts: { partNumber: number; url: string }[];
}

interface UploadArgs {
  projectId: string;
  originalPath: string;
  file: File;
  rotation: number;
  onProgress: (bytes: number) => void;
}

export function xhrPut({
  url,
  headers,
  body,
  onProgress,
  signal,
}: Parameters<PutRequest>[0]) {
  return new Promise<PutResult>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    for (const [key, value] of Object.entries(headers)) {
      request.setRequestHeader(key, value);
    }
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () =>
      resolve({
        status: request.status,
        eTag: request.getResponseHeader('ETag'),
      });
    request.onerror = () => reject(new Error('Image upload network error'));
    request.onabort = () => reject(abortError());
    signal.addEventListener('abort', () => request.abort(), { once: true });
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    request.send(body);
  });
}

function abortError() {
  return new DOMException('Upload cancelled', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function retryable(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (error instanceof HttpError) {
    return error.status === 0 || error.status === 429 || error.status >= 500;
  }
  return true;
}

class HttpError extends Error {
  constructor(public status: number) {
    super(`Image upload failed: ${status}`);
    this.name = 'HttpError';
  }
}

async function withRetry<T>(
  deps: UploadDependencies,
  signal: AbortSignal,
  attempt: () => Promise<T>
): Promise<T> {
  for (let n = 1; ; n++) {
    if (signal.aborted) throw abortError();
    try {
      return await attempt();
    } catch (error) {
      if (n >= MAX_ATTEMPTS || !retryable(error)) throw error;
      await deps.sleep(BASE_DELAY_MS * 2 ** (n - 1) * (0.5 + Math.random()));
    }
  }
}

async function putWithRetry(
  deps: UploadDependencies,
  signal: AbortSignal,
  request: Omit<Parameters<PutRequest>[0], 'signal'>
): Promise<PutResult> {
  return withRetry(deps, signal, async () => {
    request.onProgress(0);
    const result = await deps.put({ ...request, signal });
    if (result.status < 200 || result.status >= 300) {
      throw new HttpError(result.status);
    }
    return result;
  });
}

async function uploadSingle(
  args: UploadArgs,
  deps: UploadDependencies,
  signal: AbortSignal,
  contentType: string
): Promise<void> {
  const grant = await deps.operation<SingleGrant>(
    PREPARE_IMAGE_UPLOAD,
    {
      projectId: args.projectId,
      originalPath: args.originalPath,
      contentType,
      rotation: args.rotation,
    },
    'prepareImageUpload'
  );
  if (signal.aborted) throw abortError();
  if (grant.exists) {
    args.onProgress(args.file.size);
    return;
  }
  if (!grant.url || !grant.headers) {
    throw new Error('Missing upload authorization');
  }
  await putWithRetry(deps, signal, {
    url: grant.url,
    headers: grant.headers,
    body: args.file,
    onProgress: args.onProgress,
  });
}

async function uploadMultipart(
  args: UploadArgs,
  deps: UploadDependencies,
  signal: AbortSignal,
  contentType: string
): Promise<void> {
  const base = {
    projectId: args.projectId,
    originalPath: args.originalPath,
  };
  const grant = await deps.operation<MultipartGrant>(
    CREATE_IMAGE_MULTIPART_UPLOAD,
    { ...base, contentType, rotation: args.rotation },
    'createImageMultipartUpload'
  );
  if (signal.aborted) throw abortError();
  if (grant.exists) {
    args.onProgress(args.file.size);
    return;
  }
  const uploadId = grant.uploadId;
  if (!uploadId) throw new Error('Missing multipart upload authorization');
  // S3 allows at most 10,000 parts.
  const partSize = Math.max(
    grant.partSize ?? PART_SIZE,
    Math.ceil(args.file.size / MAX_PARTS)
  );
  const partCount = Math.ceil(args.file.size / partSize);

  const partProgress = new Map<number, number>();
  let completedBytes = 0;
  const report = () => {
    let total = completedBytes;
    for (const bytes of partProgress.values()) total += bytes;
    args.onProgress(total);
  };

  const signed = new Map<number, string>();
  const signParts = (partNumbers: number[]) =>
    withRetry(deps, signal, async () => {
      const batch = await deps.operation<SignedParts>(
        SIGN_IMAGE_UPLOAD_PARTS,
        { ...base, uploadId, partNumbers },
        'signImageUploadParts'
      );
      batch.parts.forEach((p) => signed.set(p.partNumber, p.url));
    });
  // Serialised so concurrent workers share one signing window.
  let signing: Promise<void> = Promise.resolve();
  const partUrl = (partNumber: number, fresh = false) => {
    const run = signing.then(async () => {
      if (!fresh && signed.has(partNumber)) return;
      const window: number[] = [];
      for (
        let n = partNumber;
        n <= partCount && window.length < PART_URL_BATCH;
        n++
      ) {
        if (fresh ? n === partNumber : !signed.has(n)) window.push(n);
      }
      if (window.length) await signParts(window);
    });
    signing = run.catch(() => {});
    return run.then(() => {
      const url = signed.get(partNumber);
      if (!url) throw new Error(`No upload URL for part ${partNumber}`);
      return url;
    });
  };

  const eTags = new Map<number, string>();
  const uploadPart = async (partNumber: number) => {
    const start = (partNumber - 1) * partSize;
    const body = args.file.slice(
      start,
      Math.min(start + partSize, args.file.size)
    );
    let attempt = 0;
    const result = await withRetry(deps, signal, async () => {
      // Re-sign on retry in case the URL expired.
      const url = await partUrl(partNumber, attempt++ > 0);
      const response = await deps.put({
        url,
        headers: {},
        body,
        onProgress: (loaded) => {
          partProgress.set(partNumber, loaded);
          report();
        },
        signal,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new HttpError(response.status);
      }
      if (!response.eTag) {
        throw new Error(
          'S3 did not return a part ETag; check bucket CORS ExposeHeaders'
        );
      }
      return response;
    });
    partProgress.delete(partNumber);
    completedBytes += body.size;
    eTags.set(partNumber, result.eTag!);
    report();
  };

  try {
    let next = 1;
    const worker = async () => {
      while (next <= partCount && !signal.aborted) {
        const partNumber = next++;
        await uploadPart(partNumber);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PART_CONCURRENCY, partCount) }, worker)
    );
    if (signal.aborted) throw abortError();
    await withRetry(deps, signal, () =>
      deps.operation<{ sourceKey: string }>(
        COMPLETE_IMAGE_MULTIPART_UPLOAD,
        {
          ...base,
          uploadId,
          parts: JSON.stringify(
            [...eTags].map(([partNumber, eTag]) => ({ partNumber, eTag }))
          ),
        },
        'completeImageMultipartUpload'
      )
    );
  } catch (error) {
    // Best effort; the bucket lifecycle rule reclaims leftovers.
    void deps
      .operation(
        ABORT_IMAGE_MULTIPART_UPLOAD,
        { ...base, uploadId },
        'abortImageMultipartUpload'
      )
      .catch(() => {});
    throw error;
  }
}

export const defaultUploadDependencies: UploadDependencies = {
  // Loaded on demand so importing this module does not configure Amplify.
  operation: async (query, variables, field) =>
    (await import('./api')).storageOperation(query, variables, field),
  put: xhrPut,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function uploadOriginal(
  args: UploadArgs,
  deps: UploadDependencies = defaultUploadDependencies
) {
  const controller = new AbortController();
  const result = (async () => {
    if (args.file.size > MAX_FILE_SIZE) {
      throw new Error('Original image exceeds the maximum object size');
    }
    const contentType = args.file.type || 'application/octet-stream';
    if (args.file.size <= PART_SIZE) {
      await uploadSingle(args, deps, controller.signal, contentType);
    } else {
      await uploadMultipart(args, deps, controller.signal, contentType);
    }
  })();
  return {
    result,
    cancel: () => controller.abort(),
  };
}
