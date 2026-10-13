import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Form, Modal } from 'react-bootstrap';
import { Minus, Plus } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GlobalContext } from '../Context';
import {
  makeProjection,
  createImageMap,
  addImageTiles,
  fitPxBounds,
  storedZoomToMapZoom,
  mapZoomToStoredZoom,
} from '../annotator/imageTiles';
import {
  DEFAULT_ZOOM_OFFSET,
  ZOOM_LEVEL_COUNT,
  type ZoomPreviewCandidate,
  type ZoomPreviewMode,
} from './zoomPreview';

const OFFSET_MAX_MAP_ZOOM = 22;
const WHOLE_IMAGE_PADDING = 20;
const AUTO_FIT_SCALE = 1.5;
const ANNOTATOR_MAX_WIDTH = '1024px';

type Sample = {
  id: string;
  x: number;
  y: number;
  box: { width: number; height: number } | null;
  image: { id: string; width: number; height: number };
  sourceKey: string;
};

const ZOOM_PANEL_STYLE = {
  position: 'absolute',
  zIndex: 2,
  background: 'rgba(255, 255, 255, 0.95)',
  borderRadius: 8,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
} as const;

const clampValue = (value: number) =>
  Math.max(0, Math.min(ZOOM_LEVEL_COUNT - 1, value));

export default function ZoomPreviewModal({
  show,
  mode,
  loadCandidates,
  zoom,
  onConfirm,
  onClose,
}: {
  show: boolean;
  mode: ZoomPreviewMode;
  loadCandidates: () => Promise<ZoomPreviewCandidate[]>;
  zoom: number | undefined;
  onConfirm: (zoom: number | undefined) => void;
  onClose: () => void;
}) {
  const { client } = useContext(GlobalContext)!;
  const [candidates, setCandidates] = useState<ZoomPreviewCandidate[] | null>(
    null
  );
  const [index, setIndex] = useState(0);
  const [sample, setSample] = useState<Sample | null>(null);
  const [error, setError] = useState('');
  const [value, setValue] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const baseZoomRef = useRef(0);
  // Value carried across samples while Auto is off.
  const pinnedRef = useRef<number | null>(null);
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const loadCandidatesRef = useRef(loadCandidates);
  loadCandidatesRef.current = loadCandidates;

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    pinnedRef.current =
      zoom ?? (mode === 'offset' ? DEFAULT_ZOOM_OFFSET : null);
    setAuto(mode === 'level' && zoom === undefined);
    setCandidates(null);
    setSample(null);
    setValue(null);
    setIndex(0);
    setError('');
    loadCandidatesRef
      .current()
      .then((found) => {
        if (!cancelled) setCandidates(found);
      })
      .catch((err) => {
        console.error('Failed to load zoom preview samples', err);
        if (!cancelled) setError('Could not load a sample.');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const candidate = candidates?.[index] ?? null;

  useEffect(() => {
    if (!candidate) return;
    let cancelled = false;
    setSample(null);
    setError('');
    async function load(target: ZoomPreviewCandidate) {
      try {
        let point = target;
        if (point.x == null || point.y == null || !point.imageId) {
          const { data: annotation } = await client.models.Annotation.get(
            { id: target.id },
            { selectionSet: ['id', 'x', 'y', 'imageId'] as const }
          );
          if (cancelled) return;
          if (!annotation) {
            setError('This sample no longer exists. Try another sample.');
            return;
          }
          point = annotation;
        }
        const { data: image } = await client.models.Image.get(
          { id: point.imageId! },
          { selectionSet: ['id', 'width', 'height'] as const }
        );
        const { data: files } = await client.models.ImageFile.imagesByimageId(
          { imageId: point.imageId },
          { selectionSet: ['id', 'type', 'key'] as const }
        );
        const file =
          (files ?? []).find((f) => f.type === 'image/jpeg') ?? files?.[0];
        if (cancelled) return;
        if (!image || !file?.key) {
          setError('This sample has no image to show. Try another sample.');
          return;
        }
        setSample({
          id: target.id,
          x: point.x!,
          y: point.y!,
          box:
            target.width && target.height
              ? { width: target.width, height: target.height }
              : null,
          image: { id: image.id, width: image.width, height: image.height },
          sourceKey: file.key,
        });
      } catch (err) {
        console.error('Failed to load zoom preview image', err);
        if (!cancelled) setError('Could not load the sample image.');
      }
    }
    load(candidate);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate]);

  const projection = useMemo(
    () =>
      sample ? makeProjection(sample.image.width, sample.image.height) : null,
    [sample]
  );

  const readValue = (map: maplibregl.Map) =>
    Math.round(
      mode === 'level'
        ? mapZoomToStoredZoom(map.getZoom())
        : map.getZoom() - baseZoomRef.current
    );

  const toMapZoom = (next: number) =>
    mode === 'level' ? storedZoomToMapZoom(next) : baseZoomRef.current + next;

  const fitAuto = () => {
    const map = mapRef.current;
    if (!map || !sample?.box || !projection) return;
    const { x, y, box } = sample;
    fitPxBounds(
      map,
      projection,
      x - box.width * AUTO_FIT_SCALE,
      y - box.height * AUTO_FIT_SCALE,
      x + box.width * AUTO_FIT_SCALE,
      y + box.height * AUTO_FIT_SCALE
    );
  };

  const toggleAuto = (next: boolean) => {
    const map = mapRef.current;
    setAuto(next);
    if (!map) return;
    if (next) fitAuto();
    else pinnedRef.current = clampValue(readValue(map));
  };

  const changeValue = (next: number) => {
    const map = mapRef.current;
    if (!map) return;
    const clamped = clampValue(next);
    setAuto(false);
    pinnedRef.current = clamped;
    setValue(clamped);
    map.zoomTo(toMapZoom(clamped), { duration: 150 });
  };

  useEffect(() => {
    if (!show || !sample || !projection || !containerRef.current) return;
    const { px2lngLat } = projection;
    const { x, y, box, image } = sample;
    const map = createImageMap(
      containerRef.current,
      projection,
      mode === 'offset' ? OFFSET_MAX_MAP_ZOOM : undefined
    );
    mapRef.current = map;
    if (mode === 'level') map.setZoomSnap(1);

    map.on('load', () => {
      addImageTiles(map, sample.sourceKey, image, projection);
      if (box) {
        const x0 = x - box.width / 2;
        const y0 = y - box.height / 2;
        const x1 = x + box.width / 2;
        const y1 = y + box.height / 2;
        map.addSource('preview-location', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
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
          },
        });
        map.addLayer({
          id: 'preview-location-line',
          type: 'line',
          source: 'preview-location',
          paint: { 'line-color': 'blue', 'line-width': 2 },
        });
      } else {
        map.addSource('preview-point', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: px2lngLat(x, y) },
          },
        });
        map.addLayer({
          id: 'preview-point-circle',
          type: 'circle',
          source: 'preview-point',
          paint: {
            'circle-radius': 7,
            'circle-color': 'red',
            'circle-stroke-color': 'white',
            'circle-stroke-width': 2,
          },
        });
      }
      if (mode === 'offset') {
        map.fitBounds([px2lngLat(0, image.height), px2lngLat(image.width, 0)], {
          padding: WHOLE_IMAGE_PADDING,
          animate: false,
        });
        baseZoomRef.current = map.getZoom();
      }
      if (!autoRef.current && pinnedRef.current != null) {
        map.jumpTo({
          center: px2lngLat(x, y),
          zoom: toMapZoom(pinnedRef.current),
        });
      } else {
        fitAuto();
      }
      setValue(clampValue(readValue(map)));
    });

    const onZoom = (event: maplibregl.MapLibreEvent<unknown>) => {
      const byUser = !!event.originalEvent;
      const ended = event.type === 'zoomend';
      if (!byUser && !ended) return;
      const next = clampValue(readValue(map));
      setValue(next);
      if (!byUser) return;
      // Zooming by hand takes over from Auto.
      setAuto(false);
      pinnedRef.current = next;
      // Settle on the whole level that gets stored.
      const target = toMapZoom(next);
      if (ended && Math.abs(map.getZoom() - target) > 0.01) {
        map.easeTo({ zoom: target, duration: 150 });
      }
    };
    map.on('zoom', onZoom);
    map.on('zoomend', onZoom);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, sample, projection]);

  const loading = !error && (candidates === null || (candidate && !sample));
  const empty = candidates !== null && candidates.length === 0;
  const ready = !!sample && value != null;

  return (
    // p-0 overrides the scrollbar padding react-bootstrap adds inline.
    <Modal show={show} onHide={onClose} fullscreen className='p-0'>
      <Modal.Header closeButton>
        <Modal.Title>Set Zoom Level</Modal.Title>
      </Modal.Header>
      <Modal.Body className='d-flex flex-column align-items-center gap-2'>
        <span className='text-muted' style={{ fontSize: '12px' }}>
          {mode === 'level'
            ? 'This is a sample location as it will open in the job. Zoom to the level annotators should start at.'
            : 'This is a sample annotation as it will open in the job. Zoom to the level reviewers should start at.'}
        </span>
        <div
          className='w-100 flex-grow-1'
          style={{
            maxWidth: ANNOTATOR_MAX_WIDTH,
            minHeight: 0,
            position: 'relative',
          }}
        >
          {sample && (
            <div
              ref={containerRef}
              key={sample.id}
              style={{
                width: '100%',
                height: '100%',
                borderRadius: 10,
                overflow: 'hidden',
                background: '#ffffff',
              }}
            />
          )}
          {ready && (
            <div
              className='d-flex flex-column align-items-center gap-2 p-2 text-dark'
              style={{ ...ZOOM_PANEL_STYLE, top: 12, left: 12 }}
            >
              <Button
                variant='dark'
                className='d-flex p-1'
                aria-label='Zoom in'
                disabled={value >= ZOOM_LEVEL_COUNT - 1}
                onClick={() => changeValue(value + 1)}
              >
                <Plus size={20} />
              </Button>
              <input
                type='range'
                aria-label='Zoom level'
                min={0}
                max={ZOOM_LEVEL_COUNT - 1}
                step={1}
                value={value}
                onChange={(e) => changeValue(Number(e.target.value))}
                style={{
                  writingMode: 'vertical-lr',
                  direction: 'rtl',
                  height: 240,
                  width: 24,
                  cursor: 'pointer',
                }}
              />
              <Button
                variant='dark'
                className='d-flex p-1'
                aria-label='Zoom out'
                disabled={value <= 0}
                onClick={() => changeValue(value - 1)}
              >
                <Minus size={20} />
              </Button>
              {auto ? (
                <Badge pill bg='warning'>
                  AUTO
                </Badge>
              ) : (
                <strong style={{ fontSize: '13px' }}>{value}</strong>
              )}
            </div>
          )}
          {ready && mode === 'level' && (
            <div
              className={`px-2 py-1 ${
                auto ? 'bg-warning text-white fw-bold' : 'text-dark'
              }`}
              style={{ ...ZOOM_PANEL_STYLE, top: 12, right: 12 }}
            >
              <Form.Switch
                id='zoom-preview-auto'
                className='mb-0'
                label='Auto'
                checked={auto}
                onChange={(e) => toggleAuto(e.target.checked)}
              />
            </div>
          )}
          {(loading || empty || error) && (
            <div className='position-absolute top-50 start-50 translate-middle text-center'>
              {error ? (
                error
              ) : empty ? (
                'Nothing matches the current launch settings to preview.'
              ) : (
                <span className='spinner-border' role='status' />
              )}
            </div>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <span className='me-auto'>
          {!ready
            ? ''
            : auto
            ? `Auto (Level ${value} for this sample)`
            : `Level ${value}`}
        </span>
        <Button
          variant='secondary'
          disabled={!candidates || candidates.length < 2}
          onClick={() => setIndex((i) => (i + 1) % candidates!.length)}
        >
          Next sample
        </Button>
        <Button
          variant='primary'
          disabled={!ready}
          onClick={() => onConfirm(auto ? undefined : value!)}
        >
          {auto ? 'Use Auto' : `Use Level ${value ?? ''}`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
