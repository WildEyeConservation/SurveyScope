import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSurveyAdmin, authorizeWorkflowStatsItem, requireWorkflowStatsUser } from './readAuthorization';

test('ordinary organization members can read statistics without admin roles', () => {
  const user = { sub: 'member', groups: ['organization-a'] };
  for (const item of [
    { organizationId: 'organization-a', runId: 'run' },
    { organizationId: 'organization-a', eventId: 'event' },
    { organizationId: 'organization-a', scopeKey: 'daily' },
  ]) assert.doesNotThrow(() => authorizeWorkflowStatsItem(user, item));
});

test('cross-organization and missing ownership are denied', () => {
  for (const user of [{ sub: 'member', groups: ['organization-a'] }, { sub: 'member', groups: [] }]) {
    assert.throws(() => authorizeWorkflowStatsItem(user, { organizationId: 'organization-b' }), /Unauthorized/);
    assert.throws(() => authorizeWorkflowStatsItem(user, {}), /Unauthorized/);
  }
});

test('sysadmins retain access to all organizations and legacy records', () => {
  const user = { sub: 'admin', groups: ['sysadmin'] };
  assert.doesNotThrow(() => authorizeWorkflowStatsItem(user, { organizationId: 'organization-b' }));
  assert.doesNotThrow(() => authorizeWorkflowStatsItem(user, {}));
});

test('anonymous and non-user identities cannot use reporting queries', () => {
  for (const identity of [null, undefined, {}, { groups: ['sysadmin'] }, { sub: '', groups: ['sysadmin'] }]) {
    assert.throws(() => requireWorkflowStatsUser(identity), /Unauthorized/);
    assert.throws(() => authorizeWorkflowStatsItem(identity, { organizationId: 'organization-a' }), /Unauthorized/);
  }
});

test('task event exports require a survey or organization admin', async () => {
  const lookup = (orgAdmin: boolean, projectAdmin: boolean) => ({
    organizationOf: async () => 'organization-a',
    isOrganizationAdmin: async () => orgAdmin,
    isProjectAdmin: async () => projectAdmin,
  });
  const member = { sub: 'member', groups: ['organization-a'] };
  await assert.rejects(assertSurveyAdmin(member, 'survey', lookup(false, false)), /only survey admins/);
  await assert.doesNotReject(assertSurveyAdmin(member, 'survey', lookup(false, true)));
  await assert.doesNotReject(assertSurveyAdmin(member, 'survey', lookup(true, false)));
  const outsider = { sub: 'outsider', groups: ['organization-b'] };
  await assert.rejects(assertSurveyAdmin(outsider, 'survey', lookup(true, true)), /another organization/);
  const sysadmin = { sub: 'admin', groups: ['sysadmin'] };
  await assert.doesNotReject(assertSurveyAdmin(sysadmin, 'survey', lookup(false, false)));
});
