import assert from 'node:assert/strict';
import test from 'node:test';
import { detectTransects, type TimedImage } from './detectTransects';

const epoch = 1_780_000_000_000;
const metresPerDegree = 111_195;
function image(
  id: string,
  seconds: number,
  north: number,
  cameraId?: string
): TimedImage {
  return {
    id,
    timestamp: epoch + seconds * 1000,
    latitude: north / metresPerDegree,
    longitude: 0,
    cameraId,
  };
}
function groups(images: TimedImage[]): string[][] {
  const result = new Map<number, string[]>();
  for (const assignment of detectTransects(images)) {
    const group = result.get(assignment.transectIndex) ?? [];
    group.push(assignment.id);
    result.set(assignment.transectIndex, group);
  }
  return [...result.values()]
    .map((group) => group.sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
}

test('another flight cannot fill the pauses between transects, and paired cameras stay together', () => {
  const images: TimedImage[] = [];
  for (let seconds = 0; seconds <= 30; seconds += 2) {
    images.push(image(`b1-${seconds}`, seconds, 100_000 + seconds * 30, 'b1'));
    images.push(image(`b2-${seconds}`, seconds, 100_000 + seconds * 30, 'b2'));
    if (seconds <= 4 || seconds >= 26) {
      images.push(image(`a1-${seconds}`, seconds, seconds * 30, 'a1'));
      images.push(image(`a2-${seconds}`, seconds, seconds * 30, 'a2'));
    }
  }
  const assignments = new Map(
    detectTransects(images).map((a) => [a.id, a.transectIndex])
  );
  assert.equal(new Set(assignments.values()).size, 3);
  assert.notEqual(assignments.get('a1-0'), assignments.get('a1-26'));
  assert.notEqual(assignments.get('a1-0'), assignments.get('b1-0'));
  for (const seconds of [0, 2, 4, 26, 28, 30]) {
    assert.equal(
      assignments.get(`a1-${seconds}`),
      assignments.get(`a2-${seconds}`)
    );
  }
  for (let seconds = 0; seconds <= 30; seconds += 2) {
    assert.equal(assignments.get(`b1-${seconds}`), assignments.get('b1-0'));
    assert.equal(assignments.get(`b2-${seconds}`), assignments.get('b1-0'));
  }
  assert.deepEqual(groups([...images].reverse()), groups(images));
});

test('simultaneous distant tracks stay separate even without camera metadata', () => {
  assert.deepEqual(
    groups([
      image('a0', 0, 0),
      image('b0', 0, 100_000),
      image('a1', 2, 60),
      image('b1', 2, 100_060),
      image('a2', 4, 120),
      image('b2', 4, 100_120),
    ]),
    [
      ['a0', 'a1', 'a2'],
      ['b0', 'b1', 'b2'],
    ]
  );
});

test('known cameras keep their tracks when two flights approach and cross', () => {
  assert.deepEqual(
    groups([
      image('a0', 0, 0, 'a'),
      image('b0', 0, 600, 'b'),
      image('a1', 2, 200, 'a'),
      image('b1', 2, 400, 'b'),
      image('a2', 4, 400, 'a'),
      image('b2', 4, 200, 'b'),
    ]),
    [
      ['a0', 'a1', 'a2'],
      ['b0', 'b1', 'b2'],
    ]
  );
});

test('a geographic jump starts a new transect even for the same camera', () => {
  assert.deepEqual(
    groups([
      image('a0', 0, 0, 'camera'),
      image('a1', 2, 60, 'camera'),
      image('b0', 4, 100_000, 'camera'),
      image('b1', 6, 100_060, 'camera'),
    ]),
    [
      ['a0', 'a1'],
      ['b0', 'b1'],
    ]
  );
});

test('ordinary aircraft motion, GPS jitter and camera offsets do not split a line', () => {
  assert.deepEqual(
    groups([
      image('a0', 0, 0, 'a'),
      image('b0', 0, 50, 'b'),
      image('a1', 2, 354, 'a'),
      image('b1', 2, 360, 'b'),
      image('a2', 4, 200, 'a'),
      image('b2', 4, 250, 'b'),
    ]),
    [['a0', 'a1', 'a2', 'b0', 'b1', 'b2']]
  );
});

test('the ten-second floor is strict and short transects are preserved', () => {
  const images = [0, 2, 4, 6, 16, 27].map((t, i) => ({
    id: String(i),
    timestamp: epoch + t * 1000,
  }));
  assert.deepEqual(groups(images), [['0', '1', '2', '3', '4'], ['5']]);
});

test('the adaptive gap threshold still uses three times the median', () => {
  const images = [0, 5, 10, 15, 30, 46].map((t, i) => ({
    id: String(i),
    timestamp: epoch + t * 1000,
  }));
  assert.deepEqual(groups(images), [['0', '1', '2', '3', '4'], ['5']]);
});

test('mixed epoch units and shuffled images give the same groups without mutating input', () => {
  const images = [image('c', 4, 120), image('a', 0, 0), image('b', 2, 60)];
  images[1].timestamp = epoch / 1000;
  const before = structuredClone(images);
  assert.deepEqual(groups(images), [['a', 'b', 'c']]);
  assert.deepEqual(images, before);
});

test('missing timestamps cannot join geographically distant images to the final track', () => {
  assert.deepEqual(
    groups([
      image('a0', 0, 0, 'a'),
      image('a1', 2, 60, 'a'),
      { ...image('near', 0, 70, 'a'), timestamp: null },
      { ...image('far', 0, 100_000, 'a'), timestamp: NaN },
    ]),
    [['a0', 'a1', 'near'], ['far']]
  );
});

test('missing GPS uses camera identity without merging simultaneous cameras', () => {
  assert.deepEqual(
    groups([
      image('a0', 0, 0, 'a'),
      image('b0', 0, 100_000, 'b'),
      {
        id: 'a1',
        timestamp: epoch + 2000,
        cameraId: 'a',
        latitude: NaN,
        longitude: 0,
      },
      { id: 'b1', timestamp: epoch + 2000, cameraId: 'b' },
    ]),
    [
      ['a0', 'a1'],
      ['b0', 'b1'],
    ]
  );
});

test('empty, single-image and timestamp-only inputs remain supported', () => {
  assert.deepEqual(detectTransects([]), []);
  assert.deepEqual(detectTransects([{ id: 'single', timestamp: null }]), [
    { id: 'single', transectIndex: 0 },
  ]);
  assert.deepEqual(
    groups([
      { id: 'a', timestamp: epoch },
      { id: 'b', timestamp: undefined },
    ]),
    [['a', 'b']]
  );
});
