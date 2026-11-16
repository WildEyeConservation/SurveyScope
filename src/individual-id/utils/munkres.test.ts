import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AnnotationType, ImageType } from '../../schemaTypes';
import { buildMatchCandidates } from './munkres';

const image = (id: string) =>
  ({ id, width: 1000, height: 1000 }) as unknown as ImageType;
const ann = (
  id: string,
  imageId: string,
  x: number,
  y: number,
  objectId: string | null = null,
) =>
  ({
    id,
    imageId,
    x,
    y,
    objectId,
    categoryId: 'c',
  }) as unknown as AnnotationType;
const identity = (c: [number, number]): [number, number] => c;

const build = (
  annotationsA: AnnotationType[],
  annotationsB: AnnotationType[],
  proposedPairs?: [string, string, boolean?][],
) =>
  buildMatchCandidates({
    annotationsA,
    annotationsB,
    imageA: image('A'),
    imageB: image('B'),
    forward: identity,
    backward: identity,
    leniency: 50,
    proposedPairs,
  });

test('a proposed pair becomes one pending candidate however far apart', () => {
  const a = ann('a', 'A', 100, 100);
  const b = ann('b', 'B', 900, 900);
  assert.equal(build([a], [b]).length, 2);
  const [c, ...rest] = build([a], [b], [['a', 'b']]);
  assert.equal(rest.length, 0);
  assert.equal(c.realA?.id, 'a');
  assert.equal(c.realB?.id, 'b');
  assert.equal(c.status, 'pending');
  assert.equal(c.herdProposed, true);
  assert.equal(c.uncertain, undefined);
  assert.equal(build([a], [b], [['a', 'b', true]])[0].uncertain, true);
});

test('an existing link beats a stale proposal', () => {
  const a = ann('a', 'A', 100, 100, 'a');
  const b = ann('b', 'B', 900, 900);
  const linked = ann('l', 'B', 500, 500, 'a');
  const candidates = build([a], [b, linked], [['a', 'b']]);
  const ofA = candidates.find((c) => c.realA?.id === 'a');
  assert.equal(ofA?.realB?.id, 'l');
  assert.equal(ofA?.status, 'accepted');
});
