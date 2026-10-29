import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isCentreObserved, isPointInBox } from './locationGeometry.ts';

const observed = { x: 100, y: 100, width: 40, height: 20 };

test('isPointInBox includes the edges', () => {
  assert.equal(isPointInBox(120, 110, observed), true);
  assert.equal(isPointInBox(80, 90, observed), true);
  assert.equal(isPointInBox(121, 100, observed), false);
  assert.equal(isPointInBox(100, 111, observed), false);
});

test('a box is observed only when its centre is inside an observed box', () => {
  assert.equal(
    isCentreObserved({ x: 115, y: 105, width: 200, height: 200 }, [observed]),
    true,
  );
  assert.equal(
    isCentreObserved({ x: 130, y: 100, width: 40, height: 40 }, [observed]),
    false,
  );
  assert.equal(
    isCentreObserved({ x: 100, y: 100, width: 10, height: 10 }, []),
    false,
  );
});
