import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { client } from '../stores/appClient';
import { showModalAction as showModal } from '../stores/modalStore';
import { Footer } from '../Modal';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { booleanPointInPolygon } from '@turf/turf';
import {
  Button,
  Spinner,
  Alert,
  ProgressBar,
  Badge,
  Form,
} from 'react-bootstrap';
import { fetchAllPaginatedResults } from '../utils';
import {
  BASE_STYLE,
  EMPTY_FC,
  escapeHtml,
  type FeatureCollection,
} from './surveyMapStyle';
import './surveyMap.css';

type ImageData = {
  id: string;
  latitude: number;
  longitude: number;
  originalPath?: string | null;
};

type ImageAggregate = {
  id: string;
  originalPath?: string | null;
  annotationIds: string[];
  locationIds: string[];
  membershipRecords: Array<{ id: string; imageSetId?: string | null }>;
  fileRecords: Array<{ id: string }>;
  neighbourPairs: Array<{ key: string; image1Id: string; image2Id: string }>;
};

type DeletionCounters = {
  imagesDeleted: number;
  annotationsDeleted: number;
  locationsDeleted: number;
  membershipsDeleted: number;
  filesDeleted: number;
  neighboursDeleted: number;
  imageSetsUpdated: number;
  /** Images that could not be fully removed (fetch or delete errors). */
  imagesFailed: number;
  /** True when the user cancelled the run partway through. */
  cancelled: boolean;
};

// ---------------------------------------------------------------------------
// Map constants
// ---------------------------------------------------------------------------

const SRC_IMAGES = 'images';
const LYR_IMAGES = 'images-points';
const SRC_SHAPEFILE = 'shapefile';
const LYR_SHAPEFILE = 'shapefile-line';

// ---------------------------------------------------------------------------
// Resilience helpers — retry with backoff, idempotency detection and a bounded
// concurrency pool. Kept module-scope (like DensityMap's helpers) so the bulk
// delete survives AppSync/DynamoDB throttling on huge surveys instead of
// aborting the whole operation on the first transient error.
// ---------------------------------------------------------------------------

const DELETE_CONCURRENCY = 6;
const FETCH_CONCURRENCY = 6;

/** Abortable sleep used between retry attempts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Flatten an error (thrown error or a GraphQL error object) to a string. */
function errToString(err: any): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const parts = [err.errorType, err.name, err.code, err.message].filter(
    Boolean
  );
  if (Array.isArray(err.errors)) {
    for (const e of err.errors) {
      parts.push(e?.errorType, e?.message);
    }
  }
  return parts.filter(Boolean).join(' ') || String(err);
}

const TRANSIENT_PATTERNS = [
  'throttl',
  'toomanyrequests',
  'too many requests',
  'rate exceeded',
  'serviceunavailable',
  'service unavailable',
  'internalfailure',
  'internal failure',
  'internalservererror',
  'networkerror',
  'network error',
  'failed to fetch',
  'load failed',
  'timeout',
  'timed out',
  'econnreset',
  '429',
  '502',
  '503',
  '504',
];

/** True for errors worth retrying (throttling / transient network / 5xx). */
function isTransientError(err: any): boolean {
  const s = errToString(err).toLowerCase();
  if (!s) return false;
  if (s.includes('abort')) return false; // a cancellation, never retry
  return TRANSIENT_PATTERNS.some((p) => s.includes(p));
}

const GONE_PATTERNS = [
  'conditionalcheckfailed',
  'not found',
  'does not exist',
  'no item',
  'item not found',
];

/** True when a delete failed because the record is already gone (idempotent). */
function isAlreadyGone(err: any): boolean {
  const s = errToString(err).toLowerCase();
  return GONE_PATTERNS.some((p) => s.includes(p));
}

/** Exponential backoff (capped) with full jitter. */
function backoffDelay(attempt: number, baseDelay: number): number {
  const capped = Math.min(baseDelay * Math.pow(2, attempt - 1), 8000);
  return Math.round(capped / 2 + Math.random() * (capped / 2));
}

interface RunOpOpts {
  retries?: number;
  baseDelay?: number;
  signal?: AbortSignal;
}

/**
 * Run an Amplify data operation with retries. The data client resolves with
 * `{ data, errors }` rather than throwing on GraphQL errors, so we inspect
 * BOTH the thrown path and the returned `errors` array. Transient failures are
 * retried with backoff; a non-transient `errors` array is surfaced as a throw
 * so callers can record a real failure (the previous code silently treated
 * GraphQL errors as success).
 */
async function runOp<T>(
  fn: () => Promise<T>,
  opts: RunOpOpts = {}
): Promise<T> {
  const { retries = 5, baseDelay = 300, signal } = opts;
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let res: T;
    try {
      res = await fn();
    } catch (err) {
      if (!signal?.aborted && attempt < retries && isTransientError(err)) {
        attempt += 1;
        await sleep(backoffDelay(attempt, baseDelay), signal);
        continue;
      }
      throw err;
    }
    const errors = (res as any)?.errors as any[] | null | undefined;
    if (errors && errors.length) {
      if (!signal?.aborted && attempt < retries && errors.some(isTransientError)) {
        attempt += 1;
        await sleep(backoffDelay(attempt, baseDelay), signal);
        continue;
      }
      const e: any = new Error(
        errors.map((x) => x?.message || x?.errorType || String(x)).join('; ')
      );
      e.graphQLErrors = errors;
      throw e;
    }
    return res;
  }
}

/**
 * Wrap a paginated query function so each page request retries via runOp.
 * Returns `any` so it slots into `fetchAllPaginatedResults`' overloaded query
 * parameter without fighting its generic inference (the call sites cast the
 * resulting rows, as the rest of this file does).
 */
function makeRetrying(queryFn: any, signal?: AbortSignal): any {
  return (...args: any[]) => runOp(() => queryFn(...args), { signal });
}

/**
 * Bounded-concurrency worker pool. N workers pull from a shared cursor, giving
 * a steady, capped request rate instead of the unbounded `Promise.all` fan-out
 * that self-throttled on large surveys. Worker throws are swallowed so one
 * failure can't collapse the pool — workers record their own failures.
 */
async function runPool<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number,
  signal?: AbortSignal
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const runners: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    runners.push(
      (async () => {
        for (;;) {
          if (signal?.aborted) return;
          const index = cursor++;
          if (index >= items.length) return;
          try {
            await worker(items[index], index);
          } catch {
            // Worker is expected to record its own failures; this is only a
            // backstop so an unexpected throw doesn't kill the pool.
          }
        }
      })()
    );
  }
  await Promise.all(runners);
}

export default function DeleteImages({ projectId }: { projectId: string }) {
  const [images, setImages] = useState<ImageData[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{
    current: number;
    total: number;
    phase: string;
  } | null>(null);
  const [deleteResult, setDeleteResult] = useState<DeletionCounters | null>(
    null
  );
  const [showInstructions, setShowInstructions] = useState(false);
  const [shapefileCoords, setShapefileCoords] = useState<
    [number, number][] | null
  >(null);
  const [showShapefile, setShowShapefile] = useState(true);
  const [loadingShapefile, setLoadingShapefile] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [drawing, setDrawing] = useState(false);

  const isActiveRef = useRef(true);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Selection currently reflected in MapLibre feature-state, so the sync effect
  // can apply only the delta rather than rewriting every feature.
  const appliedSelectionRef = useRef<Set<string>>(new Set());

  // Latest values for the once-registered map event handlers to read.
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const drawingRef = useRef(false);

  // Fetch images with GPS coordinates
  const fetchImages = useCallback(async (): Promise<ImageData[]> => {
    isActiveRef.current = true;
    setLoading(true);
    setError(null);
    setLoadingStatus('Fetching images...');
    setDeleteResult(null);

    try {
      const allImages = (await fetchAllPaginatedResults(
        makeRetrying(client.models.Image.imagesByProjectId),
        {
          projectId,
          selectionSet: ['id', 'latitude', 'longitude', 'originalPath'],
          limit: 10000,
        },
        (count) => {
          if (isActiveRef.current) {
            setLoadingStatus(`Fetching images... (${count} fetched)`);
          }
        }
      )) as Array<{
        id: string;
        latitude?: number | null;
        longitude?: number | null;
        originalPath?: string | null;
      }>;

      if (!isActiveRef.current) return [];

      // Filter to only images with valid GPS coordinates
      const gpsImages: ImageData[] = allImages
        .filter(
          (img) =>
            img.id &&
            typeof img.latitude === 'number' &&
            typeof img.longitude === 'number' &&
            Number.isFinite(img.latitude) &&
            Number.isFinite(img.longitude)
        )
        .map((img) => ({
          id: img.id,
          latitude: img.latitude!,
          longitude: img.longitude!,
          originalPath: img.originalPath,
        }));

      setImages(gpsImages);
      setSelectedIds(new Set());
      setLoadingStatus(
        `Loaded ${gpsImages.length} images with GPS coordinates (${allImages.length - gpsImages.length
        } without GPS)`
      );
      return gpsImages;
    } catch (err) {
      console.error('Failed to fetch images:', err);
      setError(
        `Failed to fetch images: ${err instanceof Error ? err.message : String(err)
        }`
      );
      return [];
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Initial fetch
  useEffect(() => {
    fetchImages();
    return () => {
      isActiveRef.current = false;
    };
  }, [fetchImages]);

  // Load the project's saved shapefile, if any
  useEffect(() => {
    let cancelled = false;
    async function loadShapefile() {
      setLoadingShapefile(true);
      try {
        const result = (await runOp(() =>
          (client.models.Shapefile.shapefilesByProjectId as any)({ projectId })
        )) as any;
        const data = (result?.data ?? []) as Array<{
          coordinates: (number | null)[] | null;
        }>;
        if (data.length > 0 && data[0].coordinates) {
          const flat = data[0].coordinates.filter(
            (n): n is number => typeof n === 'number' && Number.isFinite(n)
          );
          const coords: [number, number][] = [];
          for (let i = 0; i + 1 < flat.length; i += 2) {
            coords.push([flat[i], flat[i + 1]]);
          }
          if (!cancelled) {
            setShapefileCoords(coords.length >= 3 ? coords : null);
          }
        } else if (!cancelled) {
          setShapefileCoords(null);
        }
      } catch (err) {
        console.error('Failed to load shapefile:', err);
        if (!cancelled) setShapefileCoords(null);
      } finally {
        if (!cancelled) setLoadingShapefile(false);
      }
    }
    loadShapefile();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Ray-casting point-in-polygon over [lat, lng] ring (shapefile selection).
  const pointInPolygon = useCallback(
    (lat: number, lng: number, polygon: [number, number][]) => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0];
        const yi = polygon[i][1];
        const xj = polygon[j][0];
        const yj = polygon[j][1];
        if (
          yi > lng !== yj > lng &&
          lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi
        ) {
          inside = !inside;
        }
      }
      return inside;
    },
    []
  );

  // Select images outside the loaded shapefile
  const selectOutsideShapefile = useCallback(() => {
    if (!shapefileCoords || shapefileCoords.length < 3) return;
    const newSelected = new Set<string>();
    for (const img of images) {
      if (!pointInPolygon(img.latitude, img.longitude, shapefileCoords)) {
        newSelected.add(img.id);
      }
    }
    setSelectedIds(newSelected);
  }, [images, shapefileCoords, pointInPolygon]);

  // GeoJSON for the image points. Rebuilt only when the image list changes
  // (e.g. after a delete refresh) — selection is handled via feature-state.
  const imagesFC = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: images.map((img) => ({
        type: 'Feature',
        id: img.id,
        properties: { id: img.id },
        geometry: { type: 'Point', coordinates: [img.longitude, img.latitude] },
      })),
    }),
    [images]
  );

  // -----------------------------------------------------------------------
  // Map initialisation (once). The Tabs component only mounts the active tab,
  // so the container is already sized when this runs.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BASE_STYLE,
      center: [0, 0],
      zoom: 2,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right'
    );
    map.addControl(
      new maplibregl.ScaleControl({ unit: 'metric' }),
      'bottom-left'
    );

    map.on('load', () => {
      map.addSource(SRC_IMAGES, {
        type: 'geojson',
        data: EMPTY_FC as any,
        promoteId: 'id',
      });
      map.addSource(SRC_SHAPEFILE, { type: 'geojson', data: EMPTY_FC as any });

      map.addLayer({
        id: LYR_SHAPEFILE,
        type: 'line',
        source: SRC_SHAPEFILE,
        paint: { 'line-color': '#fd7e14', 'line-width': 2 },
      });

      map.addLayer({
        id: LYR_IMAGES,
        type: 'circle',
        source: SRC_IMAGES,
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            7,
            5,
          ],
          'circle-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            '#dc3545',
            '#0d6efd',
          ],
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            2,
            1,
          ],
          'circle-stroke-color': '#ffffff',
          'circle-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.9,
            0.6,
          ],
        },
      });

      // Click a marker to select it; Ctrl/⌘+click toggles in/out of the set.
      map.on('click', LYR_IMAGES, (e) => {
        if (drawingRef.current) return; // drawing mode owns map clicks
        const feature = e.features?.[0];
        if (!feature) return;
        const id = String(feature.id);
        const additive = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
        setSelectedIds((prev) => {
          if (additive) {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }
          return new Set([id]);
        });
      });

      // Right-click a marker to view its details.
      map.on('contextmenu', LYR_IMAGES, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        e.originalEvent.preventDefault();
        const id = String(feature.id);
        const img = imagesRef.current.find((im) => im.id === id);
        const [lng, lat] = (feature.geometry as any).coordinates as [
          number,
          number
        ];
        const path = img?.originalPath || 'Unknown';
        new maplibregl.Popup({ closeButton: true })
          .setLngLat([lng, lat])
          .setHTML(
            `<div style="max-width:300px;color:#000">
              <strong>Path:</strong> ${escapeHtml(path)}<br/>
              <strong>Lat:</strong> ${lat.toFixed(6)}<br/>
              <strong>Lng:</strong> ${lng.toFixed(6)}
            </div>`
          )
          .addTo(map);
      });

      map.on('mouseenter', LYR_IMAGES, () => {
        if (!drawingRef.current) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', LYR_IMAGES, () => {
        if (!drawingRef.current) map.getCanvas().style.cursor = '';
      });

      // Polygon lasso. Terra Draw renders its own layers/sources via the
      // adapter; we read the finished polygon and convert it into a selection.
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawPolygonMode()],
      });
      draw.on('finish', (id) => {
        try {
          const snapshot = draw.getSnapshot();
          const feature =
            snapshot.find((f: any) => f.id === id) ??
            snapshot.find((f: any) => f.geometry?.type === 'Polygon');
          if (feature && (feature.geometry as any)?.type === 'Polygon') {
            const newSelected = new Set<string>();
            for (const img of imagesRef.current) {
              if (
                booleanPointInPolygon(
                  [img.longitude, img.latitude],
                  feature as any
                )
              ) {
                newSelected.add(img.id);
              }
            }
            setSelectedIds(newSelected);
          }
        } catch (err) {
          console.error('Polygon selection failed:', err);
        } finally {
          try {
            draw.clear();
            draw.stop();
          } catch {
            /* map torn down; ignore */
          }
          drawingRef.current = false;
          setDrawing(false);
          map.getCanvas().style.cursor = '';
        }
      });
      drawRef.current = draw;

      setMapLoaded(true);
    });

    return () => {
      setMapLoaded(false);
      try {
        drawRef.current?.stop();
      } catch {
        /* ignore */
      }
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
      appliedSelectionRef.current = new Set();
    };
  }, []);

  // Push image points into the source. setData resets feature-state, so we
  // re-apply the current selection immediately afterwards.
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    const src = map?.getSource(SRC_IMAGES) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!map || !src) return;
    src.setData(imagesFC as any);
    appliedSelectionRef.current = new Set();
    for (const id of selectedIdsRef.current) {
      try {
        map.setFeatureState({ source: SRC_IMAGES, id }, { selected: true });
      } catch {
        /* feature not present; ignore */
      }
    }
    appliedSelectionRef.current = new Set(selectedIdsRef.current);
  }, [mapLoaded, imagesFC]);

  // Apply selection changes via feature-state (delta only — no GeoJSON rebuild).
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    if (!map) return;
    const prev = appliedSelectionRef.current;
    for (const id of prev) {
      if (!selectedIds.has(id)) {
        try {
          map.setFeatureState({ source: SRC_IMAGES, id }, { selected: false });
        } catch {
          /* ignore */
        }
      }
    }
    for (const id of selectedIds) {
      if (!prev.has(id)) {
        try {
          map.setFeatureState({ source: SRC_IMAGES, id }, { selected: true });
        } catch {
          /* ignore */
        }
      }
    }
    appliedSelectionRef.current = new Set(selectedIds);
  }, [mapLoaded, selectedIds]);

  // Shapefile overlay. Stored coords are [lat, lng]; GeoJSON wants [lng, lat].
  useEffect(() => {
    if (!mapLoaded) return;
    const src = mapRef.current?.getSource(SRC_SHAPEFILE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    if (showShapefile && shapefileCoords && shapefileCoords.length >= 3) {
      const ring = shapefileCoords.map(([lat, lng]) => [lng, lat]);
      const [fx, fy] = ring[0];
      const [lx, ly] = ring[ring.length - 1];
      if (fx !== lx || fy !== ly) ring.push([fx, fy]);
      src.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: ring },
          },
        ],
      } as any);
    } else {
      src.setData(EMPTY_FC as any);
    }
  }, [mapLoaded, showShapefile, shapefileCoords]);

  // Fit bounds whenever the displayed image extent changes.
  const lastFitRef = useRef('');
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    if (!map || images.length === 0) return;
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const img of images) {
      if (img.longitude < minLng) minLng = img.longitude;
      if (img.latitude < minLat) minLat = img.latitude;
      if (img.longitude > maxLng) maxLng = img.longitude;
      if (img.latitude > maxLat) maxLat = img.latitude;
    }
    const key = `${minLng},${minLat},${maxLng},${maxLat}`;
    if (key === lastFitRef.current) return;
    lastFitRef.current = key;
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 50, maxZoom: 16, duration: 0 }
    );
  }, [mapLoaded, images]);

  // Toggle the polygon-draw lasso.
  const toggleDraw = useCallback(() => {
    const draw = drawRef.current;
    const map = mapRef.current;
    if (!draw || !map) return;
    if (drawingRef.current) {
      try {
        draw.clear();
        draw.stop();
      } catch {
        /* ignore */
      }
      drawingRef.current = false;
      setDrawing(false);
      map.getCanvas().style.cursor = '';
    } else {
      try {
        draw.start();
        draw.setMode('polygon');
        drawingRef.current = true;
        setDrawing(true);
        map.getCanvas().style.cursor = 'crosshair';
      } catch (err) {
        console.error('Failed to start drawing:', err);
      }
    }
  }, []);

  // -----------------------------------------------------------------------
  // Fetch all associated data for the images to delete. Per-image gathering
  // runs through a bounded pool with per-page retries; an image whose
  // relationships can't be fetched is recorded in `failedToFetch` instead of
  // aborting the whole run.
  // -----------------------------------------------------------------------
  const fetchImageData = useCallback(
    async (
      imageIds: string[],
      signal: AbortSignal,
      failedToFetch: Set<string>
    ): Promise<Map<string, ImageAggregate>> => {
      const imageMap = new Map<string, ImageAggregate>();
      let totalMemberships = 0;
      let totalFiles = 0;
      let totalNeighbours = 0;
      let totalAnnotations = 0;
      let totalLocations = 0;

      setDeleteProgress({
        current: 0,
        total: imageIds.length,
        phase: 'Fetching selected image details...',
      });

      const selectedSet = new Set(imageIds);
      const deletedNeighbourKeys = new Set<string>();
      const imageById = new Map(images.map((img) => [img.id, img] as const));

      // Memberships are only indexed by imageSetId, so we read the set(s) once
      // and filter to the selection. This is the known heavy step on a huge
      // survey, hence the per-page retry.
      const imageSets = (await fetchAllPaginatedResults(
        makeRetrying(client.models.ImageSet.imageSetsByProjectId, signal),
        { projectId, selectionSet: ['id'], limit: 10000 }
      )) as Array<{ id?: string | null }>;

      const membershipByImageId = new Map<
        string,
        Array<{ id: string; imageSetId?: string | null }>
      >();

      for (const imageSet of imageSets) {
        if (!imageSet?.id) continue;
        const memberships = (await fetchAllPaginatedResults(
          makeRetrying(
            client.models.ImageSetMembership.imageSetMembershipsByImageSetId,
            signal
          ),
          {
            imageSetId: imageSet.id,
            selectionSet: ['id', 'imageId', 'imageSetId'],
            limit: 10000,
          }
        )) as Array<{
          id?: string | null;
          imageId?: string | null;
          imageSetId?: string | null;
        }>;

        for (const m of memberships) {
          if (!m?.id || !m?.imageId) continue;
          if (!selectedSet.has(m.imageId)) continue;
          const list = membershipByImageId.get(m.imageId) ?? [];
          list.push({ id: m.id, imageSetId: m.imageSetId ?? null });
          membershipByImageId.set(m.imageId, list);
        }
      }

      // Build aggregates per selected image, isolating per-image failures.
      let gathered = 0;
      await runPool(
        imageIds,
        async (imageId) => {
          if (signal.aborted) return;
          try {
            const membershipRecords = membershipByImageId.get(imageId) ?? [];
            const [annotations, locations, files, leftNeighbours, rightNeighbours] =
              await Promise.all([
                fetchAllPaginatedResults(
                  makeRetrying(
                    client.models.Annotation.annotationsByImageIdAndSetId,
                    signal
                  ),
                  { imageId, selectionSet: ['id', 'setId'], limit: 10000 }
                ),
                fetchAllPaginatedResults(
                  makeRetrying(
                    client.models.Location.locationsByImageKey,
                    signal
                  ),
                  { imageId, selectionSet: ['id'], limit: 10000 }
                ),
                fetchAllPaginatedResults(
                  makeRetrying(client.models.ImageFile.imagesByimageId, signal),
                  { imageId, selectionSet: ['id'], limit: 10000 }
                ),
                fetchAllPaginatedResults(
                  makeRetrying(
                    client.models.ImageNeighbour.imageNeighboursByImage1key,
                    signal
                  ),
                  {
                    image1Id: imageId,
                    selectionSet: ['image1Id', 'image2Id'],
                    limit: 10000,
                  }
                ),
                fetchAllPaginatedResults(
                  makeRetrying(
                    client.models.ImageNeighbour.imageNeighboursByImage2key,
                    signal
                  ),
                  {
                    image2Id: imageId,
                    selectionSet: ['image1Id', 'image2Id'],
                    limit: 10000,
                  }
                ),
              ]);

            const agg: ImageAggregate = {
              id: imageId,
              originalPath: imageById.get(imageId)?.originalPath,
              annotationIds: [],
              locationIds: [],
              membershipRecords,
              fileRecords: [],
              neighbourPairs: [],
            };

            totalMemberships += membershipRecords.length;

            for (const annotation of annotations as Array<{
              id?: string | null;
            }>) {
              if (!annotation?.id) continue;
              agg.annotationIds.push(annotation.id);
              totalAnnotations += 1;
            }
            for (const location of locations as Array<{ id?: string | null }>) {
              if (!location?.id) continue;
              agg.locationIds.push(location.id);
              totalLocations += 1;
            }
            for (const file of files as Array<{ id?: string | null }>) {
              if (!file?.id) continue;
              agg.fileRecords.push({ id: file.id });
              totalFiles += 1;
            }

            const localNeighbourSet = new Set<string>();
            const pushNeighbour = (n?: {
              image1Id?: string | null;
              image2Id?: string | null;
            }) => {
              if (!n?.image1Id || !n?.image2Id) return;
              const key =
                n.image1Id < n.image2Id
                  ? `${n.image1Id}::${n.image2Id}`
                  : `${n.image2Id}::${n.image1Id}`;
              if (localNeighbourSet.has(key)) return;
              localNeighbourSet.add(key);
              if (deletedNeighbourKeys.has(key)) return;
              deletedNeighbourKeys.add(key);
              agg.neighbourPairs.push({
                key,
                image1Id: n.image1Id,
                image2Id: n.image2Id,
              });
              totalNeighbours += 1;
            };
            (leftNeighbours as Array<any>).forEach(pushNeighbour);
            (rightNeighbours as Array<any>).forEach(pushNeighbour);

            imageMap.set(imageId, agg);
          } catch (err) {
            if (signal.aborted) return;
            failedToFetch.add(imageId);
            console.warn('Failed to gather data for image', imageId, err);
          } finally {
            gathered += 1;
            if (!signal.aborted) {
              setDeleteProgress({
                current: gathered,
                total: imageIds.length,
                phase: `Fetched relationships for ${gathered}/${imageIds.length} images...`,
              });
            }
          }
        },
        FETCH_CONCURRENCY,
        signal
      );

      setDeleteProgress({
        current: imageMap.size,
        total: imageMap.size,
        phase: `Ready to delete: ${imageMap.size} images, ${totalAnnotations} annotations, ${totalLocations} locations, ${totalFiles} files, ${totalMemberships} memberships, ${totalNeighbours} neighbour links`,
      });

      return imageMap;
    },
    [images, projectId]
  );

  // -----------------------------------------------------------------------
  // Delete the selected (or explicitly passed) images. Idempotent, cancellable
  // and recoverable: records that are already gone count as success, the user
  // can cancel mid-run, and images that fail stay selected for a retry.
  // -----------------------------------------------------------------------
  const handleDelete = useCallback(
    async (retryIds?: string[]) => {
      const imageIds =
        retryIds && retryIds.length ? retryIds : Array.from(selectedIds);
      if (imageIds.length === 0) return;

      // Confirm on the first attempt only (a retry skips the prompt).
      if (!retryIds) {
        const idSet = new Set(imageIds);
        const samplePaths: string[] = [];
        for (const img of images) {
          if (idSet.has(img.id)) {
            samplePaths.push(img.originalPath || 'Unknown path');
            if (samplePaths.length >= 3) break;
          }
        }
        const pathSummary =
          samplePaths.join('\n') +
          (imageIds.length > 3 ? `\n... and ${imageIds.length - 3} more` : '');
        const confirmMessage = `Are you sure you want to delete ${imageIds.length} image(s)?

This will permanently delete:
- The image records
- All annotations on these images
- All detections/locations on these images

Sample images:
${pathSummary}

This action cannot be undone.`;
        if (!window.confirm(confirmMessage)) return;
      }

      const abort = new AbortController();
      abortRef.current = abort;
      const signal = abort.signal;

      setDeleting(true);
      setError(null);
      setDeleteResult(null);

      const counters: DeletionCounters = {
        imagesDeleted: 0,
        annotationsDeleted: 0,
        locationsDeleted: 0,
        membershipsDeleted: 0,
        filesDeleted: 0,
        neighboursDeleted: 0,
        imageSetsUpdated: 0,
        imagesFailed: 0,
        cancelled: false,
      };
      const failedImageIds = new Set<string>();
      const failedToFetch = new Set<string>();

      try {
        const imageMap = await fetchImageData(imageIds, signal, failedToFetch);

        const impactedImageSetIds = new Set<string>();
        const deletedNeighbourKeys = new Set<string>();
        const aggregates = Array.from(imageMap.values());
        let processed = 0;

        setDeleteProgress({
          current: 0,
          total: aggregates.length,
          phase: 'Deleting images and associated data...',
        });

        await runPool(
          aggregates,
          async (agg) => {
            if (signal.aborted) return;
            let imageFailed = false;

            // Run one delete; returns true on success or already-gone, false on
            // a real failure (which marks the image as failed). Re-throws on
            // cancellation so the worker stops promptly.
            const del = async (fn: () => Promise<any>): Promise<boolean> => {
              try {
                await runOp(fn, { signal });
                return true;
              } catch (err) {
                if (signal.aborted) throw err;
                if (isAlreadyGone(err)) return true;
                imageFailed = true;
                console.warn('Delete failed', err);
                return false;
              }
            };

            for (const annotationId of agg.annotationIds) {
              if (
                await del(() =>
                  (client as any).models.Annotation.delete({ id: annotationId })
                )
              )
                counters.annotationsDeleted += 1;
            }
            for (const locationId of agg.locationIds) {
              if (
                await del(() =>
                  (client as any).models.Location.delete({ id: locationId })
                )
              )
                counters.locationsDeleted += 1;
            }
            for (const membership of agg.membershipRecords) {
              if (
                await del(() =>
                  (client as any).models.ImageSetMembership.delete({
                    id: membership.id,
                  })
                )
              ) {
                counters.membershipsDeleted += 1;
                if (membership.imageSetId)
                  impactedImageSetIds.add(membership.imageSetId);
              }
            }
            for (const file of agg.fileRecords) {
              if (
                await del(() =>
                  (client as any).models.ImageFile.delete({ id: file.id })
                )
              )
                counters.filesDeleted += 1;
            }
            for (const neighbour of agg.neighbourPairs) {
              if (deletedNeighbourKeys.has(neighbour.key)) continue;
              deletedNeighbourKeys.add(neighbour.key);
              if (
                await del(() =>
                  (client as any).models.ImageNeighbour.delete({
                    image1Id: neighbour.image1Id,
                    image2Id: neighbour.image2Id,
                  })
                )
              )
                counters.neighboursDeleted += 1;
            }

            // Only delete the image once its related records are gone, so a
            // failure never leaves orphaned annotations/locations behind.
            if (!imageFailed && !signal.aborted) {
              if (
                await del(() =>
                  (client as any).models.Image.delete({ id: agg.id })
                )
              )
                counters.imagesDeleted += 1;
            }
            if (imageFailed) failedImageIds.add(agg.id);

            processed += 1;
            if (!signal.aborted) {
              setDeleteProgress({
                current: processed,
                total: aggregates.length,
                phase: `Deleted ${counters.imagesDeleted}/${aggregates.length} images (${counters.annotationsDeleted} annotations, ${counters.locationsDeleted} locations)...`,
              });
            }
          },
          DELETE_CONCURRENCY,
          signal
        );

        if (signal.aborted) counters.cancelled = true;

        // Update counts on image sets that lost members.
        if (!signal.aborted && impactedImageSetIds.size > 0) {
          setDeleteProgress({
            current: 0,
            total: impactedImageSetIds.size,
            phase: 'Updating image set counts...',
          });
          for (const imageSetId of impactedImageSetIds) {
            if (signal.aborted) break;
            try {
              const memberships = (await fetchAllPaginatedResults(
                makeRetrying(
                  (client as any).models.ImageSetMembership
                    .imageSetMembershipsByImageSetId,
                  signal
                ),
                { imageSetId, selectionSet: ['id'], limit: 10000 }
              )) as Array<{ id: string }>;
              await runOp(
                () =>
                  (client as any).models.ImageSet.update({
                    id: imageSetId,
                    imageCount: memberships.length,
                  }),
                { signal }
              );
              counters.imageSetsUpdated += 1;
            } catch (err) {
              if (signal.aborted) break;
              console.warn('Failed to update image set count', imageSetId, err);
            }
          }
        }

        // Images we never managed to gather were never deleted either.
        for (const id of failedToFetch) failedImageIds.add(id);
        counters.imagesFailed = failedImageIds.size;
        if (signal.aborted) counters.cancelled = true;

        setDeleteResult(counters);

        // Notify other users about the changes (best effort).
        if (!signal.aborted) {
          setDeleteProgress({
            current: 0,
            total: 0,
            phase: 'Notifying other users...',
          });
          try {
            await runOp(() =>
              client.mutations.updateProjectMemberships({ projectId })
            );
          } catch (err) {
            console.warn('Failed to notify other users', err);
          }
        }

        // Refresh the map, then keep any images that still exist (failed,
        // un-reached or cancelled) selected so they can be retried.
        setDeleteProgress({ current: 0, total: 0, phase: 'Refreshing map...' });
        const remaining = await fetchImages();
        const targetSet = new Set(imageIds);
        setSelectedIds(
          new Set(
            remaining.filter((im) => targetSet.has(im.id)).map((im) => im.id)
          )
        );
        setDeleteProgress(null);
      } catch (err) {
        if (signal.aborted) {
          counters.cancelled = true;
          for (const id of failedToFetch) failedImageIds.add(id);
          counters.imagesFailed = failedImageIds.size;
          setDeleteResult(counters);
          const remaining = await fetchImages();
          const targetSet = new Set(imageIds);
          setSelectedIds(
            new Set(
              remaining.filter((im) => targetSet.has(im.id)).map((im) => im.id)
            )
          );
          setDeleteProgress(null);
        } else {
          console.error('Delete operation failed:', err);
          setError(
            `Delete operation failed: ${err instanceof Error ? err.message : String(err)
            }`
          );
          setDeleteProgress(null);
        }
      } finally {
        setDeleting(false);
        abortRef.current = null;
      }
    },
    [selectedIds, images, fetchImageData, fetchImages, projectId]
  );

  const cancelDelete = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Select all images
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(images.map((img) => img.id)));
  }, [images]);

  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);
  const hasImages = images.length > 0;

  return (
    <>
      <div className='p-3 d-flex flex-column gap-3'>
        {/* Selection header + toolbar */}
        <div className='d-flex justify-content-between align-items-center flex-wrap gap-2'>
          <div className='d-flex align-items-baseline gap-2'>
            <div
              className='text-uppercase fw-semibold text-muted'
              style={{ letterSpacing: 0.5, fontSize: 12 }}
            >
              Selection
            </div>
            <span className='text-muted' style={{ fontSize: 13 }}>
              {images.length} loaded {' · '}
              <span
                className={selectedCount > 0 ? 'text-danger fw-semibold' : ''}
              >
                {selectedCount} selected
              </span>
            </span>
          </div>
          <div className='d-flex gap-2 flex-wrap'>
            <Button
              size='sm'
              variant='outline-secondary'
              onClick={fetchImages}
              disabled={loading || deleting}
            >
              {loading ? (
                <>
                  <Spinner animation='border' size='sm' className='me-1' />
                  Loading...
                </>
              ) : (
                'Refresh'
              )}
            </Button>
            <Button
              size='sm'
              variant='outline-primary'
              onClick={selectAll}
              disabled={loading || deleting || images.length === 0}
            >
              Select All
            </Button>
            <Button
              size='sm'
              variant='outline-info'
              onClick={clearSelection}
              disabled={loading || deleting || selectedCount === 0}
            >
              Clear Selection
            </Button>
          </div>
        </div>

        {/* Instructions (collapsible) */}
        <div>
          <button
            type='button'
            className='text-muted d-flex align-items-center gap-1'
            onClick={() => setShowInstructions((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                transform: showInstructions ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s',
              }}
            >
              ▶
            </span>
            Instructions
          </button>
          {showInstructions && (
            <ul className='mt-2 mb-0 text-muted' style={{ fontSize: 13 }}>
              <li>Click on an image marker to select it</li>
              <li>
                Hold <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + click to select multiple
                images
              </li>
              <li>
                Use the <strong>Draw selection</strong> button, then click on the
                map to outline an area (click the first point to finish)
              </li>
              <li>Right-click on a marker to view image details</li>
              <li>Blue markers = unselected, Red markers = selected</li>
            </ul>
          )}
        </div>

        {/* Shapefile controls */}
        {(loadingShapefile || shapefileCoords) && (
          <div className='d-flex align-items-center gap-2 flex-wrap'>
            {loadingShapefile && (
              <span className='text-muted small d-flex align-items-center gap-1'>
                <Spinner animation='border' size='sm' />
                Loading shapefile...
              </span>
            )}
            {shapefileCoords && (
              <>
                <Badge bg='warning' text='dark'>
                  Shapefile loaded ({shapefileCoords.length} pts)
                </Badge>
                <Form.Check
                  type='switch'
                  id='toggle-shapefile-overlay'
                  label='Show on map'
                  checked={showShapefile}
                  onChange={(e) => setShowShapefile(e.target.checked)}
                />
                <Button
                  size='sm'
                  variant='outline-warning'
                  onClick={selectOutsideShapefile}
                  disabled={loading || deleting || images.length === 0}
                >
                  Select Outside Shapefile
                </Button>
              </>
            )}
          </div>
        )}

        {/* Loading status */}
        {loadingStatus && !error && (
          <div className='text-muted small'>{loadingStatus}</div>
        )}

        {/* Error display */}
        {error && (
          <Alert variant='danger' dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Delete progress */}
        {deleteProgress && (
          <div>
            <div className='text-muted small mb-1'>{deleteProgress.phase}</div>
            <ProgressBar
              now={
                deleteProgress.total > 0
                  ? (deleteProgress.current / deleteProgress.total) * 100
                  : 100
              }
              label={
                deleteProgress.total > 0
                  ? `${deleteProgress.current}/${deleteProgress.total}`
                  : undefined
              }
              animated
              striped
            />
          </div>
        )}

        {/* Delete result */}
        {deleteResult && (
          <Alert
            variant={
              deleteResult.cancelled || deleteResult.imagesFailed > 0
                ? 'warning'
                : 'success'
            }
            dismissible
            onClose={() => setDeleteResult(null)}
          >
            <strong>
              {deleteResult.cancelled
                ? 'Deletion cancelled:'
                : 'Deletion complete:'}
            </strong>
            <ul className='mb-0 mt-2'>
              <li>Images deleted: {deleteResult.imagesDeleted}</li>
              <li>Annotations deleted: {deleteResult.annotationsDeleted}</li>
              <li>Locations deleted: {deleteResult.locationsDeleted}</li>
              <li>File records deleted: {deleteResult.filesDeleted}</li>
              <li>Memberships deleted: {deleteResult.membershipsDeleted}</li>
              <li>Neighbour links deleted: {deleteResult.neighboursDeleted}</li>
              <li>Image sets updated: {deleteResult.imageSetsUpdated}</li>
              {deleteResult.imagesFailed > 0 && (
                <li className='text-danger'>
                  Images not deleted: {deleteResult.imagesFailed}
                </li>
              )}
            </ul>
            {deleteResult.imagesFailed > 0 && (
              <Button
                size='sm'
                variant='warning'
                className='mt-2'
                onClick={() => handleDelete(Array.from(selectedIdsRef.current))}
                disabled={deleting || loading}
              >
                Retry failed ({deleteResult.imagesFailed})
              </Button>
            )}
          </Alert>
        )}

        {/* Map */}
        <div className='survey-map'>
          <div
            ref={mapContainerRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />

          {/* Draw selection control */}
          {mapLoaded && hasImages && (
            <div
              className='position-absolute'
              style={{ top: 10, left: 10, zIndex: 1, maxWidth: 220 }}
            >
              <Button
                size='sm'
                variant={drawing ? 'warning' : 'light'}
                onClick={toggleDraw}
                disabled={loading || deleting}
                className='shadow-sm'
              >
                {drawing ? 'Cancel drawing' : 'Draw selection'}
              </Button>
              {drawing && (
                <div
                  className='mt-1 small bg-white rounded px-2 py-1 shadow-sm'
                  style={{ color: '#000' }}
                >
                  Click to add boundary points; click the first point to finish.
                </div>
              )}
            </div>
          )}

          {/* No-images overlay */}
          {!hasImages && !loading && (
            <div
              className='d-flex justify-content-center align-items-center text-muted'
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              No images with GPS coordinates found
            </div>
          )}

          {/* Loading overlay */}
          {loading && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(255, 255, 255, 0.8)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000,
              }}
            >
              <div className='text-center'>
                <Spinner animation='border' variant='primary' />
                <div className='mt-2'>{loadingStatus || 'Loading...'}</div>
              </div>
            </div>
          )}
        </div>
      </div>
      <Footer>
        {deleting && (
          <Button variant='outline-light' onClick={cancelDelete}>
            Cancel
          </Button>
        )}
        <Button
          variant='danger'
          onClick={() => handleDelete()}
          disabled={loading || deleting || selectedCount === 0}
        >
          {deleting ? (
            <>
              <Spinner animation='border' size='sm' className='me-1' />
              Deleting...
            </>
          ) : (
            `Delete ${selectedCount > 0 ? `(${selectedCount})` : ''}`
          )}
        </Button>
        <Button
          variant='dark'
          onClick={() => showModal(null)}
          disabled={deleting}
        >
          Close
        </Button>
      </Footer>
    </>
  );
}
