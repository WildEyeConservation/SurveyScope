import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { escapeCsvValue, neutraliseCsvFormula, neutraliseCsvRows } from './csv';

test('prefixes formula-like strings', () => {
  for (const value of [
    '=1+1',
    '+SUM(A1)',
    '-2+3',
    '@cmd',
    '\tx',
    '\rx',
    '-',
    '=HYPERLINK("x")'
  ]) {
    assert.equal(neutraliseCsvFormula(value), `'${value}`);
  }
});

test('leaves safe strings and non-strings alone', () => {
  for (const value of [
    'alice',
    'a=b',
    '',
    '12',
    '-12.5',
    '+3',
    '-1e5',
    '-.5'
  ]) {
    assert.equal(neutraliseCsvFormula(value), value);
  }
  assert.equal(neutraliseCsvFormula(-4), -4);
  assert.equal(neutraliseCsvFormula(null), null);
  assert.equal(neutraliseCsvFormula(undefined), undefined);
  assert.equal(neutraliseCsvFormula(true), true);
});

test('neutralises every string cell in rows', () => {
  assert.deepEqual(
    neutraliseCsvRows([{ name: '=cmd', count: -3, delta: '-3' }]),
    [{ name: "'=cmd", count: -3, delta: '-3' }]
  );
});

test('turns carriage returns into line feeds in rows', () => {
  assert.deepEqual(neutraliseCsvRows([{ a: 'x\r=1+1', b: 'y\r\nz' }]), [
    { a: 'x\n=1+1', b: 'y\nz' }
  ]);
});

test('escapes after neutralising', () => {
  assert.equal(escapeCsvValue('=1,2'), `"'=1,2"`);
  assert.equal(escapeCsvValue('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvValue(null), '');
  assert.equal(escapeCsvValue(-7), '-7');
});
