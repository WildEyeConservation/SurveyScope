export const QUEUE_MANIFEST_PREFIX = 'queue-manifests/';
export const TILING_OUTPUT_PREFIX = 'tiling-outputs/';
export const TILING_BATCH_PREFIX = 'tiling-batches/';
export const PRETILE_MANIFEST_PREFIX = 'pretile-launch-manifests/';

export function manifestPrefixFor(tag: string | null | undefined): string {
  if (tag === 'qc-review') return 'qc-review-manifests/';
  if (tag === 'info-tags') return 'info-tag-manifests/';
  return QUEUE_MANIFEST_PREFIX;
}

export function isUnder(key: unknown, prefix: string): key is string {
  return (
    typeof key === 'string' &&
    key.startsWith(prefix) &&
    key.length > prefix.length &&
    !key.split('/').includes('..') &&
    !key.includes('\0')
  );
}
