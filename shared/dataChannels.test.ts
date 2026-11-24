import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  channelRow,
  channelsFor,
  channelValue,
  EPOCH_LEAD_MS,
  EPOCH_MS,
  joinableEpochs,
  PUBLISH_SLACK_MS,
  REVOCATION_MS,
  SKEW_MS,
} from './dataChannels';

test('hidden queues are published only to the admin channel', () => {
  assert.deepEqual(channelsFor('Queue', { projectId: 'p1' }, 7), [
    '/data/Queue/projectId/p1/7',
  ]);
  assert.deepEqual(channelsFor('Queue', { projectId: 'p1', hidden: true }, 7), [
    '/data/Queue/adminProjectId/p1/7',
  ]);
});

test('subscribers may join only the current window, or the next one shortly before it', () => {
  const start = 1000 * EPOCH_MS;
  assert.deepEqual(joinableEpochs(start + EPOCH_MS / 2, 0), [1000]);
  assert.deepEqual(
    joinableEpochs(start + EPOCH_MS - EPOCH_LEAD_MS + 1, 0).sort(
      (a, b) => a - b,
    ),
    [1000, 1001],
  );
  assert.deepEqual(
    joinableEpochs(start + 5_000, 10_000).sort((a, b) => a - b),
    [999, 1000],
  );
});

test('a joined window ends within the revocation bound', () => {
  const start = 1000 * EPOCH_MS;
  // The earliest moment the next window is accepted.
  let earliest = start;
  for (let t = start; t < start + EPOCH_MS; t += 1000) {
    if (joinableEpochs(t).includes(1001)) {
      earliest = t;
      break;
    }
  }
  assert.ok(earliest > start);
  assert.ok(start + 2 * EPOCH_MS - earliest <= REVOCATION_MS);
  assert.ok(
    EPOCH_MS + EPOCH_LEAD_MS + SKEW_MS + PUBLISH_SLACK_MS <= REVOCATION_MS,
  );
});

test('annotations are published per image and set', () => {
  const imageId = 'e32bc996-dfb1-4fe7-ab49-2350b366f2ea';
  const setId = '2c373c9d-c860-4737-a505-bd5d438548e3';
  const [channel] = channelsFor('Annotation', { imageId, setId }, 7);
  const value = channel.split('/')[4];
  // AppSync Events refuses longer segments and any other characters.
  assert.match(value, /^[A-Za-z0-9-]{1,50}$/);
  assert.equal(channel, `/data/Annotation/imageSet/${value}/7`);
  assert.deepEqual(channelRow('Annotation', 'imageSet', value), {
    imageId,
    setId,
  });
  assert.deepEqual(channelsFor('Annotation', { imageId }, 7), []);
  assert.equal(channelRow('Annotation', 'imageSet', 'i1'), undefined);
});

test('annotation channels name exactly one image and set', () => {
  assert.equal(
    channelValue('Annotation', 'imageSet', { imageId: 'img1', setId: 'a1' }),
    'img1-a1',
  );
  assert.deepEqual(channelRow('Annotation', 'imageSet', 'img1-a-1'), {
    imageId: 'img1',
    setId: 'a-1',
  });
  // An image id with a dash would read back as another row.
  assert.equal(
    channelValue('Annotation', 'imageSet', { imageId: 'i-1', setId: 's1' }),
    undefined,
  );
  // So would a plain id that looks packed.
  assert.equal(
    channelValue('Annotation', 'imageSet', {
      imageId: '0'.repeat(22),
      setId: 's1',
    }),
    undefined,
  );
});
