import test from 'node:test';
import assert from 'node:assert/strict';
import { planCameraWrite } from './cameras';

test('planCameraWrite leaves an existing camera alone without entered specs', () => {
  assert.equal(planCameraWrite(true, false, false), 'reuse');
});

test('planCameraWrite updates an existing camera when specs were entered', () => {
  assert.equal(planCameraWrite(true, false, true), 'update');
});

test('planCameraWrite creates a missing camera with or without specs', () => {
  assert.equal(planCameraWrite(false, false, false), 'create');
  assert.equal(planCameraWrite(false, false, true), 'create');
});

test('planCameraWrite never writes for a mapped folder', () => {
  assert.equal(planCameraWrite(true, true, true), 'reuse');
  assert.equal(planCameraWrite(false, true, true), 'reuse');
  assert.equal(planCameraWrite(true, true, false), 'reuse');
});
