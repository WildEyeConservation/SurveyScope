import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const now = Date.parse('2026-09-28T10:30:00Z');
const early = Symbol('early');
function resolver(
  file,
  auth = 'User Pool Authorization',
  fieldName = file.split('/').pop().replace('.js', '')
) {
  let subscriptionFilter;
  const util = {
    transform: { toSubscriptionFilter: (value) => value },
    authType: () => auth,
    unauthorized: () => {
      throw new Error('Unauthorized');
    },
    error: (message, type) => {
      throw Object.assign(new Error(message), { type });
    },
    dynamodb: { toMapValues: (value) => value },
    time: {
      nowISO8601: () => new Date(now).toISOString(),
      nowEpochMilliSeconds: () => now,
      parseISO8601ToEpochMilliSeconds: Date.parse,
    },
  };
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '')
    .replaceAll('export function', 'function');
  const api = vm.runInNewContext(
    `${source}\n({ request, response, filter: getFilter })`,
    {
      util,
      getFilter: () => subscriptionFilter,
      extensions: {
        setSubscriptionFilter: (value) => {
          subscriptionFilter = value;
        },
      },
      runtime: {
        earlyReturn: () => {
          throw early;
        },
      },
    }
  );
  const context = (ctx = {}) => ({
    env: { MAINTENANCE_TABLE: 'state' },
    info: { fieldName },
    ...ctx,
  });
  return {
    request: (ctx) => api.request(context(ctx)),
    response: (ctx) => api.response(context(ctx)),
    filter: api.filter,
  };
}
const user = {
  sub: 'user',
  username: 'user',
  claims: { 'cognito:groups': ['organisation-admin'] },
};
const admin = { sub: 'admin', claims: { 'cognito:groups': ['sysadmin'] } };
const input = {
  expectedRevision: 0,
  message: ' Update ',
  messageType: 'update',
  publishAt: '2026-09-28T10:00:00Z',
  denyAccessAt: '2026-09-28T10:30:00Z',
};

test('only sysadmins can publish, clear or reschedule', () => {
  const api = resolver('../data/setSystemMaintenance.js');
  for (const identity of [undefined, user])
    assert.throws(() => api.request({ identity, args: input }), /Unauthorized/);
  const write = api.request({ identity: admin, args: input });
  assert.equal(write.key.id, 'global');
  assert.equal(write.attributeValues.message, 'Update');
  assert.equal(write.attributeValues.revision, 1);
  assert.equal(write.condition.expression, 'attribute_not_exists(id)');
  const update = api.request({
    identity: admin,
    args: { ...input, expectedRevision: 3 },
  });
  assert.equal(update.condition.expressionValues[':expected'], 3);
  assert.equal(update.attributeValues.revision, 4);
});
test('backend rejects invalid schedules even when bypassing the UI', () => {
  const api = resolver('../data/setSystemMaintenance.js');
  for (const changes of [
    { message: ' ' },
    { message: 'a'.repeat(2001) },
    { messageType: 'unknown' },
    { expectedRevision: -1 },
    { publishAt: null },
    { denyAccessAt: '2026-09-28T09:00:00Z' },
  ]) {
    assert.throws(
      () => api.request({ identity: admin, args: { ...input, ...changes } }),
      (e) => e.type === 'ValidationError'
    );
  }
});
test('grant access writes an empty state instead of deleting revision history', () => {
  const api = resolver('../data/setSystemMaintenance.js');
  const write = api.request({
    identity: admin,
    args: {
      ...input,
      expectedRevision: 4,
      message: '',
      publishAt: null,
      denyAccessAt: null,
    },
  });
  assert.equal(write.attributeValues.revision, 5);
  assert.equal(write.attributeValues.denyAccessAt, null);
  assert.equal(write.attributeValues.message, '');
});
test('one consistent batch checks global and personal restrictions at the cutoff', () => {
  const api = resolver('./guard.js');
  const ctx = {
    identity: user,
    args: { userId: 'someone-else' },
    prev: { result: { original: true } },
  };
  const request = api.request(ctx);
  assert.equal(request.operation, 'BatchGetItem');
  assert.equal(request.tables.state.consistentRead, true);
  assert.equal(
    JSON.stringify(request.tables.state.keys),
    JSON.stringify([{ id: 'global' }, { id: 'user:user' }])
  );
  const result = (states) => ({
    data: { state: states },
    unprocessedKeys: { state: [] },
  });
  assert.equal(
    api.response({ ...ctx, result: result([null, null]) }),
    ctx.prev.result
  );
  for (const index of [0, 1]) {
    for (const time of [now - 1, now, now + 1]) {
      const states = [null, null];
      states[index] = { denyAccessAt: new Date(time).toISOString() };
      if (time <= now)
        assert.throws(
          () => api.response({ ...ctx, result: result(states) }),
          (e) => e.type === 'MaintenanceInProgress'
        );
      else
        assert.equal(
          api.response({ ...ctx, result: result(states) }),
          ctx.prev.result
        );
    }
  }
  for (const failed of [
    null,
    { data: { state: [null] } },
    {
      data: { state: [null, null] },
      unprocessedKeys: { state: [{ id: 'global' }] },
    },
  ]) {
    assert.throws(
      () => api.response({ ...ctx, result: failed }),
      (e) => e.type === 'MaintenanceUnavailable'
    );
  }
  assert.throws(
    () => api.response({ ...ctx, error: { message: 'DynamoDB down' } }),
    (e) => e.type === 'MaintenanceUnavailable'
  );
});
test('sysadmins and service IAM may proceed; identity-pool browser users cannot bypass the guard', () => {
  assert.throws(
    () =>
      resolver('./guard.js').request({ identity: admin, prev: { result: {} } }),
    (e) => e === early
  );
  const iam = resolver('./guard.js', 'IAM Authorization');
  assert.throws(
    () =>
      iam.request({
        identity: { userArn: 'service-role' },
        prev: { result: {} },
      }),
    (e) => e === early
  );
  assert.throws(
    () =>
      iam.request({
        identity: { cognitoIdentityId: 'browser' },
        prev: { result: {} },
      }),
    /Unauthorized/
  );
});
test('new installations return open state; reads expose server time and never mask backend failures', () => {
  const api = resolver('../data/getSystemMaintenance.js');
  assert.equal(api.request().consistentRead, true);
  const state = api.response({ result: null });
  assert.equal(state.revision, 0);
  assert.equal(state.denyAccessAt, null);
  assert.equal(state.serverTime, new Date(now).toISOString());
  assert.throws(
    () => api.response({ error: { message: 'failed', type: 'DynamoDBError' } }),
    /failed/
  );
});

test('private announcements can only be read by their recipient or a sysadmin', () => {
  const api = resolver(
    '../data/getSystemMaintenance.js',
    'User Pool Authorization',
    'getUserAnnouncement'
  );
  const recipient = { ...user, username: 'alice' };
  assert.equal(
    api.request({ identity: recipient, args: {} }).key.id,
    'user:alice'
  );
  assert.equal(
    api.request({ identity: recipient, args: { userId: 'alice' } }).key.id,
    'user:alice'
  );
  assert.throws(
    () => api.request({ identity: recipient, args: { userId: 'bob' } }),
    /Unauthorized/
  );
  assert.throws(() => api.request({ args: {} }), /Unauthorized/);
  assert.equal(
    api.request({
      identity: { ...admin, username: 'admin' },
      args: { userId: 'bob' },
    }).key.id,
    'user:bob'
  );
});

test('private subscription filter is fixed by identity rather than caller input', () => {
  const api = resolver('../data/onUserAnnouncementChange.js');
  assert.throws(() => api.request({}), /Unauthorized/);
  const ctx = {
    identity: { ...user, username: 'alice' },
    args: { userId: 'bob', filter: {} },
  };
  api.request(ctx);
  assert.equal(api.response(ctx), null);
  assert.equal(api.filter().userId.eq, 'alice');
});

test('personal announcements enforce writer permission, independent keys and revision checks', () => {
  const api = resolver(
    '../data/setSystemMaintenance.js',
    'User Pool Authorization',
    'setUserAnnouncement'
  );
  const args = { ...input, userId: 'alice' };
  assert.throws(() => api.request({ identity: user, args }), /Unauthorized/);
  const write = api.request({ identity: admin, args });
  assert.equal(write.key.id, 'user:alice');
  assert.equal(write.attributeValues.userId, 'alice');
  assert.equal(write.attributeValues.denyAccessAt, input.denyAccessAt);
  assert.equal(write.condition.expression, 'attribute_not_exists(id)');
  const clear = api.request({
    identity: admin,
    args: {
      ...args,
      expectedRevision: 2,
      message: '',
      publishAt: null,
      denyAccessAt: null,
    },
  });
  assert.equal(clear.attributeValues.revision, 3);
  assert.equal(clear.condition.expressionValues[':expected'], 2);
  assert.equal(clear.attributeValues.denyAccessAt, null);
  for (const changes of [
    { userId: '' },
    { userId: 'x'.repeat(129) },
    { message: '' },
    { denyAccessAt: '2026-09-28T09:00:00Z' },
  ]) {
    assert.throws(
      () => api.request({ identity: admin, args: { ...args, ...changes } }),
      (e) => e.type === 'ValidationError'
    );
  }
});
