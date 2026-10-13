import maplibregl from 'maplibre-gl';
import { getTileBlob, imageTileContext } from '../StorageLayer';
import { pxBoundsCamera, type ImageProjection } from './imageProjection';

export { makeProjection, type ImageProjection } from './imageProjection';

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
    const [path, query] = params.url.replace('detweb://', '').split('?');
    const args = new URLSearchParams(query);
    const blob = await getTileBlob(decodeURIComponent(path), {
      imageId: args.get('imageId') ?? '',
      width: Number(args.get('width')),
      height: Number(args.get('height')),
      sharedImageId: args.get('sharedImageId') || undefined,
    });
    return { data: await blob.arrayBuffer() };
  });
}

export const storedZoomToMapZoom = (zoom: number) => zoom - 1;
export const mapZoomToStoredZoom = (zoom: number) => zoom + 1;

/** Create a MapLibre map over an image pyramid, with rotation and (map)
 * keyboard handling disabled — arrow keys belong to task navigation. */
export function createImageMap(
  container: HTMLDivElement,
  projection: ImageProjection,
  maxZoom = projection.maxNativeZoom + 4
): maplibregl.Map {
  ensureTileProtocol();
  const minZoom = -2;
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
  image: { width: number; height: number; id: string; sharedImageId?: string },
  projection: ImageProjection
) {
  const context = imageTileContext(image);
  const query = new URLSearchParams(
    Object.entries(context)
      .filter(([, value]) => value != null)
      .map(([key, value]) => [key, String(value)])
  );
  const template = `detweb://slippymaps/${encodeURIComponent(
    sourceKey
  )}/{z}/{y}/{x}.png?${query}`;
  map.addSource(SOURCE_TILES, {
    type: 'raster',
    tiles: [template],
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
  bottom: number,
  eventData?: Record<string, unknown>
) {
  const container = map.getContainer();
  const camera = pxBoundsCamera(
    projection,
    { width: container.clientWidth, height: container.clientHeight },
    left,
    top,
    right,
    bottom
  );
  if (camera) map.jumpTo(camera, eventData);
}
