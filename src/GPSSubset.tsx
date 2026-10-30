import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  MousePointer2Icon,
  PentagonIcon,
  PlusIcon,
  ScanIcon,
  Undo2Icon,
  XIcon,
} from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';

import { booleanPointInPolygon } from '@turf/turf';
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import GPSSubsetImageViewerModal from './GPSSubsetImageViewerModal';
import {
  BASE_STYLE,
  EMPTY_FC,
  type FeatureCollection,
} from './survey/surveyMapStyle';

import './survey/surveyMap.css';

import { Kbd, MapButton } from './survey/mapControls';
import { LIGHT_THEME, MAP_CONTROLS, MAP_DIVIDER } from './survey/mapTheme';
import { gpsRowKey } from './survey/new-survey/gpsIndex';
import { ringToPolygon, type SurveyArea } from './survey/new-survey/surveyArea';

// Define the GPS data structure
export interface GPSData {
  timestamp?: number;
  filepath?: string;
  lat: number;
  lng: number;
  alt: number;
}

// Props for the component
export interface GPSSubsetProps {
  gpsData: GPSData[];
  onFilter: (filteredData: GPSData[]) => void;
  imageFiles?: File[];
  existingImages?: { lat: number; lng: number }[];
  /** Every georeferenced row, so rows filtered before mounting still draw. */
  allPoints?: GPSData[];
  /** Keys of rows skipped by the survey boundary; shown grey and locked. */
  outsideAreaKeys?: Set<string>;
  /** Survey boundary and exclusions, drawn as outlines. */
  area?: SurveyArea;
  /** Extra filters, shown in the map panel below the legend. */
  children?: ReactNode;
}

// ---------------------------------------------------------------------------
// Map constants. Rendering goes through MapLibre GeoJSON sources + WebGL
// circle layers (same pattern as the Edit Survey tabs) instead of one SVG
// marker per point — the old approach created 100k+ DOM nodes on large
// surveys and killed the tab.
// ---------------------------------------------------------------------------

const SRC_POINTS = 'gps-points';
const LYR_POINTS = 'gps-points-circles';
const SRC_EXISTING = 'existing-images';
const LYR_EXISTING = 'existing-images-circles';
const SRC_AREA = 'survey-area';
const LYR_AREA = 'survey-area-line';

const NO_KEYS = new Set<string>();

const INCLUDED_COLOR = '#ffa500';
const REMOVED_COLOR = '#ff0000';
const OUTSIDE_COLOR = '#8a8a8a';
const EXISTING_COLOR = '#00ffff';

const POINT_COLOR = [
  'match',
  ['get', 'state'],
  'included',
  INCLUDED_COLOR,
  'outside',
  OUTSIDE_COLOR,
  REMOVED_COLOR,
] as any;

type DrawTool = 'keep' | 'remove';
type Shape = Parameters<typeof booleanPointInPolygon>[1];

const SHAPE_COLOR: Record<DrawTool, string> = {
  keep: INCLUDED_COLOR,
  remove: REMOVED_COLOR,
};

type PopupProps = {
  key: string;
  filepath?: string;
  timestamp?: number;
  lat: number;
  lng: number;
  alt: number;
  state: 'included' | 'removed' | 'outside';
};

// The main component
const GPSSubset: React.FC<GPSSubsetProps> = ({
  gpsData,
  onFilter,
  imageFiles,
  existingImages,
  allPoints,
  outsideAreaKeys = NO_KEYS,
  area,
  children,
}) => {
  const [showExistingImages, setShowExistingImages] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool | null>(null);

  // Image modal state
  const [showImageModal, setShowImageModal] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [imageRotation, setImageRotation] = useState(0); // Global rotation for all images (0, 90, 180, 270)

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const drawingRef = useRef<DrawTool | null>(null);
  const applyShapeRef = useRef<(shape: Shape) => void>(() => {});
  const didFitRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const validGpsData = useMemo(
    () =>
      gpsData.filter(
        (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
      ),
    [gpsData],
  );

  const validExistingImages = useMemo(
    () =>
      (existingImages || []).filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
      ),
    [existingImages],
  );

  const createPointKey = useCallback((p: GPSData) => gpsRowKey(p), []);

  const [currentFilteredPoints, setCurrentFilteredPoints] =
    useState<GPSData[]>(validGpsData);
  const [deletedPointsStack, setDeletedPointsStack] = useState<GPSData[][]>([]);

  // Keep a snapshot of the initial set of points so that when parent filters
  // (e.g., time filter), we can still render excluded points as red markers.
  const initialPointsRef = useRef<Map<string, GPSData> | null>(null);
  useEffect(() => {
    if (!initialPointsRef.current && validGpsData.length > 0) {
      const map = new Map<string, GPSData>();
      for (const p of validGpsData) {
        map.set(createPointKey(p), p);
      }
      initialPointsRef.current = map;
    }
  }, [validGpsData, createPointKey]);

  const visibleKeys = useMemo(
    () => new Set(currentFilteredPoints.map((p) => createPointKey(p))),
    [currentFilteredPoints, createPointKey],
  );

  // Union of the initial snapshot, all removed points, and the visible set:
  // everything that should be drawn (visible points orange, removed red).
  const allPointsByKey = useMemo(() => {
    const union = new Map<string, GPSData>();
    for (const p of allPoints ?? []) {
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
        union.set(createPointKey(p), p);
      }
    }
    if (initialPointsRef.current) {
      for (const [k, v] of initialPointsRef.current.entries()) {
        union.set(k, v);
      }
    }
    for (const p of deletedPointsStack.flat()) {
      union.set(createPointKey(p), p);
    }
    for (const p of currentFilteredPoints) {
      union.set(createPointKey(p), p);
    }
    return union;
  }, [allPoints, deletedPointsStack, currentFilteredPoints, createPointKey]);

  // Sync visible points when parent-provided data changes (e.g., time filter).
  // This treats externally excluded points like "removed" without losing
  // manual removals.
  useEffect(() => {
    const manualRemovedKeys = new Set<string>();
    for (const group of deletedPointsStack) {
      for (const p of group) {
        manualRemovedKeys.add(createPointKey(p));
      }
    }
    const nextVisible = validGpsData.filter(
      (p) => !manualRemovedKeys.has(createPointKey(p)),
    );

    // Only update if the filtered points have actually changed
    setCurrentFilteredPoints((prev) => {
      if (prev.length === nextVisible.length) {
        const prevKeys = new Set(prev.map((p) => createPointKey(p)));
        const unchanged = nextVisible.every((p) =>
          prevKeys.has(createPointKey(p)),
        );
        if (unchanged) return prev;
      }
      return nextVisible;
    });
  }, [validGpsData, deletedPointsStack, createPointKey]);

  // ---------------------------------------------------------------------
  // Lazy object URLs for image previews (created on demand, cached, revoked
  // on unmount).
  // ---------------------------------------------------------------------
  const objectUrlCacheRef = useRef<Map<string, string>>(new Map());

  const fileByPath = useMemo(() => {
    const m = new Map<string, File>();
    for (const f of imageFiles ?? []) {
      const p = f.webkitRelativePath;
      if (p) m.set(p.toLowerCase(), f);
    }
    return m;
  }, [imageFiles]);

  const getObjectUrl = useCallback(
    (filepath: string): string | null => {
      if (!filepath) return null;
      const key = filepath.toLowerCase();
      const cached = objectUrlCacheRef.current.get(key);
      if (cached) return cached;
      const file = fileByPath.get(key);
      if (!file) return null;
      const url = URL.createObjectURL(file);
      objectUrlCacheRef.current.set(key, url);
      return url;
    },
    [fileByPath],
  );

  useEffect(() => {
    const cache = objectUrlCacheRef.current;
    return () => {
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
    };
  }, []);

  // ---------------------------------------------------------------------
  // Point actions
  // ---------------------------------------------------------------------

  // Latest state for the once-registered map event handlers, and so the
  // action handlers below can read fresh values and call onFilter outside a
  // state updater (calling it inside one triggers a parent setState during
  // this component's render).
  const currentPointsRef = useRef(currentFilteredPoints);
  currentPointsRef.current = currentFilteredPoints;
  const deletedStackRef = useRef(deletedPointsStack);
  deletedStackRef.current = deletedPointsStack;
  const allPointsByKeyRef = useRef(allPointsByKey);
  allPointsByKeyRef.current = allPointsByKey;

  const handleRemovePoint = useCallback(
    (index: number) => {
      const prevPoints = currentPointsRef.current;
      if (index < 0 || index >= prevPoints.length) return;
      const removedPoint = prevPoints[index];
      const newPoints = prevPoints.filter((_, i) => i !== index);
      setDeletedPointsStack((prevStack) => [...prevStack, [removedPoint]]);
      setCurrentFilteredPoints(newPoints);
      onFilter(newPoints);
    },
    [onFilter],
  );

  const handleRestorePoint = useCallback(
    (point: GPSData) => {
      const keyToRestore = createPointKey(point);
      // Remove this point from the manual deleted stack so the sync effect
      // doesn't exclude it again
      setDeletedPointsStack((prev) =>
        prev
          .map((group) =>
            group.filter((p) => createPointKey(p) !== keyToRestore),
          )
          .filter((group) => group.length > 0),
      );

      const prevPoints = currentPointsRef.current;
      const alreadyVisible = prevPoints.some(
        (p) => createPointKey(p) === keyToRestore,
      );
      if (alreadyVisible) return;
      const newPoints = [...prevPoints, point];
      setCurrentFilteredPoints(newPoints);
      onFilter(newPoints);
    },
    [onFilter, createPointKey],
  );

  const handleUndo = useCallback(() => {
    const oldStack = deletedStackRef.current;
    if (oldStack.length === 0) return;
    const lastDeleted = oldStack[oldStack.length - 1];
    const newVisible = [...currentPointsRef.current, ...lastDeleted];
    setDeletedPointsStack(oldStack.slice(0, oldStack.length - 1));
    setCurrentFilteredPoints(newVisible);
    onFilter(newVisible);
  }, [onFilter]);

  const actionsRef = useRef<{
    removeByKey: (key: string) => void;
    restoreByKey: (key: string) => void;
    viewByKey: (key: string) => void;
    getObjectUrl: (filepath: string) => string | null;
  } | null>(null);
  actionsRef.current = {
    removeByKey: (key: string) => {
      const index = currentPointsRef.current.findIndex(
        (p) => createPointKey(p) === key,
      );
      if (index !== -1) handleRemovePoint(index);
      popupRef.current?.remove();
    },
    restoreByKey: (key: string) => {
      const point = allPointsByKeyRef.current.get(key);
      if (point) handleRestorePoint(point);
      popupRef.current?.remove();
    },
    viewByKey: (key: string) => {
      const index = currentPointsRef.current.findIndex(
        (p) => createPointKey(p) === key,
      );
      if (index !== -1) {
        setCurrentImageIndex(index);
        setShowImageModal(true);
        popupRef.current?.remove();
      }
    },
    getObjectUrl,
  };

  // Build the popup content with plain DOM (the popup lives outside the React
  // tree). Buttons dispatch through actionsRef so they always see fresh state.
  const openPointPopup = useCallback((props: PopupProps) => {
    const map = mapRef.current;
    if (!map) return;
    popupRef.current?.remove();

    const container = document.createElement('div');
    container.style.cssText = 'width:220px;color:#212529;font-size:13px';

    const url = props.filepath
      ? actionsRef.current?.getObjectUrl(props.filepath)
      : null;
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = props.filepath ?? '';
      img.style.cssText =
        'width:100%;height:140px;object-fit:contain;display:block;background:#f1f3f5;margin-bottom:8px';
      container.appendChild(img);
    }

    const name = document.createElement('div');
    name.style.cssText =
      'font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    name.textContent = props.filepath
      ? (props.filepath.split('/').pop() ?? props.filepath)
      : `${props.lat.toFixed(5)}, ${props.lng.toFixed(5)}`;
    if (props.filepath) name.title = props.filepath;
    container.appendChild(name);

    const details = document.createElement('div');
    details.style.cssText = 'color:#6c757d;font-size:12px';
    details.textContent = [
      props.timestamp
        ? new Date(props.timestamp)
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ') + ' UTC'
        : null,
      Number.isFinite(props.alt) ? `Alt ${props.alt}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    container.appendChild(details);

    if (props.state === 'outside') {
      const note = document.createElement('div');
      note.style.cssText = 'margin-top:8px;color:#6c757d;font-size:12px';
      note.textContent =
        'Outside the survey area. Change the boundary to include it.';
      container.appendChild(note);
    } else {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;margin-top:8px';
      if (url && props.state === 'included') {
        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = buttonVariants({
          variant: 'outline-secondary',
          size: 'sm',
          className: 'flex-1',
        });
        viewBtn.textContent = 'View';
        viewBtn.onclick = () => actionsRef.current?.viewByKey(props.key);
        actions.appendChild(viewBtn);
      }
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      const included = props.state === 'included';
      actionBtn.className = buttonVariants({
        variant: included ? 'danger' : 'success',
        size: 'sm',
        className: 'flex-1',
      });
      actionBtn.textContent = included ? 'Remove' : 'Add back';
      actionBtn.onclick = () =>
        included
          ? actionsRef.current?.removeByKey(props.key)
          : actionsRef.current?.restoreByKey(props.key);
      actions.appendChild(actionBtn);
      container.appendChild(actions);
    }

    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      maxWidth: '280px',
    })
      .setLngLat([props.lng, props.lat])
      .setDOMContent(container)
      .addTo(map);
  }, []);
  const openPointPopupRef = useRef(openPointPopup);
  openPointPopupRef.current = openPointPopup;

  // ---------------------------------------------------------------------
  // GeoJSON derivations
  // ---------------------------------------------------------------------

  // Rebuilt (and pushed via setData) only on explicit filter actions — cheap
  // compared to re-rendering per-point DOM markers.
  const pointsFC = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: Array.from(allPointsByKey.entries()).map(([key, p]) => ({
        type: 'Feature',
        properties: {
          key,
          filepath: p.filepath,
          timestamp: p.timestamp,
          lat: p.lat,
          lng: p.lng,
          alt: p.alt,
          state: visibleKeys.has(key)
            ? 'included'
            : outsideAreaKeys.has(key)
              ? 'outside'
              : 'removed',
        },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    }),
    [allPointsByKey, visibleKeys, outsideAreaKeys],
  );

  const areaFC = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: [
        ...(area?.boundary ? [{ ring: area.boundary, role: 'boundary' }] : []),
        ...(area?.exclusions ?? []).map((ring) => ({
          ring,
          role: 'exclusion',
        })),
      ].flatMap(({ ring, role }) => {
        const polygon = ringToPolygon(ring);
        return polygon ? [{ ...polygon, properties: { role } }] : [];
      }),
    }),
    [area],
  );

  const existingFC = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: validExistingImages.map((p) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    }),
    [validExistingImages],
  );

  // ---------------------------------------------------------------------
  // Map initialisation (once)
  // ---------------------------------------------------------------------
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
      new maplibregl.ScaleControl({ unit: 'metric' }),
      'bottom-left',
    );

    map.on('load', () => {
      map.addSource(SRC_POINTS, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_EXISTING, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_AREA, { type: 'geojson', data: EMPTY_FC as any });

      map.addLayer({
        id: LYR_AREA,
        type: 'line',
        source: SRC_AREA,
        paint: {
          'line-color': [
            'match',
            ['get', 'role'],
            'boundary',
            '#97009c',
            '#ff0000',
          ],
          'line-width': 2,
        },
      });

      // Existing survey images: faint cyan, non-interactive, under the points.
      map.addLayer({
        id: LYR_EXISTING,
        type: 'circle',
        source: SRC_EXISTING,
        paint: {
          'circle-radius': 4,
          'circle-color': EXISTING_COLOR,
          'circle-opacity': 0.15,
          'circle-stroke-color': EXISTING_COLOR,
          'circle-stroke-opacity': 0.3,
          'circle-stroke-width': 1,
        },
      });

      map.addLayer({
        id: LYR_POINTS,
        type: 'circle',
        source: SRC_POINTS,
        paint: {
          'circle-radius': 5,
          'circle-color': POINT_COLOR,
          'circle-opacity': 0.7,
          'circle-stroke-width': 1,
          'circle-stroke-color': POINT_COLOR,
        },
      });

      map.on('click', LYR_POINTS, (e) => {
        if (drawingRef.current) return; // drawing mode owns map clicks
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as unknown as PopupProps;
        openPointPopupRef.current(props);
      });

      map.on('mouseenter', LYR_POINTS, () => {
        if (!drawingRef.current) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', LYR_POINTS, () => {
        if (!drawingRef.current) map.getCanvas().style.cursor = '';
      });

      // A finished shape applies straight away: keep or remove what's inside.
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: (['keep', 'remove'] as DrawTool[]).map(
          (tool) =>
            new TerraDrawPolygonMode({
              modeName: tool,
              styles: {
                fillColor: SHAPE_COLOR[tool] as `#${string}`,
                fillOpacity: 0.15,
                outlineColor: SHAPE_COLOR[tool] as `#${string}`,
                outlineWidth: 2,
              },
            }),
        ),
      });
      draw.on('finish', (id) => {
        const feature = draw.getSnapshot().find((f) => f.id === id);
        if (feature) applyShapeRef.current(feature as Shape);
      });
      drawRef.current = draw;

      setMapLoaded(true);
    });

    // Wizard steps show/hide this map with display:none; keep the canvas in
    // sync with the container's real size whenever it changes.
    const resizeObserver = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {
        /* map torn down; ignore */
      }
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      setMapLoaded(false);
      popupRef.current?.remove();
      popupRef.current = null;
      try {
        drawRef.current?.stop();
      } catch {
        /* ignore */
      }
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Push points into the source; fit bounds on first non-empty data.
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    const src = map?.getSource(SRC_POINTS) as
      maplibregl.GeoJSONSource | undefined;
    if (!map || !src) return;
    src.setData(pointsFC as any);

    if (!didFitRef.current && pointsFC.features.length > 0) {
      didFitRef.current = true;
      let minLng = Infinity;
      let minLat = Infinity;
      let maxLng = -Infinity;
      let maxLat = -Infinity;
      for (const f of pointsFC.features) {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 40, maxZoom: 16, duration: 0 },
      );
    }
  }, [mapLoaded, pointsFC]);

  // Existing survey images source + visibility toggle.
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    const src = map?.getSource(SRC_EXISTING) as
      maplibregl.GeoJSONSource | undefined;
    if (!map || !src) return;
    src.setData(existingFC as any);
    map.setLayoutProperty(
      LYR_EXISTING,
      'visibility',
      showExistingImages ? 'visible' : 'none',
    );
  }, [mapLoaded, existingFC, showExistingImages]);

  useEffect(() => {
    if (!mapLoaded) return;
    const src = mapRef.current?.getSource(SRC_AREA) as
      maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(areaFC as any);
  }, [mapLoaded, areaFC]);

  // ---------------------------------------------------------------------
  // Polygon drawing / filtering
  // ---------------------------------------------------------------------

  const stopDrawing = useCallback(() => {
    const map = mapRef.current;
    const draw = drawRef.current;
    try {
      draw?.clear();
      draw?.stop();
    } catch {
      /* ignore */
    }
    drawingRef.current = null;
    setDrawTool(null);
    if (map) map.getCanvas().style.cursor = '';
  }, []);

  const startDrawing = useCallback(
    (tool: DrawTool) => {
      const map = mapRef.current;
      const draw = drawRef.current;
      if (!map || !draw) return;
      if (drawingRef.current === tool) {
        stopDrawing();
        return;
      }
      try {
        popupRef.current?.remove();
        if (draw.enabled) draw.clear();
        else draw.start();
        draw.setMode(tool);
        drawingRef.current = tool;
        setDrawTool(tool);
        map.getCanvas().style.cursor = 'crosshair';
      } catch (err) {
        console.error('Failed to start drawing:', err);
      }
    },
    [stopDrawing],
  );

  applyShapeRef.current = (polygon) => {
    const keep = drawingRef.current === 'keep';
    const newVisiblePoints: GPSData[] = [];
    const removedPoints: GPSData[] = [];
    for (const point of currentPointsRef.current) {
      const inside = booleanPointInPolygon([point.lng, point.lat], polygon);
      if (inside === keep) newVisiblePoints.push(point);
      else removedPoints.push(point);
    }
    if (removedPoints.length > 0) {
      // Record the removed points (for undo) and update current visible points
      setDeletedPointsStack((prev) => [...prev, removedPoints]);
      setCurrentFilteredPoints(newVisiblePoints);
      onFilter(newVisiblePoints);
    }
    // Leave terra-draw's finish handler before tearing the drawing down.
    setTimeout(stopDrawing);
  };

  // ---------------------------------------------------------------------
  // Image modal handlers
  // ---------------------------------------------------------------------

  const handleCloseModal = useCallback(() => {
    setShowImageModal(false);
  }, []);

  const handleNextImage = useCallback(() => {
    setCurrentImageIndex((prev) => (prev + 1) % currentFilteredPoints.length);
  }, [currentFilteredPoints.length]);

  const handlePrevImage = useCallback(() => {
    setCurrentImageIndex((prev) =>
      prev === 0 ? currentFilteredPoints.length - 1 : prev - 1,
    );
  }, [currentFilteredPoints.length]);

  const handleRemoveImage = useCallback(() => {
    handleRemovePoint(currentImageIndex);
    // Adjust current index if we're removing the last image or if the index is now out of bounds
    if (currentFilteredPoints.length === 1) {
      setShowImageModal(false);
    } else if (currentImageIndex >= currentFilteredPoints.length - 1) {
      setCurrentImageIndex(currentFilteredPoints.length - 2);
    }
  }, [currentImageIndex, currentFilteredPoints.length, handleRemovePoint]);

  const handleRotateImage = useCallback(() => {
    setImageRotation((prev) => (prev + 90) % 360);
  }, []);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const p of allPointsByKeyRef.current.values())
      bounds.extend([p.lng, p.lat]);
    if (bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 0 });
  }, []);

  const toggleFullscreen = () => {
    const frame = frameRef.current;
    if (!frame) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.requestFullscreen?.();
  };

  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Shortcuts only while this map is on screen; wizard steps stay mounted.
  const shortcutsRef = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutsRef.current = (e: KeyboardEvent) => {
    const frame = frameRef.current;
    if (!frame || !frame.offsetParent || !mapLoaded) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (key === 'f') fitAll();
    else if (key === 'l') setPanelOpen((open) => !open);
    else if (key === 'k') startDrawing('keep');
    else if (key === 'r') startDrawing('remove');
    else if ((key === 'v' || key === 'escape') && drawingRef.current) {
      stopDrawing();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutsRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const counts = useMemo(() => {
    const tally = { included: 0, removed: 0, outside: 0 };
    for (const feature of pointsFC.features) {
      tally[(feature.properties as PopupProps).state]++;
    }
    return tally;
  }, [pointsFC]);

  const legend = [
    { label: 'To upload', color: INCLUDED_COLOR, count: counts.included },
    { label: 'Removed', color: REMOVED_COLOR, count: counts.removed },
    ...(counts.outside > 0
      ? [
          {
            label: 'Outside survey area',
            color: OUTSIDE_COLOR,
            count: counts.outside,
          },
        ]
      : []),
  ];

  const hint =
    drawTool === 'keep'
      ? 'Draw around the images to keep · double-click to finish'
      : drawTool === 'remove'
        ? 'Draw around the images to remove · double-click to finish'
        : deletedPointsStack.length === 0
          ? 'Click an image to inspect it, or draw a shape to keep or remove images'
          : null;

  return (
    <>
      <div
        ref={frameRef}
        className={cn(
          'survey-map',
          fullscreen && 'h-full rounded-none border-0',
        )}
      >
        {/* Inline: maplibre's unlayered CSS overrides layered utilities here. */}
        <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />

        <div
          className={cn(
            'absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2',
            MAP_CONTROLS,
          )}
        >
          <MapButton
            tipSide='top'
            label='Inspect images'
            shortcut='V'
            active={!drawTool}
            disabled={!mapLoaded}
            onClick={() => drawTool && stopDrawing()}
          >
            <MousePointer2Icon className='size-4' />
          </MapButton>
          <div className={MAP_DIVIDER} />
          <MapButton
            tipSide='top'
            label='Draw a shape to keep only the images inside'
            shortcut='K'
            active={drawTool === 'keep'}
            disabled={!mapLoaded}
            onClick={() => startDrawing('keep')}
          >
            <PentagonIcon
              className='size-4'
              style={{ color: SHAPE_COLOR.keep }}
            />
          </MapButton>
          <MapButton
            tipSide='top'
            label='Draw a shape to remove the images inside'
            shortcut='R'
            active={drawTool === 'remove'}
            disabled={!mapLoaded}
            onClick={() => startDrawing('remove')}
          >
            <PentagonIcon
              className='size-4'
              style={{ color: SHAPE_COLOR.remove }}
            />
          </MapButton>
          <div className={MAP_DIVIDER} />
          <MapButton
            tipSide='top'
            label='Undo'
            shortcut='Ctrl Z'
            disabled={deletedPointsStack.length === 0}
            onClick={handleUndo}
          >
            <Undo2Icon className='size-4' />
          </MapButton>
        </div>

        <div className='absolute top-3 right-3 z-10 flex max-h-[calc(100%-1.5rem)] items-start'>
          {panelOpen ? (
            <div
              className='flex max-h-full w-80 flex-col overflow-hidden bg-white text-foreground shadow-lg'
              style={LIGHT_THEME}
            >
              <div className='flex items-center gap-2 border-b border-black/10 px-3 py-2 text-sm'>
                <LayersIcon className='size-4' />
                <span className='flex-1 font-semibold'>Images</span>
                <Kbd>L</Kbd>
                <button
                  type='button'
                  aria-label='Hide panel'
                  onClick={() => setPanelOpen(false)}
                  className='p-0.5 hover:text-primary'
                >
                  <XIcon className='size-4' />
                </button>
              </div>
              <div className='flex flex-col overflow-y-auto'>
                <div className='py-1'>
                  {legend.map(({ label, color, count }) => (
                    <div
                      key={label}
                      className='flex items-center gap-2 px-3 py-1.5 text-sm'
                    >
                      <span
                        className='inline-block size-2.5 shrink-0 rounded-full'
                        style={{ background: color }}
                      />
                      <span className='flex-1'>{label}</span>
                      <span className='text-muted-foreground tabular-nums'>
                        {count.toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {validExistingImages.length > 0 && (
                    <div className='flex items-center gap-2 px-3 py-1.5 text-sm'>
                      <span
                        className='inline-block size-2.5 shrink-0 rounded-full border'
                        style={{
                          background: `${EXISTING_COLOR}40`,
                          borderColor: EXISTING_COLOR,
                        }}
                      />
                      <span className='flex-1'>Already in the survey</span>
                      <span className='text-muted-foreground tabular-nums'>
                        {validExistingImages.length.toLocaleString()}
                      </span>
                      <button
                        type='button'
                        title={showExistingImages ? 'Hide' : 'Show'}
                        aria-label={
                          showExistingImages
                            ? 'Hide images already in the survey'
                            : 'Show images already in the survey'
                        }
                        aria-pressed={showExistingImages}
                        className='p-1 opacity-60 hover:text-primary hover:opacity-100'
                        onClick={() => setShowExistingImages((show) => !show)}
                      >
                        {showExistingImages ? (
                          <EyeIcon className='size-3.5' />
                        ) : (
                          <EyeOffIcon className='size-3.5' />
                        )}
                      </button>
                    </div>
                  )}
                </div>
                {children}
              </div>
            </div>
          ) : (
            <MapButton
              label='Show panel'
              shortcut='L'
              tipSide='left'
              className={MAP_CONTROLS}
              onClick={() => setPanelOpen(true)}
            >
              <LayersIcon className='size-4' />
            </MapButton>
          )}
        </div>

        <div
          className={cn(
            'absolute top-3 left-3 z-10 flex flex-col',
            MAP_CONTROLS,
          )}
        >
          <MapButton
            label={fullscreen ? 'Exit full screen' : 'Full screen'}
            shortcut={fullscreen ? 'Esc' : undefined}
            onClick={toggleFullscreen}
          >
            {fullscreen ? (
              <Minimize2Icon className='size-4' />
            ) : (
              <Maximize2Icon className='size-4' />
            )}
          </MapButton>
          <div className='mx-2 h-px bg-black/15' />
          <MapButton label='Zoom in' onClick={() => mapRef.current?.zoomIn()}>
            <PlusIcon className='size-4' />
          </MapButton>
          <MapButton label='Zoom out' onClick={() => mapRef.current?.zoomOut()}>
            <MinusIcon className='size-4' />
          </MapButton>
          <MapButton label='Fit to images' shortcut='F' onClick={fitAll}>
            <ScanIcon className='size-4' />
          </MapButton>
        </div>

        {hint && (
          <div className='pointer-events-none absolute bottom-[5.5rem] left-1/2 z-10 -translate-x-1/2'>
            <div
              className={cn(
                'flex items-center gap-2 border border-black/10 px-3 py-1.5 text-xs whitespace-nowrap text-[#212529]',
                MAP_CONTROLS,
              )}
            >
              {hint}
              {drawTool && <Kbd>Esc cancel</Kbd>}
            </div>
          </div>
        )}
      </div>

      <GPSSubsetImageViewerModal
        showImageModal={showImageModal}
        imageData={{
          currentImageIndex,
          currentFilteredPoints,
          getObjectUrl,
          imageRotation,
        }}
        handlers={{
          handleCloseModal,
          handleNextImage,
          handlePrevImage,
          handleRotateImage,
          handleRemoveImage,
        }}
      />
    </>
  );
};

export default React.memo(GPSSubset);
