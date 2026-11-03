import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INACTIVE_AFTER_MS,
  NOTICE_MS,
  decide,
  inactiveJobsEmail,
  jobLabel,
  lastActivityMs,
} from './core';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 3, 6);
const iso = (time: number) => new Date(time).toISOString();

test('a never-worked queue is judged by when it was created', () => {
  assert.equal(decide({ createdAt: iso(NOW - 59 * DAY) }, NOW), 'none');
  assert.equal(decide({ createdAt: iso(NOW - 60 * DAY) }, NOW), 'warn');
});

test('the latest of observation, access and creation counts', () => {
  const queue = {
    createdAt: iso(NOW - 200 * DAY),
    lastObservationAt: iso(NOW - 100 * DAY),
    lastAccessedAt: iso(NOW - 10 * DAY),
  };
  assert.equal(lastActivityMs(queue), NOW - 10 * DAY);
  assert.equal(decide(queue, NOW), 'none');
});

test('a warned queue waits for its deadline, then is cancelled', () => {
  const warnedAt = NOW - 10 * DAY;
  const queue = {
    createdAt: iso(warnedAt - INACTIVE_AFTER_MS),
    inactivityWarnedAt: iso(warnedAt),
    cancelAfter: iso(warnedAt + NOTICE_MS),
  };
  assert.equal(decide(queue, NOW), 'none');
  assert.equal(decide(queue, warnedAt + NOTICE_MS), 'cancel');
});

test('activity after the warning clears it', () => {
  const warnedAt = NOW - 10 * DAY;
  const queue = {
    createdAt: iso(warnedAt - INACTIVE_AFTER_MS),
    lastObservationAt: iso(NOW - DAY),
    inactivityWarnedAt: iso(warnedAt),
    cancelAfter: iso(warnedAt + NOTICE_MS),
  };
  assert.equal(decide(queue, warnedAt + NOTICE_MS), 'clear');
});

test('job labels avoid repeating the queue name', () => {
  assert.equal(jobLabel({ name: 'False Negatives', tag: 'GR2024 - False Negatives' }), 'GR2024 - False Negatives');
  assert.equal(jobLabel({ name: 'Model Guided', tag: 'Tsavo' }), 'Tsavo (Model Guided)');
  assert.equal(jobLabel({ name: 'Review 1', tag: 'qc-review' }), 'Review 1');
  assert.equal(jobLabel({ name: 'Model Guided', tag: null }), 'Model Guided');
});

test('the email names the deadline and escapes survey names', () => {
  const email = inactiveJobsEmail(
    'Wild  <Org>',
    [{ projectName: 'A & B', jobLabel: 'Model Guided', lastActiveAt: NOW - 70 * DAY }],
    NOW + NOTICE_MS
  );
  assert.equal(email.subject, 'A SurveyScope job in Wild <Org> will be cancelled on 3 December 2026');
  assert.ok(email.html.includes('A &amp; B: Model Guided'));
  assert.ok(!email.html.includes('<Org>'));
  assert.ok(email.text.includes('does not delete any annotations'));
});
