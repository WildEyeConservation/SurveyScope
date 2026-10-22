import type { StyleSpecification } from 'maplibre-gl';

export type FeatureCollection = { type: 'FeatureCollection'; features: any[] };

export const EMPTY_FC: FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// OpenStreetMap raster basemap, matching the rest of the app's MapLibre views
// (see DensityMap.tsx). Glyphs are needed for any symbol layers MapLibre adds.
export const BASE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      // OSM serves tiles up to z19; beyond that MapLibre overzooms the z19 tile
      // rather than requesting non-existent tiles (which would 400 as CORS).
      maxzoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/** Escape a string for safe interpolation into MapLibre popup HTML. */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c]!)
  );
}
