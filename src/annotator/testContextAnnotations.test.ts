import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContextAnnotation } from '../api/tasks';
import { selectTestContextAnnotations } from './testContextAnnotations';

const annotation = (
  id: string,
  x: number,
  y: number,
  overrides: Partial<TestContextAnnotation> = {},
): TestContextAnnotation => ({
  id,
  categoryName: 'Elephant',
  x,
  y,
  source: 'manual',
  ...overrides,
});

const jobCategories = [
  { id: 'job-elephant', name: 'elephant' },
  { id: 'job-zebra', name: 'Zebra' },
];

const select = (
  annotations: TestContextAnnotation[],
  overrides: Partial<Parameters<typeof selectTestContextAnnotations>[0]> = {},
) =>
  selectTestContextAnnotations({
    annotations,
    jobCategories,
    ...overrides,
  });

test('maps labels to same-named job labels and drops foreign labels', () => {
  const result = select([
    annotation('elephant', 10, 10),
    annotation('zebra', 20, 20, { categoryName: 'zebra' }),
    annotation('rhino', 30, 30, { categoryName: 'Rhino' }),
    annotation('unknown-category', 40, 40, { categoryName: '' }),
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
