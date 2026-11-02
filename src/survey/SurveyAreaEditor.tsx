import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormText } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import * as maplibregl from 'maplibre-gl';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';

import { cn } from '@/lib/utils';
import * as turf from '@turf/turf';
import {
  CrosshairIcon,
  LayersIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  MousePointer2Icon,
  PentagonIcon,
  PlusIcon,
  Redo2Icon,
  ScanIcon,
  SplineIcon,
  Trash2Icon,
  Undo2Icon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRenderMode,
  TerraDrawSelectMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import FileInput from '../FileInput';
import { BASE_STYLE, EMPTY_FC, type FeatureCollection } from './surveyMapStyle';

import './surveyMap.css';

import { Kbd, MapButton } from './mapControls';
import { LIGHT_THEME, MAP_CONTROLS, MAP_DIVIDER } from './mapTheme';
import {
  applyImport,
  ringAreaKm2,
  ringToPolygon,
  setImportRole,
  suggestRoles,
  traceAroundPoints,
  type AreaRole,
  type ImportedPolygon,
  type LatLng,
  type SurveyArea,
} from './new-survey/surveyArea';
import { AREA_FILE_TYPES, readAreaFiles } from './new-survey/surveyAreaImport';
import {
  connect,
  EMPTY_NETWORK,
  moveNode,
  removeEdge,
  removeNode,
  type NetworkTarget,
  type StrataNetwork,
} from './strataNetwork';
import { strataColors } from './transectStrata';

export type AreaPoint = {
  lat: number;
  lng: number;
  state: 'upload' | 'skipped' | 'uploaded';
};

export interface StrataEditing {
  sections: LatLng[][];
  names: string[];
  onNameChange: (index: number, name: string) => void;
  invalid?: boolean[];
  dangling?: boolean;
  status?: ReactNode;
}

interface SurveyAreaEditorProps {
  value: SurveyArea;
  onChange: (area: SurveyArea) => void;
  points?: AreaPoint[];
  locked?: boolean;
  children?: ReactNode;
  strata?: StrataEditing;
}

// Separate polygon modes allow different boundary and exclusion styles.
const MODE_BOUNDARY = 'boundary';
const MODE_EXCLUSION = 'exclusion';
const MODE_SELECT = 'select';
const MODE_IDLE = 'idle';

const BOUNDARY_COLOR = '#97009c';
const EXCLUSION_COLOR = '#ff0000';
const IGNORED_COLOR = '#6c757d';

const SRC_POINTS = 'area-points';
const LYR_POINTS = 'area-points-circles';
const SRC_STRATA = 'area-strata';
const LYR_STRATA_FILL = 'area-strata-fill';
const LYR_STRATA_LABEL = 'area-strata-label';
const SRC_NETWORK = 'area-network';
const LYR_NETWORK_LINE = 'area-network-line';
const LYR_NETWORK_NODE = 'area-network-node';
const SRC_PREVIEW = 'area-preview';
const LYR_PREVIEW_LINE = 'area-preview-line';
const LYR_PREVIEW_NODE = 'area-preview-node';
const NETWORK_COLOR = '#1f78d1';
const SNAP_PX = 10;
const DRAG_PX = 3;
const SRC_IMPORT = 'area-import';
const LYR_IMPORT_FILL = 'area-import-fill';
const LYR_IMPORT_LINE = 'area-import-line';
const LYR_IMPORT_LABEL = 'area-import-label';

const HISTORY_LIMIT = 30;

type Tool = 'boundary' | 'exclusion' | 'strata';

type Hit = NetworkTarget & { snapped: boolean };

type Preview = { from: LatLng | null; to: LatLng; snapped: boolean };

// Nearest point on a-b to p, as a fraction along a-b and a pixel distance.
function nearestOnSegment(
  p: maplibregl.Point,
  a: maplibregl.Point,
  b: maplibregl.Point,
): { t: number; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { t, d: Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) };
}

// Interpolated in degrees so the point lies on the stored straight segment.
const along = (a: LatLng, b: LatLng, t: number): LatLng => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

const ROLE_COLOR = [
  'match',
  ['get', 'role'],
  'boundary',
  BOUNDARY_COLOR,
  'exclusion',
  EXCLUSION_COLOR,
  IGNORED_COLOR,
] as any;

const SELECT_FLAGS = {
  feature: {
    draggable: false,
    coordinates: {
      draggable: true,
      midpoints: { draggable: true },
      deletable: true,
    },
  },
};

// [lat,lng] ring -> Terra Draw polygon, rounded to the adapter's precision.
function ringToDrawFeature(
  ring: LatLng[],
  mode: string,
  id: string | number,
  precision: number,
): any | null {
  const scale = 10 ** precision;
  const round = (value: number) => Math.round(value * scale) / scale;
  const polygon = ringToPolygon(
    ring.map(([lat, lng]) => [round(lat), round(lng)] as LatLng),
  );
  if (!polygon) return null;
  return {
    id,
    type: 'Feature',
    geometry: polygon.geometry,
    properties: { mode },
  };
}

// Terra Draw polygon ([lng,lat], closed) -> open [lat,lng] ring.
function drawFeatureToRing(feature: any): LatLng[] {
  const ring = (feature.geometry.coordinates[0] as [number, number][]).map(
    ([lng, lat]) => [lat, lng] as LatLng,
  );
  if (ring.length > 1) {
    const [firstLat, firstLng] = ring[0];
    const [lastLat, lastLng] = ring[ring.length - 1];
    if (firstLat === lastLat && firstLng === lastLng) ring.pop();
  }
  return ring;
}

function areaPolygons(draw: TerraDraw, mode: string): any[] {
  return draw
    .getSnapshot()
    .filter(
      (feature: any) =>
        feature.geometry?.type === 'Polygon' &&
        feature.properties?.mode === mode,
    );
}

function formatArea(km2: number): string {
  if (km2 >= 100) return `${Math.round(km2).toLocaleString()} km²`;
  if (km2 >= 1) return `${km2.toFixed(1)} km²`;
  return `${km2.toFixed(2)} km²`;
}

export default function SurveyAreaEditor({
  value,
  onChange,
  points,
  locked = false,
  children,
  strata,
}: SurveyAreaEditorProps) {
  const inputId = useId();
  const [mapLoaded, setMapLoaded] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(
    null,
  );
  const [history, setHistory] = useState<SurveyArea[]>([]);
  const [future, setFuture] = useState<SurveyArea[]>([]);
  const [pendingImport, setPendingImport] = useState<ImportedPolygon[] | null>(
    null,
  );
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragNetwork, setDragNetwork] = useState<StrataNetwork | null>(null);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const precisionRef = useRef(9);
  // The area the draw store currently shows; other values get re-seeded.
  const syncedRef = useRef<SurveyArea | null>(null);
  const fittedRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const toolRef = useRef(activeTool);
  toolRef.current = activeTool;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const frameRef = useRef<HTMLDivElement>(null);
  const [layersOpen, setLayersOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const chainRef = useRef<NetworkTarget | null>(null);
  const dragRef = useRef<{ index: number; x: number; y: number } | null>(null);
  const dragNetworkRef = useRef<StrataNetwork | null>(null);
  const suppressClickRef = useRef(false);

  const commit = useCallback((next: SurveyArea, fromDraw = false) => {
    const previous = valueRef.current;
    // Finishing a polygon reports the same area through two draw events.
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    valueRef.current = next;
    setHistory((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), previous]);
    setFuture([]);
    if (fromDraw) syncedRef.current = next;
    onChangeRef.current(next);
  }, []);

  const fitTo = useCallback((positions: { lat: number; lng: number }[]) => {
    const map = mapRef.current;
    if (!map) return false;
    const bounds = new maplibregl.LngLatBounds();
    for (const { lat, lng } of positions) {
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        bounds.extend([lng, lat]);
      }
    }
    if (bounds.isEmpty()) return false;
    map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 0 });
    return true;
  }, []);

  const fitToRings = useCallback(
    (rings: LatLng[][]) =>
      fitTo(rings.flat().map(([lat, lng]) => ({ lat, lng }))),
    [fitTo],
  );

  const fitAll = useCallback(() => {
    const area = valueRef.current;
    const rings = [
      ...(area.boundary ? [area.boundary] : []),
      ...area.exclusions,
    ];
    return fitTo([
      ...rings.flat().map(([lat, lng]) => ({ lat, lng })),
      ...(pointsRef.current ?? []),
    ]);
  }, [fitTo]);

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

    const commitSnapshot = () => {
      const draw = drawRef.current;
      if (!draw) return;
      const boundary = areaPolygons(draw, MODE_BOUNDARY)[0];
      commit(
        {
          ...valueRef.current,
          boundary: boundary ? drawFeatureToRing(boundary) : null,
          exclusions: areaPolygons(draw, MODE_EXCLUSION).map(drawFeatureToRing),
        },
        true,
      );
    };

    const hitTest = (lngLat: maplibregl.LngLat, skipNode?: number): Hit => {
      const p = map.project(lngLat);
      const area = valueRef.current;
      const { nodes, edges } = area.network ?? EMPTY_NETWORK;
      const px = ([lat, lng]: LatLng) => map.project([lng, lat]);
      let best: { hit: Hit; d: number } | null = null;
      nodes.forEach((node, index) => {
        if (index === skipNode) return;
        const d = px(node).dist(p);
        if (d <= SNAP_PX && (!best || d < best.d)) {
          best = { hit: { kind: 'node', index, snapped: true }, d };
        }
      });
      if (best) return (best as { hit: Hit }).hit;
      edges.forEach(([a, b], edge) => {
        if (a === skipNode || b === skipNode) return;
        const { t, d } = nearestOnSegment(p, px(nodes[a]), px(nodes[b]));
        if (d <= SNAP_PX && (!best || d < best.d)) {
          const point = along(nodes[a], nodes[b], t);
          best = { hit: { kind: 'edge', edge, point, snapped: true }, d };
        }
      });
      const ring = area.boundary ?? [];
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length];
        const { t, d } = nearestOnSegment(p, px(a), px(b));
        if (d <= SNAP_PX && (!best || d < best.d)) {
          const point = along(a, b, t);
          best = { hit: { kind: 'point', point, snapped: true }, d };
        }
      });
      if (best) return (best as { hit: Hit }).hit;
      return { kind: 'point', point: [lngLat.lat, lngLat.lng], snapped: false };
    };

    const hitPoint = (hit: NetworkTarget): LatLng =>
      hit.kind === 'node'
        ? (valueRef.current.network ?? EMPTY_NETWORK).nodes[hit.index]
        : hit.point;

    map.on('mousemove', (e) => {
      if (toolRef.current !== 'strata') return;
      const drag = dragRef.current;
      if (drag) {
        if (
          !dragNetworkRef.current &&
          Math.hypot(e.point.x - drag.x, e.point.y - drag.y) < DRAG_PX
        ) {
          return;
        }
        const hit = hitTest(e.lngLat, drag.index);
        const next = moveNode(
          valueRef.current.network ?? EMPTY_NETWORK,
          drag.index,
          hit.kind === 'edge' ? hit.point : hitPoint(hit),
        );
        dragNetworkRef.current = next;
        setDragNetwork(next);
        return;
      }
      const hit = hitTest(e.lngLat);
      const chain = chainRef.current;
      setPreview({
        from: chain ? hitPoint(chain) : null,
        to: hitPoint(hit),
        snapped: hit.snapped,
      });
    });

    map.on('mousedown', (e) => {
      suppressClickRef.current = false;
      if (
        toolRef.current !== 'strata' ||
        chainRef.current ||
        e.originalEvent.button !== 0
      ) {
        return;
      }
      const hit = hitTest(e.lngLat);
      if (hit.kind !== 'node') return;
      // Keeps the map from panning while a point is dragged.
      e.preventDefault();
      dragRef.current = { index: hit.index, x: e.point.x, y: e.point.y };
    });

    map.on('mouseup', () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      const moved = dragNetworkRef.current;
      dragNetworkRef.current = null;
      setDragNetwork(null);
      if (!moved) return;
      suppressClickRef.current = true;
      commit({ ...valueRef.current, network: moved });
    });

    map.on('click', (e) => {
      if (toolRef.current !== 'strata') return;
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const hit = hitTest(e.lngLat);
      const chain = chainRef.current;
      if (!chain) {
        chainRef.current = hit;
        return;
      }
      const area = valueRef.current;
      const { network, end } = connect(
        area.network ?? EMPTY_NETWORK,
        chain,
        hit,
      );
      commit({ ...area, network });
      chainRef.current = hit.snapped ? null : { kind: 'node', index: end };
      setPreview(null);
    });

    map.on('contextmenu', (e) => {
      if (toolRef.current !== 'strata') return;
      chainRef.current = null;
      setPreview(null);
      const hit = hitTest(e.lngLat);
      const area = valueRef.current;
      const network = area.network ?? EMPTY_NETWORK;
      if (hit.kind === 'node') {
        commit({ ...area, network: removeNode(network, hit.index) });
      } else if (hit.kind === 'edge') {
        commit({ ...area, network: removeEdge(network, hit.edge) });
      }
    });

    map.on('load', () => {
      for (const src of [SRC_STRATA, SRC_NETWORK, SRC_PREVIEW]) {
        map.addSource(src, { type: 'geojson', data: EMPTY_FC });
      }
      map.addLayer({
        id: LYR_STRATA_FILL,
        type: 'fill',
        source: SRC_STRATA,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['get', 'highlighted'], 0.4, 0.18],
        },
      });
      map.addLayer({
        id: LYR_NETWORK_LINE,
        type: 'line',
        source: SRC_NETWORK,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': NETWORK_COLOR, 'line-width': 3 },
      });
      map.addLayer({
        id: LYR_PREVIEW_LINE,
        type: 'line',
        source: SRC_PREVIEW,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': NETWORK_COLOR,
          'line-width': 2,
          'line-dasharray': [2, 2],
        },
      });
      map.addLayer({
        id: LYR_NETWORK_NODE,
        type: 'circle',
        source: SRC_NETWORK,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#fff',
          'circle-stroke-color': NETWORK_COLOR,
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: LYR_PREVIEW_NODE,
        type: 'circle',
        source: SRC_PREVIEW,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': ['case', ['get', 'snapped'], 7, 4],
          'circle-color': NETWORK_COLOR,
          'circle-opacity': 0.5,
        },
      });
      map.addLayer({
        id: LYR_STRATA_LABEL,
        type: 'symbol',
        source: SRC_STRATA,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 14,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#000',
          'text-halo-color': '#fff',
          'text-halo-width': 2,
        },
      });

      map.addSource(SRC_POINTS, { type: 'geojson', data: EMPTY_FC as any });
      map.addLayer({
        id: LYR_POINTS,
        type: 'circle',
        source: SRC_POINTS,
        paint: {
          'circle-radius': 4,
          'circle-opacity': 0.7,
          'circle-color': [
            'match',
            ['get', 'state'],
            'upload',
            '#ffa500',
            'uploaded',
            '#00ffff',
            '#8a8a8a',
          ],
        },
      });

      map.addSource(SRC_IMPORT, { type: 'geojson', data: EMPTY_FC as any });
      map.addLayer({
        id: LYR_IMPORT_FILL,
        type: 'fill',
        source: SRC_IMPORT,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': ROLE_COLOR, 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: LYR_IMPORT_LINE,
        type: 'line',
        source: SRC_IMPORT,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': ROLE_COLOR, 'line-width': 2 },
      });
      map.addLayer({
        id: LYR_IMPORT_LABEL,
        type: 'symbol',
        source: SRC_IMPORT,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 14,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#000',
          'text-halo-color': '#fff',
          'text-halo-width': 2,
        },
      });

      const adapter = new TerraDrawMapLibreGLAdapter({ map });
      precisionRef.current = adapter.getCoordinatePrecision();
      const draw = new TerraDraw({
        adapter,
        modes: [
          new TerraDrawPolygonMode({
            modeName: MODE_BOUNDARY,
            styles: {
              fillColor: BOUNDARY_COLOR,
              fillOpacity: 0.08,
              outlineColor: BOUNDARY_COLOR,
              outlineWidth: 2,
            },
          }),
          new TerraDrawPolygonMode({
            modeName: MODE_EXCLUSION,
            styles: {
              fillColor: EXCLUSION_COLOR,
              fillOpacity: 0.25,
              outlineColor: EXCLUSION_COLOR,
              outlineWidth: 2,
            },
          }),
          new TerraDrawSelectMode({
            flags: {
              [MODE_BOUNDARY]: SELECT_FLAGS,
              [MODE_EXCLUSION]: SELECT_FLAGS,
            },
            // Deletion goes through the editor so it is committed once.
            keyEvents: {
              deselect: 'Escape',
              delete: null,
              rotate: null,
              scale: null,
            },
          }),
          new TerraDrawRenderMode({ modeName: MODE_IDLE, styles: {} }),
        ],
      });
      drawRef.current = draw;
      draw.start();
      draw.setMode(lockedRef.current ? MODE_IDLE : MODE_SELECT);

      draw.on('finish', (id, context) => {
        const drew = context.action === 'draw';
        const drewBoundary = drew && context.mode === MODE_BOUNDARY;
        if (drewBoundary) {
          const others = areaPolygons(draw, MODE_BOUNDARY)
            .filter((feature: any) => feature.id !== id)
            .map((feature: any) => feature.id);
          if (others.length) draw.removeFeatures(others);
          // Later features draw on top and win clicks; keep exclusions above.
          const exclusions = areaPolygons(draw, MODE_EXCLUSION);
          if (exclusions.length) {
            draw.removeFeatures(exclusions.map((feature) => feature.id));
            draw.addFeatures(
              exclusions.map((feature) => ({
                ...feature,
                properties: { mode: feature.properties.mode },
              })),
            );
          }
        }
        commitSnapshot();
        // A finished shape hands back to selecting, with the new shape selected.
        if (drew) {
          draw.setMode(MODE_SELECT);
          setActiveTool(null);
          draw.selectFeature(id);
        }
      });
      draw.on('change', (_ids, type, context) => {
        const fromApi =
          !!context && 'origin' in context && context.origin === 'api';
        if (type !== 'delete' || fromApi) return;
        // Ignore deletion of selection handles.
        const synced = syncedRef.current;
        const polygonCount =
          areaPolygons(draw, MODE_BOUNDARY).length +
          areaPolygons(draw, MODE_EXCLUSION).length;
        const syncedCount = synced
          ? (synced.boundary ? 1 : 0) + synced.exclusions.length
          : 0;
        if (polygonCount !== syncedCount) commitSnapshot();
      });
      draw.on('select', (id) => setSelectedFeatureId(String(id)));
      draw.on('deselect', () => setSelectedFeatureId(null));

      // A selected boundary otherwise keeps winning clicks inside exclusions.
      map.on('click', (e) => {
        if (draw.getMode() !== MODE_SELECT) return;
        const onHandle = draw
          .getFeaturesAtLngLat(e.lngLat)
          .some((feature) => feature.geometry.type === 'Point');
        if (onHandle) return;
        const point: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const exclusion = areaPolygons(draw, MODE_EXCLUSION)
          .reverse()
          .find((feature) => turf.booleanPointInPolygon(point, feature));
        if (!exclusion) return;
        // Runs after terra-draw's own click handling.
        setTimeout(() => draw.selectFeature(exclusion.id));
      });

      setMapLoaded(true);
    });

    // Wizard steps show and hide this map; keep the canvas sized to it.
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
      try {
        drawRef.current?.stop();
      } catch {
        /* ignore */
      }
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
      syncedRef.current = null;
      fittedRef.current = false;
    };
  }, [commit]);

  const stopTool = useCallback(() => {
    try {
      drawRef.current?.setMode(lockedRef.current ? MODE_IDLE : MODE_SELECT);
    } catch {
      /* ignore */
    }
    setActiveTool(null);
    setSelectedFeatureId(null);
    chainRef.current = null;
    setPreview(null);
  }, []);

  useEffect(() => {
    const draw = drawRef.current;
    const synced = syncedRef.current;
    if (!mapLoaded || !draw) return;
    if (
      synced &&
      synced.boundary === value.boundary &&
      synced.exclusions === value.exclusions
    ) {
      return;
    }
    stopTool();
    const stale = [
      ...areaPolygons(draw, MODE_BOUNDARY),
      ...areaPolygons(draw, MODE_EXCLUSION),
    ].map((feature: any) => feature.id);
    if (stale.length) draw.removeFeatures(stale);
    const rings = [
      ...(value.boundary
        ? [{ ring: value.boundary, mode: MODE_BOUNDARY }]
        : []),
      ...value.exclusions.map((ring) => ({ ring, mode: MODE_EXCLUSION })),
    ];
    const features = rings
      .map(({ ring, mode }) =>
        ringToDrawFeature(
          ring,
          mode,
          draw.getFeatureId(),
          precisionRef.current,
        ),
      )
      .filter(Boolean);
    if (features.length) {
      const invalid = draw
        .addFeatures(features)
        .filter((result) => !result.valid);
      if (invalid.length) {
        console.error('Failed to add survey area geometry:', invalid);
      }
    }
    syncedRef.current = value;
  }, [mapLoaded, value, stopTool]);

  const pointsFC = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (points ?? [])
        .filter(
          (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
        )
        .map((point) => ({
          type: 'Feature',
          properties: { state: point.state },
          geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
        })),
    }),
    [points],
  );

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_POINTS) as
        maplibregl.GeoJSONSource | undefined
    )?.setData(pointsFC as any);
  }, [mapLoaded, pointsFC]);

  useEffect(() => {
    if (!mapLoaded || fittedRef.current) return;
    if (fitAll()) fittedRef.current = true;
  }, [mapLoaded, pointsFC, value, fitAll]);

  const importFC = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (pendingImport ?? []).flatMap((polygon, index) => {
        const feature = ringToPolygon(polygon.ring);
        if (!feature) return [];
        // Labelled at the northernmost point so nested polygons stay apart.
        const [lat, lng] = polygon.ring.reduce((top, position) =>
          position[0] > top[0] ? position : top,
        );
        return [
          { ...feature, properties: { role: polygon.role } },
          {
            type: 'Feature',
            properties: { label: String(index + 1) },
            geometry: { type: 'Point', coordinates: [lng, lat] },
          },
        ];
      }),
    }),
    [pendingImport],
  );

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_IMPORT) as
        maplibregl.GeoJSONSource | undefined
    )?.setData(importFC as any);
  }, [mapLoaded, importFC]);

  const network = dragNetwork ?? value.network ?? null;
  const sections = strata?.sections;
  const names = strata?.names;

  const strataFC = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (sections ?? []).flatMap((ring, i) => {
        const polygon = ringToPolygon(ring);
        if (!polygon) return [];
        return [
          {
            ...polygon,
            properties: {
              color: strataColors[i % strataColors.length],
              highlighted: highlighted === i,
            },
          },
          {
            ...turf.pointOnFeature(polygon),
            properties: { label: names?.[i] ?? '' },
          },
        ];
      }),
    }),
    [sections, names, highlighted],
  );

  const networkFC = useMemo<FeatureCollection>(() => {
    if (!strata || !network) return EMPTY_FC;
    const lngLat = ([lat, lng]: LatLng) => [lng, lat];
    return {
      type: 'FeatureCollection',
      features: [
        ...network.edges.map(([a, b]) => ({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [lngLat(network.nodes[a]), lngLat(network.nodes[b])],
          },
        })),
        ...network.nodes.map((node) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: lngLat(node) },
        })),
      ],
    } as FeatureCollection;
  }, [strata, network]);

  const previewFC = useMemo<FeatureCollection>(() => {
    if (!preview || activeTool !== 'strata') return EMPTY_FC;
    const lngLat = ([lat, lng]: LatLng) => [lng, lat];
    return {
      type: 'FeatureCollection',
      features: [
        ...(preview.from
          ? [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: [lngLat(preview.from), lngLat(preview.to)],
                },
              },
            ]
          : []),
        {
          type: 'Feature',
          properties: { snapped: preview.snapped },
          geometry: { type: 'Point', coordinates: lngLat(preview.to) },
        },
      ],
    } as FeatureCollection;
  }, [preview, activeTool]);

  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    const sources: [string, FeatureCollection][] = [
      [SRC_STRATA, strataFC],
      [SRC_NETWORK, networkFC],
      [SRC_PREVIEW, previewFC],
    ];
    for (const [id, data] of sources) {
      (map?.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(
        data,
      );
    }
  }, [mapLoaded, strataFC, networkFC, previewFC]);

  useEffect(() => {
    if (activeTool !== 'strata') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      chainRef.current = null;
      setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool]);

  useEffect(() => {
    if (locked) setPendingImport(null);
    if (mapLoaded) stopTool();
  }, [locked, mapLoaded, stopTool]);

  const toggleTool = (tool: Tool) => {
    const draw = drawRef.current;
    if (!draw) return;
    if (activeTool === tool) {
      stopTool();
      return;
    }
    setSelectedFeatureId(null);
    chainRef.current = null;
    setPreview(null);
    draw.setMode(
      tool === 'strata'
        ? MODE_IDLE
        : tool === 'boundary'
          ? MODE_BOUNDARY
          : MODE_EXCLUSION,
    );
    if (tool === 'strata' && !value.network) {
      commit({ ...value, network: EMPTY_NETWORK });
    }
    setActiveTool(tool);
  };

  const deleteSelected = () => {
    const draw = drawRef.current;
    if (!draw || !selectedFeatureId) return;
    const selected = draw
      .getSnapshot()
      .find((feature: any) => String(feature.id) === selectedFeatureId);
    if (!selected) return;
    const area = valueRef.current;
    if (selected.properties?.mode === MODE_BOUNDARY) {
      commit({ ...area, boundary: null });
    } else {
      const index = areaPolygons(draw, MODE_EXCLUSION).findIndex(
        (feature: any) => feature.id === selected.id,
      );
      commit({
        ...area,
        exclusions: area.exclusions.filter((_, i) => i !== index),
      });
    }
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setFuture((stack) => [...stack, valueRef.current]);
    chainRef.current = null;
    setPreview(null);
    onChange(previous);
  };

  const redo = () => {
    const next = future[future.length - 1];
    if (!next) return;
    setFuture(future.slice(0, -1));
    setHistory((stack) => [...stack, valueRef.current]);
    chainRef.current = null;
    setPreview(null);
    onChange(next);
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setImporting(true);
    try {
      const { polygons, errors } = await readAreaFiles(files);
      setImportErrors(errors);
      setImportCount((count) => count + 1);
      if (polygons.length === 0) return;
      const suggested = suggestRoles(
        polygons,
        pointsRef.current ?? [],
        valueRef.current.boundary,
      );
      stopTool();
      fitToRings(suggested.map((polygon) => polygon.ring));
      const area = valueRef.current;
      if (
        suggested.length === 1 &&
        !area.boundary &&
        area.exclusions.length === 0
      ) {
        commit(applyImport(area, [{ ...suggested[0], role: 'boundary' }]));
      } else {
        setPendingImport(suggested);
      }
    } finally {
      setImporting(false);
    }
  };

  const trace = () => {
    const ring = traceAroundPoints(points ?? []);
    if (!ring) return;
    commit({ ...value, boundary: ring });
    fitToRings([ring]);
  };

  const rings = [
    ...(value.boundary
      ? [{ label: 'Boundary', ring: value.boundary, color: BOUNDARY_COLOR }]
      : []),
    ...value.exclusions.map((ring, index) => ({
      label: `Exclusion ${index + 1}`,
      ring,
      color: EXCLUSION_COLOR,
    })),
  ];
  const removeRing = (index: number) => {
    const offset = value.boundary ? 1 : 0;
    commit(
      value.boundary && index === 0
        ? { ...value, boundary: null }
        : {
            ...value,
            exclusions: value.exclusions.filter((_, i) => i !== index - offset),
          },
    );
  };

  const fileInput = (
    <FileInput
      key={importCount}
      id={`${inputId}-area-files`}
      fileType={AREA_FILE_TYPES}
      disabled={importing}
      variant='outline-secondary'
      buttonSize='sm'
      showSelection={false}
      onFileChange={handleFiles}
    >
      {rings.length > 0 ? 'Import more' : 'Import file'}
    </FileInput>
  );

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
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && (k === 'z' || k === 'y')) {
      if (locked || pendingImport) return;
      e.preventDefault();
      if (k === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'f') fitAll();
    else if (key === 'l') setLayersOpen((open) => !open);
    if (locked || pendingImport) return;
    if (key === 'escape' && activeTool) stopTool();
    else if ((key === 'delete' || key === 'backspace') && selectedFeatureId) {
      e.preventDefault();
      deleteSelected();
    } else if (key === 'v') stopTool();
    else if (key === 'b' && !value.boundary) toggleTool('boundary');
    else if (key === 'e') toggleTool('exclusion');
    else if (key === 's' && strata && value.boundary) toggleTool('strata');
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutsRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectedKind = (() => {
    if (!selectedFeatureId) return null;
    const feature = drawRef.current
      ?.getSnapshot()
      .find((f) => String(f.id) === selectedFeatureId);
    return feature
      ? feature.properties?.mode === MODE_BOUNDARY
        ? 'boundary'
        : 'exclusion'
      : null;
  })();

  const hint = locked
    ? null
    : pendingImport
      ? 'Choose what each imported polygon is in the panel'
      : activeTool === 'strata'
        ? 'Click to place points; a line ends at the boundary or another line · drag a point to move it · right-click to delete'
        : activeTool
          ? 'Click to add corners · double-click or Enter to finish'
          : selectedKind
            ? 'Drag corners to reshape · right-click a corner to remove it'
            : rings.length === 0
              ? 'Draw a boundary, trace it around the images, or import a file'
              : null;
  const hintKeys =
    activeTool && activeTool !== 'strata'
      ? 'Esc cancel'
      : activeTool === 'strata'
        ? 'Esc stop'
        : selectedKind
          ? 'Del delete'
          : null;

  const controls = MAP_CONTROLS;
  const divider = MAP_DIVIDER;
  const canTrace = !locked && (points?.length ?? 0) > 0;

  const railTools: {
    tool: Tool | null;
    label: string;
    shortcut?: string;
    icon: ReactNode;
    disabled?: boolean;
    divider?: boolean;
  }[] = [
    {
      tool: null,
      label: 'Select and edit',
      shortcut: 'V',
      icon: <MousePointer2Icon className='size-4' />,
    },
    {
      tool: 'boundary',
      label: value.boundary
        ? 'Delete the boundary to draw a new one'
        : 'Draw boundary',
      shortcut: value.boundary ? undefined : 'B',
      icon: (
        <PentagonIcon className='size-4' style={{ color: BOUNDARY_COLOR }} />
      ),
      disabled: !!value.boundary,
      divider: true,
    },
    {
      tool: 'exclusion',
      label: 'Draw exclusion',
      shortcut: 'E',
      icon: (
        <PentagonIcon className='size-4' style={{ color: EXCLUSION_COLOR }} />
      ),
      divider: true,
    },
    ...(strata
      ? [
          {
            tool: 'strata' as Tool,
            label: 'Draw strata lines',
            shortcut: 'S',
            icon: (
              <SplineIcon className='size-4' style={{ color: NETWORK_COLOR }} />
            ),
            disabled: !value.boundary,
            divider: true,
          },
        ]
      : []),
  ];

  return (
    <div className='flex flex-col gap-2'>
      {importErrors.map((error) => (
        <Alert key={error} variant='warning' className='mb-0 p-2'>
          {error}
        </Alert>
      ))}
      <div
        ref={frameRef}
        className={cn(
          'survey-map',
          fullscreen && 'h-full rounded-none border-0',
        )}
      >
        {/* Inline: maplibre's unlayered CSS overrides layered utilities here. */}
        <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />

        {!locked && !pendingImport && (
          <div
            className={cn(
              'absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2',
              controls,
            )}
          >
            {railTools.map((item) => (
              <div key={item.label} className='flex'>
                {item.divider && <div className={divider} />}
                <MapButton
                  tipSide='top'
                  label={item.label}
                  shortcut={item.shortcut}
                  active={activeTool === item.tool}
                  disabled={!mapLoaded || item.disabled}
                  onClick={() =>
                    item.tool ? toggleTool(item.tool) : stopTool()
                  }
                >
                  {item.icon}
                </MapButton>
              </div>
            ))}
            {canTrace && (
              <>
                <div className={divider} />
                <MapButton
                  tipSide='top'
                  label='Trace boundary around images'
                  disabled={!mapLoaded}
                  onClick={trace}
                >
                  <WandSparklesIcon className='size-4' />
                </MapButton>
              </>
            )}
            <div className={divider} />
            <MapButton
              tipSide='top'
              label='Undo'
              shortcut='Ctrl Z'
              disabled={history.length === 0}
              onClick={undo}
            >
              <Undo2Icon className='size-4' />
            </MapButton>
            <MapButton
              tipSide='top'
              label='Redo'
              shortcut='Ctrl Shift Z'
              disabled={future.length === 0}
              onClick={redo}
            >
              <Redo2Icon className='size-4' />
            </MapButton>
            <MapButton
              tipSide='top'
              label='Delete selected'
              shortcut='Del'
              disabled={!selectedFeatureId}
              onClick={deleteSelected}
            >
              <Trash2Icon className='size-4' />
            </MapButton>
          </div>
        )}

        <div className='pointer-events-none absolute top-3 right-3 bottom-3 z-10 flex items-start gap-2'>
          {layersOpen ? (
            <div
              className='pointer-events-auto flex max-h-full w-80 flex-col overflow-hidden bg-white text-foreground shadow-lg'
              style={LIGHT_THEME}
            >
              <div className='flex items-center gap-2 border-b border-black/10 px-3 py-2 text-sm'>
                <LayersIcon className='size-4' />
                <span className='flex-1 font-semibold'>
                  {pendingImport
                    ? `${pendingImport.length} polygon${
                        pendingImport.length === 1 ? '' : 's'
                      } found`
                    : 'Survey area'}
                </span>
                <Kbd>L</Kbd>
                <button
                  type='button'
                  aria-label='Hide panel'
                  onClick={() => setLayersOpen(false)}
                  className='p-0.5 hover:text-primary'
                >
                  <XIcon className='size-4' />
                </button>
              </div>
              <div className='flex min-h-0 flex-col overflow-y-auto'>
                {pendingImport ? (
                  <div className='flex flex-col gap-2 p-3'>
                    <FormText className='mt-0'>
                      Choose what each polygon is. A survey has one boundary, so
                      picking a new one replaces the current choice.
                    </FormText>
                    {pendingImport.map((polygon, index) => (
                      <div
                        key={polygon.id}
                        className='flex items-center gap-2 border border-black/15 p-2'
                      >
                        <div className='min-w-0 grow'>
                          <div className='truncate text-sm'>
                            {index + 1}. {polygon.name}
                          </div>
                          <div className='truncate text-xs text-muted-foreground'>
                            {polygon.source}, {formatArea(polygon.areaKm2)}
                          </div>
                        </div>
                        <NativeSelect
                          size='sm'
                          aria-label={`Role of ${polygon.name}`}
                          style={{ width: 110, flex: '0 0 auto' }}
                          value={polygon.role}
                          onChange={(e) =>
                            setPendingImport(
                              setImportRole(
                                pendingImport,
                                polygon.id,
                                e.target.value as AreaRole,
                              ),
                            )
                          }
                        >
                          <option value='boundary'>Boundary</option>
                          <option value='exclusion'>Exclusion</option>
                          <option value='ignore'>Ignore</option>
                        </NativeSelect>
                      </div>
                    ))}
                    <div className='flex gap-2'>
                      <Button
                        size='sm'
                        variant='primary'
                        onClick={() => {
                          commit(applyImport(value, pendingImport));
                          setPendingImport(null);
                        }}
                      >
                        Use these
                      </Button>
                      <Button
                        size='sm'
                        variant='outline-secondary'
                        onClick={() => setPendingImport(null)}
                      >
                        Cancel import
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className='py-1'>
                      {rings.length === 0 && (
                        <div className='px-3 py-1.5 text-xs text-muted-foreground'>
                          {locked ? (
                            'This survey has no boundary.'
                          ) : (
                            <>
                              No boundary yet. Press <Kbd>B</Kbd> to draw one
                              {canTrace
                                ? ', trace it around the images,'
                                : ''}{' '}
                              or import a shapefile, GeoJSON or KML file.
                            </>
                          )}
                        </div>
                      )}
                      {rings.map(({ label, ring, color }, index) => (
                        <div
                          key={label}
                          className='group flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-black/5'
                        >
                          <span
                            className='inline-block size-3 shrink-0 border-2'
                            style={{
                              borderColor: color,
                              background:
                                color === EXCLUSION_COLOR
                                  ? `${color}55`
                                  : undefined,
                            }}
                          />
                          <span className='flex-1 truncate'>{label}</span>
                          <span className='text-xs text-muted-foreground'>
                            {formatArea(ringAreaKm2(ring))}
                          </span>
                          <button
                            type='button'
                            title='Zoom to'
                            aria-label={`Zoom to ${label}`}
                            className='p-1 opacity-60 group-hover:opacity-100 hover:text-primary'
                            onClick={() => fitToRings([ring])}
                          >
                            <CrosshairIcon className='size-3.5' />
                          </button>
                          {!locked && (
                            <button
                              type='button'
                              title='Delete'
                              aria-label={`Delete ${label}`}
                              className='p-1 opacity-60 group-hover:opacity-100 hover:text-danger'
                              onClick={() => removeRing(index)}
                            >
                              <Trash2Icon className='size-3.5' />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {!locked && (
                      <div className='flex flex-wrap items-center gap-2 border-t border-black/10 px-3 py-2.5'>
                        {fileInput}
                        {importing && <Spinner animation='border' size='sm' />}
                        {canTrace && !value.boundary && (
                          <Button
                            variant='outline-secondary'
                            size='sm'
                            onClick={trace}
                          >
                            <WandSparklesIcon className='size-4' />
                            Trace around images
                          </Button>
                        )}
                      </div>
                    )}
                    {children && (
                      <div className='border-t border-black/10 px-3 pt-1 pb-3'>
                        {children}
                      </div>
                    )}
                    {strata && (
                      <div className='flex flex-col gap-2 border-t border-black/10 p-3'>
                        <div className='text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
                          Strata
                        </div>
                        <FormText className='mt-0'>
                          {value.boundary ? (
                            <>
                              Press <Kbd>S</Kbd> to draw lines across the area
                              to divide it into strata, then name each one.
                              Without lines the whole area is one stratum.
                            </>
                          ) : (
                            'Add a boundary to define strata.'
                          )}
                        </FormText>
                        {strata.status}
                        {strata.sections.map((ring, i) => (
                          <div
                            key={i}
                            className='flex items-center gap-2'
                            onMouseEnter={() => setHighlighted(i)}
                            onMouseLeave={() => setHighlighted(null)}
                          >
                            <span
                              className='inline-block size-3 shrink-0'
                              style={{
                                background:
                                  strataColors[i % strataColors.length],
                              }}
                            />
                            <Input
                              size='sm'
                              aria-label={`Name of stratum ${i + 1}`}
                              value={strata.names[i] ?? ''}
                              disabled={locked}
                              aria-invalid={strata.invalid?.[i] || undefined}
                              onChange={(e) =>
                                strata.onNameChange(i, e.target.value)
                              }
                            />
                            <button
                              type='button'
                              title='Zoom to'
                              aria-label={`Zoom to stratum ${i + 1}`}
                              className='p-1 opacity-70 hover:text-primary hover:opacity-100'
                              onClick={() => fitToRings([ring])}
                            >
                              <CrosshairIcon className='size-3.5' />
                            </button>
                          </div>
                        ))}
                        {strata.dangling && (
                          <span className='text-xs text-warning'>
                            Some strata lines do not reach the boundary or
                            another line at both ends, so they do not divide the
                            area.
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <MapButton
              label='Show panel'
              shortcut='L'
              tipSide='left'
              className={cn('pointer-events-auto', controls)}
              onClick={() => setLayersOpen(true)}
            >
              <LayersIcon className='size-4' />
            </MapButton>
          )}
        </div>

        <div
          className={cn('absolute top-3 left-3 z-10 flex flex-col', controls)}
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
          <MapButton label='Fit to area' shortcut='F' onClick={fitAll}>
            <ScanIcon className='size-4' />
          </MapButton>
        </div>

        {hint && (
          <div className='pointer-events-none absolute bottom-[5.5rem] left-1/2 z-10 -translate-x-1/2'>
            <div
              className={cn(
                'flex items-center gap-2 border border-black/10 px-3 py-1.5 text-xs whitespace-nowrap text-[#212529]',
                controls,
              )}
            >
              {hint}
              {hintKeys && <Kbd>{hintKeys}</Kbd>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
