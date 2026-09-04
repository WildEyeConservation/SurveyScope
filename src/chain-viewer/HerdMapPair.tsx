import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { Button } from 'react-bootstrap';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import maplibregl from 'maplibre-gl';
import { client } from '../stores/appClient';
import {
  IndividualIdMap,
  type MapInstanceCallback,
  type MapMarker,
  type MarkerKind,
} from '../individual-id/IndividualIdMap';
import type {
  LocationOverlayRow,
  LocationSourceConfig,
} from '../individual-id/MapLocationOverlay';
import { isOov } from '../individual-id/utils/identity';
import type { PixelTransform } from '../individual-id/types';
import type { ChainAnnotation, HerdDisplayPair } from './types';

const DEFAULT_COLOR = '#3498db';
const NOOP = () => {};

/** Detection sources whose location boxes can be toggled on each map. */
export const CHAIN_LOCATION_SOURCES: LocationSourceConfig[] = [
  { source: 'scoutbotv3', label: 'ScoutBot', color: '#2f80ed' },
  { source: 'heatmap', label: 'Elephant Nadir', color: '#e67e22' },
  { source: 'mad-v2', label: 'MAD', color: '#27ae60' },
  { source: 'stormfly-testing', label: 'Stormfly (testing model)', color: '#9b59b6' },
  { source: 'owl-d', label: 'OWL-D', color: '#d45e43' },
];

interface Props {
  pair: HerdDisplayPair;
  /** Annotations on the pair's older image (image1), drawn on the left map. */
  annotationsA: ChainAnnotation[];
  /** Annotations on the pair's newer image (image2), drawn on the right map. */
  annotationsB: ChainAnnotation[];
  categoryColors: Record<string, string>;
  onToggleObscured: (annotationId: string) => void;
  onViewChainTiles: (annotationId: string) => void;
  onChangeLabel: (annotationId: string) => void;
  /** Open a free-text comment editor for a marker. Omitted = no comment action. */
  onComment?: (annotationId: string) => void;
  bearingForImage: (image: HerdDisplayPair['imageA']) => number;
  onImageBearingChange: (
    image: HerdDisplayPair['imageA'],
    bearing: number
  ) => void;
  /** Step one frame (pair) back / forward along the time-ordered sequence. */
  onRequestPrevPair?: () => void;
  onRequestNextPair?: () => void;
  /** Jump to the previous / next herd sighting (chain-sharing run). */
  onRequestPrevHerd?: () => void;
  onRequestNextHerd?: () => void;
  /** When set, the toolbar shows a button toggling the nav-bar lanes. */
  collapsed?: boolean;
  onCollapsedChange?: (next: boolean) => void;
  /** Synchronous source key resolver; when provided, skips the ImageFile query. */
  sourceKeyFor?: (imageId: string) => string | undefined;
  /** Detection overlays to offer; pass [] to disable (e.g. for reviewers). */
  locationSources?: LocationSourceConfig[];
  /** Resolve preloaded location rows by image id, used by shared chain reviews. */
  locationRowsFor?: (imageId: string) => LocationOverlayRow[] | undefined;
}

function classify(a: ChainAnnotation): MarkerKind {
  if (a.objectId && a.objectId !== a.id) return 'secondary';
  return 'primary';
}

/**
 * Stripped-down two-map pair workspace for the herd view. Renders both images
 * with their real annotations, keeps the maps linked via the pair's
 * homography (pan/zoom one and the other follows), and exposes only the
 * obscured toggle + "view chain tiles" per marker. No Munkres candidates, no
 * linking, no auto-pan — markers are read-only positions.
 *
 * Remount on pair change (pass `key={pairKey}`) so each pair fits fresh.
 */
export function HerdMapPair({
  pair,
  annotationsA,
  annotationsB,
  categoryColors,
  onToggleObscured,
  onViewChainTiles,
  onChangeLabel,
  onComment,
  bearingForImage,
  onImageBearingChange,
  onRequestPrevPair,
  onRequestNextPair,
  onRequestPrevHerd,
  onRequestNextHerd,
  collapsed,
  onCollapsedChange,
  sourceKeyFor,
  locationSources = CHAIN_LOCATION_SOURCES,
  locationRowsFor,
}: Props) {
  const { imageA, imageB } = pair;

  // Hovering any marker highlights every marker sharing its chain (objectId)
  // across both maps, so the linked sighting on the other image lights up too.
  const [hoverIdentityKey, setHoverIdentityKey] = useState<string | null>(null);
  const identityByAnnId = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of annotationsA) m.set(a.id, a.objectId ?? a.id);
    for (const a of annotationsB) m.set(a.id, a.objectId ?? a.id);
    return m;
  }, [annotationsA, annotationsB]);
  const handleHover = useCallback(
    (key: string | null) =>
      setHoverIdentityKey(key ? identityByAnnId.get(key) ?? null : null),
    [identityByAnnId]
  );

  const buildMarkers = useCallback(
    (annotations: ChainAnnotation[], side: 'A' | 'B'): MapMarker[] =>
      annotations
        .filter((a) => !isOov(a))
        .map((a) => {
          const identityKey = a.objectId ?? a.id;
          return {
            candidateKey: a.id,
            side,
            x: a.x,
            y: a.y,
            color: categoryColors[a.categoryId] ?? DEFAULT_COLOR,
            status: 'pending' as const,
            kind: classify(a),
            identityKey,
            active: identityKey === hoverIdentityKey,
            obscured: !!a.obscured,
            infoTags: a.infoTags,
          };
        }),
    [categoryColors, hoverIdentityKey]
  );

  const markersA = useMemo(
    () => buildMarkers(annotationsA, 'A'),
    [annotationsA, buildMarkers]
  );
  const markersB = useMemo(
    () => buildMarkers(annotationsB, 'B'),
    [annotationsB, buildMarkers]
  );

  // Seed synchronous keys in lazy state: `sourceKey` is in map-init deps, so
  // an undefined→resolved flip tears down and recreates the map mid-flight,
  // letting the discarded map's pending `load` strand markers on the dead map.
  const [sourceKeys, setSourceKeys] = useState<
    [string | undefined, string | undefined]
  >(() =>
    sourceKeyFor
      ? [sourceKeyFor(imageA.id), sourceKeyFor(imageB.id)]
      : [undefined, undefined]
  );
  useEffect(() => {
    if (sourceKeyFor) return;
    let cancelled = false;
    Promise.all(
      [imageA, imageB].map(async (img) => {
        const resp = await client.models.ImageFile.imagesByimageId({
          imageId: img.id,
        });
        const jpg = (resp.data ?? []).find((f) => f.type === 'image/jpeg');
        return jpg?.key ?? undefined;
      })
    ).then((keys) => {
      if (!cancelled)
        setSourceKeys(keys as [string | undefined, string | undefined]);
    });
    return () => {
      cancelled = true;
    };
  }, [imageA, imageB, sourceKeyFor]);

  // ---- Linked maps: slave the other map via the homography on move/zoom. ----
  type MapHandle = {
    map: maplibregl.Map;
    px2lngLat: (x: number, y: number) => [number, number];
    lngLat2px: (lng: number, lat: number) => { x: number; y: number };
  };
  const mapsRef = useRef<[MapHandle | null, MapHandle | null]>([null, null]);
  const [mapsTick, setMapsTick] = useState(0);
  const isSyncingRef = useRef(false);

  const onMapInstance0: MapInstanceCallback = useCallback(
    (map, px2lngLat, lngLat2px) => {
      const wasNull = mapsRef.current[0] === null;
      mapsRef.current[0] = map ? { map, px2lngLat, lngLat2px } : null;
      if (wasNull !== (map === null)) setMapsTick((t) => t + 1);
    },
    []
  );
  const onMapInstance1: MapInstanceCallback = useCallback(
    (map, px2lngLat, lngLat2px) => {
      const wasNull = mapsRef.current[1] === null;
      mapsRef.current[1] = map ? { map, px2lngLat, lngLat2px } : null;
      if (wasNull !== (map === null)) setMapsTick((t) => t + 1);
    },
    []
  );

  useEffect(() => {
    const a = mapsRef.current[0];
    const b = mapsRef.current[1];
    if (!a || !b) return;

    const transforms: [PixelTransform, PixelTransform] = [
      pair.forward,
      pair.backward,
    ];

    const sync = (srcIdx: 0 | 1) => {
      if (isSyncingRef.current) return;
      const src = mapsRef.current[srcIdx];
      const tgt = mapsRef.current[1 - srcIdx];
      if (!src || !tgt) return;
      const tf = transforms[srcIdx];

      const c = src.map.getCenter();
      const srcPx = src.lngLat2px(c.lng, c.lat);
      const tgtPx = tf([srcPx.x, srcPx.y]);
      const targetLngLat = tgt.px2lngLat(tgtPx[0], tgtPx[1]);

      const probe = tf([srcPx.x + 100, srcPx.y]);
      const dx = probe[0] - tgtPx[0];
      const dy = probe[1] - tgtPx[1];
      const scaleRatio = Math.sqrt(dx * dx + dy * dy) / 100;
      const targetZoom = src.map.getZoom() - Math.log2(scaleRatio || 1);

      isSyncingRef.current = true;
      try {
        tgt.map.jumpTo({ center: targetLngLat, zoom: targetZoom });
      } finally {
        requestAnimationFrame(() => {
          isSyncingRef.current = false;
        });
      }
    };

    const aMove = () => sync(0);
    const bMove = () => sync(1);
    a.map.on('move', aMove);
    b.map.on('move', bMove);
    return () => {
      a.map.off('move', aMove);
      b.map.off('move', bMove);
    };
  }, [mapsTick, pair.forward, pair.backward]);

  useHotkeys('ArrowLeft', () => onRequestPrevPair?.(), { enabled: !!onRequestPrevPair }, [
    onRequestPrevPair,
  ]);
  useHotkeys('ArrowRight', () => onRequestNextPair?.(), { enabled: !!onRequestNextPair }, [
    onRequestNextPair,
  ]);
  // Shift+Arrow jumps between herd sightings (chain-sharing runs).
  useHotkeys(
    'shift+ArrowLeft',
    () => onRequestPrevHerd?.(),
    { enabled: !!onRequestPrevHerd },
    [onRequestPrevHerd]
  );
  useHotkeys(
    'shift+ArrowRight',
    () => onRequestNextHerd?.(),
    { enabled: !!onRequestNextHerd },
    [onRequestNextHerd]
  );

  // Hold Tab to temporarily hide the annotation markers on both maps (so the
  // underlying imagery / location boxes can be inspected). Tab is intercepted
  // here unless focus is in a form field, so normal tabbing still works there.
  const [markersHidden, setMarkersHidden] = useState(false);
  useEffect(() => {
    const inFormField = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        node.isContentEditable
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || inFormField(document.activeElement)) return;
      e.preventDefault(); // don't move focus while Tab is used as a "peek" key
      setMarkersHidden(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') setMarkersHidden(false);
    };
    // If the window loses focus while Tab is held, the keyup may never arrive —
    // reset so markers don't stay stuck hidden.
    const onBlur = () => setMarkersHidden(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return (
    <div className='w-100 h-100 d-flex flex-column gap-2'>
      <div
        className='d-flex flex-row gap-2 w-100'
        style={{ flex: 1, minHeight: 0 }}
      >
        <div style={{ flex: 1, minHeight: 0 }}>
          <IndividualIdMap
            image={imageA}
            bearing={bearingForImage(imageA)}
            onBearingChange={(bearing) =>
              onImageBearingChange(imageA, bearing)
            }
            sourceKey={sourceKeys[0]}
            markers={markersA}
            onMarkerDrag={NOOP}
            onMarkerClick={NOOP}
            onMapInstance={onMapInstance0}
            onHoverChange={handleHover}
            onMarkerToggleObscured={onToggleObscured}
            onMarkerViewChainTiles={onViewChainTiles}
            onMarkerChangeLabel={onChangeLabel}
            onMarkerComment={onComment}
            simplifiedActions
            markersDraggable={false}
            previewTransform={pair.backward}
            otherImage={imageB}
            locationSources={locationSources}
            locationRows={locationRowsFor?.(imageA.id)}
            markersHidden={markersHidden}
          />
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <IndividualIdMap
            image={imageB}
            bearing={bearingForImage(imageB)}
            onBearingChange={(bearing) =>
              onImageBearingChange(imageB, bearing)
            }
            sourceKey={sourceKeys[1]}
            markers={markersB}
            onMarkerDrag={NOOP}
            onMarkerClick={NOOP}
            onMapInstance={onMapInstance1}
            onHoverChange={handleHover}
            onMarkerToggleObscured={onToggleObscured}
            onMarkerViewChainTiles={onViewChainTiles}
            onMarkerChangeLabel={onChangeLabel}
            onMarkerComment={onComment}
            simplifiedActions
            markersDraggable={false}
            previewTransform={pair.forward}
            otherImage={imageA}
            locationSources={locationSources}
            locationRows={locationRowsFor?.(imageB.id)}
            markersHidden={markersHidden}
          />
        </div>
      </div>
      <div
        className='d-flex flex-row align-items-center justify-content-center gap-2 px-3 py-2'
        style={{ background: '#4E5D6C', color: '#f8f9fa', position: 'relative' }}
      >
        <Button
          size='sm'
          variant='outline-light'
          onClick={onRequestPrevHerd}
          disabled={!onRequestPrevHerd}
          title='Previous herd (Shift+←)'
          className='d-inline-flex align-items-center justify-content-center gap-1'
          style={{ minWidth: 120 }}
        >
          <ChevronsLeft size={16} /> Prev herd
        </Button>
        <Button
          size='sm'
          onClick={onRequestPrevPair}
          disabled={!onRequestPrevPair}
          title='Previous pair (←)'
          className='d-inline-flex align-items-center justify-content-center gap-1'
          style={{ minWidth: 120 }}
        >
          <ChevronLeft size={16} /> Previous
        </Button>
        <Button
          size='sm'
          onClick={onRequestNextPair}
          disabled={!onRequestNextPair}
          title='Next pair (→)'
          className='d-inline-flex align-items-center justify-content-center gap-1'
          style={{ minWidth: 120 }}
        >
          Next <ChevronRight size={16} />
        </Button>
        <Button
          size='sm'
          variant='outline-light'
          onClick={onRequestNextHerd}
          disabled={!onRequestNextHerd}
          title='Next herd (Shift+→)'
          className='d-inline-flex align-items-center justify-content-center gap-1'
          style={{ minWidth: 120 }}
        >
          Next herd <ChevronsRight size={16} />
        </Button>
        {onCollapsedChange && (
          <Button
            size='sm'
            variant='outline-light'
            onClick={() => onCollapsedChange(!collapsed)}
            title={collapsed ? 'Show timeline' : 'Hide timeline'}
            style={{ position: 'absolute', left: 12 }}
          >
            {collapsed ? '▴' : '▾'}
          </Button>
        )}
      </div>
    </div>
  );
}
