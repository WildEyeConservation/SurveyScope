import { compareByCommonness, lookAlikeness } from './labelCatalog';

type Lab = [number, number, number];

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLinear = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

export function hexToOklab(hex: string): Lab | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    toLinear(v / 255),
  );
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s,
  ];
}

function oklabToLinearRgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: number[]) =>
  rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

function oklchToLab(L: number, C: number, hDeg: number): Lab {
  const h = (hDeg * Math.PI) / 180;
  return [L, C * Math.cos(h), C * Math.sin(h)];
}

function labToHex(lab: Lab): string {
  return `#${oklabToLinearRgb(lab)
    .map((c) =>
      Math.round(fromLinear(Math.min(1, Math.max(0, c))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function maxChroma(L: number, h: number): number {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinearRgb(oklchToLab(L, mid, h)))) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function colourDistance(a: string, b: string): number {
  const la = hexToOklab(a);
  const lb = hexToOklab(b);
  if (!la || !lb) return Infinity;
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

function hueOf([, a, b]: Lab): number {
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

// Olive, green and tan shades blend into bush, grass and soil.
function backgroundPenalty(lab: Lab): number {
  const hue = hueOf(lab);
  const chroma = Math.hypot(lab[1], lab[2]);
  if (hue >= 95 && hue <= 175)
    return lab[0] >= 0.8 && chroma >= 0.15 ? 0.5 : 0.4;
  if (hue >= 40 && hue < 95 && (lab[0] < 0.78 || chroma < 0.14)) return 0.45;
  return 1;
}

type Candidate = { hex: string; lab: Lab; penalty: number };

const LIGHTNESS = [0.66, 0.74, 0.82, 0.9];
const MIN_CHROMA = 0.11;

const CANDIDATES: Candidate[] = (() => {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (let h = 0; h < 360; h += 6) {
    for (const L of LIGHTNESS) {
      const max = Math.min(0.26, maxChroma(L, h));
      for (const C of [max, max * 0.65]) {
        if (C < MIN_CHROMA) continue;
        const hex = labToHex(oklchToLab(L, C, h));
        if (seen.has(hex)) continue;
        seen.add(hex);
        const lab = hexToOklab(hex)!;
        out.push({ hex, lab, penalty: backgroundPenalty(lab) });
      }
    }
  }
  return out.sort(
    (a, b) =>
      b.penalty - a.penalty ||
      Math.hypot(b.lab[1], b.lab[2]) - Math.hypot(a.lab[1], a.lab[2]),
  );
})();

export const UNSET_COLOURS = new Set(['', '#000000']);

export function isUnsetColour(colour: string | null | undefined): boolean {
  return UNSET_COLOURS.has((colour ?? '').trim().toLowerCase());
}

// Look-alike species count as closer than they are, so they end up further apart.
const LOOK_ALIKE_WEIGHT = [1, 0.7, 0.45];

export function suggestLabelColour(
  name: string,
  existing: readonly { name: string; color: string }[],
): string {
  const used = existing
    .filter((e) => !isUnsetColour(e.color))
    .map((e) => ({
      lab: hexToOklab(e.color),
      hex: e.color.toLowerCase(),
      weight: LOOK_ALIKE_WEIGHT[lookAlikeness(name, e.name)],
    }))
    .filter((e): e is { lab: Lab; hex: string; weight: number } => !!e.lab);
  const usedHex = new Set(used.map((u) => u.hex));
  let best = CANDIDATES[0];
  let bestScore = -1;
  for (const c of CANDIDATES) {
    if (usedHex.has(c.hex)) continue;
    let nearest = 1;
    for (const u of used) {
      const d =
        Math.hypot(
          c.lab[0] - u.lab[0],
          c.lab[1] - u.lab[1],
          c.lab[2] - u.lab[2],
        ) * u.weight;
      if (d < nearest) nearest = d;
    }
    const score = nearest * c.penalty;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best.hex;
}

export function suggestLabelColours<T extends { name: string; color: string }>(
  labels: readonly T[],
): string[] {
  const colours = labels.map((l) => l.color);
  const order = labels
    .map((l, i) => ({ name: l.name, i }))
    .filter(({ i }) => isUnsetColour(colours[i]))
    .sort((a, b) => compareByCommonness(a.name, b.name));
  for (const { name, i } of order) {
    colours[i] = suggestLabelColour(
      name,
      labels.map((l, j) => ({ name: l.name, color: colours[j] })),
    );
  }
  return colours;
}
