import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import * as maplibregl from 'maplibre-gl';
import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';

import {
  addImageTiles,
  createImageMap,
  fitPxBounds,
  makeProjection,
} from './annotator/imageTiles';
import { TILE_VIEW_BOUNDS_SCALE } from './annotator/viewTiles';
import { GlobalContext } from './Context';
import {
  loadAnnotationCandidates,
  loadLocationCandidates,
  loadPreviewImage,
  pickZoomPreviewCandidates,
} from './survey/zoomPreview';
import {
  nearestTile,
  tileAt,
  tileGrid,
  type TileGrid,
  type TileLayout,
  type TileRect,
} from './tileLayout';

const ANNOTATOR_MAX_WIDTH = 1024;
const SOURCE_SEAMS = 'tile-seams';
const SOURCE_OVERLAP = 'tile-overlap';
const SOURCE_SELECTED = 'tile-selected';
// Past this, seams merge into a solid block and only cost memory.
const MAX_SEAM_LINES = 200;
const MAX_GRID_CELLS = 400;

type Candidate = { imageId: string; x?: number; y?: number };

type Sample = {
  image: { id: string; width: number; height: number };
  sourceKey: string;
  point: { x: number; y: number } | null;
};

const EMPTY: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

// One image per candidate, so Next image always moves on.
function uniqueImages(candidates: Candidate[]) {
  const seen = new Set<string>();
  return candidates.filter((c) => !seen.has(c.imageId) && seen.add(c.imageId));
}

export default function TileImagePreviewModal({
  show,
  projectId,
  tiledLocationSetId,
  fallbackImageIds,
  baselineLandscape,
  layout,
  controls,
  onCancel,
  onApply,
}: {
  show: boolean;
  projectId: string;
  tiledLocationSetId?: string;
  fallbackImageIds: string[];
  baselineLandscape: boolean;
  layout: TileLayout | null;
  controls: ReactNode;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { client } = useContext(GlobalContext)!;
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [index, setIndex] = useState(0);
  const [sample, setSample] = useState<Sample | null>(null);
  const [picked, setPicked] = useState<{ col: number; row: number } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const fallbackRef = useRef(fallbackImageIds);
  fallbackRef.current = fallbackImageIds;

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    setCandidates(null);
    setSample(null);
    setIndex(0);
    setPicked(null);
    setError('');
    async function load() {
      let found: Candidate[] = (
        await loadAnnotationCandidates(client, projectId)
      ).map((a) => ({ imageId: a.imageId!, x: a.x, y: a.y }));
      if (found.length === 0) {
        const { data: sets } =
          await client.models.LocationSet.locationSetsByProjectId(
            { projectId },
            { selectionSet: ['id'] as const },
          );
        const setIds = (sets ?? [])
          .map((s) => s.id)
          .filter((id) => id !== tiledLocationSetId);
        if (setIds.length > 0) {
          found = (await loadLocationCandidates(client, setIds)).map((l) => ({
            imageId: l.imageId!,
            x: l.x,
            y: l.y,
          }));
        }
      }
      if (found.length === 0) {
        found = pickZoomPreviewCandidates(fallbackRef.current).map(
          (imageId) => ({ imageId }),
        );
      }
      if (!cancelled) setCandidates(uniqueImages(found));
    }
    load().catch((err) => {
      console.error('Failed to load tile preview samples', err);
      if (!cancelled) setError('Could not load a sample image.');
    });
    return () => {
      cancelled = true;
    };
  }, [show, client, projectId, tiledLocationSetId]);

  const candidate = candidates?.[index] ?? null;

  useEffect(() => {
    if (!candidate) return;
    let cancelled = false;
    setSample(null);
    setPicked(null);
    setError('');
    loadPreviewImage(client, candidate.imageId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setError('This image cannot be shown. Try the next image.');
          return;
        }
        setSample({
          ...loaded,
          point:
            candidate.x != null && candidate.y != null
              ? { x: candidate.x, y: candidate.y }
              : null,
        });
      })
      .catch((err) => {
        console.error('Failed to load tile preview image', err);
        if (!cancelled) setError('Could not load the sample image.');
      });
    return () => {
      cancelled = true;
    };
  }, [candidate, client]);

  const projection = useMemo(
    () =>
      sample ? makeProjection(sample.image.width, sample.image.height) : null,
    [sample],
  );

  const grid = useMemo(
    () =>
      sample && layout
        ? tileGrid(sample.image, layout, baselineLandscape)
        : null,
    [sample, layout, baselineLandscape],
  );

  const selected = useMemo<TileRect | null>(() => {
    if (!grid || !sample) return null;
    if (picked) {
      return tileAt(
        grid,
        Math.min(picked.col, grid.across - 1),
        Math.min(picked.row, grid.down - 1),
      );
    }
    const point = sample.point ?? {
      x: sample.image.width / 2,
      y: sample.image.height / 2,
    };
    return nearestTile(grid, point.x, point.y);
  }, [grid, sample, picked]);

  useEffect(() => {
    if (!show || !sample || !projection || !containerRef.current) return;
    const map = createImageMap(containerRef.current, projection);
    mapRef.current = map;
    setTilesLoading(true);
    map.on('dataloading', () => setTilesLoading(true));
    map.on('idle', () => setTilesLoading(false));
    map.on('load', () => {
      addImageTiles(map, sample.sourceKey, sample.image, projection);
      map.addSource(SOURCE_OVERLAP, { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: `${SOURCE_OVERLAP}-fill`,
        type: 'fill',
        source: SOURCE_OVERLAP,
        paint: { 'fill-color': '#df6919', 'fill-opacity': 0.25 },
      });
      map.addSource(SOURCE_SEAMS, { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: `${SOURCE_SEAMS}-line`,
        type: 'line',
        source: SOURCE_SEAMS,
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.7,
          'line-width': 1,
          'line-dasharray': [4, 3],
        },
      });
      map.addSource(SOURCE_SELECTED, { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: `${SOURCE_SELECTED}-line`,
        type: 'line',
        source: SOURCE_SELECTED,
        paint: { 'line-color': 'blue', 'line-width': 2 },
      });
      setMapReady(true);
    });
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, [show, sample, projection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !projection || !sample) return;
    const { px2lngLat } = projection;
    const { width, height } = sample.image;
    const ring = (l: number, t: number, r: number, b: number) => [
      px2lngLat(l, t),
      px2lngLat(r, t),
      px2lngLat(r, b),
      px2lngLat(l, b),
      px2lngLat(l, t),
    ];
    const source = (id: string) =>
      map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (!grid || !selected) {
      source(SOURCE_SEAMS)?.setData(EMPTY);
      source(SOURCE_OVERLAP)?.setData(EMPTY);
      source(SOURCE_SELECTED)?.setData(EMPTY);
      return;
    }
    const line = (count: number, at: (i: number) => TileRect) =>
      count <= MAX_SEAM_LINES
        ? Array.from({ length: count }, (_, i) => at(i))
        : [];
    const columns = line(grid.across, (col) => tileAt(grid, col, 0));
    const rows = line(grid.down, (row) => tileAt(grid, 0, row));
    const xs = new Set<number>();
    const ys = new Set<number>();
    const bands: [number, number, number, number][] = [];
    columns.forEach((rect, i) => {
      if (i > 0) xs.add(rect.left);
      if (i < columns.length - 1) xs.add(rect.right);
      const next = columns[i + 1];
      if (next && rect.right > next.left)
        bands.push([next.left, 0, rect.right, height]);
    });
    rows.forEach((rect, i) => {
      if (i > 0) ys.add(rect.top);
      if (i < rows.length - 1) ys.add(rect.bottom);
      const next = rows[i + 1];
      if (next && rect.bottom > next.top)
        bands.push([0, next.top, width, rect.bottom]);
    });
    source(SOURCE_SEAMS)?.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          ...[...xs].map((x) => [px2lngLat(x, 0), px2lngLat(x, height)]),
          ...[...ys].map((y) => [px2lngLat(0, y), px2lngLat(width, y)]),
        ],
      },
    });
    source(SOURCE_OVERLAP)?.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: bands.map(([l, t, r, b]) => [ring(l, t, r, b)]),
      },
    });
    const { left, top, right, bottom } = selected;
    source(SOURCE_SELECTED)?.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: ring(left, top, right, bottom),
      },
    });
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const w = (right - left) * TILE_VIEW_BOUNDS_SCALE;
    const h = (bottom - top) * TILE_VIEW_BOUNDS_SCALE;
    fitPxBounds(map, projection, cx - w, cy - h, cx + w, cy + h);
  }, [mapReady, projection, sample, grid, selected]);

  const loading =
    !error && (candidates === null || (candidate && !sample) || tilesLoading);
  const empty = candidates !== null && candidates.length === 0;
  const tileNumber =
    selected && grid ? selected.row * grid.across + selected.col + 1 : 0;

  return (
    <Dialog open={show} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent fullscreen>
        <DialogHeader closeButton>
          <DialogTitle>Preview a tile</DialogTitle>
        </DialogHeader>
        <DialogBody className='flex min-h-0 flex-col gap-4 overflow-y-auto lg:flex-row lg:justify-center'>
          <div
            className='relative min-h-[320px] flex-1'
            style={{ maxWidth: ANNOTATOR_MAX_WIDTH }}
          >
            {sample && (
              <div
                ref={containerRef}
                key={sample.image.id}
                className='h-full w-full overflow-hidden bg-white'
                style={{ borderRadius: 10 }}
              />
            )}
            {(loading || empty || error || (sample && !layout)) && (
              <div className='pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center'>
                {error ? (
                  error
                ) : empty ? (
                  'This survey has no images to preview.'
                ) : sample && !layout ? (
                  'Check the settings'
                ) : (
                  <Spinner variant='primary' />
                )}
              </div>
            )}
          </div>
          <div className='flex w-full flex-col gap-3 lg:w-80 lg:flex-none'>
            <span className='text-sm text-muted-foreground'>
              A survey image with one tile outlined in blue, framed the way a
              tiled job opens it. Change the settings to see the tile update.
            </span>
            {grid && sample && (
              <TileGridMap
                image={sample.image}
                grid={grid}
                selected={selected}
                onSelect={(rect) => setPicked({ col: rect.col, row: rect.row })}
              />
            )}
            {selected && grid && (
              <span className='text-center text-xs text-muted-foreground'>
                Tile {tileNumber} of{' '}
                {(grid.across * grid.down).toLocaleString()} ·{' '}
                {(selected.right - selected.left).toLocaleString()} ×{' '}
                {(selected.bottom - selected.top).toLocaleString()} px · click a
                tile to view it
              </span>
            )}
            {controls}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant='ghost' className='mr-auto' onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant='secondary'
            disabled={!candidates || candidates.length < 2}
            onClick={() => setIndex((i) => (i + 1) % candidates!.length)}
          >
            Next image
          </Button>
          <Button variant='primary' disabled={!layout} onClick={onApply}>
            Use these settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TileGridMap({
  image,
  grid,
  selected,
  onSelect,
}: {
  image: { width: number; height: number };
  grid: TileGrid;
  selected: TileRect | null;
  onSelect: (rect: TileRect) => void;
}) {
  const maxSide = 160;
  const scale = maxSide / Math.max(image.width, image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  // Too many cells to click cleanly; the map still shows the tile.
  const rects =
    grid.across * grid.down <= MAX_GRID_CELLS
      ? Array.from({ length: grid.down }, (_, row) =>
          Array.from({ length: grid.across }, (_, col) =>
            tileAt(grid, col, row),
          ),
        ).flat()
      : [];
  return (
    <svg
      width={w + 2}
      height={h + 2}
      viewBox={`-1 -1 ${w + 2} ${h + 2}`}
      className='self-center'
      aria-label='Tiles on this image'
    >
      <rect
        width={w}
        height={h}
        fill='rgba(255,255,255,0.08)'
        stroke='#fff'
        strokeWidth={1.5}
      />
      {rects.map((rect) => (
        <rect
          key={`${rect.col}-${rect.row}`}
          x={rect.left * scale}
          y={rect.top * scale}
          width={(rect.right - rect.left) * scale}
          height={(rect.bottom - rect.top) * scale}
          fill='transparent'
          stroke='#DF6919'
          strokeWidth={0.8}
          className='cursor-pointer hover:fill-[rgba(223,105,25,0.3)]'
          onClick={() => onSelect(rect)}
        />
      ))}
      {selected && (
        <rect
          x={selected.left * scale}
          y={selected.top * scale}
          width={(selected.right - selected.left) * scale}
          height={(selected.bottom - selected.top) * scale}
          fill='rgba(223,105,25,0.55)'
          stroke='#DF6919'
          strokeWidth={1.6}
          pointerEvents='none'
        />
      )}
    </svg>
  );
}
