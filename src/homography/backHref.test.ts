import assert from 'node:assert/strict';
import test from 'node:test';
import { sameAppPath } from './backHref';

test('same-app paths are kept', () => {
  assert.equal(sameAppPath('/jobs'), '/jobs');
  assert.equal(
    sameAppPath('/surveys/1/edit?tab=a&b=%2F'),
    '/surveys/1/edit?tab=a&b=%2F',
  );
});

test('off-site and malformed targets are rejected', () => {
  for (const href of [
    null,
    '',
    'jobs',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/ /evil.example',
    '/\u007f',
    'https://evil.example',
    'javascript:alert(1)',
  ]) {
    assert.equal(sameAppPath(href), undefined, JSON.stringify(href));
  }
});
