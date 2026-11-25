import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationFeatureProperties } from '../annotator/annotationFeatures';
import {
  addAnnotationMarkerLayers,
  ANNOTATION_MARKER_LAYERS,
  registerAnnotationMarkerImages,
} from '../annotator/annotationMarkerLayers';
import { makeCentredProjection } from '../annotator/imageProjection';
import { createImageMap } from '../annotator/imageTiles';
import MapRotateControl from '../annotator/MapRotateControl';
import type { NotebookCrop } from './types';

const SOURCE_CROP = 'notebook-crop';
const LAYER_CROP = 'notebook-crop-layer';
const SOURCE_MARKER = 'notebook-marker';
// MapLibre's world is 512 screen pixels wide at zoom 0.
const WORLD_PX = 512;

export function CropView({
  crop,
  color,
  scale,
  onScale,
  zoomKey,
}: {
  crop: NotebookCrop;
  color: string;
  // Screen pixels per image pixel.
  scale: number | null;
  onScale: (scale: number) => void;
  zoomKey: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [noMap, setNoMap] = useState(false);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;

  const projection = useMemo(
    () => makeCentredProjection(crop.size, crop.size),
    [crop.size],
  );
  const zoomFor = (s: number) => Math.log2((s * projection.size) / WORLD_PX);
  const scaleAt = (zoom: number) => (2 ** zoom * WORLD_PX) / projection.size;

  useEffect(() => {
    if (!containerRef.current) return;
    let map: maplibregl.Map;
    try {
      map = createImageMap(containerRef.current, projection);
    } catch (error) {
      console.warn('Species Notebook map unavailable', error);
      setNoMap(true);
      return;
    }
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, showZoom: true }),
      'top-left',
    );
    map.addControl(new MapRotateControl(), 'top-left');
    const unregister = registerAnnotationMarkerImages(map);
    map.on('zoomend', (event) => {
      if (event.originalEvent) onScaleRef.current(scaleAt(map.getZoom()));
    });
    map.on('error', (event) => {
      if ((event as { sourceId?: string }).sourceId === SOURCE_CROP)
        setFailed(true);
    });
    map.on('load', () => {
      map.addSource(SOURCE_MARKER, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      addAnnotationMarkerLayers(map, SOURCE_MARKER);
      setReady(true);
    });
    return () => {
      unregister();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setFailed(false);
    const { size } = crop;
    const url = `data:${crop.type};base64,${crop.data}`;
    const coordinates = [
      projection.px2lngLat(0, 0),
      projection.px2lngLat(size, 0),
      projection.px2lngLat(size, size),
      projection.px2lngLat(0, size),
    ] as maplibregl.Coordinates;
    const source = map.getSource(SOURCE_CROP) as
      maplibregl.ImageSource | undefined;
    if (source) {
      source.updateImage({ url, coordinates });
    } else {
      map.addSource(SOURCE_CROP, { type: 'image', url, coordinates });
      map.addLayer(
        {
          id: LAYER_CROP,
          type: 'raster',
          source: SOURCE_CROP,
          paint: { 'raster-fade-duration': 0 },
        },
        ANNOTATION_MARKER_LAYERS.outlines,
      );
    }
    const container = map.getContainer();
    const fit = Math.min(container.clientWidth, container.clientHeight) / size;
    map.jumpTo({
      center: projection.px2lngLat(size / 2, size / 2),
      zoom: zoomFor(scaleRef.current ?? fit),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crop, ready, projection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const marker: AnnotationFeatureProperties = {
      id: 'example',
      color,
      markerKind: 'primary',
      borderColor: 'rgba(0, 0, 0, 0.7)',
      borderWidth: 1,
      opacity: 1,
      active: false,
      obscured: false,
      readonly: true,
      icon: '',
      statusIcon: '',
    };
    (map.getSource(SOURCE_MARKER) as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: projection.px2lngLat(crop.size / 2, crop.size / 2),
          },
          properties: marker,
        },
      ],
    });
  }, [color, crop.size, ready, projection]);

  const lastKey = useRef(zoomKey);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || zoomKey === lastKey.current) return;
    const zoom = map.getZoom() + (zoomKey > lastKey.current ? 1 : -1);
    lastKey.current = zoomKey;
    map.easeTo({ zoom, duration: 200 });
    onScaleRef.current(scaleAt(zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomKey]);

  return (
    <>
      {/* MapLibre makes its container relative, so it fills a positioned box. */}
      <div className='absolute inset-0'>
        <div ref={containerRef} className='h-full w-full' />
      </div>
      {noMap && (
        <>
          <img
            src={`data:${crop.type};base64,${crop.data}`}
            alt=''
            className='absolute inset-0 m-auto max-h-full max-w-full'
          />
          <span
            className='pointer-events-none absolute top-1/2 left-1/2 size-5 -translate-1/2 rounded-full border border-black/70'
            style={{ backgroundColor: color }}
          />
        </>
      )}
      {failed && (
        <div className='absolute inset-0 flex items-center justify-center text-sm text-[#bcccdc]'>
          This image is unavailable.
        </div>
      )}
    </>
  );
}
