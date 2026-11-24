import { useQueries } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import {
  createElement,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  NeighbourImageInfo,
  NeighbourImageLookup,
} from '../annotationTypes';
import { GlobalContext } from '../Context';
import {
  colourOverlaps,
  neighbourOverlaps,
  type NeighbourOverlap,
  type Segment,
} from '../exploreViews/neighbourOverlaps';
import { timeOffsetLabel } from '../exploreViews/otherViews';
import { useImageNeighbours } from '../exploreViews/useImageNeighbours';
import { fileName } from '../reviewImageView';
import { ANNOTATION_MARKER_LAYERS } from './annotationMarkerLayers';

const SOURCE = 'neighbour-overlaps';
const LAYER_FILL = 'neighbour-overlaps-fill';
const LAYER_GRID = 'neighbour-overlaps-grid';
const LAYER_OUTLINE = 'neighbour-overlaps-outline';
const EMPTY: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

let overlapsOn = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getOverlapsOn = () => overlapsOn;
function toggleOverlaps() {
  overlapsOn = !overlapsOn;
  listeners.forEach((listener) => listener());
}

class NeighbourOverlapControl implements maplibregl.IControl {
  private container?: HTMLDivElement;
  private unsubscribe?: () => void;
  onAdd() {
    const c = document.createElement('div');
    c.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'maplibregl-ctrl-icon';
    btn.title = 'Toggle neighbour overlaps';
    btn.setAttribute('aria-label', 'Toggle neighbour overlaps');
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.innerHTML = renderToStaticMarkup(
      createElement(Layers, { size: 16, color: '#333', strokeWidth: 2.5 }),
    );
    const sync = () => {
      btn.style.background = overlapsOn ? '#cce5ff' : '';
      btn.setAttribute('aria-pressed', String(overlapsOn));
    };
    sync();
    this.unsubscribe = subscribe(sync);
    btn.onclick = toggleOverlaps;
    c.appendChild(btn);
    this.container = c;
    return c;
  }
  onRemove() {
    this.unsubscribe?.();
    this.container?.remove();
    this.container = undefined;
  }
}

const imageInfoOf = (results: { data?: NeighbourImageInfo | null }[]) =>
  results.map((result) => result.data ?? undefined);

function addLayers(map: maplibregl.Map) {
  const before = map.getLayer(ANNOTATION_MARKER_LAYERS.outlines)
    ? ANNOTATION_MARKER_LAYERS.outlines
    : undefined;
  const kind = (k: string): maplibregl.FilterSpecification => [
    '==',
    ['get', 'kind'],
    k,
  ];
  map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
  map.addLayer(
    {
      id: LAYER_FILL,
      type: 'fill',
      source: SOURCE,
      filter: kind('area'),
      paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.08 },
    },
    before,
  );
  map.addLayer(
    {
      id: LAYER_GRID,
      type: 'line',
      source: SOURCE,
      filter: kind('grid'),
      paint: {
        'line-color': ['get', 'colour'],
        'line-width': 1,
        'line-opacity': 0.4,
      },
    },
    before,
  );
  map.addLayer(
    {
      id: LAYER_OUTLINE,
      type: 'line',
      source: SOURCE,
      filter: kind('outline'),
      paint: {
        'line-color': ['get', 'colour'],
        'line-width': 3,
        'line-dasharray': [2, 1],
      },
    },
    before,
  );
}

function labelElement(text: string, colour: string) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `pointer-events:none;white-space:nowrap;padding:1px 6px;font-size:12px;line-height:18px;color:#212529;background:rgba(255,255,255,.9);border-left:4px solid ${colour};box-shadow:0 1px 3px rgba(0,0,0,.35)`;
  return el;
}

type Px2LngLat = (x: number, y: number) => [number, number];
type ShownOverlap = NeighbourOverlap & { colour: string; label: string };

function toGeoJSON(
  overlaps: ShownOverlap[],
  px2lngLat: Px2LngLat,
): GeoJSON.FeatureCollection {
  const line = (segments: Segment[]) =>
    segments.map(([a, b]) => [px2lngLat(a.x, a.y), px2lngLat(b.x, b.y)]);
  return {
    type: 'FeatureCollection',
    features: overlaps.flatMap(({ area, edges, grid, colour }) => {
      const ring = [...area, area[0]].map((p) => px2lngLat(p.x, p.y));
      return [
        {
          type: 'Feature' as const,
          properties: { kind: 'area', colour },
          geometry: { type: 'Polygon' as const, coordinates: [ring] },
        },
        {
          type: 'Feature' as const,
          properties: { kind: 'grid', colour },
          geometry: {
            type: 'MultiLineString' as const,
            coordinates: line(grid),
          },
        },
        {
          type: 'Feature' as const,
          properties: { kind: 'outline', colour },
          geometry: {
            type: 'MultiLineString' as const,
            coordinates: line(edges),
          },
        },
      ];
    }),
  };
}

export function useNeighbourOverlaps(
  map: maplibregl.Map | null,
  image: { id: string; width: number; height: number },
  px2lngLat: Px2LngLat,
  lookup: NeighbourImageLookup | undefined,
) {
  const { client } = useContext(GlobalContext)!;
  const on = useSyncExternalStore(subscribe, getOverlapsOn);
  const enabled = !!map && !!lookup;
  const active = enabled && on;
  const { id, width, height } = image;

  useEffect(() => {
    if (!map || !enabled) return;
    const control = new NeighbourOverlapControl();
    map.addControl(control, 'top-left');
    return () => {
      try {
        map.removeControl(control);
      } catch {
        /* map removed */
      }
    };
  }, [map, enabled]);

  const { rows } = useImageNeighbours(active ? id : null);
  const missing = useMemo(() => {
    if (!active) return [];
    const ids = new Set([id, ...rows.flatMap((r) => [r.image1Id, r.image2Id])]);
    return [...ids].filter((i) => !lookup?.(i)?.width);
  }, [active, id, rows, lookup]);
  const fetched = useQueries({
    queries: missing.map((imageId) => ({
      queryKey: ['neighbourOverlapImage', imageId],
      queryFn: async (): Promise<NeighbourImageInfo | null> => {
        const { data } = await client.models.Image.get(
          { id: imageId },
          {
            selectionSet: [
              'id',
              'width',
              'height',
              'originalPath',
              'timestamp',
            ],
          },
        );
        return data ?? null;
      },
      staleTime: Infinity,
      gcTime: 36e5,
    })),
    combine: imageInfoOf,
  });

  const overlaps = useMemo((): ShownOverlap[] => {
    if (!active) return [];
    const fetchedById = new Map(missing.map((i, n) => [i, fetched[n]]));
    const info = (i: string) => fetchedById.get(i) ?? lookup?.(i);
    const sizeOf = (i: string) => {
      const n = info(i);
      return n?.width && n.height
        ? { width: n.width, height: n.height }
        : undefined;
    };
    const here = info(id)?.timestamp;
    const found = neighbourOverlaps(id, { width, height }, rows, sizeOf);
    return colourOverlaps(found, (i) => info(i)?.timestamp).map((o) => {
      const n = info(o.imageId);
      const offset = timeOffsetLabel(
        here != null && n?.timestamp != null ? n.timestamp - here : null,
        false,
      );
      const name = n?.originalPath ? fileName(n.originalPath, o.imageId) : '';
      return {
        ...o,
        label: [name, offset].filter(Boolean).join(' · ') || 'Neighbour',
      };
    });
  }, [active, missing, fetched, lookup, id, width, height, rows]);

  useEffect(() => {
    if (!map) return;
    const labels: maplibregl.Marker[] = [];
    try {
      if (!map.getSource(SOURCE)) {
        if (!overlaps.length) return;
        addLayers(map);
      }
      (map.getSource(SOURCE) as maplibregl.GeoJSONSource).setData(
        toGeoJSON(overlaps, px2lngLat),
      );
      for (const o of overlaps)
        labels.push(
          new maplibregl.Marker({ element: labelElement(o.label, o.colour) })
            .setLngLat(px2lngLat(o.labelAt.x, o.labelAt.y))
            .addTo(map),
        );
    } catch {
      /* map removed */
    }
    return () => labels.forEach((label) => label.remove());
  }, [map, overlaps, px2lngLat]);
}
