import { storageOperation, UPLOADED_IMAGE_PATHS } from '../../storage/api';
import { runPool } from './pool';
import type { ProjectKeyInfo } from './projectKeys';

const PATHS_PER_REQUEST = 50;
const CONCURRENT_REQUESTS = 4;

// Checks only the selected paths; the browser never lists the bucket.
export async function listUploadedOriginalPaths(args: {
  projectId: string;
  keyInfo: ProjectKeyInfo;
  localPaths: Set<string>;
  signal?: AbortSignal;
}): Promise<Set<string>> {
  const found = new Set<string>();
  const paths = [...args.localPaths];
  const batches: string[][] = [];
  for (let offset = 0; offset < paths.length; offset += PATHS_PER_REQUEST) {
    batches.push(paths.slice(offset, offset + PATHS_PER_REQUEST));
  }
  await runPool(
    batches,
    CONCURRENT_REQUESTS,
    async (batch) => {
      const uploaded = await storageOperation<string[]>(
        UPLOADED_IMAGE_PATHS,
        { projectId: args.projectId, paths: batch },
        'uploadedImagePaths'
      );
      uploaded.forEach((path) => found.add(path));
    },
    args.signal
  );
  if (args.signal?.aborted) {
    throw new DOMException('Upload check cancelled', 'AbortError');
  }
  return found;
}
