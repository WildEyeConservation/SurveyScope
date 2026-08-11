import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  makeProjection,
  createImageMap,
  addImageTiles,
  fitPxBounds,
} from './imageTiles';
import { NavButtons } from '../NavButtons';
import type { AnnotationFeatureProperties } from './annotationFeatures';
import {
  addAnnotationMarkerLayers,
  ANNOTATION_MARKER_LAYERS,
  registerAnnotationMarkerImages,
} from './annotationMarkerLayers';

/*
Read-only MapLibre image viewer: tiles + coloured annotation dots with a
click popup, plus optional location rectangles. Used by the lighter viewing
surfaces (image viewer modal, test-location previews) that don't need the
full annotator's editing machinery.
*/

const SOURCE_POINTS = 'light-points';
const LAYER_POINTS = ANNOTATION_MARKER_LAYERS.circles;
const SOURCE_RECTS = 'light-rects';
const LAYER_RECTS = 'light-rects-lines';

export interface LightAnnotation extends AnnotationFeatureProperties {
  x: number;
  y: number;
  popupLines?: string[];
}

export interface LightRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

interface MapLibreLightViewerProps {
  image: { width: number; height: number };
  sourceKey: string;
  annotations?: LightAnnotation[];
  rects?: LightRect[];
  /** Centre-based rect to fit the initial view around (padded by `scale`,
   * matching the old BaseImage behaviour). Fits the whole image if omitted. */
  fitRect?: { x: number; y: number; width: number; height: number };
  fitScale?: number;
  /** Fly in closer when an annotation is clicked (image-viewer behaviour). */
  zoomInOnAnnotationClick?: boolean;
  visible?: boolean;
  next?: () => void;
  prev?: () => void;
}

export default function MapLibreLightViewer({
  image,
  sourceKey,
  annotations,
  rects,
  fitRect,
  fitScale = 1.5,
  zoomInOnAnnotationClick = false,
  visible = true,
  next,
  prev,
}: MapLibreLightViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const annotationsRef = useRef<LightAnnotation[]>(annotations ?? []);
  annotationsRef.current = annotations ?? [];
  const [mapReady, setMapReady] = useState(false);

  const projection = useMemo(
    () => makeProjection(image.width, image.height),
    [image.width, image.height]
  );
  const { px2lngLat, lngLat2px } = projection;

  useEffect(() => {
    if (!containerRef.current || !sourceKey) return;
    const map = createImageMap(containerRef.current, projection);
    mapRef.current = map;
    const unregisterMarkerImages = registerAnnotationMarkerImages(map);

    map.on('load', () => {
      addImageTiles(map, sourceKey, image, projection);

      map.addSource(SOURCE_RECTS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: LAYER_RECTS,
        type: 'line',
        source: SOURCE_RECTS,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
        },
      });

      map.addSource(SOURCE_POINTS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      addAnnotationMarkerLayers(map, SOURCE_POINTS);

      map.on('mousemove', (e) => {
        const feature = map.queryRenderedFeatures(e.point, {
          layers: [LAYER_POINTS],
        })[0];
        map.getCanvas().style.cursor = feature ? 'pointer' : '';
      });

      map.on('click', (e) => {
        const feature = map.queryRenderedFeatures(e.point, {
          layers: [LAYER_POINTS],
        })[0];
        if (!feature) return;
        const annotation = annotationsRef.current.find(
          (a) => a.id === (feature.properties as any).id
        );
        if (!annotation) return;
        popupRef.current?.remove();
        if (annotation.popupLines?.length) {
          const div = document.createElement('div');
          div.style.color = '#333';
          annotation.popupLines.forEach((text) => {
            const row = document.createElement('div');
            row.textContent = text;
            div.appendChild(row);
          });
          popupRef.current = new maplibregl.Popup({ offset: 10 })
            .setLngLat(px2lngLat(annotation.x, annotation.y))
            .setDOMContent(div)
            .addTo(map);
        }
        if (zoomInOnAnnotationClick) {
          map.flyTo({
            center: px2lngLat(annotation.x, annotation.y),
            zoom: Math.max(map.getZoom() + 2, 7),
            duration: 500,
          });
        }
      });

      setMapReady(true);
    });

    return () => {
      unregisterMarkerImages();
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, image.width, image.height]);

  // Initial view
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (fitRect) {
      fitPxBounds(
        map,
        projection,
        Math.max(0, fitRect.x - fitRect.width * fitScale),
        Math.max(0, fitRect.y - fitRect.height * fitScale),
        Math.min(image.width, fitRect.x + fitRect.width * fitScale),
        Math.min(image.height, fitRect.y + fitRect.height * fitScale)
      );
    } else {
      fitPxBounds(map, projection, 0, 0, image.width, image.height);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // Data sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    (
      map.getSource(SOURCE_POINTS) as maplibregl.GeoJSONSource | undefined
    )?.setData({
      type: 'FeatureCollection',
      features: (annotations ?? []).map((a) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: px2lngLat(a.x, a.y) },
        properties: {
          id: a.id,
          color: a.color,
          markerKind: a.markerKind,
          borderColor: a.borderColor,
          borderWidth: a.borderWidth,
          opacity: a.opacity,
          active: a.active,
          obscured: a.obscured,
          readonly: a.readonly,
          icon: a.icon,
          statusIcon: a.statusIcon,
        },
      })),
    } as any);

    (
      map.getSource(SOURCE_RECTS) as maplibregl.GeoJSONSource | undefined
    )?.setData({
      type: 'FeatureCollection',
      features: (rects ?? []).map((r) => {
        const x0 = r.x - r.width / 2;
        const y0 = r.y - r.height / 2;
        const x1 = r.x + r.width / 2;
        const y1 = r.y + r.height / 2;
        return {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              px2lngLat(x0, y0),
              px2lngLat(x1, y0),
              px2lngLat(x1, y1),
              px2lngLat(x0, y1),
              px2lngLat(x0, y0),
            ],
          },
          properties: { color: r.color ?? 'blue' },
        };
      }),
    } as any);
  }, [annotations, rects, mapReady, px2lngLat, lngLat2px]);

  useEffect(() => {
    if (visible) mapRef.current?.resize();
  }, [visible]);

  return (
    <div className='d-flex flex-column align-items-stretch w-100 h-100 gap-3'>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', borderRadius: 10 }}
      />
      {(next || prev) && <NavButtons prev={prev} next={next} />}
    </div>
  );
}
