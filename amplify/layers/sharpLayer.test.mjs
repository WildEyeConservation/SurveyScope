import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const version = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url))).version;

test('the sharp layer matches the sharp JS bundled into functions', () => {
  const bundled = version('../../node_modules/sharp/package.json');
  const layer = './sharp-ph200-x64/nodejs/node_modules';
  assert.equal(version(`${layer}/sharp/package.json`), bundled);
  assert.equal(version(`${layer}/@img/sharp-linux-x64/package.json`), bundled);
});
