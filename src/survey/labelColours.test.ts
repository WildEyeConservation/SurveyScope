import assert from 'node:assert/strict';
import test from 'node:test';
import { lookAlikeGroup } from './labelCatalog';
import {
  colourDistance,
  hexToOklab,
  isUnsetColour,
  suggestLabelColour,
  suggestLabelColours,
} from './labelColours';

const fill = (names: string[]) =>
  suggestLabelColours(names.map((name) => ({ name, color: '' })));

function minDistance(colours: string[]): number {
  let min = Infinity;
  for (let i = 0; i < colours.length; i++)
    for (let j = i + 1; j < colours.length; j++)
      min = Math.min(min, colourDistance(colours[i], colours[j]));
  return min;
}

test('suggestions are valid colour-input hex values', () => {
  for (const colour of fill(['Elephant', 'Lion', 'Zebra']))
    assert.match(colour, /^#[0-9a-f]{6}$/);
});

test('50 labels get unique, well separated colours', () => {
  const colours = fill(Array.from({ length: 50 }, (_, i) => `Label ${i}`));
  assert.equal(new Set(colours).size, 50);
  assert.ok(minDistance(colours) >= 0.04, `${minDistance(colours)}`);
});

test('a few labels are far apart', () => {
  const colours = fill(['Elephant', 'Giraffe', 'Lion', 'Zebra', 'Kudu']);
  assert.ok(minDistance(colours) >= 0.15, `${minDistance(colours)}`);
});

test('colours stay readable on dark UI and bush imagery', () => {
  const colours = fill(Array.from({ length: 50 }, (_, i) => `Label ${i}`));
  for (const colour of colours) {
    const [L, a, b] = hexToOklab(colour)!;
    assert.ok(L >= 0.6 && L <= 0.95, `${colour} lightness ${L}`);
    assert.ok(Math.hypot(a, b) >= 0.1, `${colour} is too grey`);
  }
});

test('the first few colours avoid vegetation greens', () => {
  for (const colour of fill(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])) {
    const [, a, b] = hexToOklab(colour)!;
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    assert.ok(hue < 95 || hue > 175, `${colour} hue ${hue}`);
  }
});

test('look-alike species are pushed further apart than unrelated ones', () => {
  const names = [
    'Springbok',
    'Steenbok',
    'Duiker',
    'Oribi',
    'Impala',
    'Lion',
    'Elephant',
    'Ostrich',
    'Warthog',
    'Zebra',
  ];
  const colours = fill(names);
  const antelope = colours.filter(
    (_, i) => lookAlikeGroup(names[i]) === 'smallAntelope',
  );
  assert.ok(minDistance(antelope) >= 0.15, `${minDistance(antelope)}`);
  assert.ok(colourDistance(colours[0], colours[1]) >= 0.15);
});

test('a look-alike gets a colour far from its group', () => {
  const existing = [
    { name: 'Springbok', color: '#7cf3ff' },
    { name: 'Elephant', color: '#eb34cd' },
  ];
  const steenbok = suggestLabelColour('Steenbok', existing);
  const unrelated = suggestLabelColour('Vehicle', existing);
  assert.ok(
    colourDistance(steenbok, '#7cf3ff') > colourDistance(unrelated, '#7cf3ff'),
  );
});

test('never reuses a colour already in the survey', () => {
  const existing = fill(Array.from({ length: 30 }, (_, i) => `L${i}`)).map(
    (color, i) => ({ name: `L${i}`, color }),
  );
  const next = suggestLabelColour('New', existing);
  assert.ok(!existing.some((e) => e.color === next));
});

test('only unset colours are filled', () => {
  const colours = suggestLabelColours([
    { name: 'Elephant', color: '#123456' },
    { name: 'Lion', color: '#000000' },
    { name: 'Zebra', color: '' },
  ]);
  assert.equal(colours[0], '#123456');
  assert.ok(!isUnsetColour(colours[1]));
  assert.ok(!isUnsetColour(colours[2]));
});

test('group lookup is case and punctuation insensitive', () => {
  assert.equal(lookAlikeGroup('STEEN-BOK'), 'smallAntelope');
  assert.equal(lookAlikeGroup('Elephant carcass'), 'carcass');
  assert.equal(lookAlikeGroup('Bird nest'), 'nest');
  assert.equal(lookAlikeGroup('Caracal'), 'carnivore');
  assert.equal(lookAlikeGroup('Bat-eared fox'), 'carnivore');
});
