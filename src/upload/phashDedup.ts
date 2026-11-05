// Banded LSH index for perceptual hashes of arbitrary fixed bit-width.
//
// Pigeonhole: split the hash into k bands. Any two hashes within Hamming
// distance t (where t < k) must agree on at least k - t bands exactly.
// We index every band, probe every band on lookup, union the candidates,
// then run an exact Hamming distance check against each candidate.
//
// Hashes whose length does not match the index's expected length are
// silently skipped — useful for ignoring legacy hashes that were produced
// with a different block size (e.g. 64-bit) when the index expects the
// current 256-bit format.

const POPCOUNT_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let v = i;
  v = v - ((v >> 1) & 0x55);
  v = (v & 0x33) + ((v >> 2) & 0x33);
  POPCOUNT_TABLE[i] = (v + (v >> 4)) & 0x0f;
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    d += POPCOUNT_TABLE[a[i] ^ b[i]];
  }
  return d;
}

export interface PhashEntry<T> {
  phash: string;
  bytes: Uint8Array;
  payload: T;
}

export class PhashIndex<T> {
  private bands: Map<string, PhashEntry<T>[]>[] = [];
  private threshold: number;
  private hashLength: number;
  private bandCount: number;
  private bandWidth: number;

  // Default geometry: 256-bit hash (64 hex chars) split into 4 × 64-bit bands.
  // Pigeonhole with t=4 → at least 3 bands match exactly per duplicate pair.
  constructor(threshold = 4, hashLength = 64, bandCount = 4) {
    if (hashLength % bandCount !== 0) {
      throw new Error(
        `hashLength (${hashLength}) must be divisible by bandCount (${bandCount})`,
      );
    }
    this.threshold = threshold;
    this.hashLength = hashLength;
    this.bandCount = bandCount;
    this.bandWidth = hashLength / bandCount;
    for (let i = 0; i < bandCount; i++) this.bands.push(new Map());
  }

  add(phash: string, payload: T): PhashEntry<T> | null {
    if (phash.length !== this.hashLength) return null;
    const entry: PhashEntry<T> = {
      phash,
      bytes: hexToBytes(phash),
      payload,
    };
    for (let b = 0; b < this.bandCount; b++) {
      const key = phash.slice(b * this.bandWidth, (b + 1) * this.bandWidth);
      const bucket = this.bands[b].get(key);
      if (bucket) bucket.push(entry);
      else this.bands[b].set(key, [entry]);
    }
    return entry;
  }

  // Returns the first entry within the threshold, or null.
  findMatch(phash: string): PhashEntry<T> | null {
    if (phash.length !== this.hashLength) return null;
    const bytes = hexToBytes(phash);
    const seen = new Set<PhashEntry<T>>();
    for (let b = 0; b < this.bandCount; b++) {
      const key = phash.slice(b * this.bandWidth, (b + 1) * this.bandWidth);
      const bucket = this.bands[b].get(key);
      if (!bucket) continue;
      for (const entry of bucket) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        if (hammingDistance(bytes, entry.bytes) <= this.threshold) {
          return entry;
        }
      }
    }
    return null;
  }
}
