import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeHeader, pyramid, tilePackKey } from '../../../shared/tilePack';
import type {
  ImageFileRow,
  ImageRow,
  ProjectRow,
} from '../imageAccess/authorization';
import { notebookCrop, type CropPiece, type CropSource } from './notebookCrop';

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

function pack(size = { width: image.width, height: image.height }) {
  const meta = {
    ...size,
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
  const composed: { size: number; pieces: string[] }[] = [];
  const cut: unknown[] = [];
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
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
    compose: async (size, pieces: CropPiece[]) => {
      composed.push({
        size,
        pieces: pieces.map((p) => `${text(p.bytes)}@${p.left},${p.top}`),
      });
      return new TextEncoder().encode('crop');
    },
    fromSource: async (_key, window) => {
      cut.push(window);
      return new TextEncoder().encode('cut');
    },
  };
  return { crop, reads, composed, cut };
}

test('a crop is the tiles around the point, centred and composed', async () => {
  const { crop, composed } = source({ [tilePackKey(file.key)]: pack() });
  const result = await notebookCrop(crop, member, 'i', { x: 600, y: 300 });
  assert.deepEqual(result, {
    size: 512,
    type: 'image/webp',
    data: Buffer.from('crop').toString('base64'),
  });
  assert.deepEqual(composed, [
    {
      size: 512,
      pieces: [
        '2/0/1@-88,-44',
        '2/0/2@168,-44',
        '2/0/3@424,-44',
        '2/1/1@-88,212',
        '2/1/2@168,212',
        '2/1/3@424,212',
        '2/2/1@-88,468',
        '2/2/2@168,468',
        '2/2/3@424,468',
      ],
    },
  ]);
});

test('an example near the image edge has no crop', async () => {
  const { crop, reads } = source({ [tilePackKey(file.key)]: pack() });
  assert.equal(await notebookCrop(crop, member, 'i', { x: 10, y: 300 }), null);
  assert.equal(await notebookCrop(crop, member, 'i', { x: 600, y: 650 }), null);
  assert.deepEqual(reads, []);
});

test('without a pack, the crop is cut from the source image', async () => {
  const { crop, cut } = source({});
  const result = await notebookCrop(crop, member, 'i', { x: 300, y: 300 });
  assert.deepEqual(cut, [{ left: 44, top: 44, width: 512, height: 512 }]);
  assert.equal(result?.data, Buffer.from('cut').toString('base64'));
});

test('a pack smaller than the image row refuses edge crops', async () => {
  const { crop, composed, cut } = source({
    [tilePackKey(file.key)]: pack({ width: 700, height: 700 }),
  });
  assert.equal(await notebookCrop(crop, member, 'i', { x: 600, y: 300 }), null);
  assert.deepEqual([composed, cut], [[], []]);
});

test('another organisation cannot crop the image', async () => {
  const { crop, reads } = source({ [tilePackKey(file.key)]: pack() });
  await assert.rejects(
    notebookCrop(crop, { sub: 'x', groups: ['org-b'] }, 'i', { x: 300, y: 300 }),
    /another organization/,
  );
  assert.deepEqual(reads, []);
});
