import assert from 'node:assert/strict';
import test from 'node:test';
import { decideTestCadence } from './testCadence';

test('an interval of 10 inserts a test immediately after 10 unannotated tasks', () => {
  const beforeThreshold = decideTestCadence({
    unannotatedJobs: 8,
    userAnnotated: false,
    isTestTask: false,
    testingEnabled: true,
    config: { testType: 'interval', interval: 10 },
    jobsCompleted: 8,
  });
  const atThreshold = decideTestCadence({
    unannotatedJobs: 9,
    userAnnotated: false,
    isTestTask: false,
    testingEnabled: true,
    config: { testType: 'interval', interval: 10 },
    jobsCompleted: 9,
  });

  assert.deepEqual(beforeThreshold, {
    nextUnannotatedJobs: 9,
    shouldInsertTest: false,
  });
  assert.deepEqual(atThreshold, {
    nextUnannotatedJobs: 10,
    shouldInsertTest: true,
  });
});

test('an annotation resets the consecutive unannotated count', () => {
  assert.deepEqual(
    decideTestCadence({
      unannotatedJobs: 9,
      userAnnotated: true,
      isTestTask: false,
      testingEnabled: true,
      config: { testType: 'interval', interval: 10 },
      jobsCompleted: 9,
    }),
    { nextUnannotatedJobs: 0, shouldInsertTest: false }
  );
});

test('a completed test does not count toward the next interval', () => {
  assert.deepEqual(
    decideTestCadence({
      unannotatedJobs: 0,
      userAnnotated: false,
      isTestTask: true,
      testingEnabled: true,
      config: { testType: 'interval', interval: 10 },
      jobsCompleted: 10,
    }),
    { nextUnannotatedJobs: 0, shouldInsertTest: false }
  );
});

test('random tests respect the completed-job deadzone and probability', () => {
  const inDeadzone = decideTestCadence({
    unannotatedJobs: 10,
    userAnnotated: false,
    isTestTask: false,
    testingEnabled: true,
    config: { testType: 'random', deadzone: 10, random: 100 },
    jobsCompleted: 9,
    randomValue: 0,
  });
  const selected = decideTestCadence({
    unannotatedJobs: 11,
    userAnnotated: false,
    isTestTask: false,
    testingEnabled: true,
    config: { testType: 'random', deadzone: 10, random: 25 },
    jobsCompleted: 10,
    randomValue: 0.24,
  });

  assert.equal(inDeadzone.shouldInsertTest, false);
  assert.equal(selected.shouldInsertTest, true);
});
