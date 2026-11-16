export interface HerdPoint {
  id: string;
  x: number;
  y: number;
}

type Affine = [number, number, number, number, number, number];

interface Solution {
  t: Affine;
  match: Int32Array;
  cost: number;
}

const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];
const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
const MAX_ITERS = 12;
const REFINE_SEEDS = 3;
const LOCAL_ITERS = 4;
const FINAL_ITERS = 3;
// All in units of the herd's median spacing.
const FINE_SIGMA = 2.5;
const GATE = 3;
const CAP = 4;
// Past the cap a pair still costs a little more per pixel, so spare animals pair with the nearest spare.
const CAP_SLOPE = 0.25;
const TRIM = 0.25;
const RIDGE = 1;
// Along/across-track spread ratio beyond which the cost becomes direction-aware.
const ANISO_DEAD = 1.5;
const ANISO_MAX = 4;
const PRUNE = 3;

const dist = (x1: number, y1: number, x2: number, y2: number) =>
  Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));

// Min-cost assignment of rows to distinct columns; a row may stay unmatched at cost `gate` (infinite gate needs n <= m).
export function solveAssignment(
  cost: Float64Array,
  n: number,
  m: number,
  gate = Infinity,
): Int32Array {
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1);
  const way = new Int32Array(m + 1);
  const minv = new Float64Array(m + 1);
  const used = new Uint8Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    used.fill(0);
    let exit = Infinity;
    let exitCol = 0;
    for (;;) {
      used[j0] = 1;
      const i0 = p[j0];
      const leave = gate - u[i0];
      if (leave < exit) {
        exit = leave;
        exitCol = j0;
      }
      const row = (i0 - 1) * m - 1;
      const ui = u[i0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[row + j] - ui - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      const unmatched = exit < delta;
      if (unmatched) delta = exit;
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      exit -= delta;
      if (unmatched) {
        j0 = exitCol;
        break;
      }
      j0 = j1;
      if (p[j0] === 0) break;
    }
    while (j0 !== 0) {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    }
  }
  const rowToCol = new Int32Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

interface Ctx {
  n: number;
  m: number;
  ax: Float64Array;
  ay: Float64Array;
  bx: Float64Array;
  by: Float64Array;
  d2: Float64Array;
  spacing: number;
  extent: number;
}

function medianSpacing(x: Float64Array, y: Float64Array): number {
  const n = x.length;
  if (n < 2) return 1;
  const nearest = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = (x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2;
      if (d < nearest[i]) nearest[i] = d;
      if (d < nearest[j]) nearest[j] = d;
    }
  }
  nearest.sort();
  return Math.max(Math.sqrt(nearest[n >> 1]), 1);
}

function makeCtx(A: HerdPoint[], B: HerdPoint[]): Ctx {
  const n = A.length;
  const ax = Float64Array.from(A, (p) => p.x);
  const ay = Float64Array.from(A, (p) => p.y);
  const bx = Float64Array.from(B, (p) => p.x);
  const by = Float64Array.from(B, (p) => p.y);
  const d2 = new Float64Array(n * n);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < n; s++)
      d2[i * n + s] = (ax[i] - ax[s]) ** 2 + (ay[i] - ay[s]) ** 2;
    x0 = Math.min(x0, ax[i]);
    x1 = Math.max(x1, ax[i]);
    y0 = Math.min(y0, ay[i]);
    y1 = Math.max(y1, ay[i]);
  }
  return {
    n,
    m: B.length,
    ax,
    ay,
    bx,
    by,
    d2,
    spacing: medianSpacing(bx, by),
    extent: Math.hypot(x1 - x0, y1 - y0),
  };
}

// Gaussian neighbour weights; an animal's own pair gets none (leave-one-out).
function weights(c: Ctx, sigma: number): Float64Array {
  const S = c.n;
  const w = new Float64Array(S * S);
  const q = -1 / (2 * sigma * sigma);
  for (let i = 0; i < c.n; i++) {
    const row = i * S;
    for (let s = 0; s < S; s++)
      w[row + s] = s === i ? 0 : Math.exp(q * c.d2[row + s]) + 1e-12;
  }
  return w;
}

function solve3(m: number[], r: number[]): [number, number, number] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-9) return null;
  return [
    (r[0] * (e * i - f * h) -
      b * (r[1] * i - f * r[2]) +
      c * (r[1] * h - e * r[2])) /
      det,
    (a * (r[1] * i - f * r[2]) -
      r[0] * (d * i - f * g) +
      c * (d * r[2] - r[1] * g)) /
      det,
    (a * (e * r[2] - r[1] * h) -
      b * (d * r[2] - r[1] * g) +
      r[0] * (d * h - e * g)) /
      det,
  ];
}

function predict(
  c: Ctx,
  match: Int32Array,
  w: Float64Array,
): { px: Float64Array; py: Float64Array } {
  const n = c.n;
  const S = n;
  const ex = new Float64Array(S);
  const ey = new Float64Array(S);
  const valid: number[] = [];
  for (let s = 0; s < S; s++) {
    const j = match[s];
    if (j < 0) continue;
    ex[s] = c.bx[j] - c.ax[s];
    ey[s] = c.by[j] - c.ay[s];
    valid.push(s);
  }
  const px = Float64Array.from(c.ax);
  const py = Float64Array.from(c.ay);
  const L = valid.length;
  if (L === 0) return { px, py };
  const ordX = Int32Array.from(valid).sort((p, q) => ex[p] - ex[q]);
  const ordY = Int32Array.from(valid).sort((p, q) => ey[p] - ey[q]);
  const trimmed = (
    row: number,
    ord: Int32Array,
    e: Float64Array,
    W: number,
  ) => {
    const lo = TRIM * W;
    const hi = (1 - TRIM) * W;
    let acc = 0;
    let sum = 0;
    for (let q = 0; q < L && acc < hi; q++) {
      const s = ord[q];
      const next = acc + w[row + s];
      const part = Math.min(next, hi) - Math.max(acc, lo);
      if (part > 0) sum += part * e[s];
      acc = next;
    }
    return sum / (hi - lo || 1);
  };
  for (let i = 0; i < n; i++) {
    const row = i * S;
    let W = 0;
    for (let q = 0; q < L; q++) W += w[row + valid[q]];
    px[i] += trimmed(row, ordX, ex, W);
    py[i] += trimmed(row, ordY, ey, W);
  }
  const res = new Float64Array(S);
  const sorted: number[] = [];
  for (let s = 0; s < n; s++) {
    const j = match[s];
    if (j < 0) continue;
    res[s] = dist(c.bx[j], c.by[j], px[s], py[s]);
    sorted.push(res[s]);
  }
  sorted.sort((p, q) => p - q);
  const cut = 3 * 1.4826 * (sorted[sorted.length >> 1] ?? 0) + 1e-9;
  const lam = RIDGE * (FINE_SIGMA * c.spacing) ** 2;
  for (let i = 0; i < n; i++) {
    const row = i * S;
    let W = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0,
      syy = 0;
    const bx = [0, 0, 0];
    const by = [0, 0, 0];
    for (let q = 0; q < L; q++) {
      const s = valid[q];
      const ws = w[row + s];
      if (res[s] > cut || ws < 1e-6) continue;
      const x = c.ax[s] - c.ax[i];
      const y = c.ay[s] - c.ay[i];
      W += ws;
      sx += ws * x;
      sy += ws * y;
      sxx += ws * x * x;
      sxy += ws * x * y;
      syy += ws * y * y;
      bx[0] += ws * ex[s];
      bx[1] += ws * x * ex[s];
      bx[2] += ws * y * ex[s];
      by[0] += ws * ey[s];
      by[1] += ws * x * ey[s];
      by[2] += ws * y * ey[s];
    }
    if (W < 1e-3) continue;
    const M = [W, sx, sy, sx, sxx + lam, sxy, sy, sxy, syy + lam];
    const fx = solve3(M, bx);
    const fy = solve3(M, by);
    if (!fx || !fy) continue;
    px[i] = c.ax[i] + fx[0];
    py[i] = c.ay[i] + fy[0];
  }
  return { px, py };
}

interface Dirs {
  ux: Float64Array;
  uy: Float64Array;
  k: number;
}

// Residual length with along-track offsets shrunk by √k and across-track ones stretched by √k.
function residual(rx: number, ry: number, ux: number, uy: number, k: number) {
  if (k === 1 || (ux === 0 && uy === 0)) return Math.sqrt(rx * rx + ry * ry);
  const al = rx * ux + ry * uy;
  const cr = ry * ux - rx * uy;
  return Math.sqrt((al * al) / k + cr * cr * k);
}

function travelDirs(
  c: Ctx,
  px: Float64Array,
  py: Float64Array,
  aniso: number,
): Dirs | null {
  if (aniso === 1) return null;
  const ux = new Float64Array(c.n);
  const uy = new Float64Array(c.n);
  for (let i = 0; i < c.n; i++) {
    const dx = px[i] - c.ax[i];
    const dy = py[i] - c.ay[i];
    const l = Math.sqrt(dx * dx + dy * dy);
    if (l >= 0.5 * c.spacing) {
      ux[i] = dx / l;
      uy[i] = dy / l;
    }
  }
  return { ux, uy, k: aniso };
}

function assign(
  c: Ctx,
  px: Float64Array,
  py: Float64Array,
  gate: number,
  dirs: Dirs | null = null,
  cap = Infinity,
): Int32Array {
  const { n, m, bx, by } = c;
  const transpose = !Number.isFinite(gate) && n > m;
  const R = transpose ? m : n;
  const C = transpose ? n : m;
  const cost = new Float64Array(R * C);
  for (let i = 0; i < n; i++) {
    const ux = dirs ? dirs.ux[i] : 0;
    const uy = dirs ? dirs.uy[i] : 0;
    const k = dirs ? dirs.k : 1;
    for (let j = 0; j < m; j++) {
      const d = residual(bx[j] - px[i], by[j] - py[i], ux, uy, k);
      cost[transpose ? j * C + i : i * C + j] =
        d > cap ? cap + CAP_SLOPE * (d - cap) : d;
    }
  }
  const rows = solveAssignment(cost, R, C, gate);
  if (!transpose) return rows;
  const match = new Int32Array(n).fill(-1);
  for (let r = 0; r < R; r++) if (rows[r] >= 0) match[rows[r]] = r;
  return match;
}

function sameMatch(a: Int32Array, b: Int32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function spreadRatio(
  c: Ctx,
  match: Int32Array,
  px: Float64Array,
  py: Float64Array,
): number {
  const al: number[] = [];
  const cr: number[] = [];
  for (let i = 0; i < c.n; i++) {
    const j = match[i];
    if (j < 0) continue;
    const dx = px[i] - c.ax[i];
    const dy = py[i] - c.ay[i];
    const l = Math.hypot(dx, dy);
    if (l < 0.5 * c.spacing) continue;
    const rx = c.bx[j] - px[i];
    const ry = c.by[j] - py[i];
    al.push(Math.abs(rx * dx + ry * dy) / l);
    cr.push(Math.abs(ry * dx - rx * dy) / l);
  }
  if (al.length < 20) return 1;
  al.sort((p, q) => p - q);
  cr.sort((p, q) => p - q);
  return (al[al.length >> 1] + 1) / (cr[cr.length >> 1] + 1);
}

function localRefine(
  c: Ctx,
  start: Int32Array,
  seen: Int32Array[][],
): { match: Int32Array; score: number; uncertain: Uint8Array } | null {
  const finest = FINE_SIGMA * c.spacing;
  const gate = GATE * c.spacing;
  const cap = CAP * c.spacing;
  let match = start;
  let w = weights(c, finest);
  let level = 0;
  for (
    let sigma = Math.max(c.extent / 2, finest);
    ;
    sigma = Math.max(sigma * 0.6, finest)
  ) {
    w = weights(c, sigma);
    for (let it = 0; it < LOCAL_ITERS; it++) {
      const { px, py } = predict(c, match, w);
      const next = assign(c, px, py, sigma === finest ? gate : Infinity);
      const done = sameMatch(next, match);
      match = next;
      if (done) break;
    }
    // Same pairing as an earlier start at this scale: the rest would repeat it.
    const at = (seen[level++] ??= []);
    if (at.some((m) => sameMatch(m, match))) return null;
    at.push(match);
    if (sigma === finest) break;
  }
  // The gate only shields the motion estimate; the final pairing links everyone it can.
  const finish = (from: Int32Array, aniso: number) => {
    let cur = from;
    for (let it = 0; it <= FINAL_ITERS; it++) {
      const { px, py } = predict(c, cur, w);
      const next = assign(
        c,
        px,
        py,
        Infinity,
        travelDirs(c, px, py, aniso),
        cap,
      );
      const done = it > 0 && sameMatch(next, cur);
      cur = next;
      if (done) break;
    }
    return cur;
  };
  let final = finish(match, 1);
  let aniso = 1;
  let { px, py } = predict(c, final, w);
  const ratio = spreadRatio(c, final, px, py);
  if (Math.abs(Math.log(ratio)) > Math.log(ANISO_DEAD)) {
    aniso = Math.min(ANISO_MAX, Math.max(1 / ANISO_MAX, ratio * ratio));
    let cur = final;
    for (let it = 0; it < LOCAL_ITERS; it++) {
      const p = predict(c, cur, w);
      const next = assign(
        c,
        p.px,
        p.py,
        gate,
        travelDirs(c, p.px, p.py, aniso),
      );
      const done = sameMatch(next, cur);
      cur = next;
      if (done) break;
    }
    final = finish(cur, aniso);
    ({ px, py } = predict(c, final, w));
  }
  const dirs = travelDirs(c, px, py, aniso);
  let score = 0;
  const uncertain = new Uint8Array(c.n);
  for (let i = 0; i < c.n; i++) {
    const j = final[i];
    if (j < 0) continue;
    const r = residual(
      c.bx[j] - px[i],
      c.by[j] - py[i],
      dirs ? dirs.ux[i] : 0,
      dirs ? dirs.uy[i] : 0,
      aniso,
    );
    score += Math.min(r, cap);
    if (r > cap) uncertain[i] = 1;
  }
  return { match: final, score, uncertain };
}

function applyT(t: Affine, x: number, y: number): [number, number] {
  return [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]];
}

function similarityAbout(
  from: [number, number],
  to: [number, number],
  scale: number,
  angle: number,
): Affine {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
  const co = s * Math.cos(angle);
  const si = s * Math.sin(angle);
  return [
    co,
    -si,
    to[0] - co * from[0] + si * from[1],
    si,
    co,
    to[1] - si * from[0] - co * from[1],
  ];
}

function translation(dx: number, dy: number): Affine {
  return [1, 0, dx, 0, 1, dy];
}

interface Corr {
  sx: number[];
  sy: number[];
  dx: number[];
  dy: number[];
  w: number[];
}

function fitSimilarity(q: Corr): Affine {
  const L = q.w.length;
  let W = 0,
    csx = 0,
    csy = 0,
    cdx = 0,
    cdy = 0;
  for (let i = 0; i < L; i++) {
    W += q.w[i];
    csx += q.w[i] * q.sx[i];
    csy += q.w[i] * q.sy[i];
    cdx += q.w[i] * q.dx[i];
    cdy += q.w[i] * q.dy[i];
  }
  csx /= W;
  csy /= W;
  cdx /= W;
  cdy /= W;
  let a = 0,
    b = 0,
    nn = 0;
  for (let i = 0; i < L; i++) {
    const x = q.sx[i] - csx;
    const y = q.sy[i] - csy;
    const u = q.dx[i] - cdx;
    const v = q.dy[i] - cdy;
    a += q.w[i] * (x * u + y * v);
    b += q.w[i] * (x * v - y * u);
    nn += q.w[i] * (x * x + y * y);
  }
  if (nn < 1e-9) return translation(cdx - csx, cdy - csy);
  return similarityAbout(
    [csx, csy],
    [cdx, cdy],
    Math.hypot(a, b) / nn,
    Math.atan2(b, a),
  );
}

function fitAffine(q: Corr): Affine | null {
  const L = q.w.length;
  if (L < 3) return null;
  // Centre first so the normal equations stay well conditioned at image-pixel magnitudes.
  let cx = 0,
    cy = 0;
  for (let i = 0; i < L; i++) {
    cx += q.sx[i];
    cy += q.sy[i];
  }
  cx /= L;
  cy /= L;
  let sxx = 0,
    sxy = 0,
    syy = 0,
    sx = 0,
    sy = 0,
    W = 0;
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (let i = 0; i < L; i++) {
    const x = q.sx[i] - cx;
    const y = q.sy[i] - cy;
    const k = q.w[i];
    sxx += k * x * x;
    sxy += k * x * y;
    syy += k * y * y;
    sx += k * x;
    sy += k * y;
    W += k;
    bx[0] += k * x * q.dx[i];
    bx[1] += k * y * q.dx[i];
    bx[2] += k * q.dx[i];
    by[0] += k * x * q.dy[i];
    by[1] += k * y * q.dy[i];
    by[2] += k * q.dy[i];
  }
  const M = [sxx, sxy, sx, sxy, syy, sy, sx, sy, W];
  const p = solve3(M, bx);
  const r = solve3(M, by);
  if (!p || !r) return null;
  const t: Affine = [
    p[0],
    p[1],
    p[2] - p[0] * cx - p[1] * cy,
    r[0],
    r[1],
    r[2] - r[0] * cx - r[1] * cy,
  ];
  const det = t[0] * t[4] - t[1] * t[3];
  if (det < MIN_SCALE * MIN_SCALE || det > MAX_SCALE * MAX_SCALE) return null;
  return t;
}

function outlierCutoff(residuals: number[]): number {
  const sorted = [...residuals].sort((x, y) => x - y);
  return Math.max(3 * (sorted[sorted.length >> 1] ?? 0), 1);
}

function fitTrimmed(
  c: Ctx,
  target: Int32Array,
  residuals: number[],
  affine: boolean,
): Affine | null {
  const cutoff = outlierCutoff(residuals.filter((r) => r >= 0));
  const q: Corr = { sx: [], sy: [], dx: [], dy: [], w: [] };
  for (let i = 0; i < c.n; i++) {
    const j = target[i];
    if (j < 0 || residuals[i] > cutoff) continue;
    q.sx.push(c.ax[i]);
    q.sy.push(c.ay[i]);
    q.dx.push(c.bx[j]);
    q.dy.push(c.by[j]);
    q.w.push(1);
  }
  if (q.w.length === 0) return null;
  return affine ? fitAffine(q) : fitSimilarity(q);
}

function sameTransform(a: Affine, b: Affine): boolean {
  for (let i = 0; i < 6; i++) {
    const tol = i === 2 || i === 5 ? 0.01 : 1e-6;
    if (Math.abs(a[i] - b[i]) > tol) return false;
  }
  return true;
}

function nearlySame(c: Ctx, a: Affine, b: Affine): boolean {
  for (let i = 0; i < c.n; i += Math.max(1, c.n >> 4)) {
    const [x1, y1] = applyT(a, c.ax[i], c.ay[i]);
    const [x2, y2] = applyT(b, c.ax[i], c.ay[i]);
    if (dist(x1, y1, x2, y2) > 0.25 * c.spacing) return false;
  }
  return true;
}

function project(c: Ctx, t: Affine): { px: Float64Array; py: Float64Array } {
  const px = new Float64Array(c.n);
  const py = new Float64Array(c.n);
  for (let i = 0; i < c.n; i++) {
    px[i] = t[0] * c.ax[i] + t[1] * c.ay[i] + t[2];
    py[i] = t[3] * c.ax[i] + t[4] * c.ay[i] + t[5];
  }
  return { px, py };
}

function assignUnder(c: Ctx, t: Affine): Solution {
  const { px, py } = project(c, t);
  const match = assign(c, px, py, Infinity);
  let cost = 0;
  for (let i = 0; i < c.n; i++) {
    const j = match[i];
    if (j >= 0) cost += dist(px[i], py[i], c.bx[j], c.by[j]);
  }
  return { t, match, cost };
}

function nearestNeighbourIcp(c: Ctx, t0: Affine): Affine {
  let t = t0;
  const target = new Int32Array(c.n);
  const res: number[] = new Array(c.n);
  for (let it = 0; it < MAX_ITERS; it++) {
    const { px, py } = project(c, t);
    for (let i = 0; i < c.n; i++) {
      let best = -1;
      let bestD = Infinity;
      for (let j = 0; j < c.m; j++) {
        const d = (px[i] - c.bx[j]) ** 2 + (py[i] - c.by[j]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      target[i] = best;
      res[i] = Math.sqrt(bestD);
    }
    const next = fitTrimmed(c, target, res, false) ?? t;
    if (sameTransform(next, t)) return next;
    t = next;
  }
  return t;
}

function assignmentIcp(c: Ctx, t0: Affine, affine: boolean): Solution {
  let best = assignUnder(c, t0);
  let current = best;
  for (let it = 0; it < MAX_ITERS; it++) {
    const { px, py } = project(c, current.t);
    const res: number[] = [];
    for (let i = 0; i < c.n; i++) {
      const j = current.match[i];
      res.push(j < 0 ? -1 : dist(px[i], py[i], c.bx[j], c.by[j]));
    }
    const t = fitTrimmed(c, current.match, res, affine);
    if (!t) break;
    const next = assignUnder(c, t);
    if (next.cost < best.cost) best = next;
    if (sameMatch(next.match, current.match)) break;
    current = next;
  }
  return best;
}

function principalAxis(
  x: Float64Array,
  y: Float64Array,
  cx: number,
  cy: number,
) {
  let xx = 0,
    xy = 0,
    yy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - cx;
    const dy = y[i] - cy;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const tr = xx + yy;
  const disc = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
  const l1 = tr / 2 + disc;
  const l2 = Math.max(tr / 2 - disc, 1e-9);
  return {
    angle: 0.5 * Math.atan2(2 * xy, xx - yy),
    elongation: Math.sqrt(l1 / l2),
    spread: Math.sqrt(tr / x.length),
  };
}

const mean = (v: Float64Array) => v.reduce((s, x) => s + x, 0) / v.length;

function seedTransforms(c: Ctx): Affine[] {
  const ca: [number, number] = [mean(c.ax), mean(c.ay)];
  const cb: [number, number] = [mean(c.bx), mean(c.by)];
  const pa = principalAxis(c.ax, c.ay, ca[0], ca[1]);
  const pb = principalAxis(c.bx, c.by, cb[0], cb[1]);
  const scale = pa.spread > 0 ? pb.spread / pa.spread : 1;
  const seeds: Affine[] = [
    IDENTITY,
    translation(cb[0] - ca[0], cb[1] - ca[1]),
    similarityAbout(ca, cb, scale, 0),
  ];
  if (pa.elongation > 1.5 && pb.elongation > 1.5) {
    const d = pb.angle - pa.angle;
    seeds.push(
      similarityAbout(ca, cb, scale, d),
      similarityAbout(ca, cb, scale, d + Math.PI),
    );
  }
  // Align the herd's leading/trailing edges: robust when one lasso holds only part of the herd.
  const arg = (v: Float64Array, sign: number) => {
    let best = 0;
    for (let i = 1; i < v.length; i++)
      if (sign * v[i] > sign * v[best]) best = i;
    return best;
  };
  for (const sign of [1, -1]) {
    for (const [a, b] of [
      [c.ax, c.bx],
      [c.ay, c.by],
    ]) {
      const ia = arg(a, sign);
      const ib = arg(b, sign);
      seeds.push(translation(c.bx[ib] - c.ax[ia], c.by[ib] - c.ay[ia]));
    }
  }
  return seeds;
}

function globalStarts(c: Ctx): Solution[] {
  const transforms: Affine[] = [];
  for (const seed of seedTransforms(c)) {
    const t = nearestNeighbourIcp(c, seed);
    if (!transforms.some((p) => nearlySame(c, p, t))) transforms.push(t);
  }
  const screened = transforms
    .map((t) => assignUnder(c, t))
    .sort((x, y) => x.cost - y.cost);
  // A start several times worse than the best is a different herd-wide guess that refining cannot rescue.
  const limit = PRUNE * screened[0].cost;
  const picked: Solution[] = [];
  for (const s of screened) {
    if (picked.length >= REFINE_SEEDS || s.cost > limit) break;
    if (!picked.some((p) => sameMatch(p.match, s.match))) picked.push(s);
  }
  const starts = picked.map((s) => assignmentIcp(c, s.t, false));
  const bestRigid = starts.reduce((a, b) => (b.cost < a.cost ? b : a));
  starts.push(assignmentIcp(c, bestRigid.t, true));
  return starts.filter(
    (s, i) => !starts.slice(0, i).some((p) => sameMatch(p.match, s.match)),
  );
}

// Links min(|A|, |B|); uncertain = far beyond its predicted motion. A must be in B's frame.
export function matchHerd(
  A: HerdPoint[],
  B: HerdPoint[],
): Array<[string, string, boolean]> {
  if (A.length === 0 || B.length === 0) return [];
  const c = makeCtx(A, B);
  const seen: Int32Array[][] = [];
  let best: ReturnType<typeof localRefine> = null;
  for (const start of globalStarts(c)) {
    const r = localRefine(c, start.match, seen);
    if (r && (!best || r.score < best.score)) best = r;
  }
  const pairs: Array<[string, string, boolean]> = [];
  best?.match.forEach((j, i) => {
    if (j >= 0) pairs.push([A[i].id, B[j].id, best!.uncertain[i] === 1]);
  });
  return pairs;
}
