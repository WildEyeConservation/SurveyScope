import { useRef, useEffect, useCallback, useMemo, useState, type ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { renderToStaticMarkup } from 'react-dom/server';
import { RotateCw, MoreVertical, Copy, Check } from 'lucide-react';
import { getTileBlob, imageTileContext } from '../StorageLayer';
import type { ImageType } from '../schemaTypes';
import type { Point } from '../homography/ManualHomographyEditor';

// MapLibre doesn't require an access token for local or open-source tiles.

export const POINT_COLORS = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
  '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
  '#469990', '#dcbeff',
];

const TILE_SIZE = 256;
const SOURCE_POINTS = 'points';
const LAYER_CIRCLES = 'points-circle';
const LAYER_LABELS = 'points-label';

class RotateControl implements maplibregl.IControl {
  _map?: maplibregl.Map;
  _container?: HTMLDivElement;

  onAdd(map: maplibregl.Map) {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'maplibregl-ctrl-icon';
    button.title = 'Rotate 90°';
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    
    button.innerHTML = renderToStaticMarkup(<RotateCw size={16} color="#333" strokeWidth={2.5} />);
    
    button.onclick = () => {
      const currentBearing = map.getBearing();
      const nextBearing = (Math.round(currentBearing / 90) * 90) - 90;
      map.easeTo({
        bearing: nextBearing,
        duration: 300
      });
    };

    this._container.appendChild(button);
    return this._container;
  }

  onRemove() {
    this._container?.parentNode?.removeChild(this._container);
    this._map = undefined;
  }
}

/**
 * Higher-resolution scale to keep coordinates very close to the equator (e.g. within 0.1 deg).
 * MapLibre Use Web Mercator, which is linear near the equator. At 45 deg lat, vertical distortion
 * is ~40%, but at 0.1 deg lat, it is < 0.0001%.
 */
function getScale(width: number, height: number) {
  return 0.1 / Math.max(width, height);
}

function getPointFeaturesAt(map: maplibregl.Map, point: maplibregl.Point) {
  return map.queryRenderedFeatures(point, { layers: [LAYER_CIRCLES] });
}

export type MapLibreMenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

type Props = {
  image: ImageType;
  sourceKey: string | undefined;
  points: Point[];
  setPoints: (updater: Point[] | ((prev: Point[]) => Point[])) => void;
  highlightedIndex: number | null;
  onHoverPoint: (index: number | null) => void;
  onContextMenu?: (pointIndex: number, screenPos: { x: number; y: number }) => void;
  onAction?: () => void;
  previewTransform?: (c: [number, number]) => [number, number];
  /**
   * Optional second overlay drawn in red, independent of `previewTransform`.
   * Used by the homography editor to display the homography currently saved
   * in the DB as a reference. Purely visual — never feeds map sync.
   */
  savedTransform?: (c: [number, number]) => [number, number];
  otherImage?: ImageType;
  onMapInstance?: (map: maplibregl.Map | null, px2lngLat: (x: number, y: number) => [number, number], lngLat2px: (lng: number, lat: number) => { x: number; y: number }) => void;
  onInitialTilesReady?: () => void;
  menuItems?: MapLibreMenuItem[];
};

const SOURCE_PREVIEW = 'preview';
const LAYER_OUTLINE = 'preview-outline';
const LAYER_GRID = 'preview-grid';
const SOURCE_SAVED = 'saved-preview';
const LAYER_SAVED_OUTLINE = 'saved-preview-outline';
const LAYER_SAVED_GRID = 'saved-preview-grid';

export function MapLibreImageViewer({
  image,
  sourceKey,
  points,
  setPoints,
  highlightedIndex,
  onHoverPoint,
  onContextMenu,
  onAction,
  previewTransform,
  savedTransform,
  otherImage,
  onMapInstance,
  onInitialTilesReady,
  menuItems,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const dragPointRef = useRef<{ index: number } | null>(null);
  const cancelledRef = useRef(false);
  const loadedTilesRef = useRef<Set<string>>(new Set());
  const blobUrlsRef = useRef<string[]>([]);
  const readyCallbackRef = useRef(onInitialTilesReady);
  readyCallbackRef.current = onInitialTilesReady;
  const readyMapRef = useRef<maplibregl.Map | null>(null);
  const initialTilesReadyRef = useRef(false);

  const scale = useMemo(() => getScale(image.width, image.height), [image.width, image.height]);

  const px2lngLat = useCallback(
    (x: number, y: number): [number, number] => [x * scale, -y * scale],
    [scale]
  );
  const lngLat2px = useCallback(
    (lng: number, lat: number): { x: number; y: number } => ({
      x: lng / scale,
      y: -lat / scale,
    }),
    [scale]
  );

  // Load only visible tiles at a suitable zoom level
  const updateVisibleTiles = useCallback(async (m: maplibregl.Map | null) => {
    if (!m || !sourceKey || cancelledRef.current) return;

    const { maxZ, pyramidSize } = getPyramidInfo(image);

    // Choose tile zoom z based on current map zoom.
    // We want the tiles to be sharp but not excessively high-res.
    const mapZoom = m.getZoom();
    const degPerPxAtZoom0 = 360 / 256;
    const currentDegPerPx = degPerPxAtZoom0 / Math.pow(2, mapZoom);
    const targetTilePxPerDeg = 1 / (currentDegPerPx * 0.75); // slight oversampling for sharpness

    // Tile resolution at tileZ z: (TILE_SIZE * 2^z) / (pyramidSize * scale) px/deg
    const target2z = (targetTilePxPerDeg * pyramidSize * scale) / TILE_SIZE;
    const z = Math.max(0, Math.min(maxZ, Math.round(Math.log2(target2z))));

    const tileCoverage = pyramidSize / Math.pow(2, z);
    const cols = Math.ceil(image.width / tileCoverage);
    const rows = Math.ceil(image.height / tileCoverage);

    const bounds = m.getBounds();
    const pendingTiles: Promise<void>[] = [];
    let addedTiles = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sourceId = `tile-${z}-${row}-${col}`;
        if (loadedTilesRef.current.has(sourceId)) continue;

        const x0 = col * tileCoverage;
        const y0 = row * tileCoverage;
        const x1 = (col + 1) * tileCoverage;
        const y1 = (row + 1) * tileCoverage;

        const c1 = px2lngLat(x0, y0);
        const c2 = px2lngLat(x1, y1);
        const tileBounds = new maplibregl.LngLatBounds(
          [Math.min(c1[0], c2[0]), Math.min(c1[1], c2[1])],
          [Math.max(c1[0], c2[0]), Math.max(c1[1], c2[1])]
        );

        const isVisible = bounds && (
          bounds.getWest() <= tileBounds.getEast() &&
          bounds.getEast() >= tileBounds.getWest() &&
          bounds.getSouth() <= tileBounds.getNorth() &&
          bounds.getNorth() >= tileBounds.getSouth()
        );

        if (isVisible && !isCoveredByHigherRes(z, row, col, maxZ, loadedTilesRef.current)) {
          loadedTilesRef.current.add(sourceId);
          const path = `slippymaps/${sourceKey}/${z}/${row}/${col}.png`;
          pendingTiles.push(getTileBlob(path, imageTileContext(image)).then((blob) => {
            if (cancelledRef.current) return;
            const url = URL.createObjectURL(blob);
            blobUrlsRef.current.push(url);
            addTileToMap(m, url, z, row, col, tileCoverage, px2lngLat);
            addedTiles += 1;
          }).catch(() => {
            // Silently fail, tile will remain in 'visible' check for later
            loadedTilesRef.current.delete(sourceId);
          }));
        }
      }
    }
    if (pendingTiles.length && !initialTilesReadyRef.current) {
      await Promise.all(pendingTiles);
      if (addedTiles > 0 && readyMapRef.current === m) {
        m.once('idle', () => {
          if (readyMapRef.current === m && !initialTilesReadyRef.current) {
            initialTilesReadyRef.current = true;
            readyCallbackRef.current?.();
          }
        });
      }
    }
  }, [sourceKey, image, px2lngLat, scale]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;
    cancelledRef.current = false;
    loadedTilesRef.current = new Set();
    blobUrlsRef.current = [];
    initialTilesReadyRef.current = false;

    const m = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {},
        layers: [],
      },
      center: px2lngLat(image.width / 2, image.height / 2),
      zoom: 1,
      minZoom: -20,
      maxZoom: 22,
      renderWorldCopies: false,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
    });

    m.addControl(new maplibregl.NavigationControl({
      showCompass: false,
      showZoom: true,
      visualizePitch: false,
    }), 'top-left');

    m.addControl(new RotateControl(), 'top-left');

    m.touchZoomRotate.disableRotation();

    m.on('load', () => {
      m.addSource(SOURCE_POINTS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      m.addLayer({
        id: LAYER_CIRCLES,
        type: 'circle',
        source: SOURCE_POINTS,
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['get', 'highlighted'], false],
            10, 7,
          ],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9,
        },
      });

      m.addLayer({
        id: LAYER_LABELS,
        type: 'symbol',
        source: SOURCE_POINTS,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 12,
          'text-offset': [0, -1.5],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.7)',
          'text-halo-width': 1.5,
        },
      });

      // Homography preview layers
      m.addSource(SOURCE_PREVIEW, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      m.addLayer({
        id: LAYER_GRID,
        type: 'line',
        source: SOURCE_PREVIEW,
        filter: ['==', ['get', 'type'], 'grid'],
        paint: {
          'line-color': '#00e5ff',
          'line-width': 1,
          'line-opacity': 0.4,
        },
      });

      m.addLayer({
        id: LAYER_OUTLINE,
        type: 'line',
        source: SOURCE_PREVIEW,
        filter: ['==', ['get', 'type'], 'outline'],
        paint: {
          'line-color': '#00e5ff',
          'line-width': 3,
          'line-dasharray': [2, 1],
        },
      });

      // Second overlay (red) — displays the saved-in-DB homography for
      // reference when the editor toggle is on. Same shape as the cyan
      // preview but driven by `savedTransform` instead of the user's
      // current points.
      m.addSource(SOURCE_SAVED, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      m.addLayer({
        id: LAYER_SAVED_GRID,
        type: 'line',
        source: SOURCE_SAVED,
        filter: ['==', ['get', 'type'], 'grid'],
        paint: {
          'line-color': '#ff3b30',
          'line-width': 1,
          'line-opacity': 0.4,
        },
      });

      m.addLayer({
        id: LAYER_SAVED_OUTLINE,
        type: 'line',
        source: SOURCE_SAVED,
        filter: ['==', ['get', 'type'], 'outline'],
        paint: {
          'line-color': '#ff3b30',
          'line-width': 3,
          'line-dasharray': [2, 1],
        },
      });

      m.fitBounds(
        [px2lngLat(0, image.height), px2lngLat(image.width, 0)],
        { padding: 20, animate: false }
      );

      updateVisibleTiles(m);
      setMap(m);
    });

    readyMapRef.current = m;
    const onMoveEnd = () => updateVisibleTiles(m);
    m.on('moveend', onMoveEnd);

    return () => {
      cancelledRef.current = true;
      readyMapRef.current = null;
      m.remove();
      setMap(null);
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [image.id, sourceKey, px2lngLat, updateVisibleTiles, image.width, image.height]);

  useEffect(() => {
    onMapInstance?.(map, px2lngLat, lngLat2px);
  }, [map, px2lngLat, lngLat2px, onMapInstance]);

  // Update points GeoJSON
  useEffect(() => {
    if (!map) return;
    const source = map.getSource(SOURCE_POINTS) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    const features = points.map((p, i) => ({
      type: 'Feature' as const,
      properties: {
        index: i,
        label: `${i + 1}`,
        color: POINT_COLORS[i % POINT_COLORS.length],
        highlighted: i === highlightedIndex,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: px2lngLat(p.x, p.y),
      },
    }));

    source.setData({ type: 'FeatureCollection', features });
  }, [map, points, highlightedIndex, px2lngLat]);

  // Update homography preview GeoJSON
  useEffect(() => {
    if (!map) return;
    const source = map.getSource(SOURCE_PREVIEW) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (!previewTransform || !otherImage) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const w = otherImage.width;
    const h = otherImage.height;
    const GRID_DIVISIONS = 8;
    const GRID_SAMPLES = 30;

    const features: any[] = [];

    // Outline
    const corners: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h], [0, 0]];
    features.push({
      type: 'Feature',
      properties: { type: 'outline' },
      geometry: {
        type: 'LineString',
        coordinates: corners.map((c) => px2lngLat(...previewTransform(c))),
      },
    });

    // Grid lines
    for (let i = 0; i <= GRID_DIVISIONS; i++) {
      // Vertical
      const x = (w * i) / GRID_DIVISIONS;
      const vLine: [number, number][] = [];
      for (let j = 0; j <= GRID_SAMPLES; j++) {
        vLine.push(previewTransform([x, (h * j) / GRID_SAMPLES]));
      }
      features.push({
        type: 'Feature',
        properties: { type: 'grid' },
        geometry: {
          type: 'LineString',
          coordinates: vLine.map((c) => px2lngLat(...c)),
        },
      });

      // Horizontal
      const y = (h * i) / GRID_DIVISIONS;
      const hLine: [number, number][] = [];
      for (let j = 0; j <= GRID_SAMPLES; j++) {
        hLine.push(previewTransform([(w * j) / GRID_SAMPLES, y]));
      }
      features.push({
        type: 'Feature',
        properties: { type: 'grid' },
        geometry: {
          type: 'LineString',
          coordinates: hLine.map((c) => px2lngLat(...c)),
        },
      });
    }

    source.setData({ type: 'FeatureCollection', features });
  }, [map, previewTransform, otherImage, px2lngLat]);

  // Update saved-homography preview GeoJSON (red overlay). Same shape as
  // above, separate source so the two overlays can be shown together.
  useEffect(() => {
    if (!map) return;
    const source = map.getSource(SOURCE_SAVED) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;

    if (!savedTransform || !otherImage) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const w = otherImage.width;
    const h = otherImage.height;
    const GRID_DIVISIONS = 8;
    const GRID_SAMPLES = 30;

    const features: any[] = [];

    const corners: [number, number][] = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
      [0, 0],
    ];
    features.push({
      type: 'Feature',
      properties: { type: 'outline' },
      geometry: {
        type: 'LineString',
        coordinates: corners.map((c) => px2lngLat(...savedTransform(c))),
      },
    });

    for (let i = 0; i <= GRID_DIVISIONS; i++) {
      const x = (w * i) / GRID_DIVISIONS;
      const vLine: [number, number][] = [];
      for (let j = 0; j <= GRID_SAMPLES; j++) {
        vLine.push(savedTransform([x, (h * j) / GRID_SAMPLES]));
      }
      features.push({
        type: 'Feature',
        properties: { type: 'grid' },
        geometry: {
          type: 'LineString',
          coordinates: vLine.map((c) => px2lngLat(...c)),
        },
      });

      const y = (h * i) / GRID_DIVISIONS;
      const hLine: [number, number][] = [];
      for (let j = 0; j <= GRID_SAMPLES; j++) {
        hLine.push(savedTransform([(w * j) / GRID_SAMPLES, y]));
      }
      features.push({
        type: 'Feature',
        properties: { type: 'grid' },
        geometry: {
          type: 'LineString',
          coordinates: hLine.map((c) => px2lngLat(...c)),
        },
      });
    }

    source.setData({ type: 'FeatureCollection', features });
  }, [map, savedTransform, otherImage, px2lngLat]);

  // Click to add points
  useEffect(() => {
    if (!map) return;

    const MIN_POINT_DISTANCE = 20;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (getPointFeaturesAt(map, e.point).length > 0) return;

      const { x, y } = lngLat2px(e.lngLat.lng, e.lngLat.lat);
      if (x < 0 || x > image.width || y < 0 || y > image.height) return;

      const tooClose = points.some((p) => {
        const dx = p.x - x;
        const dy = p.y - y;
        return Math.sqrt(dx * dx + dy * dy) < MIN_POINT_DISTANCE;
      });
      if (tooClose) return;

      onAction?.();
      setPoints((prev) => [...prev, { id: crypto.randomUUID(), x, y }]);
    };

    map.on('click', handleClick);
    return () => { map.off('click', handleClick); };
  }, [map, points, lngLat2px, setPoints, image.width, image.height]);

  // Hover highlights
  useEffect(() => {
    if (!map) return;

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (dragPointRef.current) return;
      const features = getPointFeaturesAt(map, e.point);
      if (features.length > 0) {
        map.getCanvas().style.cursor = 'pointer';
        onHoverPoint(features[0].properties?.index ?? null);
      } else {
        map.getCanvas().style.cursor = 'crosshair';
        onHoverPoint(null);
      }
    };

    const handleMouseLeave = () => onHoverPoint(null);

    map.on('mousemove', handleMouseMove);
    const canvas = map.getCanvas();
    canvas.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      map.off('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [map, onHoverPoint]);

  // Drag points
  useEffect(() => {
    if (!map) return;

    const handleMouseDown = (e: maplibregl.MapMouseEvent) => {
      // Only allow dragging with left mouse button
      if (e.originalEvent.button !== 0) return;

      const features = getPointFeaturesAt(map, e.point);
      if (features.length === 0) return;
      const index = features[0].properties?.index;
      if (index == null) return;

      e.preventDefault();
      onAction?.();
      dragPointRef.current = { index };
      map.getCanvas().style.cursor = 'grabbing';
      map.dragPan.disable();
    };

    const handleMouseMoveForDrag = (e: maplibregl.MapMouseEvent) => {
      if (!dragPointRef.current) return;
      const { x, y } = lngLat2px(e.lngLat.lng, e.lngLat.lat);
      const idx = dragPointRef.current.index;
      setPoints((prev) =>
        prev.map((p, i) => (i === idx ? { ...p, x, y } : p))
      );
    };

    const handleMouseUp = () => {
      if (!dragPointRef.current) return;
      dragPointRef.current = null;
      map.getCanvas().style.cursor = 'crosshair';
      map.dragPan.enable();
    };

    map.on('mousedown', handleMouseDown);
    map.on('mousemove', handleMouseMoveForDrag);
    map.on('mouseup', handleMouseUp);
    const canvas = map.getCanvas();
    canvas.addEventListener('mouseleave', handleMouseUp);

    return () => {
      map.off('mousedown', handleMouseDown);
      map.off('mousemove', handleMouseMoveForDrag);
      map.off('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
    };
  }, [map, lngLat2px, setPoints]);

  // Right-click context menu
  useEffect(() => {
    if (!map) return;

    const handleContextMenu = (e: maplibregl.MapMouseEvent) => {
      const features = getPointFeaturesAt(map, e.point);
      if (features.length === 0) return;
      e.preventDefault();
      const index = features[0].properties?.index;
      if (index == null) return;
      onContextMenu?.(index, { x: e.point.x, y: e.point.y });
    };

    map.on('contextmenu', handleContextMenu);
    return () => { map.off('contextmenu', handleContextMenu); };
  }, [map, onContextMenu]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const imageName = (image as any).originalPath ?? image.id;
  const [copied, setCopied] = useState(false);

  const handleCopyName = useCallback(() => {
    navigator.clipboard.writeText(imageName);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [imageName]);

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 10,
          overflow: 'hidden',
          background: '#ffffff',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          width: 200,
        }}
        className="maplibregl-ctrl maplibregl-ctrl-group"
      >
        <button
          className="maplibregl-ctrl-icon"
          title={copied ? 'Copied!' : `Click to copy: ${imageName}`}
          onClick={handleCopyName}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '0 8px',
            fontSize: '0.75rem',
            color: copied ? '#2e7d32' : '#333',
            width: '100%',
            cursor: 'pointer',
            height: 29,
            transition: 'color 0.2s',
          }}
        >
          {copied
            ? <Check size={12} strokeWidth={2.5} style={{ flexShrink: 0 }} />
            : <Copy size={12} strokeWidth={2.5} style={{ flexShrink: 0 }} />
          }
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {copied ? 'Copied!' : imageName}
          </span>
        </button>
      </div>
      {menuItems && menuItems.length > 0 && (
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }} className="maplibregl-ctrl maplibregl-ctrl-group">
          <button
            className="maplibregl-ctrl-icon"
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title='Options'
          >
            <MoreVertical size={16} color="#333" strokeWidth={2.5} />
          </button>
          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                top: 32,
                right: 0,
                background: '#ffffff',
                border: '1px solid #ccc',
                borderRadius: 4,
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                minWidth: 180,
                padding: '4px 0',
                fontSize: '0.85rem',
              }}
            >
              {menuItems.map((item, idx) => (
                <button
                  key={idx}
                  disabled={item.disabled}
                  onClick={() => {
                    item.onClick();
                    setMenuOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    color: item.disabled ? '#aaa' : '#333',
                    cursor: item.disabled ? 'default' : 'pointer',
                    textAlign: 'left',
                    fontSize: 'inherit',
                  }}
                  onMouseEnter={(e) => {
                    if (!item.disabled) (e.currentTarget.style.background = '#f5f5f5');
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getPyramidInfo(image: ImageType) {
  const maxDim = Math.max(image.width, image.height);
  const maxZ = Math.ceil(Math.log2(maxDim / TILE_SIZE));
  const pyramidSize = TILE_SIZE * Math.pow(2, maxZ);
  return { maxZ, pyramidSize };
}

/** Check if a tile's area is fully covered by already-loaded higher-res tiles. */
function isCoveredByHigherRes(
  z: number, row: number, col: number,
  maxZ: number, loadedTiles: Set<string>,
): boolean {
  if (z >= maxZ) return false;
  const childZ = z + 1;
  for (let dr = 0; dr < 2; dr++) {
    for (let dc = 0; dc < 2; dc++) {
      const cr = row * 2 + dr;
      const cc = col * 2 + dc;
      if (!loadedTiles.has(`tile-${childZ}-${cr}-${cc}`) &&
        !isCoveredByHigherRes(childZ, cr, cc, maxZ, loadedTiles)) {
        return false;
      }
    }
  }
  return true;
}

function addTileToMap(
  map: maplibregl.Map,
  blobUrl: string,
  z: number, row: number, col: number,
  tileCoverage: number,
  px2lngLat: (x: number, y: number) => [number, number],
) {
  const sourceId = `tile-${z}-${row}-${col}`;
  if (map.getSource(sourceId)) return;

  const x0 = col * tileCoverage;
  const y0 = row * tileCoverage;
  const x1 = (col + 1) * tileCoverage;
  const y1 = (row + 1) * tileCoverage;

  map.addSource(sourceId, {
    type: 'image',
    url: blobUrl,
    coordinates: [
      px2lngLat(x0, y0),
      px2lngLat(x1, y0),
      px2lngLat(x1, y1),
      px2lngLat(x0, y1),
    ],
  });

  // Insert in z-order so higher-res tiles always render on top of lower-res
  let beforeId: string = LAYER_CIRCLES;
  const layers = map.getStyle().layers || [];
  for (const layer of layers) {
    if (layer.id.startsWith('layer-')) {
      const layerZ = parseInt(layer.id.split('-')[1], 10);
      if (layerZ > z) {
        beforeId = layer.id;
        break;
      }
    }
  }

  map.addLayer(
    {
      id: `layer-${z}-${row}-${col}`,
      type: 'raster',
      source: sourceId,
      paint: { 'raster-fade-duration': 0 },
    },
    beforeId
  );
}

