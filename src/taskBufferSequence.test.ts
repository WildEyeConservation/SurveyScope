import assert from 'node:assert/strict';
import test from 'node:test';
import {
  insertBufferedTaskAfter,
  promoteStandbyTaskAfter,
} from './taskBufferSequence';

test('an urgent test is inserted before preloaded normal tasks', () => {
  const buffer = [
    { id: 'normal-1', kind: 'normal' },
    { id: 'normal-2', kind: 'normal' },
    { id: 'normal-3', kind: 'normal' },
    { id: 'normal-4', kind: 'normal' },
  ];

  const next = insertBufferedTaskAfter(buffer, 0, { kind: 'test' }, 'test-1');

  assert.deepEqual(
    next.map((entry) => entry.id),
    ['normal-1', 'test-1', 'normal-2', 'normal-3', 'normal-4']
  );
  assert.deepEqual(
    buffer.map((entry) => entry.id),
    ['normal-1', 'normal-2', 'normal-3', 'normal-4']
  );
});

test('a promoted standby keeps its identity and stable render id', () => {
  const buffer = [
    { id: 'normal-1', kind: 'normal' },
    { id: 'normal-2', kind: 'normal' },
  ];
  const standby = { id: 'test-hot', kind: 'test' };

  const next = promoteStandbyTaskAfter(buffer, 0, standby);

  assert.equal(next[1], standby);
  assert.deepEqual(
    next.map((entry) => entry.id),
    ['normal-1', 'test-hot', 'normal-2']
  );
});

test('a promoted standby can inherit slot metadata without changing its id', () => {
  const buffer = [{ id: 'normal-1', taskTag: 'flow_1' }];
  const standby = { id: 'test-hot', taskTag: '' };

  const next = promoteStandbyTaskAfter(buffer, 0, standby, {
    taskTag: buffer[0].taskTag,
  });

  assert.equal(next[1].id, 'test-hot');
  assert.equal(next[1].taskTag, 'flow_1');
});
