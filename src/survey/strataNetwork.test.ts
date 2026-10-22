import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  connect,
  EMPTY_NETWORK,
  removeEdge,
  removeNode,
  strataSections,
  type LatLng,
} from './strataNetwork';

const square: LatLng[] = [
  [0, 0],
  [0, 0.01],
  [0.01, 0.01],
  [0.01, 0],
];

test('without lines the boundary is one stratum', () => {
  const { sections, dangling } = strataSections(square, {
    nodes: [],
    edges: [],
  });
  assert.equal(sections.length, 1);
  assert.equal(dangling, false);
});

test('a line across the boundary splits it in two, north first', () => {
  const { sections } = strataSections(square, {
    nodes: [
      [0.005, -0.001],
      [0.005, 0.011],
    ],
    edges: [[0, 1]],
  });
  assert.equal(sections.length, 2);
  assert.ok(sections[0].every(([lat]) => lat >= 0.005 - 1e-9));
});

test('branching lines that end on the boundary make four areas', () => {
  // Two junctions joined across the middle, each with a leg to the top
  // and the bottom edge.
  const { sections, dangling } = strataSections(square, {
    nodes: [
      [0.006, 0.003],
      [0.006, 0.007],
      [0.01, 0.002],
      [0, 0.004],
      [0.01, 0.008],
      [0, 0.0075],
    ],
    edges: [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 4],
      [1, 5],
    ],
  });
  assert.equal(sections.length, 4);
  assert.equal(dangling, false);
});

test('a line ending short of the boundary splits nothing', () => {
  const { sections, dangling } = strataSections(square, {
    nodes: [
      [0.005, -0.001],
      [0.005, 0.005],
    ],
    edges: [[0, 1]],
  });
  assert.equal(sections.length, 1);
  assert.equal(dangling, true);
});

test('a line can end on another line', () => {
  const { sections } = strataSections(square, {
    nodes: [
      [0.005, 0],
      [0.005, 0.01],
      [0.005, 0.005],
      [0.01, 0.005],
    ],
    edges: [
      [0, 1],
      [2, 3],
    ],
  });
  assert.equal(sections.length, 3);
});

test('a line started on another line splits it at a shared junction', () => {
  const across = connect(
    EMPTY_NETWORK,
    { kind: 'point', point: [0.005, -0.001] },
    { kind: 'point', point: [0.005, 0.011] }
  ).network;
  const { network, end } = connect(
    across,
    { kind: 'edge', edge: 0, point: [0.005, 0.005] },
    { kind: 'point', point: [0.011, 0.005] }
  );
  assert.equal(network.nodes.length, 4);
  assert.equal(network.edges.length, 3);
  assert.equal(end, 3);
  assert.equal(strataSections(square, network).sections.length, 3);
  const junction = 2;
  const after = removeNode(network, junction);
  assert.deepEqual(after, { nodes: [], edges: [] });
});

test('removing an edge drops nodes left without edges', () => {
  const { network } = connect(
    EMPTY_NETWORK,
    { kind: 'point', point: [0, 0] },
    { kind: 'point', point: [1, 1] }
  );
  assert.deepEqual(removeEdge(network, 0), EMPTY_NETWORK);
});
