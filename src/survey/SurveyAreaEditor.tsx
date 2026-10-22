import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  TerraDrawRenderMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import * as turf from '@turf/turf';
import FileInput from '../FileInput';
import { BASE_STYLE, EMPTY_FC, type FeatureCollection } from './surveyMapStyle';
import './surveyMap.css';
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

type Tool = 'boundary' | 'exclusion' | 'edit' | 'strata';

type Hit = NetworkTarget & { snapped: boolean };

type Preview = { from: LatLng | null; to: LatLng; snapped: boolean };

// Nearest point on a-b to p, as a fraction along a-b and a pixel distance.
function nearestOnSegment(
  p: maplibregl.Point,
  a: maplibregl.Point,
  b: maplibregl.Point
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
    draggable: true,
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
  precision: number
): any | null {
  const scale = 10 ** precision;
  const round = (value: number) => Math.round(value * scale) / scale;
  const polygon = ringToPolygon(
    ring.map(([lat, lng]) => [round(lat), round(lng)] as LatLng)
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
    ([lng, lat]) => [lat, lng] as LatLng
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
        feature.properties?.mode === mode
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
    null
  );
  const [history, setHistory] = useState<SurveyArea[]>([]);
  const [pendingImport, setPendingImport] = useState<ImportedPolygon[] | null>(
    null
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
    [fitTo]
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
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right'
    );
    map.addControl(
      new maplibregl.ScaleControl({ unit: 'metric' }),
      'bottom-left'
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
        true
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
          hit.kind === 'edge' ? hit.point : hitPoint(hit)
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
        hit
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
          }),
          new TerraDrawRenderMode({ modeName: MODE_IDLE, styles: {} }),
        ],
      });
      drawRef.current = draw;
      draw.start();
      draw.setMode(MODE_IDLE);

      draw.on('finish', (id, context) => {
        const drewBoundary =
          context.action === 'draw' && context.mode === MODE_BOUNDARY;
        if (drewBoundary) {
          const others = areaPolygons(draw, MODE_BOUNDARY)
            .filter((feature: any) => feature.id !== id)
            .map((feature: any) => feature.id);
          if (others.length) draw.removeFeatures(others);
        }
        commitSnapshot();
        if (drewBoundary) {
          draw.setMode(MODE_IDLE);
          setActiveTool(null);
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
      drawRef.current?.setMode(MODE_IDLE);
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
        ringToDrawFeature(ring, mode, draw.getFeatureId(), precisionRef.current)
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
          (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
        )
        .map((point) => ({
          type: 'Feature',
          properties: { state: point.state },
          geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
        })),
    }),
    [points]
  );

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_POINTS) as
        | maplibregl.GeoJSONSource
        | undefined
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
          position[0] > top[0] ? position : top
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
    [pendingImport]
  );

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_IMPORT) as
        | maplibregl.GeoJSONSource
        | undefined
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
    [sections, names, highlighted]
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
        data
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
    if (locked) {
      stopTool();
      setPendingImport(null);
    }
  }, [locked, stopTool]);

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
        : tool === 'edit'
        ? MODE_SELECT
        : tool === 'boundary'
        ? MODE_BOUNDARY
        : MODE_EXCLUSION
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
        (feature: any) => feature.id === selected.id
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
    chainRef.current = null;
    setPreview(null);
    onChange(previous);
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
        valueRef.current.boundary
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
          }
    );
  };

  const fileInput = (
    <FileInput
      key={importCount}
      id={`${inputId}-area-files`}
      fileType={AREA_FILE_TYPES}
      disabled={importing}
      onFileChange={handleFiles}
    >
      <p className='mb-0'>{rings.length > 0 ? 'Add files' : 'Upload files'}</p>
    </FileInput>
  );

  const toolHint =
    activeTool === 'strata'
      ? 'Click to place points; a line finishes when it reaches the boundary or another line, or press Esc. Drag a point to move it. Right-click a point or line to delete it.'
      : activeTool === 'edit'
      ? 'Click a shape to select it, then drag it or its points. Right-click a point to delete it.'
      : activeTool
      ? 'Click on the map to place points, then click the first point to finish.'
      : null;

  return (
    <div className='d-flex flex-wrap gap-3'>
      <div
        className='d-flex flex-column gap-2'
        style={{ flex: '1 1 260px', maxWidth: 360, minWidth: 0 }}
      >
        {pendingImport ? (
          <>
            <Form.Label className='mb-0'>
              {pendingImport.length} polygon
              {pendingImport.length === 1 ? '' : 's'} found
            </Form.Label>
            <Form.Text className='d-block mt-0' style={{ fontSize: 12 }}>
              Choose what each polygon is. A survey has one boundary, so picking
              a new one replaces the current choice.
            </Form.Text>
            <div
              className='d-flex flex-column gap-2'
              style={{ maxHeight: 380, overflowY: 'auto' }}
            >
              {pendingImport.map((polygon, index) => (
                <div
                  key={polygon.id}
                  className='d-flex align-items-center gap-2 border border-dark p-2'
                >
                  <div className='flex-grow-1' style={{ minWidth: 0 }}>
                    <div className='text-truncate'>
                      {index + 1}. {polygon.name}
                    </div>
                    <div
                      className='text-muted text-truncate'
                      style={{ fontSize: 12 }}
                    >
                      {polygon.source}, {formatArea(polygon.areaKm2)}
                    </div>
                  </div>
                  <Form.Select
                    size='sm'
                    aria-label={`Role of ${polygon.name}`}
                    style={{ width: 120, flex: '0 0 auto' }}
                    value={polygon.role}
                    onChange={(e) =>
                      setPendingImport(
                        setImportRole(
                          pendingImport,
                          polygon.id,
                          e.target.value as AreaRole
                        )
                      )
                    }
                  >
                    <option value='boundary'>Boundary</option>
                    <option value='exclusion'>Exclusion</option>
                    <option value='ignore'>Ignore</option>
                  </Form.Select>
                </div>
              ))}
            </div>
            <div className='d-flex gap-2'>
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
                variant='outline-light'
                onClick={() => setPendingImport(null)}
              >
                Cancel import
              </Button>
            </div>
          </>
        ) : (
          <>
            <Form.Label className='mb-0'>Survey area</Form.Label>
            {rings.length === 0 && (
              <Form.Text className='d-block mt-0' style={{ fontSize: 12 }}>
                {locked
                  ? 'This survey has no boundary.'
                  : 'Upload one or more zipped shapefiles, GeoJSON or KML files, draw the boundary on the map, or trace it around your images.'}
              </Form.Text>
            )}
            {rings.map(({ label, ring, color }, index) => (
              <div
                key={label}
                className='d-flex align-items-center gap-2 border border-dark p-2'
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    flex: '0 0 auto',
                    border: `2px solid ${color}`,
                  }}
                />
                <div className='flex-grow-1' style={{ minWidth: 0 }}>
                  <div>{label}</div>
                  <div className='text-muted' style={{ fontSize: 12 }}>
                    {formatArea(ringAreaKm2(ring))}
                  </div>
                </div>
                <Button
                  size='sm'
                  variant='outline-light'
                  onClick={() => fitToRings([ring])}
                >
                  Show
                </Button>
                {!locked && (
                  <Button
                    size='sm'
                    variant='outline-danger'
                    onClick={() => removeRing(index)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
            {!locked && (
              <div className='d-flex flex-wrap align-items-center gap-2'>
                {fileInput}
                {importing && <Spinner animation='border' size='sm' />}
                {!value.boundary && (points?.length ?? 0) > 0 && (
                  <Button variant='outline-light' onClick={trace}>
                    Trace around my images
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        {importErrors.map((error) => (
          <div key={error} className='alert alert-warning mb-0 p-2'>
            {error}
          </div>
        ))}
        {children}
        {strata && !pendingImport && (
          <>
            <Form.Label className='mb-0 mt-2'>Strata</Form.Label>
            <Form.Text className='d-block mt-0' style={{ fontSize: 12 }}>
              {value.boundary
                ? 'Draw lines across the survey area to divide it into strata, then name each one. Without lines the whole area is one stratum.'
                : 'Add a boundary to define strata.'}
            </Form.Text>
            {strata.status}
            {strata.sections.map((ring, i) => (
              <div
                key={i}
                className='d-flex align-items-center gap-2 border border-dark p-2'
                onMouseEnter={() => setHighlighted(i)}
                onMouseLeave={() => setHighlighted(null)}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    flex: '0 0 auto',
                    background: strataColors[i % strataColors.length],
                  }}
                />
                <Form.Control
                  size='sm'
                  aria-label={`Name of stratum ${i + 1}`}
                  value={strata.names[i] ?? ''}
                  disabled={locked}
                  isInvalid={strata.invalid?.[i]}
                  onChange={(e) => strata.onNameChange(i, e.target.value)}
                />
                <Button
                  size='sm'
                  variant='outline-light'
                  onClick={() => fitToRings([ring])}
                >
                  Show
                </Button>
              </div>
            ))}
            {strata.dangling && (
              <span className='text-warning' style={{ fontSize: 12 }}>
                Some strata lines do not reach the boundary or another line at
                both ends, so they do not divide the area.
              </span>
            )}
          </>
        )}
      </div>
      <div
        className='d-flex flex-column gap-2'
        style={{ flex: '3 1 480px', minWidth: 0 }}
      >
        {!locked && !pendingImport && (
          <div className='d-flex gap-2 flex-wrap align-items-center'>
            <Button
              size='sm'
              variant={
                activeTool === 'boundary' ? 'primary' : 'outline-primary'
              }
              onClick={() => toggleTool('boundary')}
              disabled={!mapLoaded}
            >
              {activeTool === 'boundary'
                ? 'Drawing boundary…'
                : value.boundary
                ? 'Redraw boundary'
                : 'Draw boundary'}
            </Button>
            <Button
              size='sm'
              variant={
                activeTool === 'exclusion' ? 'primary' : 'outline-primary'
              }
              onClick={() => toggleTool('exclusion')}
              disabled={!mapLoaded}
            >
              {activeTool === 'exclusion'
                ? 'Drawing exclusions…'
                : 'Draw exclusion'}
            </Button>
            {strata && (
              <Button
                size='sm'
                variant={
                  activeTool === 'strata' ? 'primary' : 'outline-primary'
                }
                onClick={() => toggleTool('strata')}
                disabled={!mapLoaded || !value.boundary}
              >
                {activeTool === 'strata'
                  ? 'Drawing strata lines…'
                  : value.network
                  ? 'Draw strata lines'
                  : 'Redraw strata'}
              </Button>
            )}
            <Button
              size='sm'
              variant={activeTool === 'edit' ? 'primary' : 'outline-primary'}
              onClick={() => toggleTool('edit')}
              disabled={!mapLoaded || rings.length === 0}
            >
              {activeTool === 'edit' ? 'Editing…' : 'Edit shapes'}
            </Button>
            <Button
              size='sm'
              variant='outline-danger'
              onClick={deleteSelected}
              disabled={!selectedFeatureId}
            >
              Delete selected
            </Button>
            <Button
              size='sm'
              variant='outline-light'
              onClick={undo}
              disabled={history.length === 0}
            >
              Undo
            </Button>
            <Button
              size='sm'
              variant='outline-light'
              onClick={fitAll}
              disabled={!mapLoaded}
            >
              Fit
            </Button>
          </div>
        )}
        {toolHint && (
          <span className='text-muted' style={{ fontSize: 12 }}>
            {toolHint}
          </span>
        )}
        <div className='survey-map'>
          <div
            ref={mapContainerRef}
            style={{ position: 'absolute', inset: 0 }}
          />
        </div>
      </div>
    </div>
  );
}
