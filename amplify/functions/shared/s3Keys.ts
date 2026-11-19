export const QUEUE_MANIFEST_PREFIX = 'queue-manifests/';
export const TILING_OUTPUT_PREFIX = 'tiling-outputs/';
export const TILING_BATCH_PREFIX = 'tiling-batches/';
export const PRETILE_MANIFEST_PREFIX = 'pretile-launch-manifests/';

// Queue rows with these tags are handled as that job kind downstream.
export const KIND_TAGS = {
  'qc-review': 'qc-review',
  'info-tags': 'info-tags',
  homography: 'homography',
} as const;
export type TaggedKind = keyof typeof KIND_TAGS;

const KIND_MANIFEST_PREFIXES: Record<TaggedKind, string> = {
  'qc-review': 'qc-review-manifests/',
  'info-tags': 'info-tag-manifests/',
  homography: QUEUE_MANIFEST_PREFIX,
};

// Tags not in KIND_TAGS are job names of annotation-style queues.
export function queueKindOf(
  tag: string | null | undefined,
): TaggedKind | 'annotation' {
  return typeof tag === 'string' && Object.hasOwn(KIND_TAGS, tag)
    ? (tag as TaggedKind)
    : 'annotation';
}

export function manifestPrefixFor(tag: string | null | undefined): string {
  const kind = queueKindOf(tag);
  return kind === 'annotation' ? QUEUE_MANIFEST_PREFIX : KIND_MANIFEST_PREFIXES[kind];
}

// Annotation-style launchers keep the caller's job name unless it would
// make the queue read as another kind.
export function annotationQueueTag(label: unknown, fallback: string): string {
  const tag = typeof label === 'string' ? label : fallback;
  if (queueKindOf(tag) !== 'annotation') {
    throw new Error(`The job name "${tag}" is reserved`);
  }
  return tag;
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
