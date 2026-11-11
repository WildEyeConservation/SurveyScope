import assert from 'node:assert/strict';
import test from 'node:test';
import { continuationEvent, parseImageEntry } from './detectorImages';

test('splits an image entry at the first separator', () => {
  assert.deepEqual(parseImageEntry('i1---org/p/a---b.jpg'), {
    imageId: 'i1',
    key: 'images/org/p/a---b.jpg',
  });
});

test('continues with the same request and the remaining images', () => {
  const event = {
    arguments: {
      projectId: 'p1',
      queueUrl: 'q',
      bucket: 'b',
      images: ['a', 'b', 'c'],
    },
    identity: { sub: 'u1', groups: ['org1'] },
  };
  const next = continuationEvent(event, ['c']);
  assert.deepEqual(next, {
    arguments: { projectId: 'p1', queueUrl: 'q', bucket: 'b', images: ['c'] },
    identity: { sub: 'u1', groups: ['org1'] },
  });
  assert.deepEqual(event.arguments.images, ['a', 'b', 'c']);
});
