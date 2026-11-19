import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeWorkflowTask,
  pairImageIds,
  workflowTaskKey,
  type WorkflowTaskLookups,
} from './authorize';

const run = {
  runId: 'r1',
  workflowType: 'qc-review',
  projectId: 'p1',
  annotationSetId: 's1',
  organizationId: 'o1',
};

function lookups(overrides: Partial<WorkflowTaskLookups> = {}): WorkflowTaskLookups {
  return {
    isSurveyMember: async (projectId, userId) => projectId === 'p1' && userId === 'member',
    isOrganizationAdmin: async (_org, userId) => userId === 'orgadmin',
    annotation: async (id) =>
      id === 'a1' ? { projectId: 'p1', setId: 's1' } : { projectId: 'p2', setId: 's9' },
    imageProject: async (id) => (id.startsWith('i') ? 'p1' : 'p2'),
    ...overrides,
  };
}

const user = (sub: string, groups = ['o1']) => ({ sub, groups });

test('survey members, org admins and sysadmins may record', async () => {
  await authorizeWorkflowTask(user('member'), run, 'annotation', 'a1', lookups());
  await authorizeWorkflowTask(user('orgadmin'), run, 'annotation', 'a1', lookups());
  await authorizeWorkflowTask(user('x', ['sysadmin']), run, 'annotation', 'a1', lookups());
});

test('other organisation members may not record', async () => {
  await assert.rejects(
    authorizeWorkflowTask(user('stranger'), run, 'annotation', 'a1', lookups()),
    /not a member/,
  );
  await assert.rejects(
    authorizeWorkflowTask(user('member', ['o2']), run, 'annotation', 'a1', lookups()),
    /not a member/,
  );
});

test('work items must belong to the run', async () => {
  await assert.rejects(
    authorizeWorkflowTask(user('member'), run, 'annotation', 'a2', lookups()),
    /not part of this workflow run/,
  );
  await assert.rejects(
    authorizeWorkflowTask(user('member'), run, 'image-pair', 'i1::i2', lookups()),
    /cannot be recorded/,
  );
  await assert.rejects(
    authorizeWorkflowTask(user('member'), { ...run, workflowType: 'constructor' }, 'annotation', 'a1', lookups()),
    /cannot be recorded/,
  );
  const pairs = { ...run, workflowType: 'homographies' };
  await authorizeWorkflowTask(user('member'), pairs, 'image-pair', 'i1::i2', lookups());
  await authorizeWorkflowTask(user('member'), { ...run, workflowType: 'individual-id' }, 'image-pair', 'i1__i2', lookups());
  await assert.rejects(
    authorizeWorkflowTask(user('member'), pairs, 'image-pair', 'i1::x2', lookups()),
    /not part of this workflow run/,
  );
  await assert.rejects(
    authorizeWorkflowTask(user('member'), pairs, 'image-pair', 'i1', lookups()),
    /Invalid image pair/,
  );
});

test('pair keys and dedupe keys', () => {
  assert.deepEqual(pairImageIds('a::b'), ['a', 'b']);
  assert.deepEqual(pairImageIds('a__b'), ['a', 'b']);
  assert.equal(pairImageIds('a::b::c'), null);
  assert.equal(pairImageIds('::b'), null);
  assert.notEqual(workflowTaskKey('annotation', 'a1', 'u1'), workflowTaskKey('annotation', 'a1', 'u2'));
  assert.equal(workflowTaskKey('annotation', 'a1', 'u1'), workflowTaskKey('annotation', 'a1', 'u1'));
});
