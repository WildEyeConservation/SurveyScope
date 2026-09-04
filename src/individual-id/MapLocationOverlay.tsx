import { useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { Feature, Point, Polygon } from 'geojson';
import { client } from '../stores/appClient';
import { fetchAllPaginatedResults } from '../utils';

/** One toggleable location source: its DB `source` value, display label, colour. */
export interface LocationSourceConfig {
  source: string;
  label: string;
  color: string;
}

interface Props {
  /** Ready map instance (null until the map has loaded). */
  map: maplibregl.Map | null;
  /** Image whose locations are drawn on this map. */
  imageId: string;
  /** Image-pixel → map lng/lat converter for this map. */
  px2lngLat: (x: number, y: number) => [number, number];
  sources: LocationSourceConfig[];
  /** Preloaded rows; when supplied, skips the live Location query. */
  locationRows?: LocationOverlayRow[];
}

interface LocationBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number | null;
}

export interface LocationOverlayRow {
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  confidence: number | null;
  source: string;
}

const SRC_ID = 'location-boxes';
const FILL_LAYER = 'location-boxes-fill';
const LINE_LAYER = 'location-boxes-outline';
const LABEL_LAYER = 'location-boxes-label';

/**
 * Per-map overlay that draws detection-location rectangles for a configurable
 * set of sources, toggled by a top-right checkbox control. Each source's
 * locations are fetched once (lazily, on first enable) via the per-image
 * `locationsByImageKey` index narrowed to that `source`, then drawn as
 * `(x, y)`-centred boxes — matching the app-wide location box convention.
 *
 * Self-contained: it owns its own GeoJSON source/layers and checkbox state, so
 * dropping `<MapLocationOverlay>` inside a map is all that's needed.
 */
export function MapLocationOverlay({
  map,
  imageId,
  px2lngLat,
  sources,
  locationRows,
}: Props) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [boxesBySource, setBoxesBySource] = useState<
    Record<string, LocationBox[]>
  >({});
  const [loading, setLoading] = useState(true);

  // Fetch this image's boxes for all configured sources up front (one query,
  // narrowed to those sources). We need this to know which sources are actually
  // present so we can show only their checkboxes — and reading the rows for
  // that anyway, we keep the geometry too so toggling is instant.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBoxesBySource({});

    if (locationRows) {
      const grouped: Record<string, LocationBox[]> = {};
      for (const r of locationRows) {
        // Drop the zero-size "no detections" placeholder rows.
        if ((r.width ?? 0) <= 0 || (r.height ?? 0) <= 0) continue;
        (grouped[r.source] ??= []).push({
          x: r.x,
          y: r.y,
          width: r.width as number,
          height: r.height as number,
          confidence: r.confidence ?? null,
        });
      }
      setBoxesBySource(grouped);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    fetchAllPaginatedResults(client.models.Location.locationsByImageKey, {
      imageId,
      filter: { or: sources.map((c) => ({ source: { eq: c.source } })) },
      selectionSet: ['id', 'x', 'y', 'width', 'height', 'confidence', 'source'],
      limit: 1000,
    })
      .then((rows) => {
        if (cancelled) return;
        const grouped: Record<string, LocationBox[]> = {};
        for (const r of rows as LocationOverlayRow[]) {
          // Drop the zero-size "no detections" placeholder rows.
          if ((r.width ?? 0) <= 0 || (r.height ?? 0) <= 0) continue;
          (grouped[r.source] ??= []).push({
            x: r.x,
            y: r.y,
            width: r.width as number,
            height: r.height as number,
            confidence: r.confidence ?? null,
          });
        }
        setBoxesBySource(grouped);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to fetch image locations', err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sources, imageId, locationRows]);

  // Only offer sources that actually have boxes on this image.
  const availableSources = sources.filter(
    (c) => (boxesBySource[c.source]?.length ?? 0) > 0
  );

  // Add the GeoJSON source + fill/line layers once the map is ready.
  useEffect(() => {
    if (!map) return;
    try {
      if (!map.getSource(SRC_ID)) {
        map.addSource(SRC_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      if (!map.getLayer(FILL_LAYER)) {
        map.addLayer({
          id: FILL_LAYER,
          type: 'fill',
          source: SRC_ID,
          filter: ['==', ['get', 'kind'], 'box'],
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 },
        });
      }
      if (!map.getLayer(LINE_LAYER)) {
        map.addLayer({
          id: LINE_LAYER,
          type: 'line',
          source: SRC_ID,
          filter: ['==', ['get', 'kind'], 'box'],
          paint: { 'line-color': ['get', 'color'], 'line-width': 2 },
        });
      }
      // Confidence label, anchored just above each box's top-left corner.
      if (!map.getLayer(LABEL_LAYER)) {
        map.addLayer({
          id: LABEL_LAYER,
          type: 'symbol',
          source: SRC_ID,
          filter: ['==', ['get', 'kind'], 'label'],
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Open Sans Regular'],
            'text-size': 12,
            'text-anchor': 'bottom-left',
            'text-offset': [0, -0.2],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': 'rgba(0, 0, 0, 0.75)',
            'text-halo-width': 1.5,
          },
        });
      }
    } catch {
      /* style not ready / map removed — ignore */
    }
    return () => {
      try {
        if (map.getLayer(LABEL_LAYER)) map.removeLayer(LABEL_LAYER);
        if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
        if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);
        if (map.getSource(SRC_ID)) map.removeSource(SRC_ID);
      } catch {
        /* map already torn down — ignore */
      }
    };
  }, [map]);

  // Rebuild the rectangle features whenever the enabled set or data changes.
  useEffect(() => {
    if (!map) return;
    let src: maplibregl.GeoJSONSource | undefined;
    try {
      src = map.getSource(SRC_ID) as maplibregl.GeoJSONSource | undefined;
    } catch {
      // React can run this effect while a just-unmounted MapLibre instance is
      // still in state. At that point map.getSource throws because style is gone.
      return;
    }
    if (!src) return;
    const features: Feature<Polygon | Point>[] = [];
    for (const cfg of sources) {
      if (!enabled[cfg.source]) continue;
      for (const b of boxesBySource[cfg.source] ?? []) {
        const left = b.x - b.width / 2;
        const right = b.x + b.width / 2;
        const top = b.y - b.height / 2;
        const bottom = b.y + b.height / 2;
        features.push({
          type: 'Feature',
          properties: { kind: 'box', color: cfg.color, source: cfg.source },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                px2lngLat(left, top),
                px2lngLat(right, top),
                px2lngLat(right, bottom),
                px2lngLat(left, bottom),
                px2lngLat(left, top),
              ],
            ],
          },
        });
        // Confidence label pinned to the box's top-left corner.
        if (b.confidence != null) {
          features.push({
            type: 'Feature',
            properties: {
              kind: 'label',
              color: cfg.color,
              label: b.confidence.toFixed(2),
            },
            geometry: { type: 'Point', coordinates: px2lngLat(left, top) },
          });
        }
      }
    }
    try {
      src.setData({ type: 'FeatureCollection', features });
    } catch {
      /* map removed — ignore */
    }
  }, [map, enabled, boxesBySource, sources, px2lngLat]);

  // Nothing to offer (still loading, or this image has none of these sources).
  if (loading || availableSources.length === 0) return null;

  return (
    <div
      className='maplibregl-ctrl maplibregl-ctrl-group'
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 10,
        padding: '6px 8px',
        fontSize: 12,
        minWidth: 150,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, color: '#333' }}>
        Locations
      </div>
      {availableSources.map((cfg) => (
        <label
          key={cfg.source}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 2,
            cursor: 'pointer',
            color: '#333',
          }}
        >
          <input
            type='checkbox'
            checked={!!enabled[cfg.source]}
            onChange={(e) =>
              setEnabled((s) => ({ ...s, [cfg.source]: e.target.checked }))
            }
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: cfg.color,
              border: '1px solid rgba(0, 0, 0, 0.2)',
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1 }}>{cfg.label}</span>
        </label>
      ))}
    </div>
  );
}
