import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LIMIT_WINDOW_MS,
  MAX_REPORTS_PER_USER_PER_WINDOW,
  MAX_STACK_LENGTH,
  MAX_SUBJECT_LENGTH,
  bounded,
  buildNotification,
  buildReport,
  createReserve,
  limiterKeys,
  processClientError,
  type ClientErrorReport,
  type LimiterStore,
  type ReportDependencies,
} from './core';

const args = { message: 'Boom', stack: 'Error: Boom\n    at App' };

function dependencies(
  overrides: Partial<ReportDependencies> = {}
): ReportDependencies & {
  saved: ClientErrorReport[];
  emails: string[];
  released: number[];
} {
  const saved: ClientErrorReport[] = [];
  const emails: string[] = [];
  const released: number[] = [];
  return {
    saved,
    emails,
    released,
    reserve: async () => ({
      release: async () => {
        released.push(1);
      },
    }),
    lookUpEmail: async () => 'user@example.org',
    save: async (report) => {
      saved.push(report);
      return 'report-1';
    },
    notify: async (_subject, message) => {
      emails.push(message);
    },
    ...overrides,
  };
}

test('bounded drops blank values and truncates long ones', () => {
  assert.equal(bounded(null, 10), undefined);
  assert.equal(bounded('   ', 10), undefined);
  assert.equal(bounded('  ok  ', 10), 'ok');
  assert.equal(bounded('abcdef', 3), 'abc… [truncated]');
});

test('a report without a usable message is still recorded', () => {
  const report = buildReport(
    { message: '  ', stack: 'x'.repeat(25_000) },
    'user-1'
  );
  assert.equal(report.message, 'Unknown error');
  assert.equal(report.stack, `${'x'.repeat(MAX_STACK_LENGTH)}… [truncated]`);
  assert.equal(report.userId, 'user-1');
});

test('the email subject is bounded printable ASCII on one line', () => {
  const { subject } = buildNotification(
    buildReport({ message: `naïve\nfailure ${'y'.repeat(200)}` }, 'user-1'),
    'master',
    'report-1'
  );
  assert.equal(subject.length, MAX_SUBJECT_LENGTH);
  assert.match(subject, /^[\x20-\x7E]+$/);
  assert.ok(subject.startsWith('[SurveyScope master] Client error: na ve '));
});

test('limiter keys are per user, per window and per distinct error', () => {
  const now = 5 * LIMIT_WINDOW_MS + 1;
  const keys = limiterKeys('user-1', args, now);
  assert.deepEqual(limiterKeys('user-1', args, now + 1000), keys);
  assert.equal(keys.rate, 'rate#user-1#5');
  assert.equal(keys.expiresAt, (7 * LIMIT_WINDOW_MS) / 1000);

  const otherError = limiterKeys('user-1', { message: 'Other' }, now);
  assert.equal(otherError.rate, keys.rate);
  assert.notEqual(otherError.duplicate, keys.duplicate);

  const otherUser = limiterKeys('user-2', args, now);
  assert.notEqual(otherUser.rate, keys.rate);
  assert.notEqual(otherUser.duplicate, keys.duplicate);

  const nextWindow = limiterKeys('user-1', args, now + LIMIT_WINDOW_MS);
  assert.notEqual(nextWindow.rate, keys.rate);
  assert.notEqual(nextWindow.duplicate, keys.duplicate);
});

test('saves and emails a report with the looked-up email', async () => {
  const deps = dependencies();
  const outcome = await processClientError(deps, 'user-1', args, 'master');
  assert.deepEqual(outcome, {
    id: 'report-1',
    notified: true,
    throttled: false,
  });
  assert.equal(deps.saved[0].userEmail, 'user@example.org');
  assert.match(deps.emails[0], /Report ID: report-1/);
});

test('a throttled report is neither saved nor emailed', async () => {
  const deps = dependencies({ reserve: async () => null });
  const outcome = await processClientError(deps, 'user-1', args, 'master');
  assert.deepEqual(outcome, { notified: false, throttled: true });
  assert.equal(deps.saved.length, 0);
  assert.equal(deps.emails.length, 0);
});

test('a failed email lookup does not prevent saving', async () => {
  const deps = dependencies({
    lookUpEmail: async () => {
      throw new Error('cognito down');
    },
  });
  const outcome = await processClientError(deps, 'user-1', args, 'master');
  assert.equal(outcome.id, 'report-1');
  assert.equal(deps.saved[0].userEmail, undefined);
});

test('a failed save still emails the report and then rejects', async () => {
  const deps = dependencies({
    save: async () => {
      throw new Error('save failed');
    },
  });
  await assert.rejects(
    processClientError(deps, 'user-1', args, 'master'),
    /save failed/
  );
  assert.match(deps.emails[0], /Report ID: not saved/);
  // The email went out, so a repeat of this error is still a duplicate.
  assert.equal(deps.released.length, 0);
});

test('a report that reached nobody releases its claim', async () => {
  const deps = dependencies({
    save: async () => {
      throw new Error('save failed');
    },
    notify: async () => {
      throw new Error('sns down');
    },
  });
  await assert.rejects(
    processClientError(deps, 'user-1', args, 'master'),
    /save failed/
  );
  assert.equal(deps.released.length, 1);
});

test('a failed email keeps the saved report', async () => {
  const deps = dependencies({
    notify: async () => {
      throw new Error('sns down');
    },
  });
  const outcome = await processClientError(deps, 'user-1', args, 'master');
  assert.deepEqual(outcome, {
    id: 'report-1',
    notified: false,
    throttled: false,
  });
  assert.equal(deps.saved.length, 1);
});

test('without recipients the report is only saved', async () => {
  const deps = dependencies({ notify: undefined });
  const outcome = await processClientError(deps, 'user-1', args, 'master');
  assert.deepEqual(outcome, {
    id: 'report-1',
    notified: false,
    throttled: false,
  });
});

function limiterStore(overrides: Partial<LimiterStore> = {}) {
  const calls: string[] = [];
  const store: LimiterStore = {
    claimDuplicate: async (key) => {
      calls.push(key);
      return true;
    },
    incrementRate: async (key, _expiresAt, max) => {
      calls.push(`${key} max=${max}`);
      return true;
    },
    releaseDuplicate: async (key) => {
      calls.push(`release ${key}`);
    },
    ...overrides,
  };
  return { calls, reserve: createReserve(store, () => 5 * LIMIT_WINDOW_MS) };
}

test('reserving claims the duplicate key and then the rate counter', async () => {
  const { calls, reserve } = limiterStore();
  const keys = limiterKeys('user-1', args, 5 * LIMIT_WINDOW_MS);
  const reservation = await reserve('user-1', args);
  assert.deepEqual(calls, [
    keys.duplicate,
    `${keys.rate} max=${MAX_REPORTS_PER_USER_PER_WINDOW}`,
  ]);
  await reservation?.release();
  assert.equal(calls[2], `release ${keys.duplicate}`);
});

test('a duplicate is dropped without using the rate budget', async () => {
  let rateCalls = 0;
  const { reserve } = limiterStore({
    claimDuplicate: async () => false,
    incrementRate: async () => {
      rateCalls += 1;
      return true;
    },
  });
  assert.equal(await reserve('user-1', args), null);
  assert.equal(rateCalls, 0);
});

test('a user over the rate limit is dropped', async () => {
  const { reserve } = limiterStore({ incrementRate: async () => false });
  assert.equal(await reserve('user-1', args), null);
});

test('a broken limiter accepts the report', async () => {
  const { reserve } = limiterStore({
    claimDuplicate: async () => {
      throw new Error('dynamodb down');
    },
  });
  assert.notEqual(await reserve('user-1', args), null);
});
