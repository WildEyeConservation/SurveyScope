import assert from 'node:assert/strict';
import test from 'node:test';
import {
  annotationQueueTag,
  isUnder,
  KIND_TAGS,
  manifestPrefixFor,
  QUEUE_MANIFEST_PREFIX,
  queueKindOf,
} from './s3Keys';

test('accepts keys under the prefix', () => {
  assert.equal(
    isUnder('queue-manifests/abc.json', QUEUE_MANIFEST_PREFIX),
    true,
  );
  assert.equal(
    isUnder('queue-manifests/a/b..c.json', QUEUE_MANIFEST_PREFIX),
    true,
  );
});

test('rejects other prefixes, traversal, and non-strings', () => {
  assert.equal(isUnder('images/abc.json', QUEUE_MANIFEST_PREFIX), false);
  assert.equal(isUnder('queue-manifests/', QUEUE_MANIFEST_PREFIX), false);
  assert.equal(
    isUnder('queue-manifests/../images/a.jpg', QUEUE_MANIFEST_PREFIX),
    false,
  );
  assert.equal(
    isUnder('queue-manifests/a/../../b', QUEUE_MANIFEST_PREFIX),
    false,
  );
  assert.equal(
    isUnder('/queue-manifests/a.json', QUEUE_MANIFEST_PREFIX),
    false,
  );
  assert.equal(isUnder(null, QUEUE_MANIFEST_PREFIX), false);
  assert.equal(isUnder(undefined, QUEUE_MANIFEST_PREFIX), false);
  assert.equal(isUnder(42, QUEUE_MANIFEST_PREFIX), false);
});

test('each queue tag keeps its manifest under its own prefix', () => {
  assert.equal(
    isUnder('info-tag-manifests/s1/1.json', manifestPrefixFor('info-tags')),
    true,
  );
  assert.equal(
    isUnder('qc-review-manifests/s1/c1/1.json', manifestPrefixFor('qc-review')),
    true,
  );
  assert.equal(
    isUnder('queue-manifests/q1.json', manifestPrefixFor('homography')),
    true,
  );
  assert.equal(
    isUnder('qc-review-manifests/s1/c1/1.json', manifestPrefixFor(null)),
    false,
  );
});

test('job names cannot claim another queue kind', () => {
  for (const tag of Object.values(KIND_TAGS)) {
    assert.throws(() => annotationQueueTag(tag, 'fallback'), /reserved/);
  }
  assert.equal(annotationQueueTag('Elephant pass', 'x'), 'Elephant pass');
  assert.equal(annotationQueueTag(undefined, 'Default'), 'Default');
  assert.equal(annotationQueueTag('', 'Default'), '');
});

test('inherited names map to annotation queues', () => {
  for (const tag of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(queueKindOf(tag), 'annotation');
    assert.equal(manifestPrefixFor(tag), QUEUE_MANIFEST_PREFIX);
  }
});
