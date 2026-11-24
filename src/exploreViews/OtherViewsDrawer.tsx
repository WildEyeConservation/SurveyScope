import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { OtherViewsTarget } from '../annotationTypes';
import { ChainGrid } from '../chain-viewer/ChainGrid';
import '../chain-viewer/ChainViewer.css';
import { ChainTilesModal } from '../chain-viewer/components/ChainTilesModal';
import { useChainTileMeta } from '../chain-viewer/hooks/useChainTileMeta';
import type { Chain, ChainAnnotation } from '../chain-viewer/types';
import { GlobalContext } from '../Context';
import { nameFor } from '../individual-id/utils/identity';
import { fetchAllPaginatedResults } from '../utils';
import { nearbyViews, timeOffsetLabel, type Pt } from './otherViews';
import { useImageNeighbours } from './useImageNeighbours';

export type OtherViewsState = {
  target: OtherViewsTarget;
  linked: boolean;
};

export type ImageInfo = {
  width?: number | null;
  height?: number | null;
  timestamp?: number | null;
  cameraId?: string | null;
};

type ChainRow = {
  id: string;
  x: number;
  y: number;
  imageId: string;
  objectId?: string | null;
  categoryId: string;
  obscured?: boolean | null;
  oov?: boolean | null;
  outsideBoundary?: boolean | null;
};

type TileKind = 'here' | 'chain' | 'projected' | 'unregistered' | 'oov';

export const DRAWER_WIDTH = 240;
const NEARBY_PREFIX = 'nearby:';
export default function OtherViewsDrawer({
  state,
  currentImageId,
  surveyId,
  annotationSetId,
  imageInfo,
  categoryColor,
  categoryName,
  narrow,
  onJump,
  onClose,
}: {
  state: OtherViewsState;
  currentImageId: string | null;
  surveyId: string;
  annotationSetId: string;
  imageInfo: (imageId: string) => ImageInfo | undefined;
  categoryColor: string;
  categoryName: string;
  narrow: boolean;
  onJump: (imageId: string, point: Pt | null) => void;
  onClose: () => void;
}) {
  const { client } = useContext(GlobalContext)!;
  const queryClient = useQueryClient();
  const { target, linked } = state;
  const chainKey = useMemo(
    () => ['explore-chain', annotationSetId, target.objectId],
    [annotationSetId, target.objectId],
  );

  const chainQuery = useQuery({
    queryKey: chainKey,
    enabled: linked && !!target.objectId,
    staleTime: 30_000,
    queryFn: () =>
      fetchAllPaginatedResults<ChainRow>(
        client.models.Annotation.annotationsByObjectId,
        {
          objectId: target.objectId,
          filter: { setId: { eq: annotationSetId } },
          selectionSet: [
            'id',
            'x',
            'y',
            'imageId',
            'objectId',
            'categoryId',
            'obscured',
            'oov',
            'outsideBoundary',
          ],
          limit: 1000,
        },
      ),
  });

  const neighbours = useImageNeighbours(linked ? null : target.imageId);

  const timestampOf = useCallback(
    (imageId: string) => imageInfo(imageId)?.timestamp ?? null,
    [imageInfo],
  );

  const { chain, kinds } = useMemo(() => {
    const kinds = new Map<string, TileKind>();
    let annotations: ChainAnnotation[] = [];
    if (linked) {
      annotations = (chainQuery.data ?? []).map((a) => ({
        id: a.id,
        x: a.x,
        y: a.y,
        imageId: a.imageId,
        objectId: a.objectId ?? null,
        categoryId: a.categoryId,
        obscured: !!a.obscured,
        oov: !!a.oov,
        outsideBoundary: !!a.outsideBoundary,
        imageTimestamp: timestampOf(a.imageId),
      }));
      for (const a of annotations) kinds.set(a.id, a.oov ? 'oov' : 'chain');
    } else if (!neighbours.loading) {
      const sizeOf = (id: string) => {
        const info = imageInfo(id);
        return info?.width && info.height
          ? { width: info.width, height: info.height }
          : undefined;
      };
      const views = nearbyViews(
        target.imageId,
        target,
        neighbours.rows,
        sizeOf,
      );
      annotations = [
        {
          id: target.id,
          x: target.x,
          y: target.y,
          imageId: target.imageId,
          objectId: null,
          categoryId: target.categoryId,
          obscured: false,
          oov: false,
          imageTimestamp: timestampOf(target.imageId),
        },
        ...views.map((v) => {
          const size = sizeOf(v.imageId);
          const id = `${NEARBY_PREFIX}${v.imageId}`;
          kinds.set(id, v.point ? 'projected' : 'unregistered');
          return {
            id,
            x: v.point?.x ?? (size?.width ?? 0) / 2,
            y: v.point?.y ?? (size?.height ?? 0) / 2,
            imageId: v.imageId,
            objectId: null,
            categoryId: target.categoryId,
            obscured: false,
            oov: false,
            imageTimestamp: timestampOf(v.imageId),
          };
        }),
      ];
      kinds.set(target.id, 'here');
    }
    if (!annotations.length) return { chain: null, kinds };
    const chain: Chain = {
      primaryId: target.objectId ?? target.id,
      categoryId: target.categoryId,
      annotations: [...annotations].sort(
        (a, b) =>
          (a.imageTimestamp ?? Infinity) - (b.imageTimestamp ?? Infinity) ||
          a.id.localeCompare(b.id),
      ),
    };
    return { chain, kinds };
  }, [
    linked,
    chainQuery.data,
    neighbours.loading,
    neighbours.rows,
    target,
    imageInfo,
    timestampOf,
  ]);

  const { metaByAnnotationId, loading: metaLoading } = useChainTileMeta(chain);

  const [cameraRotations, setCameraRotations] = useState(
    () => new Map<string, number>(),
  );
  const rotateByKey = useCallback((key: string) => {
    setCameraRotations((prev) =>
      new Map(prev).set(key, ((prev.get(key) ?? 0) + 1) % 4),
    );
  }, []);
  const [tileZoom, setTileZoom] = useState(() => new Map<string, number>());
  const zoomFor = useCallback(
    (a: ChainAnnotation) =>
      tileZoom.get(a.id) ?? (kinds.get(a.id) === 'unregistered' ? 99 : 0),
    [tileZoom, kinds],
  );
  const zoomMap = useMemo(() => {
    const out = new Map<string, number>();
    for (const a of chain?.annotations ?? []) out.set(a.id, zoomFor(a));
    return out;
  }, [chain, zoomFor]);
  const setZoomFor = useCallback((id: string, next: number) => {
    setTileZoom((prev) => new Map(prev).set(id, next));
  }, []);

  const toggleObscured = useCallback(
    async (annotationId: string) => {
      const rows = queryClient.getQueryData<ChainRow[]>(chainKey);
      const current = rows?.find((a) => a.id === annotationId);
      if (!rows || !current) return;
      const set = (obscured: boolean) =>
        queryClient.setQueryData<ChainRow[]>(chainKey, (old) =>
          old?.map((a) => (a.id === annotationId ? { ...a, obscured } : a)),
        );
      set(!current.obscured);
      try {
        const response = await client.models.Annotation.update({
          id: annotationId,
          obscured: !current.obscured,
        });
        if (response.errors?.length)
          throw new Error(response.errors[0].message);
        queryClient.invalidateQueries({
          predicate: (q) =>
            q.queryKey[0] === 'Annotation' &&
            JSON.stringify(q.queryKey).includes(current.imageId),
        });
      } catch (err) {
        console.error('Failed to toggle obscured flag', err);
        set(!!current.obscured);
      }
    },
    [client, queryClient, chainKey],
  );

  const openImageHrefFor = useCallback(
    (a: ChainAnnotation) =>
      `/surveys/${surveyId}/image/${a.imageId}/${annotationSetId}`,
    [surveyId, annotationSetId],
  );

  const currentTimestamp = currentImageId ? timestampOf(currentImageId) : null;
  const jump = (a: ChainAnnotation) => {
    const kind = kinds.get(a.id);
    onJump(
      a.imageId,
      kind === 'oov' || kind === 'unregistered' ? null : { x: a.x, y: a.y },
    );
  };

  const tileRefs = useRef<(HTMLDivElement | null)[]>([]);
  const onTileKey = (
    event: KeyboardEvent<HTMLDivElement>,
    a: ChainAnnotation,
    index: number,
  ) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -2,
      ArrowDown: 2,
    };
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      jump(a);
    } else if (event.key in moves) {
      event.preventDefault();
      event.stopPropagation();
      tileRefs.current[index + moves[event.key]]?.focus();
    }
  };

  useEffect(() => {
    if (narrow) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [narrow, onClose]);

  const cameraOf = (a: ChainAnnotation) => {
    const meta = metaByAnnotationId.get(a.id);
    return meta?.cameraName ?? meta?.cameraSerial ?? '';
  };

  const wrapTile = (a: ChainAnnotation, tile: ReactNode, index: number) => {
    const here = a.imageId === currentImageId;
    const kind = kinds.get(a.id);
    const offset = timeOffsetLabel(
      currentTimestamp != null && a.imageTimestamp != null
        ? a.imageTimestamp - currentTimestamp
        : null,
      here,
    );
    const caption = [
      cameraOf(a),
      offset,
      kind === 'projected' && !here ? 'projected' : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div
        ref={(el) => {
          tileRefs.current[index] = el;
        }}
        role='button'
        tabIndex={0}
        aria-label={here ? 'Centre on the animal' : 'Go to this image'}
        onClick={() => jump(a)}
        onKeyDown={(event) => onTileKey(event, a, index)}
        className={cn(
          'relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-info',
          here && 'outline-2 outline-offset-1 outline-primary',
        )}
      >
        {tile}
        {(here || kind === 'unregistered') && (
          <span
            className={cn(
              'pointer-events-none absolute bottom-6 left-1 z-[4] px-1 text-[10px] font-semibold text-white',
              here ? 'bg-primary' : 'bg-dark',
            )}
          >
            {here ? 'This image' : 'No registration'}
          </span>
        )}
        {caption && (
          <span className='pointer-events-none absolute inset-x-0 bottom-0 z-[4] truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white'>
            {caption}
          </span>
        )}
      </div>
    );
  };

  const loading = linked ? chainQuery.isLoading : neighbours.loading;
  const otherCount = chain
    ? chain.annotations.filter((a) => a.imageId !== target.imageId).length
    : 0;
  const cameraCount = new Set(
    (chain?.annotations ?? []).map((a) => imageInfo(a.imageId)?.cameraId ?? ''),
  ).size;

  const body = loading ? (
    <div className='flex items-center gap-2 p-3 text-sm text-muted-foreground'>
      <Spinner size='sm' />
      {linked ? 'Loading sightings...' : 'Finding neighbouring images...'}
    </div>
  ) : !chain || otherCount === 0 ? (
    <div className='p-3 text-sm text-muted-foreground'>
      {linked
        ? 'No other sightings of this animal.'
        : 'No other image covers this point.'}
    </div>
  ) : (
    <ChainGrid
      chain={chain}
      metaByAnnotationId={metaByAnnotationId}
      metaLoading={metaLoading}
      categoryColor={categoryColor}
      columns={1}
      gap={8}
      bareTiles
      cameraRotations={cameraRotations}
      onRotateKey={rotateByKey}
      tileZoom={zoomMap}
      onZoomChange={setZoomFor}
      openImageHrefFor={openImageHrefFor}
      onToggleObscured={toggleObscured}
      canToggleObscured={(a) => linked && !a.id.startsWith(NEARBY_PREFIX)}
      markerFor={(a) => {
        const kind = kinds.get(a.id);
        if (kind === 'projected') return 'crosshair';
        if (kind === 'unregistered') return 'none';
        return 'strong';
      }}
      wrapTile={wrapTile}
    />
  );

  const title =
    linked && target.objectId ? nameFor(target.objectId) : categoryName;
  const subtitle = linked
    ? chain
      ? `${chain.annotations.length} sightings · ${cameraCount} camera${cameraCount === 1 ? '' : 's'}`
      : categoryName
    : 'Neighbouring images that cover this point';

  if (narrow && linked) {
    return (
      <ChainTilesModal
        show
        onHide={onClose}
        chainId={target.objectId}
        annotations={chain?.annotations ?? []}
        categoryColors={{ [target.categoryId]: categoryColor }}
        onToggleObscured={toggleObscured}
        openImageHrefFor={openImageHrefFor}
        metaByAnnotationId={metaByAnnotationId}
        metaLoading={metaLoading || loading}
      />
    );
  }

  if (narrow) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent size='lg' centered scrollable>
          <DialogHeader closeButton>
            <DialogTitle className='flex flex-col'>
              <span className='flex items-center gap-2'>
                {title}
                <Badge variant='secondary'>Not linked</Badge>
              </span>
              <span className='text-sm font-normal text-muted-foreground'>
                {subtitle}
              </span>
            </DialogTitle>
          </DialogHeader>
          <DialogBody style={{ maxHeight: '70vh' }}>{body}</DialogBody>
          <DialogFooter>
            <Button variant='ghost' className='mr-auto' onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <aside
      className='absolute inset-y-0 right-0 z-[12] flex flex-col border-l border-black/20 bg-card text-card-foreground shadow-[-6px_0_16px_rgba(0,0,0,0.35)]'
      style={{ width: DRAWER_WIDTH }}
      aria-label={linked ? 'Other views' : 'Nearby images'}
    >
      <div className='flex items-start gap-2 border-b border-black/20 bg-white/[0.075] px-2.5 py-2'>
        <div className='min-w-0 flex-1 leading-tight'>
          <div className='flex items-center gap-1.5 text-sm font-medium'>
            <span
              className='size-2.5 flex-none'
              style={{ backgroundColor: categoryColor }}
            />
            <span className='truncate'>{title}</span>
            {!linked && (
              <Badge variant='secondary' className='flex-none'>
                Not linked
              </Badge>
            )}
          </div>
          <div className='mt-0.5 text-[11px] text-muted-foreground'>
            {subtitle}
          </div>
        </div>
        <button
          type='button'
          aria-label='Close'
          onClick={onClose}
          className='flex-none opacity-60 hover:opacity-100'
        >
          <X className='size-4' />
        </button>
      </div>
      <div className='chain-viewer-grid-scroll min-h-0 flex-1 overflow-y-auto p-2'>
        {body}
      </div>
    </aside>
  );
}
