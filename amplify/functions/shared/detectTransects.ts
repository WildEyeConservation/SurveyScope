// Split each spatially continuous flight track at gaps in image capture.
// A survey can contain simultaneous flights: sorting the whole survey by time
// alone lets one flight's images fill another flight's between-transect pauses.
// Cameras following the same track share a transect, regardless of camera ID.

export const SPLIT_GAP_FACTOR = 3;
export const SPLIT_GAP_FLOOR_MS = 10_000;

// Allow GPS jitter/camera offsets plus aircraft movement between captures.
// These are continuity tolerances, not a GPS-track simplification threshold.
export const TRACK_POSITION_TOLERANCE_METERS = 250;
export const TRACK_MAX_SPEED_METERS_PER_SECOND = 100;

export type TimedImage = {
  id: string;
  timestamp: number | null | undefined;
  latitude?: number | null;
  longitude?: number | null;
  cameraId?: string | null;
};
export type TransectAssignment = { id: string; transectIndex: number };

type Position = { latitude: number; longitude: number };
type Track = {
  index: number;
  timestamp: number;
  position: Position | null;
  cameras: Set<string>;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Image.timestamp can be stored in either epoch seconds or milliseconds.
function normalizeToMillis(ts: number): number {
  return ts > 0 && ts < 1e12 ? ts * 1000 : ts;
}

function imagePosition(image: TimedImage): Position | null {
  const { latitude, longitude } = image;
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  return { latitude, longitude };
}

function distanceMeters(a: Position, b: Position): number {
  const radians = Math.PI / 180;
  const lat1 = a.latitude * radians;
  const lat2 = b.latitude * radians;
  const haversine =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(((b.longitude - a.longitude) * radians) / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

/**
 * Assign sequential, zero-based transect IDs while keeping simultaneous flight
 * tracks separate. An image can only extend a track within the capture-gap and
 * spatial-continuity limits. Camera identity breaks ties when tracks approach;
 * a nearby second camera can join the same track.
 *
 * Without GPS, continue a matching camera (or the sole anonymous track).
 * Missing timestamps sort last and cannot imply extra aircraft movement or
 * extend a track's capture time; they still obey the spatial/camera checks.
 */
export function detectTransects(images: TimedImage[]): TransectAssignment[] {
  if (images.length === 0) return [];

  const sorted = images
    .map((img, order) => ({
      id: img.id,
      order,
      cameraId: img.cameraId || null,
      position: imagePosition(img),
      ts:
        typeof img.timestamp === 'number' && Number.isFinite(img.timestamp)
          ? normalizeToMillis(img.timestamp)
          : NaN,
    }))
    .sort((a, b) => {
      const aNaN = Number.isNaN(a.ts);
      const bNaN = Number.isNaN(b.ts);
      if (aNaN && bNaN) return a.order - b.order;
      if (aNaN) return 1;
      if (bNaN) return -1;
      return a.ts - b.ts || a.order - b.order;
    });

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].ts;
    const cur = sorted[i].ts;
    if (Number.isFinite(prev) && Number.isFinite(cur)) gaps.push(cur - prev);
  }
  const threshold = Math.max(
    median(gaps) * SPLIT_GAP_FACTOR,
    SPLIT_GAP_FLOOR_MS
  );

  const assignments: TransectAssignment[] = [];
  let active: Track[] = [];
  let nextIndex = 0;
  for (const img of sorted) {
    if (Number.isFinite(img.ts)) {
      // Expire each flight independently. Other flights cannot keep it alive.
      active = active.filter((track) => img.ts - track.timestamp <= threshold);
    }

    let best: Track | undefined;
    let bestDistance = Infinity;
    let bestCameraMatch = false;
    for (const track of active) {
      const cameraMatch =
        img.cameraId !== null && track.cameras.has(img.cameraId);
      let distance = 0;
      if (img.position && track.position) {
        distance = distanceMeters(img.position, track.position);
        const elapsedSeconds =
          Number.isFinite(img.ts) && Number.isFinite(track.timestamp)
            ? (img.ts - track.timestamp) / 1000
            : 0;
        const limit =
          TRACK_POSITION_TOLERANCE_METERS +
          TRACK_MAX_SPEED_METERS_PER_SECOND * elapsedSeconds;
        if (distance > limit) continue;
      } else if (!cameraMatch) {
        // Time alone cannot associate unknown positions with another camera.
        if (img.cameraId || track.cameras.size > 0 || active.length !== 1)
          continue;
      }
      if (
        !best ||
        (cameraMatch && !bestCameraMatch) ||
        (cameraMatch === bestCameraMatch && distance < bestDistance)
      ) {
        best = track;
        bestDistance = distance;
        bestCameraMatch = cameraMatch;
      }
    }

    if (!best) {
      best = {
        index: nextIndex++,
        timestamp: img.ts,
        position: img.position,
        cameras: new Set(),
      };
      active.push(best);
    }
    if (Number.isFinite(img.ts)) best.timestamp = img.ts;
    if (img.position) best.position = img.position;
    if (img.cameraId) best.cameras.add(img.cameraId);
    assignments.push({ id: img.id, transectIndex: best.index });
  }
  return assignments;
}
