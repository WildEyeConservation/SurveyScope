import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maintenancePhase,
  validateSchedule,
  assertMaintenanceAccess,
  setMaintenanceAccessBlocked,
  type MaintenanceState,
} from './state';

const state: MaintenanceState = {
  revision: 1,
  message: 'Updating',
  messageType: 'update',
  publishAt: '2026-09-28T10:00:00Z',
  denyAccessAt: '2026-09-28T10:30:00Z',
  serverTime: '2026-09-28T09:00:00Z',
};
test('announcement and access cutoff activate at their exact boundaries', () => {
  assert.equal(maintenancePhase(null, 0), 'loading');
  assert.equal(
    maintenancePhase(state, Date.parse(state.publishAt!) - 1),
    'open'
  );
  assert.equal(
    maintenancePhase(state, Date.parse(state.publishAt!)),
    'announced'
  );
  assert.equal(
    maintenancePhase(state, Date.parse(state.denyAccessAt!) - 1),
    'announced'
  );
  assert.equal(
    maintenancePhase(state, Date.parse(state.denyAccessAt!)),
    'blocked'
  );
  assert.equal(
    maintenancePhase(state, Date.parse(state.denyAccessAt!) + 86400000),
    'blocked'
  );
});
test('clearing the singleton reopens access and removes the banner', () => {
  assert.equal(
    maintenancePhase(
      { ...state, message: '', publishAt: null, denyAccessAt: null },
      Date.now()
    ),
    'open'
  );
});
test('announcements may be informational without locking access', () => {
  assert.equal(
    maintenancePhase(
      { ...state, denyAccessAt: null },
      Date.parse(state.denyAccessAt!)
    ),
    'announced'
  );
});
test('schedule validation handles timezone offsets, invalid dates and reversed times', () => {
  const input = { ...state, expectedRevision: 1 };
  assert.equal(validateSchedule(input), null);
  assert.equal(
    validateSchedule({ ...input, denyAccessAt: '2026-09-28T12:00:00+02:00' }),
    null
  );
  assert.ok(
    validateSchedule({ ...input, denyAccessAt: '2026-09-28T09:59:00Z' })
  );
  assert.ok(validateSchedule({ ...input, publishAt: 'invalid' }));
  assert.ok(validateSchedule({ ...input, message: ' ' }));
  assert.ok(validateSchedule({ ...input, message: 'a'.repeat(2001) }));
});
test('queued application calls are denied until access is granted again', () => {
  setMaintenanceAccessBlocked(true);
  assert.throws(assertMaintenanceAccess, /maintenance/);
  setMaintenanceAccessBlocked(false);
  assert.doesNotThrow(assertMaintenanceAccess);
});
