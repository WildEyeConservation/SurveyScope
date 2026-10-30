import type { ImageNeighbourType } from '../../schemaTypes';
import type { PixelTransform } from '../types';
import { buildNeighbourTransforms } from './transforms';

/**
 * A pixel transform that maps source-image coordinates to a far-away target
 * image's coordinates via a composed chain of homographies through the
 * undirected neighbour graph.
 *
 * `hops` is the BFS distance from the source: 1 = direct neighbour, 2 =
 * neighbour-of-neighbour, etc. The reunion-search pass only uses hops >= 2 —
 * the regular Munkres pair already handles direct neighbours.
 */
export interface ChainedTransform {
  hops: number;
  /** source pixel coordinate → target pixel coordinate. */
  forward: PixelTransform;
  /** target pixel coordinate → source pixel coordinate. */
  backward: PixelTransform;
}

interface DirectedEdge {
  to: string;
  /** from-node pixel → to-node pixel. */
  forward: PixelTransform;
  /** to-node pixel → from-node pixel. */
  backward: PixelTransform;
}

export type NeighbourAdjacency = Map<string, DirectedEdge[]>;

/**
 * Build a directed adjacency list from the (undirected) raw neighbour rows.
 * Skipped or missing-homography rows are excluded — they have no usable
 * transform. Each undirected edge becomes two directed edges so BFS can
 * traverse either way; the `backward` field of each directed edge is the
 * inverse direction's homography.
 *
 * Expensive ish (mathjs matrix inversion per edge) so callers doing many BFS
 * walks should build the adjacency once and pass it to
 * `buildChainedTransformsFromAdj` for every source.
 */
export function buildAdjacency(
  rawNeighbours: ImageNeighbourType[],
): NeighbourAdjacency {
  const adj: NeighbourAdjacency = new Map();
  const push = (from: string, edge: DirectedEdge) => {
    let arr = adj.get(from);
    if (!arr) {
      arr = [];
      adj.set(from, arr);
    }
    arr.push(edge);
  };
  for (const n of rawNeighbours) {
    if ((n as { skipped?: boolean | null }).skipped) continue;
    const tfs = buildNeighbourTransforms(n);
    if (tfs.noHomography) continue;
    // image1 → image2 uses the raw homography (forward).
    push(n.image1Id, {
      to: n.image2Id,
      forward: tfs.forward,
      backward: tfs.backward,
    });
    // image2 → image1 uses the inverse (which is the raw homography's backward).
    push(n.image2Id, {
      to: n.image1Id,
      forward: tfs.backward,
      backward: tfs.forward,
    });
  }
  return adj;
}

/**
 * BFS from `sourceImageId` through `adj` up to `maxHops`, returning the
 * composed transform from source pixel space to every reachable image's
 * pixel space.
 *
 * BFS guarantees the shortest hop count wins on every revisit; we never
 * revisit a node, so each reachable image gets one composed transform
 * along its shortest path. The source itself is excluded from the result.
 */
export function buildChainedTransformsFromAdj(
  sourceImageId: string,
  adj: NeighbourAdjacency,
  maxHops: number,
): Map<string, ChainedTransform> {
  const out = new Map<string, ChainedTransform>();
  const identity: PixelTransform = (c) => [c[0], c[1]];

  interface QueueEntry {
    imageId: string;
    hops: number;
    forward: PixelTransform;
    backward: PixelTransform;
  }
  const queue: QueueEntry[] = [
    {
      imageId: sourceImageId,
      hops: 0,
      forward: identity,
      backward: identity,
    },
  ];
  // Head-index dequeue — avoids O(n) Array.shift on large graphs.
  let head = 0;
  const visited = new Set<string>([sourceImageId]);

  while (head < queue.length) {
    const node = queue[head++];
    if (node.hops >= maxHops) continue;
    const edges = adj.get(node.imageId);
    if (!edges) continue;
    for (const e of edges) {
      if (visited.has(e.to)) continue;
      visited.add(e.to);
      // Capture the parent's transforms in the closure so each composed
      // function stays referenced to its own path.
      const parentForward = node.forward;
      const parentBackward = node.backward;
      const composedForward: PixelTransform = (c) =>
        e.forward(parentForward(c));
      const composedBackward: PixelTransform = (c) =>
        parentBackward(e.backward(c));
      const next: QueueEntry = {
        imageId: e.to,
        hops: node.hops + 1,
        forward: composedForward,
        backward: composedBackward,
      };
      out.set(e.to, {
        hops: next.hops,
        forward: next.forward,
        backward: next.backward,
      });
      queue.push(next);
    }
  }
  return out;
}

/**
 * One-shot convenience: build the adjacency and run BFS in a single call.
 * Use this when you have a single source to query; for many sources, call
 * `buildAdjacency` once and reuse via `buildChainedTransformsFromAdj`.
 */
export function buildChainedTransforms(
  sourceImageId: string,
  rawNeighbours: ImageNeighbourType[],
  maxHops: number,
): Map<string, ChainedTransform> {
  const adj = buildAdjacency(rawNeighbours);
  return buildChainedTransformsFromAdj(sourceImageId, adj, maxHops);
}
