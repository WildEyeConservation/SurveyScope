import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSuccessfulScans } from './sampleScan';

// Negative numbers stand in for corrupt files.
function scanner() {
  const seen: number[] = [];
  const scan = async (n: number) => {
    seen.push(n);
    return n < 0 ? null : n;
  };
  return { seen, scan };
}

test('sampleSuccessfulScans skips leading failures', async () => {
  const files = [-1, -2, -3, -4, -5, 1, 2, 3, 4, 5, 6];
  const { seen, scan } = scanner();
  const { sample, consumed } = await sampleSuccessfulScans(files, 5, scan);
  assert.deepEqual(sample, [1, 2, 3, 4, 5]);
  assert.equal(consumed, 10);
  assert.deepEqual(seen, files.slice(0, 10));
});

test('sampleSuccessfulScans stops after the first batch when it fills', async () => {
  const { seen, scan } = scanner();
  const { sample, consumed } = await sampleSuccessfulScans(
    [1, 2, 3, 4, 5, 6, 7],
    5,
    scan
  );
  assert.deepEqual(sample, [1, 2, 3, 4, 5]);
  assert.equal(consumed, 5);
  assert.equal(seen.length, 5);
});

test('sampleSuccessfulScans keeps batches full width after a partial sample', async () => {
  const files = [1, 2, 3, 4, -1, -2, -3, -4, -5, -6, 5, 6];
  const { seen, scan } = scanner();
  const { sample, consumed } = await sampleSuccessfulScans(files, 5, scan);
  assert.deepEqual(sample, [1, 2, 3, 4, 5, 6]);
  assert.equal(consumed, 12);
  assert.deepEqual(seen, files);
});

test('sampleSuccessfulScans handles fewer files than the sample size', async () => {
  const { sample, consumed } = await sampleSuccessfulScans(
    [1, -1, 2],
    5,
    scanner().scan
  );
  assert.deepEqual(sample, [1, 2]);
  assert.equal(consumed, 3);
});

test('sampleSuccessfulScans terminates when every file fails', async () => {
  const files = [-1, -2, -3, -4, -5, -6, -7];
  const { seen, scan } = scanner();
  const { sample, consumed } = await sampleSuccessfulScans(files, 5, scan);
  assert.deepEqual(sample, []);
  assert.equal(consumed, 7);
  assert.deepEqual(seen, files);
});

test('sampleSuccessfulScans handles no files', async () => {
  const { sample, consumed } = await sampleSuccessfulScans(
    [],
    5,
    scanner().scan
  );
  assert.deepEqual(sample, []);
  assert.equal(consumed, 0);
});
