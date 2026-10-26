import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'react-bootstrap';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRenderMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
  type TerraDrawMouseEvent,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import {
  createImageMap,
  fitPxBounds,
  type ImageProjection,
} from '../../annotator/imageTiles';
import { makeCentredProjection } from '../../annotator/imageProjection';
import type { Polygon } from 'geojson';
import type { MaskPolygon } from '../../types/CameraMask';
import '../surveyMap.css';

const MASK_COLOR = '#97009c';
const MODE_MASK = 'mask';
const MODE_SELECT = 'select';
const MODE_IDLE = 'idle';
const SRC_IMAGE = 'mask-sample';
const EDGE_SNAP_PX = 12;
const FIT_PADDING_PX = 40;
const HISTORY_LIMIT = 30;

type Tool = 'draw' | 'edit';
type Size = { width: number; height: number };
type Corners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number]
];

const toFraction = (value: number) =>
  Math.round(Math.min(Math.max(value, 0), 1) * 1e6) / 1e6;

const imageCorners = (
  projection: ImageProjection,
  { width, height }: Size
): Corners => [
  projection.px2lngLat(0, 0),
  projection.px2lngLat(width, 0),
  projection.px2lngLat(width, height),
  projection.px2lngLat(0, height),
];

function maskFeatures(draw: TerraDraw): GeoJSONStoreFeatures<Polygon>[] {
  return draw
    .getSnapshot()
    .filter(
      (feature): feature is GeoJSONStoreFeatures<Polygon> =>
        feature.geometry.type === 'Polygon' &&
        feature.properties.mode === MODE_MASK &&
        !feature.properties.currentlyDrawing
    );
}

interface MaskCanvasProps {
  imageUrl: string;
  polygons: MaskPolygon[];
  onChange: (polygons: MaskPolygon[]) => void;
}

export default function MaskCanvas({
  imageUrl,
  polygons,
  onChange,
}: MaskCanvasProps) {
  const [size, setSize] = useState<Size | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<MaskPolygon[][]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const precisionRef = useRef(9);
  // The polygons the draw store currently shows; other values get re-seeded.
  const syncedRef = useRef<MaskPolygon[] | null>(null);
  const ownChangeRef = useRef<MaskPolygon[] | null>(null);
  const valueRef = useRef(polygons);
  valueRef.current = polygons;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const imageUrlRef = useRef(imageUrl);
  imageUrlRef.current = imageUrl;

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setSize((prev) =>
        prev?.width === img.naturalWidth && prev.height === img.naturalHeight
          ? prev
          : { width: img.naturalWidth, height: img.naturalHeight }
      );
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const projection = useMemo(
    () => (size ? makeCentredProjection(size.width, size.height) : null),
    [size]
  );

  const commit = useCallback((next: MaskPolygon[], fromDraw = false) => {
    const previous = valueRef.current;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    valueRef.current = next;
    ownChangeRef.current = next;
    setHistory((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), previous]);
    if (fromDraw) syncedRef.current = next;
    onChangeRef.current(next);
  }, []);

  const fit = useCallback(() => {
    const map = mapRef.current;
    if (!map || !projection || !size) return;
    const { clientWidth, clientHeight } = map.getContainer();
    const scale = Math.min(
      (clientWidth - FIT_PADDING_PX * 2) / size.width,
      (clientHeight - FIT_PADDING_PX * 2) / size.height
    );
    if (scale <= 0) return;
    const padX = (clientWidth / scale - size.width) / 2;
    const padY = (clientHeight / scale - size.height) / 2;
    fitPxBounds(
      map,
      projection,
      -padX,
      -padY,
      size.width + padX,
      size.height + padY
    );
  }, [projection, size]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !projection || !size) return;
    const map = createImageMap(container, projection);
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right'
    );

    const snapToImage = (event: TerraDrawMouseEvent) => {
      const { x, y } = projection.lngLat2px(event.lng, event.lat);
      const screenPerPx = (512 * 2 ** map.getZoom()) / projection.size;
      const snap = (value: number, length: number) => {
        if (value * screenPerPx < EDGE_SNAP_PX) return 0;
        if ((length - value) * screenPerPx < EDGE_SNAP_PX) return length;
        return value;
      };
      return projection.px2lngLat(snap(x, size.width), snap(y, size.height));
    };

    const masksFromDraw = (draw: TerraDraw): MaskPolygon[] =>
      maskFeatures(draw).map((feature) => {
        const ring: MaskPolygon = feature.geometry.coordinates[0].map(
          ([lng, lat]) => {
            const { x, y } = projection.lngLat2px(lng, lat);
            return [toFraction(x / size.width), toFraction(y / size.height)];
          }
        );
        ring.pop();
        return ring;
      });

    map.on('load', () => {
      map.addLayer({
        id: 'mask-background',
        type: 'background',
        paint: { 'background-color': '#ffffff' },
      });
      map.addSource(SRC_IMAGE, {
        type: 'image',
        url: imageUrlRef.current,
        coordinates: imageCorners(projection, size),
      });
      map.addLayer({
        id: `${SRC_IMAGE}-layer`,
        type: 'raster',
        source: SRC_IMAGE,
        paint: { 'raster-fade-duration': 0 },
      });

      const adapter = new TerraDrawMapLibreGLAdapter({ map });
      precisionRef.current = adapter.getCoordinatePrecision();
      const draw = new TerraDraw({
        adapter,
        modes: [
          new TerraDrawPolygonMode({
            modeName: MODE_MASK,
            snapping: { toCustom: snapToImage },
            styles: {
              fillColor: MASK_COLOR,
              fillOpacity: 0.35,
              outlineColor: MASK_COLOR,
              outlineWidth: 2,
              closingPointWidth: 7,
              closingPointColor: '#ffffff',
              closingPointOutlineColor: MASK_COLOR,
              closingPointOutlineWidth: 2,
              snappingPointWidth: 6,
              snappingPointColor: MASK_COLOR,
              snappingPointOutlineColor: '#ffffff',
              snappingPointOutlineWidth: 2,
            },
          }),
          new TerraDrawSelectMode({
            dragEventThrottle: 0,
            flags: {
              [MODE_MASK]: {
                feature: {
                  draggable: false,
                  coordinates: {
                    draggable: true,
                    snappable: { toCustom: snapToImage },
                    midpoints: { draggable: true },
                    deletable: true,
                  },
                },
              },
            },
            styles: {
              selectedPolygonColor: MASK_COLOR,
              selectedPolygonFillOpacity: 0.45,
              selectedPolygonOutlineColor: MASK_COLOR,
              selectedPolygonOutlineWidth: 3,
              selectionPointWidth: 7,
              selectionPointColor: '#ffffff',
              selectionPointOutlineColor: MASK_COLOR,
              selectionPointOutlineWidth: 2,
              midPointWidth: 5,
              midPointColor: MASK_COLOR,
              midPointOutlineColor: '#ffffff',
              midPointOutlineWidth: 2,
            },
          }),
          new TerraDrawRenderMode({ modeName: MODE_IDLE, styles: {} }),
        ],
      });
      drawRef.current = draw;
      draw.start();
      draw.setMode(MODE_IDLE);

      draw.on('finish', () => commit(masksFromDraw(draw), true));
      draw.on('change', (_ids, type, context) => {
        const fromApi =
          !!context && 'origin' in context && context.origin === 'api';
        if (type !== 'delete' || fromApi) return;
        // Ignore deletion of selection handles.
        const next = masksFromDraw(draw);
        if (next.length !== (syncedRef.current?.length ?? 0)) {
          commit(next, true);
        }
      });
      draw.on('select', (id) => setSelectedId(String(id)));
      draw.on('deselect', () => setSelectedId(null));

      setMapLoaded(true);
    });

    // Keep Escape (cancel or deselect) from closing the surrounding modal.
    const stopEscape = (e: KeyboardEvent) => {
      const draw = drawRef.current;
      if (
        e.key === 'Escape' &&
        (draw?.getModeState() === 'drawing' || draw?.getMode() === MODE_SELECT)
      )
        e.stopPropagation();
    };
    container.addEventListener('keydown', stopEscape);

    // Wizard steps show and hide this map; keep the canvas sized to it.
    const resizeObserver = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {
        /* map torn down; ignore */
      }
    });
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener('keydown', stopEscape);
      resizeObserver.disconnect();
      setMapLoaded(false);
      setActiveTool(null);
      setSelectedId(null);
      try {
        drawRef.current?.stop();
      } catch {
        /* ignore */
      }
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
      syncedRef.current = null;
    };
  }, [projection, size, commit]);

  useEffect(() => {
    if (mapLoaded) fit();
  }, [mapLoaded, fit]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapLoaded || !map || !projection || !size) return;
    (
      map.getSource(SRC_IMAGE) as maplibregl.ImageSource | undefined
    )?.updateImage({
      url: imageUrl,
      coordinates: imageCorners(projection, size),
    });
  }, [mapLoaded, imageUrl, projection, size]);

  const stopTool = useCallback(() => {
    try {
      drawRef.current?.setMode(MODE_IDLE);
    } catch {
      /* ignore */
    }
    setActiveTool(null);
    setSelectedId(null);
  }, []);

  useEffect(() => {
    const draw = drawRef.current;
    if (!mapLoaded || !draw || !projection || !size) return;
    if (syncedRef.current === polygons) return;
    // Undo cannot step back over changes made outside the canvas.
    if (syncedRef.current && polygons !== ownChangeRef.current) setHistory([]);
    stopTool();
    const stale = maskFeatures(draw).flatMap(({ id }) =>
      id === undefined ? [] : [id]
    );
    if (stale.length) draw.removeFeatures(stale);
    const scale = 10 ** precisionRef.current;
    const round = (value: number) => Math.round(value * scale) / scale;
    const features: GeoJSONStoreFeatures<Polygon>[] = polygons
      .filter((polygon) => polygon.length >= 3)
      .map((polygon) => {
        const ring = polygon.map(([x, y]) =>
          projection.px2lngLat(x * size.width, y * size.height).map(round)
        );
        return {
          id: draw.getFeatureId(),
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
          properties: { mode: MODE_MASK },
        };
      });
    if (features.length) {
      const invalid = draw
        .addFeatures(features)
        .filter((result) => !result.valid);
      if (invalid.length) console.error('Failed to add mask polygons', invalid);
    }
    syncedRef.current = polygons;
  }, [mapLoaded, polygons, projection, size, stopTool]);

  const toggleTool = (tool: Tool) => {
    const draw = drawRef.current;
    if (!draw) return;
    if (activeTool === tool) {
      stopTool();
      return;
    }
    setSelectedId(null);
    draw.setMode(tool === 'edit' ? MODE_SELECT : MODE_MASK);
    setActiveTool(tool);
  };

  const deleteSelected = () => {
    const draw = drawRef.current;
    if (!draw || !selectedId) return;
    const index = maskFeatures(draw).findIndex(
      (feature) => String(feature.id) === selectedId
    );
    if (index >= 0) commit(valueRef.current.filter((_, i) => i !== index));
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    ownChangeRef.current = previous;
    onChange(previous);
  };

  const toolHint =
    activeTool === 'edit'
      ? 'Click a mask to select it, then drag its corners. Drag a midpoint to add a corner; right-click a corner to delete it.'
      : activeTool === 'draw'
      ? 'Click to place corners, then click the first corner or press Enter to finish. Esc cancels. Clicks near or outside the image edge snap to it.'
      : 'Choose Draw mask to outline areas to ignore. Scroll to zoom and drag to pan.';

  return (
    <div className='d-flex flex-column gap-2'>
      <div className='d-flex gap-2 flex-wrap align-items-center'>
        <Button
          size='sm'
          variant={activeTool === 'draw' ? 'primary' : 'outline-primary'}
          onClick={() => toggleTool('draw')}
          disabled={!mapLoaded}
        >
          {activeTool === 'draw' ? 'Drawing masks…' : 'Draw mask'}
        </Button>
        <Button
          size='sm'
          variant={activeTool === 'edit' ? 'primary' : 'outline-primary'}
          onClick={() => toggleTool('edit')}
          disabled={!mapLoaded || polygons.length === 0}
        >
          {activeTool === 'edit' ? 'Editing…' : 'Edit masks'}
        </Button>
        <Button
          size='sm'
          variant='outline-danger'
          onClick={deleteSelected}
          disabled={!selectedId}
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
          onClick={fit}
          disabled={!mapLoaded}
        >
          Fit
        </Button>
      </div>
      <span className='text-muted' style={{ fontSize: 12 }}>
        {toolHint}
      </span>
      <div className='survey-map' style={{ background: '#ffffff' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      </div>
    </div>
  );
}
