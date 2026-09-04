import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import type { ImageType } from '../schemaTypes';
import type { Point } from './ManualHomographyEditor';
import { MapLibreImageViewer, POINT_COLORS, type MapLibreMenuItem } from '../maplibre-viewer/MapLibreImageViewer';
import { client } from '../stores/appClient';
import { useParams } from 'react-router-dom';

type Props = {
  images: [ImageType, ImageType];
  points: [Point[], Point[]];
  setPoints: [
    (updater: Point[] | ((prev: Point[]) => Point[])) => void,
    (updater: Point[] | ((prev: Point[]) => Point[])) => void,
  ];
  previewTransforms: [
    (c: [number, number]) => [number, number],
    (c: [number, number]) => [number, number],
  ] | null;
  /**
   * Optional independent overlay (red) drawn on each map showing the
   * homography currently saved in the DB. Purely visual — never used for
   * map sync.
   */
  savedTransforms?: [
    (c: [number, number]) => [number, number],
    (c: [number, number]) => [number, number],
  ] | null;
  onAction: () => void;
  annotationSetId?: string;
};

type ContextMenuState = {
  imageIndex: number;
  pointIndex: number;
  screenPos: { x: number; y: number };
} | null;

function PointContextMenu({
  menu,
  points,
  onClose,
  onRemove,
  onSwap,
}: {
  menu: NonNullable<ContextMenuState>;
  points: Point[];
  onClose: () => void;
  onRemove: (imageIndex: number, pointIndex: number) => void;
  onSwap: (imageIndex: number, fromIndex: number, toIndex: number) => void;
}) {
  const { pointIndex, imageIndex, screenPos } = menu;

  // Close on outside click or Esc key
  useEffect(() => {
    const handleEvents = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof MouseEvent || (e instanceof KeyboardEvent && e.key === 'Escape')) {
        onClose();
      }
    };
    window.addEventListener('click', handleEvents);
    window.addEventListener('keydown', handleEvents);
    return () => {
      window.removeEventListener('click', handleEvents);
      window.removeEventListener('keydown', handleEvents);
    };
  }, [onClose]);

  const swapTargets = points
    .map((_, i) => i)
    .filter((i) => i !== pointIndex);

  return (
    <div
      style={{
        position: 'fixed',
        left: screenPos.x,
        top: screenPos.y,
        zIndex: 9999,
        background: '#ffffff',
        border: '1px solid #ccc',
        borderRadius: 4,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        minWidth: 160,
        fontSize: '0.85rem',
        padding: '4px 0',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          padding: '6px 12px',
          color: '#666',
          fontSize: '0.75rem',
          borderBottom: '1px solid #eee',
          fontWeight: 'bold',
        }}
      >
        Point {pointIndex + 1}
      </div>
      <button
        className='btn btn-sm w-100 text-start'
        style={{ padding: '8px 12px', textDecoration: 'none', color: '#d9534f', background: 'transparent', border: 'none' }}
        onClick={() => {
          onRemove(imageIndex, pointIndex);
          onClose();
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        Remove point
      </button>
      {swapTargets.length > 0 && (
        <>
          <div
            style={{
              padding: '4px 12px',
              color: '#999',
              fontSize: '0.70rem',
              borderTop: '1px solid #eee',
              marginTop: 4,
              textTransform: 'uppercase',
            }}
          >
            Swap with...
          </div>
          {swapTargets.map((targetIdx) => (
            <button
              key={targetIdx}
              className='btn btn-sm w-100 text-start'
              style={{ padding: '8px 12px', textDecoration: 'none', color: '#333', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center' }}
              onClick={() => {
                onSwap(imageIndex, pointIndex, targetIdx);
                onClose();
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f5')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: POINT_COLORS[targetIdx % POINT_COLORS.length],
                  marginRight: 8,
                }}
              />
              Point {targetIdx + 1}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

export function MapLibrePairViewer({
  images,
  points,
  setPoints,
  previewTransforms,
  savedTransforms,
  onAction,
  annotationSetId: annotationSetIdProp,
}: Props) {
  const { surveyId, annotationSetId: annotationSetIdParam } = useParams();
  const annotationSetId = annotationSetIdProp || annotationSetIdParam;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [sourceKeys, setSourceKeys] = useState<[string | undefined, string | undefined]>([
    undefined,
    undefined,
  ]);

  const mapsRef = useRef<([maplibregl.Map, (x: number, y: number) => [number, number], (lng: number, lat: number) => { x: number; y: number }] | null)[]>([null, null]);
  const [mapsReady, setMapsReady] = useState(0);

  const onMapInstance0 = useCallback(
    (m: maplibregl.Map | null, px2l: (x: number, y: number) => [number, number], l2px: (lng: number, lat: number) => { x: number; y: number }) => {
      const wasNull = mapsRef.current[0] === null;
      if (m) {
        mapsRef.current[0] = [m, px2l, l2px];
      } else {
        mapsRef.current[0] = null;
      }
      // Only bump when mount/unmount changes
      if (wasNull !== (m === null)) setMapsReady((c) => c + 1);
    },
    []
  );

  const onMapInstance1 = useCallback(
    (m: maplibregl.Map | null, px2l: (x: number, y: number) => [number, number], l2px: (lng: number, lat: number) => { x: number; y: number }) => {
      const wasNull = mapsRef.current[1] === null;
      if (m) {
        mapsRef.current[1] = [m, px2l, l2px];
      } else {
        mapsRef.current[1] = null;
      }
      if (wasNull !== (m === null)) setMapsReady((c) => c + 1);
    },
    []
  );

  // Fetch source keys for each image
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      images.map(async (img) => {
        const resp = await client.models.ImageFile.imagesByimageId({
          imageId: img.id,
        });
        const jpgFile = resp.data.find(
          (f: any) => f.type === 'image/jpeg'
        );
        return jpgFile?.key as string | undefined;
      })
    ).then((keys) => {
      if (!cancelled) {
        setSourceKeys(keys as [string | undefined, string | undefined]);
      }
    });
    return () => { cancelled = true; };
  }, [images[0].id, images[1].id]);

  // Map Synchronization
  useEffect(() => {
    if (!previewTransforms) return;

    let isSyncing = false;

    const syncHandler = (sourceIdx: number) => {
      if (isSyncing) return;
      const targetIdx = 1 - sourceIdx;
      const source = mapsRef.current[sourceIdx];
      const target = mapsRef.current[targetIdx];
      if (!source || !target || !previewTransforms) return;

      const [sMap, , sLngLat2px] = source;
      const [tMap, tPx2lngLat, tLngLat2px] = target;

      const centerLngLat = sMap.getCenter();
      const sPx = sLngLat2px(centerLngLat.lng, centerLngLat.lat);
      const tPx = previewTransforms[sourceIdx]([sPx.x, sPx.y]);

      const tLngLat = tPx2lngLat(tPx[0], tPx[1]);

      // Check distance to avoid unnecessary updates/jitters
      const currentTLngLat = tMap.getCenter();
      const currentTPx = tLngLat2px(currentTLngLat.lng, currentTLngLat.lat);
      const dist = Math.sqrt(Math.pow(currentTPx.x - tPx[0], 2) + Math.pow(currentTPx.y - tPx[1], 2));

      if (dist > 0.5 || Math.abs(sMap.getZoom() - tMap.getZoom()) > 0.001) {
        isSyncing = true;
        tMap.jumpTo({
          center: tLngLat,
          zoom: sMap.getZoom(),
        });
        isSyncing = false;
      }
    };

    const listeners = [0, 1].map((i) => {
      const m = mapsRef.current[i];
      if (!m) return null;
      const handler = () => syncHandler(i);
      m[0].on('move', handler);
      return { map: m[0], handler };
    });

    return () => {
      listeners.forEach((l) => l?.map.off('move', l.handler));
    };
  }, [previewTransforms, mapsReady]);

  const handleRemove = useCallback(
    (imageIndex: number, pointIndex: number) => {
      onAction();
      // Remove the point from the clicked image
      setPoints[imageIndex]((prev) => prev.filter((_, i) => i !== pointIndex));
      // Move the counterpart on the other image to the end (unmatched)
      const otherIndex = imageIndex === 0 ? 1 : 0;
      setPoints[otherIndex]((prev) => {
        if (pointIndex >= prev.length) return prev;
        const orphan = prev[pointIndex];
        return [...prev.filter((_, i) => i !== pointIndex), orphan];
      });
    },
    [setPoints, onAction]
  );

  const handleSwap = useCallback(
    (imageIndex: number, fromIndex: number, toIndex: number) => {
      onAction();
      setPoints[imageIndex]((prev) => {
        const next = [...prev];
        [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
        return next;
      });
    },
    [setPoints, onAction]
  );

  const containerRefs = [useCallback((el: HTMLDivElement | null) => {
    containerEls.current[0] = el;
  }, []), useCallback((el: HTMLDivElement | null) => {
    containerEls.current[1] = el;
  }, [])];
  const containerEls = useRef<(HTMLDivElement | null)[]>([null, null]);

  const contextMenuHandlers = useMemo(() => [0, 1].map((imageIndex) =>
    (pointIndex: number, screenPos: { x: number; y: number }) => {
      const rect = containerEls.current[imageIndex]?.getBoundingClientRect();
      setContextMenu({
        imageIndex,
        pointIndex,
        screenPos: {
          x: (rect?.left ?? 0) + screenPos.x,
          y: (rect?.top ?? 0) + screenPos.y,
        },
      });
    }
  ), []);

  // Fetch temporal neighbours (prev/next by timestamp) for each image
  const [neighbours, setNeighbours] = useState<
    [{ prev?: string; next?: string }, { prev?: string; next?: string }]
  >([{}, {}]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      images.map(async (img) => {
        const [fwd, bwd] = await Promise.all([
          client.models.ImageNeighbour.imageNeighboursByImage1key({ image1Id: img.id }),
          client.models.ImageNeighbour.imageNeighboursByImage2key({ image2Id: img.id }),
        ]);
        const allNeighbourIds = [
          ...fwd.data.map((n: any) => n.image2Id),
          ...bwd.data.map((n: any) => n.image1Id),
        ];
        // Fetch timestamps for neighbours to determine prev/next
        const uniqueIds = [...new Set(allNeighbourIds)];
        const metas = await Promise.all(
          uniqueIds.map((id) => client.models.Image.get({ id }))
        );
        const metaMap = new Map(
          metas.filter((m) => m.data).map((m) => [m.data!.id, m.data!])
        );
        const sorted = uniqueIds
          .filter((id) => metaMap.has(id))
          .sort(
            (a, b) =>
              (metaMap.get(a)!.timestamp ?? 0) - (metaMap.get(b)!.timestamp ?? 0)
          );
        const myTs = img.timestamp ?? 0;
        const prev = sorted.filter((id) => (metaMap.get(id)!.timestamp ?? 0) < myTs).pop();
        const next = sorted.find((id) => (metaMap.get(id)!.timestamp ?? 0) > myTs);
        return { prev, next };
      })
    ).then((result) => {
      if (!cancelled) setNeighbours(result as any);
    });
    return () => { cancelled = true; };
  }, [images[0].id, images[1].id]);

  const buildImageUrl = useCallback(
    (imageId: string) => {
      const origin = window.location.origin;
      if (surveyId && annotationSetId) {
        return `${origin}/surveys/${surveyId}/image/${imageId}/${annotationSetId}`;
      }
      if (surveyId) {
        return `${origin}/surveys/${surveyId}/image/${imageId}`;
      }
      return `${origin}/image/${imageId}`;
    },
    [surveyId, annotationSetId]
  );

  const buildMenuItems = useCallback(
    (image: ImageType, idx: number): MapLibreMenuItem[] => {
      return [
        {
          label: 'Copy link to this image',
          onClick: () => {
            navigator.clipboard.writeText(buildImageUrl(image.id));
          },
        },
        {
          label: 'Open previous image',
          disabled: !neighbours[idx].prev,
          onClick: () => {
            if (neighbours[idx].prev) {
              window.open(buildImageUrl(neighbours[idx].prev!), '_blank');
            }
          },
        },
        {
          label: 'Open next image',
          disabled: !neighbours[idx].next,
          onClick: () => {
            if (neighbours[idx].next) {
              window.open(buildImageUrl(neighbours[idx].next!), '_blank');
            }
          },
        },
      ];
    },
    [neighbours, buildImageUrl]
  );

  return (
    <div className='w-100 h-100 d-flex flex-row gap-3' style={{
      position: 'relative',
      flexDirection: (images[0].timestamp ?? 0) > (images[1].timestamp ?? 0) ? 'row-reverse' : undefined,
    }}>
      {images.map((image, i) => (
        <div
          className='w-50'
          key={image.id}
          ref={containerRefs[i]}
          style={{ position: 'relative', height: '100%', minHeight: 400 }}
        >
          <MapLibreImageViewer
            image={image}
            sourceKey={sourceKeys[i]}
            points={points[i]}
            setPoints={setPoints[i]}
            onAction={onAction}
            highlightedIndex={hoveredIndex}
            onHoverPoint={setHoveredIndex}
            onContextMenu={contextMenuHandlers[i]}
            previewTransform={previewTransforms?.[1 - i]}
            savedTransform={savedTransforms?.[1 - i]}
            otherImage={images[1 - i]}
            onMapInstance={i === 0 ? onMapInstance0 : onMapInstance1}
            menuItems={buildMenuItems(image, i)}
          />
        </div>
      ))}

      {contextMenu && (
        <PointContextMenu
          menu={contextMenu}
          points={points[contextMenu.imageIndex]}
          onClose={() => setContextMenu(null)}
          onRemove={handleRemove}
          onSwap={handleSwap}
        />
      )}
    </div>
  );
}
