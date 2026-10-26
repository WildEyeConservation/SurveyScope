import { useCallback, useMemo, useState } from 'react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Check, Copy, LayoutGrid, Share2, Square } from 'lucide-react';
import { ChainGrid } from '../ChainGrid';
import { ChainTilePaginator } from './ChainTilePaginator';
import { buildChains } from '../utils/chainBuilder';
import { useChainTileMeta } from '../hooks/useChainTileMeta';
import { nameFor } from '../../individual-id/utils/identity';
import type { AnnotationImageMeta, ChainAnnotation } from '../types';

const DEFAULT_COLOR = '#ff8c1a';

type TileView = 'grid' | 'paginator';

interface Props {
  show: boolean;
  onHide: () => void;
  /** Chain key (objectId ?? id) of the annotation whose tiles to show. */
  chainId: string | null;
  /** Live set annotations — the chain's members are derived from these. */
  annotations: ChainAnnotation[];
  categoryColors: Record<string, string>;
  onToggleObscured: (annotationId: string) => void;
  openImageHrefFor: (annotation: ChainAnnotation) => string;
  /** Preloaded meta; when provided, skips the live useChainTileMeta fetch. */
  metaByAnnotationId?: Map<string, AnnotationImageMeta>;
  metaLoading?: boolean;
}

/**
 * Per-annotation popup showing the chain's tiles, reusing the same tile grid
 * the original Chain Viewer rendered. Launched from a marker's "View chain
 * tiles" action in the herd view.
 */
export function ChainTilesModal({
  show,
  onHide,
  chainId,
  annotations,
  categoryColors,
  onToggleObscured,
  openImageHrefFor,
  metaByAnnotationId: metaOverride,
  metaLoading: metaLoadingOverride,
}: Props) {
  const chain = useMemo(() => {
    if (!show || !chainId) return null;
    const members = annotations.filter(
      (a) => (a.objectId ?? a.id) === chainId
    );
    return buildChains(members)[0] ?? null;
  }, [show, chainId, annotations]);

  // Pass null to skip the live fetch when meta is already preloaded.
  const live = useChainTileMeta(metaOverride ? null : chain);
  const metaByAnnotationId = metaOverride ?? live.metaByAnnotationId;
  const loading = metaOverride ? !!metaLoadingOverride : live.loading;

  const [cameraRotations, setCameraRotations] = useState<Map<string, number>>(
    () => new Map()
  );
  const rotateByKey = useCallback((key: string) => {
    setCameraRotations((prev) => {
      const next = new Map(prev);
      next.set(key, ((prev.get(key) ?? 0) + 1) % 4);
      return next;
    });
  }, []);

  // Per-tile zoom-out steps, keyed by annotation id. Lifted here (rather than
  // held inside ChainTile) so a tile's zoom survives paginator navigation and
  // grid/paginator view switches, which remount the tile.
  const [tileZoom, setTileZoom] = useState<Map<string, number>>(
    () => new Map()
  );
  const setZoomFor = useCallback((annotationId: string, next: number) => {
    setTileZoom((prev) => {
      const updated = new Map(prev);
      updated.set(annotationId, next);
      return updated;
    });
  }, []);

  const categoryColor = chain
    ? categoryColors[chain.categoryId] || DEFAULT_COLOR
    : DEFAULT_COLOR;

  const [view, setView] = useState<TileView>('grid');

  const [copied, setCopied] = useState(false);
  const copyId = useCallback(() => {
    if (!chain) return;
    navigator.clipboard.writeText(chain.primaryId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [chain]);
  const [shareCopied, setShareCopied] = useState(false);
  const shareChain = useCallback(() => {
    if (!chain) return;
    const url = new URL(window.location.href);
    url.searchParams.set('chain', chain.primaryId);
    navigator.clipboard.writeText(url.toString());
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 1500);
  }, [chain]);

  return (
    <Dialog open={show} onOpenChange={(o) => !o && onHide()}>
      <DialogContent size='lg' centered scrollable>
        <DialogHeader closeButton>
          <DialogTitle className='grow flex flex-col'>
            <span style={{ fontSize: 16 }}>Chain tiles</span>
            {chain && (
              <span
                className='flex items-center gap-2'
                style={{ fontSize: 13 }}
              >
                <span style={{ fontWeight: 600 }}>{nameFor(chain.primaryId)}</span>
                <button
                  type='button'
                  onClick={copyId}
                  title={copied ? 'Copied!' : 'Copy chain id'}
                  className='inline-flex items-center'
                  style={{
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    color: copied ? '#2e7d32' : '#ff8c1a',
                  }}
                >
                  {copied ? (
                    <Check size={14} strokeWidth={2.5} />
                  ) : (
                    <Copy size={14} strokeWidth={2.5} />
                  )}
                </button>
                <span className='text-muted-foreground'>
                  · {chain.annotations.length} sighting
                  {chain.annotations.length === 1 ? '' : 's'}
                </span>
              </span>
            )}
          </DialogTitle>
          {chain && (
            <div className='flex items-center gap-2 self-center'>
              <button
                type='button'
                onClick={shareChain}
                title={shareCopied ? 'Copied!' : 'Copy share link'}
                className='inline-flex items-center gap-1'
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  whiteSpace: 'nowrap',
                  color: shareCopied ? '#2e7d32' : '#ff8c1a',
                  cursor: 'pointer',
                  fontSize: 13,
                  textDecoration: shareCopied ? 'none' : 'underline',
                }}
              >
                {shareCopied ? (
                  <Check size={14} strokeWidth={2.5} />
                ) : (
                  <Share2 size={14} strokeWidth={2.5} />
                )}
                <span>{shareCopied ? 'Copied' : 'Share'}</span>
              </button>
              <div
                className='chain-viewer-view-toggle'
                role='group'
                aria-label='Tile view'
              >
              <button
                type='button'
                className={view === 'grid' ? 'active' : ''}
                onClick={() => setView('grid')}
                aria-pressed={view === 'grid'}
                title='Grid view — all tiles at once'
              >
                <LayoutGrid size={14} strokeWidth={2.5} />
                <span>Grid</span>
              </button>
              <button
                type='button'
                className={view === 'paginator' ? 'active' : ''}
                onClick={() => setView('paginator')}
                aria-pressed={view === 'paginator'}
                title='Paginator view — one tile at a time'
              >
                <Square size={14} strokeWidth={2.5} />
                <span>Paginator</span>
              </button>
              </div>
            </div>
          )}
        </DialogHeader>
        <DialogBody style={{ maxHeight: '70vh' }}>
          {chain ? (
            view === 'grid' ? (
              <ChainGrid
                chain={chain}
                metaByAnnotationId={metaByAnnotationId}
                metaLoading={loading}
                categoryColor={categoryColor}
                columns={null}
                cameraRotations={cameraRotations}
                onRotateKey={rotateByKey}
                tileZoom={tileZoom}
                onZoomChange={setZoomFor}
                onToggleObscured={onToggleObscured}
                openImageHrefFor={openImageHrefFor}
              />
            ) : (
              <ChainTilePaginator
                key={chain.primaryId}
                chain={chain}
                metaByAnnotationId={metaByAnnotationId}
                metaLoading={loading}
                categoryColor={categoryColor}
                cameraRotations={cameraRotations}
                onRotateKey={rotateByKey}
                tileZoom={tileZoom}
                onZoomChange={setZoomFor}
                onToggleObscured={onToggleObscured}
                openImageHrefFor={openImageHrefFor}
              />
            )
          ) : (
            <div className='text-muted-foreground text-center p-6'>No chain selected.</div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
