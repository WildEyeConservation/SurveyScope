import test from 'node:test';
import assert from 'node:assert/strict';
import { gpsRowKey, nextMapRemovedKeys } from './gpsIndex';

const row = (lat: number) => ({ lat, lng: 0, alt: 100 });

test('map removals accumulate and survive rows being filtered elsewhere', () => {
  const [a, b, c] = [row(1), row(2), row(3)];
  const removed = nextMapRemovedKeys(new Set(), [a, b, c], [a, c]);
  assert.deepEqual([...removed], [gpsRowKey(b)]);
  // c is now excluded by another filter, so the map is only offered a.
  assert.deepEqual([...nextMapRemovedKeys(removed, [a], [a])], [gpsRowKey(b)]);
});

test('undoing a map removal clears it', () => {
  const [a, b] = [row(1), row(2)];
  const removed = nextMapRemovedKeys(new Set([gpsRowKey(b)]), [a], [a, b]);
  assert.equal(removed.size, 0);
});

test('restoring a row the map was never offered does not track it', () => {
  const [a, outOfBand] = [row(1), row(2)];
  const removed = nextMapRemovedKeys(new Set(), [a], [a, outOfBand]);
  assert.equal(removed.size, 0);
});

test('rebuilt row objects still match the rows the map kept', () => {
  const retained = [row(1), row(2), row(3)];
  const rebuilt = [row(1), row(2), row(3)];
  const removed = nextMapRemovedKeys(new Set(), rebuilt, retained.slice(1));
  assert.deepEqual([...removed], [gpsRowKey(rebuilt[0])]);
});
