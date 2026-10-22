import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSurveySave, surveySaveSettled } from './surveySaves';

test('saves for one survey run one after another', async () => {
  const events: string[] = [];
  let finishFirst!: () => void;
  const first = runSurveySave('p', async () => {
    events.push('first start');
    await new Promise<void>((resolve) => (finishFirst = resolve));
    events.push('first end');
  });
  const second = runSurveySave('p', async () => {
    events.push('second start');
  });
  await Promise.resolve();
  finishFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first start', 'first end', 'second start']);
});

test('loads wait for a save in progress, even one that fails', async () => {
  let failSave!: (err: Error) => void;
  const save = runSurveySave(
    'q',
    () => new Promise<void>((_, reject) => (failSave = reject))
  );
  let loaded = false;
  const load = surveySaveSettled('q').then(() => (loaded = true));
  await Promise.resolve();
  assert.equal(loaded, false);
  failSave(new Error('boom'));
  await assert.rejects(save);
  await load;
  assert.equal(loaded, true);
});
