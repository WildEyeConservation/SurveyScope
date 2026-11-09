import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { layoutBoard, moveKey, type OverlapImage } from './layout';

const STEP = 0.0005;

// Two east-west transects; the southern one is flown westwards.
function transect(id: string, lat: number, westwards: boolean) {
  const images: OverlapImage[] = [];
  for (let k = 0; k < 4; k++) {
    for (const camera of ['left', 'right']) {
      images.push({
        id: `${id}-${camera}-${k}`,
        cameraId: camera,
        transectId: id,
        lat,
        lng: 27 + k * STEP,
        timestamp: westwards ? 100 - k : k,
        width: 300,
        height: 200,
      });
    }
  }
  return images;
}

const images = [
  ...transect('south', -24.3005, true),
  ...transect('north', -24.3, false),
];
const byName = (a: string, b: string) => a.localeCompare(b);

test('places transects north first with cameras in name order', () => {
  const { sections } = layoutBoard(images, 100, byName);
  assert.deepEqual(
    sections.map((s) => s.transectId),
    ['north', 'south'],
  );
  assert.deepEqual(
    sections[0].rows.map((r) => r.cameraKey),
    ['left', 'right'],
  );
});

test('starts every row at the left in one flight direction', () => {
  const { sections, width } = layoutBoard(images, 100, byName);
  const lefts = (s: number, r: number) =>
    sections[s].rows[r].images.map((p) => [p.image.lng, p.left]);
  assert.deepEqual(lefts(0, 0), lefts(1, 1));
  assert.deepEqual(
    lefts(0, 0).map(([, left]) => left),
    [0, 100, 200, 300],
  );
  assert.equal(width, 400);
});

test('applies a saved camera order within one transect only', () => {
  const { sections } = layoutBoard(images, 100, byName, {
    south: ['right', 'left'],
  });
  assert.deepEqual(
    sections[0].rows.map((r) => r.cameraKey),
    ['left', 'right'],
  );
  assert.deepEqual(
    sections[1].rows.map((r) => r.cameraKey),
    ['right', 'left'],
  );
});

test('moveKey moves a key to the given index', () => {
  assert.deepEqual(moveKey(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
  assert.deepEqual(moveKey(['a', 'b', 'c'], 'a', 5), ['b', 'c', 'a']);
});
