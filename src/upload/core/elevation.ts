import { getUrl } from 'aws-amplify/storage';

// SRTM elevation lookup with a promise cache for concurrent tile requests.
const MAX_CACHED_TILES = 8;
const FETCH_TIMEOUT_MS = 30_000;

export class ElevationService {
  private tiles = new Map<string, Promise<ArrayBuffer>>();

  constructor(
    private opts: { bucketName: string; region?: string }
  ) {}

  async getElevation(lat: number, lon: number): Promise<number | null> {
    if (isNaN(lat) || isNaN(lon)) return null;
    const tileName = ElevationService.tileNameFor(lat, lon);
    try {
      const buffer = await this.getTile(tileName);
      return computeElevationFromBuffer(buffer, lat, lon);
    } catch (err) {
      // Elevation is best-effort (callers fall back to 0 / undefined AGL);
      // a tile failure must not fail the image.
      console.warn(`Elevation lookup failed for tile ${tileName}:`, err);
      return null;
    }
  }

  private getTile(tileName: string): Promise<ArrayBuffer> {
    const cached = this.tiles.get(tileName);
    if (cached) return cached;

    const promise = this.fetchTile(tileName).catch((err) => {
      // Drop failed fetches so a later image can retry the tile.
      this.tiles.delete(tileName);
      throw err;
    });
    this.tiles.set(tileName, promise);

    // FIFO eviction; surveys cluster geographically so a handful of tiles
    // covers a session.
    while (this.tiles.size > MAX_CACHED_TILES) {
      const oldest = this.tiles.keys().next().value as string | undefined;
      if (oldest === undefined || oldest === tileName) break;
      this.tiles.delete(oldest);
    }
    return promise;
  }

  private async fetchTile(tileName: string): Promise<ArrayBuffer> {
    const latDir = tileName.slice(0, 3); // e.g. "S24"
    const filePath = `SRTM/${latDir}/${tileName}`;
    const urlResult = await getUrl({
      path: filePath,
      options: {
        bucket: {
          bucketName: this.opts.bucketName,
          region: this.opts.region ?? 'eu-west-1',
        },
      },
    });
    const response = await fetch(urlResult.url.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HGT fetch failed with status ${response.status}`);
    }
    return response.arrayBuffer();
  }

  static tileNameFor(lat: number, lon: number): string {
    const latFloor = Math.floor(lat);
    const lonFloor = Math.floor(lon);
    const latPrefix = latFloor >= 0 ? 'N' : 'S';
    const lonPrefix = lonFloor >= 0 ? 'E' : 'W';
    const latDeg = Math.abs(latFloor).toString().padStart(2, '0');
    const lonDeg = Math.abs(lonFloor).toString().padStart(3, '0');
    return `${latPrefix}${latDeg}${lonPrefix}${lonDeg}.hgt`;
  }
}

export function computeElevationFromBuffer(
  buffer: ArrayBuffer,
  lat: number,
  lon: number
): number {
  const latFloor = Math.floor(lat);
  const lonFloor = Math.floor(lon);
  const samples = Math.sqrt(buffer.byteLength / 2);
  if (!Number.isInteger(samples)) {
    throw new Error(`Unsupported HGT size: ${buffer.byteLength} bytes`);
  }
  const dataView = new DataView(buffer);
  const latOffset = lat - latFloor;
  const lonOffset = lon - lonFloor;
  const row = (1 - latOffset) * (samples - 1);
  const col = lonOffset * (samples - 1);
  const i1 = Math.min(Math.floor(row), samples - 2);
  const j1 = Math.min(Math.floor(col), samples - 2);
  const i2 = i1 + 1;
  const j2 = j1 + 1;
  const fx = col - j1;
  const fy = row - i1;
  const getSample = (i: number, j: number): number =>
    dataView.getInt16((i * samples + j) * 2, false);
  const q11 = getSample(i1, j1);
  const q21 = getSample(i1, j2);
  const q12 = getSample(i2, j1);
  const q22 = getSample(i2, j2);
  const interp =
    (1 - fx) * (1 - fy) * q11 +
    fx * (1 - fy) * q21 +
    (1 - fx) * fy * q12 +
    fx * fy * q22;
  return Math.round(interp * 100) / 100;
}
