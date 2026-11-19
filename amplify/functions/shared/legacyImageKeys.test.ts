import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyKeyIsRegistered, registeredLegacyImages } from './legacyImageKeys';

const image = { id: 'i1', originalPath: 'flight1/IMG_1.jpg' };

test('legacy paths need a file registered to the same image and project', () => {
  const file = { key: 'flight1/IMG_1.jpg', projectId: 'p1', imageId: 'i1' };
  assert.equal(legacyKeyIsRegistered('p1', image, [file]), true);
  assert.equal(
    legacyKeyIsRegistered('p1', image, [{ ...file, key: 'images/flight1/IMG_1.jpg' }]),
    true,
  );
  assert.equal(legacyKeyIsRegistered('p1', image, [{ ...file, projectId: 'p2' }]), false);
  assert.equal(legacyKeyIsRegistered('p1', image, [{ ...file, imageId: 'i2' }]), false);
  assert.equal(
    legacyKeyIsRegistered('p1', image, [{ ...file, key: 'org/p2/flight1/IMG_1.jpg' }]),
    false,
  );
  assert.equal(legacyKeyIsRegistered('p1', { id: 'i1', originalPath: null }, [file]), false);
});

test('unregistered images are refused', async () => {
  const files: Record<string, unknown[]> = {
    i1: [{ key: 'flight1/IMG_1.jpg', projectId: 'p1', imageId: 'i1' }],
    i2: [{ key: 'other/IMG_9.jpg', projectId: 'p2', imageId: 'i2' }],
  };
  const gql = async <T>(_q: string, v: Record<string, unknown>) =>
    ({ imagesByimageId: { items: files[String(v.imageId)] ?? [], nextToken: null } }) as T;
  const { kept, refused } = await registeredLegacyImages(
    'p1',
    [image, { id: 'i2', originalPath: 'other/IMG_9.jpg' }],
    gql,
  );
  assert.deepEqual(kept, [image]);
  assert.deepEqual(refused, ['i2']);
});
