import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtendedAnnotationType } from '../schemaTypes';
import { selectTestContextAnnotations } from './testContextAnnotations';

const annotation = (
  id: string,
  x: number,
  y: number,
  overrides: Partial<ExtendedAnnotationType> = {},
): ExtendedAnnotationType =>
  ({
    id,
    categoryId: 'source-elephant',
    x,
    y,
    source: 'manual',
    ...overrides,
  }) as unknown as ExtendedAnnotationType;

const location = { x: 500, y: 500, width: 100, height: 100 };
const sourceCategories = [
  { id: 'source-elephant', name: 'Elephant' },
  { id: 'source-zebra', name: 'zebra' },
  { id: 'source-rhino', name: 'Rhino' },
];
const jobCategories = [
  { id: 'job-elephant', name: 'elephant' },
  { id: 'job-zebra', name: 'Zebra' },
];

const select = (
  annotations: ExtendedAnnotationType[],
  overrides: Partial<Parameters<typeof selectTestContextAnnotations>[0]> = {},
) =>
  selectTestContextAnnotations({
    annotations,
    sourceCategories,
    jobCategories,
    location,
    ...overrides,
  });

test('hides every annotation scoring could count, including the box edge', () => {
  const result = select([
    annotation('centre', 500, 500),
    annotation('edge', 550, 450),
    annotation('just-outside', 551, 500),
    annotation('far', 50, 900),
  ]);

  assert.deepEqual(
    result.map((a) => a.id),
    ['just-outside', 'far'],
  );
});

test('maps labels to same-named job labels and drops foreign labels', () => {
  const result = select([
    annotation('elephant', 10, 10),
    annotation('zebra', 20, 20, { categoryId: 'source-zebra' }),
    annotation('rhino', 30, 30, { categoryId: 'source-rhino' }),
    annotation('unknown-category', 40, 40, { categoryId: 'missing' }),
  ]);

  assert.deepEqual(
    result.map((a) => [a.id, a.categoryId]),
    [
      ['elephant', 'job-elephant'],
      ['zebra', 'job-zebra'],
    ],
  );
});

test('hides false negative finds only when the job hides them', () => {
  const annotations = [
    annotation('manual', 10, 10),
    annotation('fn', 20, 20, { source: 'manual-false-negative' }),
  ];

  assert.deepEqual(
    select(annotations, { hideFnAnnotations: true }).map((a) => a.id),
    ['manual'],
  );
  assert.deepEqual(
    select(annotations, { hideFnAnnotations: false }).map((a) => a.id),
    ['manual', 'fn'],
  );
});

test('shows nothing when the box has no size', () => {
  assert.deepEqual(
    select([annotation('far', 10, 10)], {
      location: { x: 500, y: 500, width: 0, height: null },
    }),
    [],
  );
});
