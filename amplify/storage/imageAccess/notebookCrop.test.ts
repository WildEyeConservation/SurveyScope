import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeHeader, pyramid, tilePackKey } from '../../../shared/tilePack';
import type { ImageFileRow, ImageRow, ProjectRow } from './authorization';
import { notebookCrop, type CropSource } from './notebookCrop';

const project: ProjectRow = {
  id: 'p',
  organizationId: 'org-a',
  group: 'org-a',
};
const image: ImageRow = {
  id: 'i',
  projectId: 'p',
  group: 'org-a',
  originalPath: 'transect-7/IMG_1.JPG',
  width: 1000,
  height: 700,
};
const file: ImageFileRow = {
  id: 'f',
  imageId: 'i',
  projectId: 'p',
  group: 'org-a',
  key: 'org-a/p/transect-7/IMG_1.JPG',
  path: 'org-a/p/transect-7/IMG_1.JPG',
};
const member = { sub: 'u', groups: ['org-a'] };

// Each tile's bytes name its own coordinate, so the test can tell them apart.
function pack() {
  const meta = {
    width: image.width,
    height: image.height,
    tileSize: 256,
    maxZoom: 2,
    format: 'image/webp',
  };
  const { levels } = pyramid(meta);
  const tiles: Uint8Array[] = [];
  for (const level of levels)
    for (let row = 0; row < level.rows; row++)
      for (let col = 0; col < level.columns; col++)
        tiles.push(new TextEncoder().encode(`${level.zoom}/${row}/${col}`));
  const header = encodeHeader(
    meta,
    tiles.map((t) => t.length),
  );
  const bytes = new Uint8Array(
    header.length + tiles.reduce((sum, t) => sum + t.length, 0),
  );
  bytes.set(header, 0);
  let at = header.length;
  for (const tile of tiles) {
    bytes.set(tile, at);
    at += tile.length;
  }
  return bytes;
}

function source(objects: Record<string, Uint8Array>) {
  const reads: string[] = [];
  const crop: CropSource = {
    image: async (id) => (id === image.id ? image : undefined),
    project: async (id) => (id === project.id ? project : undefined),
    files: async () => [file],
    read: async (key, range) => {
      reads.push(key);
      const bytes = objects[key];
      if (!bytes) return null;
      return range ? bytes.subarray(range[0], range[1] + 1) : bytes;
    },
  };
  return { crop, reads };
}

const decode = (data: string) => Buffer.from(data, 'base64').toString();

test('a crop holds only the full-resolution tiles around the point', async () => {
  const { crop } = source({ [tilePackKey(file.key)]: pack() });
  const result = await notebookCrop(crop, member, 'i', { x: 600, y: 300 });
  assert.ok(result);
  assert.deepEqual(
    { width: result.width, height: result.height, point: result.point },
    { width: 512, height: 512, point: { x: 256, y: 256 } },
  );
  assert.deepEqual(
    result.tiles.map((t) => [decode(t.data), t.left, t.top, t.type]),
    [
      ['2/0/1', -88, -44, 'image/webp'],
      ['2/0/2', 168, -44, 'image/webp'],
      ['2/0/3', 424, -44, 'image/webp'],
      ['2/1/1', -88, 212, 'image/webp'],
      ['2/1/2', 168, 212, 'image/webp'],
      ['2/1/3', 424, 212, 'image/webp'],
      ['2/2/1', -88, 468, 'image/webp'],
      ['2/2/2', 168, 468, 'image/webp'],
      ['2/2/3', 424, 468, 'image/webp'],
    ],
  );
  const text = JSON.stringify(result);
  for (const secret of ['transect-7', 'IMG_1', 'org-a', '"i"'])
    assert.ok(!text.includes(secret), `crop leaks ${secret}`);
});

test('without a pack, single tiles are read', async () => {
  const tile = (id: string) => new TextEncoder().encode(id);
  const objects: Record<string, Uint8Array> = {};
  for (const id of ['2/0/0', '2/0/1', '2/1/0', '2/1/1'])
    objects[`slippymaps/${file.key}/${id}.png`] = tile(id);
  const { crop } = source(objects);
  const result = await notebookCrop(crop, member, 'i', { x: 10, y: 10 });
  assert.deepEqual(
    result?.tiles.map((t) => decode(t.data)),
    ['2/0/0', '2/0/1', '2/1/0', '2/1/1'],
  );
});

test('an untiled image has no crop', async () => {
  const { crop } = source({});
  assert.equal(await notebookCrop(crop, member, 'i', { x: 10, y: 10 }), null);
});

test('another organisation cannot crop the image', async () => {
  const { crop, reads } = source({ [tilePackKey(file.key)]: pack() });
  await assert.rejects(
    notebookCrop(crop, { sub: 'x', groups: ['org-b'] }, 'i', { x: 1, y: 1 }),
    /another organization/,
  );
  assert.deepEqual(reads, []);
});
