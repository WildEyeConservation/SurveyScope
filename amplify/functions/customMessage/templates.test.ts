import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageFor } from './templates';

const placeholders = { codeParameter: '{####}', usernameParameter: '{username}' };

test('the invitation contains both placeholders Cognito requires', () => {
  const message = messageFor('CustomMessage_AdminCreateUser', placeholders);
  assert.ok(message?.html.includes('{####}'));
  assert.ok(message?.html.includes('{username}'));
  assert.equal(message?.subject, 'WildEye invited you to use SurveyScope');
});

test('every templated message stays within the Cognito size limit', () => {
  for (const source of [
    'CustomMessage_AdminCreateUser',
    'CustomMessage_SignUp',
    'CustomMessage_ResendCode',
    'CustomMessage_ForgotPassword',
    'CustomMessage_UpdateUserAttribute',
    'CustomMessage_VerifyUserAttribute',
  ]) {
    const message = messageFor(source, placeholders);
    assert.ok(message?.html.includes('{####}'), source);
    assert.ok(message!.html.length < 20000, source);
  }
});

test('other trigger sources keep the default message', () => {
  assert.equal(messageFor('CustomMessage_Authentication', placeholders), null);
});
