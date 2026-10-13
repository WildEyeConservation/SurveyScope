import assert from 'node:assert/strict';
import test from 'node:test';
import { assertInputsBelongToProject, parsePayload } from './validation';

const payload = {
  projectId: 'project-1',
  annotationSetId: 'set-1',
  categoryIds: ['category-1'],
};

const annotationSet = { id: 'set-1', projectId: 'project-1' };
const category = {
  id: 'category-1',
  projectId: 'project-1',
  annotationSetId: 'set-1',
};

test('parsePayload rejects requests without the required ids', () => {
  assert.throws(() => parsePayload(undefined), /Launch payload is required/);
  assert.throws(
    () => parsePayload(JSON.stringify({ projectId: 'project-1' })),
    /missing required fields/
  );
  assert.throws(
    () =>
      parsePayload(
        JSON.stringify({ ...payload, categoryIds: [{ id: 'category-1' }] })
      ),
    /missing required fields/
  );
});

test('parsePayload de-duplicates labels and sanitises the batch size', () => {
  const parsed = parsePayload(
    JSON.stringify({
      ...payload,
      categoryIds: ['category-1', 'category-1', 'category-2'],
      batchSize: -5,
      hidden: 'yes',
    })
  );
  assert.deepEqual(parsed.categoryIds, ['category-1', 'category-2']);
  assert.equal(parsed.batchSize, 200);
  assert.equal(parsed.hidden, false);
});

test('an annotation set from another project is rejected', () => {
  assert.throws(
    () =>
      assertInputsBelongToProject(
        payload,
        { id: 'set-1', projectId: 'other-project' },
        [category]
      ),
    /Annotation set does not belong to the requested project/
  );
});

test('a label from another annotation set is rejected', () => {
  assert.throws(
    () =>
      assertInputsBelongToProject(payload, annotationSet, [
        { ...category, annotationSetId: 'other-set' },
      ]),
    /does not belong to the requested annotation set/
  );
  assert.throws(
    () =>
      assertInputsBelongToProject(payload, annotationSet, [
        { ...category, projectId: 'other-project' },
      ]),
    /does not belong to the requested annotation set/
  );
});

test('missing records are rejected', () => {
  assert.throws(
    () => assertInputsBelongToProject(payload, null, [category]),
    /Annotation set set-1 not found/
  );
  assert.throws(
    () => assertInputsBelongToProject(payload, annotationSet, [null]),
    /Label category-1 not found/
  );
});

test('inputs that belong to the project are accepted', () => {
  assert.doesNotThrow(() =>
    assertInputsBelongToProject(payload, annotationSet, [category])
  );
});

test('parsePayload keeps only integer zoom values', () => {
  const parse = (zoom?: unknown) =>
    parsePayload(
      JSON.stringify({
        projectId: 'project-1',
        annotationSetId: 'set-1',
        categoryIds: ['category-1'],
        zoom,
      })
    ).zoom;
  assert.equal(parse(4), 4);
  assert.equal(parse(0), 0);
  assert.equal(parse(2.5), undefined);
  assert.equal(parse('4'), undefined);
  assert.equal(parse(null), undefined);
  assert.equal(parse(), undefined);
});
