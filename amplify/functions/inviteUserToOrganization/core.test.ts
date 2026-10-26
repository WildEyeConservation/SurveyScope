import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMIT_MESSAGES,
  InviteLimitError,
  isValidEmail,
  limitUpdates,
  organizationInviteEmail,
  processInvite,
  type InviteDependencies,
} from './core';

const NOW = Date.UTC(2026, 9, 26, 12);

test('limits are keyed by the normalised address, never the raw one', () => {
  const a = limitUpdates('org-1', ' Jane@Example.org ', NOW);
  const b = limitUpdates('org-1', 'jane@example.org', NOW);
  assert.deepEqual(a, b);
  for (const update of a) assert.ok(!update.key.includes('example'));
});

test('the recipient cooldown spans other organizations but org limits do not', () => {
  const [recipient1, org1, repeat1] = limitUpdates('org-1', 'a@b.org', NOW);
  const [recipient2, org2, repeat2] = limitUpdates('org-2', 'a@b.org', NOW);
  assert.equal(recipient1.key, recipient2.key);
  assert.notEqual(org1.key, org2.key);
  assert.notEqual(repeat1.key, repeat2.key);
});

test('the recipient cooldown lasts a rolling 24 hours', () => {
  const [recipient] = limitUpdates('org-1', 'a@b.org', NOW);
  assert.equal(recipient.limit, 'recipient');
  assert.equal(
    recipient.expiresAt - (recipient as { now: number }).now,
    24 * 60 * 60
  );
});

test('the organization counter starts afresh the next UTC day', () => {
  const today = limitUpdates('org-1', 'a@b.org', NOW)[1];
  const tomorrow = limitUpdates(
    'org-1',
    'a@b.org',
    NOW + 24 * 60 * 60 * 1000
  )[1];
  assert.notEqual(today.key, tomorrow.key);
  assert.equal(today.limit === 'organization' && today.max, 20);
});

test('limit errors carry the message for their limit', () => {
  assert.equal(new InviteLimitError('repeat').message, LIMIT_MESSAGES.repeat);
});

test('addresses that could break the Cognito filter are rejected', () => {
  assert.ok(isValidEmail('jane.doe@example.org'));
  assert.ok(!isValidEmail('a"@b.org'));
  assert.ok(!isValidEmail('a\\@b.org'));
  assert.ok(!isValidEmail('not an email'));
});

test('the organization name is escaped in the HTML and flattened in the subject', () => {
  const email = organizationInviteEmail('<b>Evil</b>\nCorp');
  assert.equal(
    email.subject,
    '<b>Evil</b> Corp invited you to join them on SurveyScope'
  );
  assert.ok(!email.html.includes('<b>Evil'));
  assert.ok(email.html.includes('&lt;b&gt;Evil&lt;/b&gt; Corp'));
  assert.ok(email.text.includes('https://www.surveyscope.org'));
});

function fakeInvites(
  accounts: Record<string, { member?: boolean; pending?: boolean }>
) {
  const claimedUntil = new Map<string, number>();
  const sent: string[] = [];
  const dependencies: InviteDependencies = {
    reserve: async (updates) => {
      const recipient = updates[0];
      if (recipient.limit !== 'recipient') throw new Error('unexpected order');
      if ((claimedUntil.get(recipient.key) ?? 0) > recipient.now) {
        throw new InviteLimitError('recipient');
      }
      claimedUntil.set(recipient.key, recipient.expiresAt);
    },
    findUser: async (email) =>
      accounts[email] ? { userId: email, email } : null,
    isMember: async (userId) => Boolean(accounts[userId].member),
    hasPendingInvite: async (userId) => Boolean(accounts[userId].pending),
    createInvite: async (userId) => {
      accounts[userId].pending = true;
      return 'Org';
    },
    sendEmail: async (to) => {
      sent.push(to);
    },
  };
  return { dependencies, sent };
}

async function outcome(promise: Promise<void>): Promise<string> {
  return promise.then(
    () => 'ok',
    (error: Error) => error.message
  );
}

test('repeated invites respond the same with or without an account', async () => {
  const { dependencies, sent } = fakeInvites({ 'known@b.org': {} });
  for (const now of [NOW, NOW + 60_000, NOW + 25 * 60 * 60 * 1000]) {
    assert.equal(
      await outcome(
        processInvite(dependencies, 'org-1', 'known@b.org', true, now)
      ),
      await outcome(
        processInvite(dependencies, 'org-1', 'unknown@b.org', true, now)
      )
    );
  }
  assert.deepEqual(sent, ['known@b.org']);
});

test('sysadmin invites skip the limits', async () => {
  const { dependencies } = fakeInvites({});
  await processInvite(dependencies, 'org-1', 'a@b.org', false, NOW);
  assert.equal(
    await outcome(processInvite(dependencies, 'org-1', 'a@b.org', false, NOW)),
    'ok'
  );
});

test('a failed email still leaves the invite in place', async () => {
  const accounts = { 'a@b.org': {} as { pending?: boolean } };
  const { dependencies } = fakeInvites(accounts);
  dependencies.sendEmail = async () => {
    throw new Error('SES down');
  };
  assert.equal(
    await outcome(processInvite(dependencies, 'org-1', 'a@b.org', true, NOW)),
    'ok'
  );
  assert.equal(accounts['a@b.org'].pending, true);
});
