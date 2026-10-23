import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { heatIntensity, heatRadiusExpression } from './densityHeat';

test('the heat radius doubles with each zoom level between its limits', () => {
  const [, , , low, lowPx, high, highPx] = heatRadiusExpression(5, -25) as [
    unknown,
    unknown,
    unknown,
    number,
    number,
    number,
    number
  ];
  assert.equal(lowPx, 8);
  assert.equal(highPx, 200);
  assert.ok(Math.abs(2 ** (high - low) - 200 / 8) < 1e-9);
  // 5 km at 25°S is about 200 px near zoom 11.5.
  assert.ok(high > 11 && high < 12);
});

test('a single herd does not set the colour scale for the whole survey', () => {
  const scattered: [number, number][] = [];
  for (let i = 0; i < 20; i++)
    for (let j = 0; j < 20; j++)
      scattered.push([20 + i * 0.05, -25 - j * 0.05]);
  const herd: [number, number][] = Array.from({ length: 200 }, () => [
    20, -25.5,
  ]);
  const withHerd = heatIntensity([...scattered, ...herd], 5);
  const without = heatIntensity(scattered, 5);
  assert.ok(withHerd > without / 2);
});

test('empty input leaves the intensity unscaled', () => {
  assert.equal(heatIntensity([], 5), 1);
});
