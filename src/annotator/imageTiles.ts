import maplibregl from 'maplibre-gl';
import { getTileBlob, registerImageIdForSource } from '../StorageLayer';

/*
Shared tiling machinery for MapLibre-based image viewers.

The image is mapped onto the full mercator world square, so the existing
slippy pyramid (slippymaps/{key}/{z}/{row}/{col}.png) aligns exactly with
MapLibre's native tile grid. A custom `detweb://` protocol feeds tiles from
getTileBlob (S3 + on-demand Lambda generation + localforage cache), and
MapLibre handles fading, retention and overzoom natively.

Stored zoom parity: saved default zooms (Queue.zoom and localStorage) use the
image pyramid's level numbering. MapLibre uses a 512px world with 256px tiles,
so its native zoom is one level lower. Convert at the persistence boundary.
*/

export const SOURCE_TILES = 'image-tiles';
export const LAYER_TILES = 'image-tiles-layer';

let protocolRegistered = false;
export function ensureTileProtocol() {
  if (protocolRegistered) return;
  protocolRegistered = true;
  maplibregl.addProtocol('detweb', async (params) => {
    const path = params.url.replace('detweb://', '');
    const blob = await getTileBlob(path);
    return { data: await blob.arrayBuffer() };
  });
}

export interface ImageProjection {
  px2lngLat: (x: number, y: number) => [number, number];
  lngLat2px: (lng: number, lat: number) => { x: number; y: number };
  maxNativeZoom: number;
}

/** Pixel <-> LngLat mapping that places the pyramid's power-of-two square
 * exactly over the mercator world, so tile (z, x, y) == pyramid tile. */
export function makeProjection(
  width: number,
  height: number
): ImageProjection {
  const n = Math.pow(2, Math.ceil(Math.log2(Math.max(width, height))));
  const px2lngLat = (x: number, y: number): [number, number] => {
    const lng = (x / n) * 360 - 180;
    const t = y / n; // 0 = top edge of the pyramid square
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * t))) * 180) / Math.PI;
    return [lng, lat];
  };
  const lngLat2px = (lng: number, lat: number): { x: number; y: number } => {
    const x = ((lng + 180) / 360) * n;
    const rad = (lat * Math.PI) / 180;
    const t = (1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2;
    return { x, y: t * n };
  };
  const maxNativeZoom = Math.max(
    0,
    Math.ceil(Math.log2(Math.max(width, height))) - 8
  );
  return { px2lngLat, lngLat2px, maxNativeZoom };
}

export const storedZoomToMapZoom = (zoom: number) => zoom - 1;
export const mapZoomToStoredZoom = (zoom: number) => zoom + 1;

/** Create a MapLibre map over an image pyramid, with rotation and (map)
 * keyboard handling disabled — arrow keys belong to task navigation. */
export function createImageMap(
  container: HTMLDivElement,
  projection: ImageProjection
): maplibregl.Map {
  ensureTileProtocol();
  const minZoom = -2;
  const maxZoom = projection.maxNativeZoom + 4;
  const map = new maplibregl.Map({
    container,
    style: { version: 8, sources: {}, layers: [] },
    minZoom,
    maxZoom,
    attributionControl: false,
    renderWorldCopies: false,
    dragRotate: false,
    // The default Mercator constraint recenters the whole power-of-two tile
    // square whenever it is smaller than the viewport. Since the source image
    // may occupy only part of that square, it can appear pinned to one side.
    // Preserve the requested center so the image remains draggable at low zoom.
    transformConstrain: (center, zoom) => ({
      center,
      zoom: Math.max(minZoom, Math.min(maxZoom, zoom)),
    }),
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disable();
  return map;
}

/** Add the image tile source + layer. Call inside the map 'load' handler. */
export function addImageTiles(
  map: maplibregl.Map,
  sourceKey: string,
  image: { width: number; height: number; id?: string },
  projection: ImageProjection
) {
  if (image.id) {
    // Lets on-demand tile generation pass the image id to the Lambda
    registerImageIdForSource(sourceKey, image.id);
  }
  map.addSource(SOURCE_TILES, {
    type: 'raster',
    tiles: [`detweb://slippymaps/${sourceKey}/{z}/{y}/{x}.png`],
    tileSize: 256,
    minzoom: 0,
    maxzoom: projection.maxNativeZoom,
    bounds: [
      projection.px2lngLat(0, image.height)[0],
      projection.px2lngLat(0, image.height)[1],
      projection.px2lngLat(image.width, 0)[0],
      projection.px2lngLat(image.width, 0)[1],
    ],
  });
  map.addLayer({
    id: LAYER_TILES,
    type: 'raster',
    source: SOURCE_TILES,
    paint: { 'raster-fade-duration': 0 },
  });
}

/** Fit the map to a pixel-space rectangle. */
export function fitPxBounds(
  map: maplibregl.Map,
  projection: ImageProjection,
  left: number,
  top: number,
  right: number,
  bottom: number
) {
  map.fitBounds(
    [
      projection.px2lngLat(left, bottom),
      projection.px2lngLat(right, top),
    ],
    { duration: 0 }
  );
}
