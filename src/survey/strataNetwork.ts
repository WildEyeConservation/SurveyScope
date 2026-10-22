export type LatLng = [number, number];

// Lines that divide the boundary; edges join node indices.
export type StrataNetwork = { nodes: LatLng[]; edges: [number, number][] };

export const EMPTY_NETWORK: StrataNetwork = { nodes: [], edges: [] };

type XY = [number, number];

const MERGE_M = 0.5;

function projector(ring: LatLng[]) {
  const lat0 = ring.reduce((sum, [lat]) => sum + lat, 0) / ring.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  return {
    project: ([lat, lng]: LatLng): XY => [lng * kx, lat * ky],
    unproject: ([x, y]: XY): LatLng => [y / ky, x / kx],
  };
}

function openRing(ring: LatLng[]): LatLng[] {
  const out = [...ring];
  if (out.length > 1) {
    const [a, b] = [out[0], out[out.length - 1]];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  return out;
}

function inside([x, y]: XY, ring: XY[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      result = !result;
    }
  }
  return result;
}

function signedArea(ring: XY[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

// Parameter along a-b of the point nearest p, clamped to the segment.
function closestT(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  return Math.max(0, Math.min(1, t));
}

const lerp = (a: XY, b: XY, t: number): XY => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Split parameters where segment pq meets segment ab, touching ends included.
function crossings(p: XY, q: XY, a: XY, b: XY): [number, number][] {
  const r: XY = [q[0] - p[0], q[1] - p[1]];
  const s: XY = [b[0] - a[0], b[1] - a[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  const out: [number, number][] = [];
  if (Math.abs(denom) > 1e-12) {
    const t = ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / denom;
    const u = ((a[0] - p[0]) * r[1] - (a[1] - p[1]) * r[0]) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push([t, u]);
  }
  for (const [point, onPQ] of [
    [a, true],
    [b, true],
    [p, false],
    [q, false],
  ] as const) {
    if (onPQ) {
      const t = closestT(point, p, q);
      if (dist(lerp(p, q, t), point) <= MERGE_M) {
        out.push([t, point === a ? 0 : 1]);
      }
    } else {
      const u = closestT(point, a, b);
      if (dist(lerp(a, b, u), point) <= MERGE_M) {
        out.push([point === p ? 0 : 1, u]);
      }
    }
  }
  return out;
}

export type StrataLayout = {
  sections: LatLng[][];
  // Some lines do not close off an area.
  dangling: boolean;
};

// The areas the network divides the boundary into, north to south.
export function strataSections(
  boundary: LatLng[] | null,
  network: StrataNetwork
): StrataLayout {
  const ringLatLng = boundary ? openRing(boundary) : [];
  if (ringLatLng.length < 3) return { sections: [], dangling: false };
  const { project, unproject } = projector(ringLatLng);
  const ring = ringLatLng.map(project);
  const nodes = network.nodes.map(project);

  const segments: { a: XY; b: XY; boundary: boolean; ts: number[] }[] = [
    ...ring.map((a, i) => ({
      a,
      b: ring[(i + 1) % ring.length],
      boundary: true,
      ts: [0, 1],
    })),
    ...network.edges
      .filter(([i, j]) => nodes[i] && nodes[j] && i !== j)
      .map(([i, j]) => ({
        a: nodes[i],
        b: nodes[j],
        boundary: false,
        ts: [0, 1],
      })),
  ];
  for (let i = ring.length; i < segments.length; i++) {
    const line = segments[i];
    for (let j = 0; j < segments.length; j++) {
      if (j >= ring.length && j <= i) continue;
      const other = segments[j];
      for (const [t, u] of crossings(line.a, line.b, other.a, other.b)) {
        line.ts.push(t);
        other.ts.push(u);
      }
    }
  }

  const vertices: XY[] = [];
  const vertexAt = (p: XY) => {
    const found = vertices.findIndex((v) => dist(v, p) <= MERGE_M);
    if (found !== -1) return found;
    vertices.push(p);
    return vertices.length - 1;
  };
  const edgeKeys = new Set<string>();
  const edges: { u: number; v: number; boundary: boolean }[] = [];
  for (const segment of segments) {
    const ts = [...new Set(segment.ts)].sort((x, y) => x - y);
    let prev = vertexAt(lerp(segment.a, segment.b, ts[0]));
    for (const t of ts.slice(1)) {
      const next = vertexAt(lerp(segment.a, segment.b, t));
      const key = prev < next ? `${prev},${next}` : `${next},${prev}`;
      if (next !== prev && !edgeKeys.has(key)) {
        const mid = lerp(vertices[prev], vertices[next], 0.5);
        if (segment.boundary || inside(mid, ring)) {
          edgeKeys.add(key);
          edges.push({ u: prev, v: next, boundary: segment.boundary });
        }
      }
      prev = next;
    }
  }

  const adjacency = vertices.map(() => new Set<number>());
  for (const { u, v } of edges) {
    adjacency[u].add(v);
    adjacency[v].add(u);
  }
  const lineEdges = edges.filter((e) => !e.boundary).length;
  const leaves = adjacency.flatMap((n, i) => (n.size === 1 ? [i] : []));
  while (leaves.length) {
    const v = leaves.pop()!;
    for (const w of adjacency[v]) {
      adjacency[w].delete(v);
      if (adjacency[w].size === 1) leaves.push(w);
    }
    adjacency[v].clear();
  }

  // Lines that only touch each other, not the boundary, are left out.
  const reached = new Set<number>();
  const start = edges.find((e) => e.boundary)?.u;
  const queue = start === undefined ? [] : [start];
  while (queue.length) {
    const v = queue.pop()!;
    if (reached.has(v)) continue;
    reached.add(v);
    queue.push(...adjacency[v]);
  }
  const kept = edges.filter(
    ({ u, v }) => reached.has(u) && adjacency[u].has(v)
  );
  const dangling = kept.filter((e) => !e.boundary).length < lineEdges;

  const sorted = vertices.map((origin, i) =>
    [...adjacency[i]].sort(
      (x, y) =>
        Math.atan2(vertices[x][1] - origin[1], vertices[x][0] - origin[0]) -
        Math.atan2(vertices[y][1] - origin[1], vertices[y][0] - origin[0])
    )
  );
  const visited = new Set<string>();
  const faces: XY[][] = [];
  for (const { u, v } of kept) {
    for (const [a, b] of [
      [u, v],
      [v, u],
    ]) {
      if (visited.has(`${a},${b}`)) continue;
      const face: XY[] = [];
      let [from, to] = [a, b];
      while (!visited.has(`${from},${to}`)) {
        visited.add(`${from},${to}`);
        face.push(vertices[from]);
        const around = sorted[to];
        const next =
          around[(around.indexOf(from) - 1 + around.length) % around.length];
        [from, to] = [to, next];
      }
      if (face.length >= 3) faces.push(face);
    }
  }
  const outer = faces.reduce(
    (best, face, i) =>
      Math.abs(signedArea(face)) > Math.abs(signedArea(faces[best])) ? i : best,
    0
  );
  const sections = faces
    .filter((_, i) => i !== outer)
    .map((face) => {
      const [sx, sy] = face.reduce(([x, y], p) => [x + p[0], y + p[1]], [0, 0]);
      return { face, cx: sx / face.length, cy: sy / face.length };
    })
    .sort((p, q) => q.cy - p.cy || p.cx - q.cx)
    .map(({ face }) => face.map(unproject));
  return { sections, dangling };
}

export type NetworkTarget =
  | { kind: 'node'; index: number }
  | { kind: 'edge'; edge: number; point: LatLng }
  | { kind: 'point'; point: LatLng };

function place(
  network: StrataNetwork,
  target: NetworkTarget
): { network: StrataNetwork; index: number } {
  if (target.kind === 'node') return { network, index: target.index };
  const index = network.nodes.length;
  const nodes = [...network.nodes, target.point];
  if (target.kind === 'point') return { network: { ...network, nodes }, index };
  const [a, b] = network.edges[target.edge];
  const edges = network.edges.map((edge, i) =>
    i === target.edge ? ([a, index] as [number, number]) : edge
  );
  edges.push([index, b]);
  return { network: { nodes, edges }, index };
}

export function connect(
  network: StrataNetwork,
  from: NetworkTarget,
  to: NetworkTarget
): { network: StrataNetwork; end: number } {
  const start = place(network, from);
  // Both ends on one edge: the second is joined by position instead.
  const target =
    from.kind === 'edge' && to.kind === 'edge' && from.edge === to.edge
      ? { kind: 'point' as const, point: to.point }
      : to;
  const end = place(start.network, target);
  const [a, b] = [start.index, end.index];
  const exists = end.network.edges.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a)
  );
  if (a === b || exists) return { network: end.network, end: b };
  return {
    network: { ...end.network, edges: [...end.network.edges, [a, b]] },
    end: b,
  };
}

function prune(network: StrataNetwork): StrataNetwork {
  const used = new Set(network.edges.flat());
  const remap = new Map<number, number>();
  const nodes: LatLng[] = [];
  network.nodes.forEach((node, i) => {
    if (!used.has(i)) return;
    remap.set(i, nodes.length);
    nodes.push(node);
  });
  return {
    nodes,
    edges: network.edges.map(
      ([a, b]) => [remap.get(a)!, remap.get(b)!] as [number, number]
    ),
  };
}

export function removeNode(
  network: StrataNetwork,
  index: number
): StrataNetwork {
  return prune({
    ...network,
    edges: network.edges.filter(([a, b]) => a !== index && b !== index),
  });
}

export function removeEdge(
  network: StrataNetwork,
  edge: number
): StrataNetwork {
  return prune({
    ...network,
    edges: network.edges.filter((_, i) => i !== edge),
  });
}

export function moveNode(
  network: StrataNetwork,
  index: number,
  point: LatLng
): StrataNetwork {
  return {
    ...network,
    nodes: network.nodes.map((node, i) => (i === index ? point : node)),
  };
}
