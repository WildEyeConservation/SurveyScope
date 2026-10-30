import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ChainTile } from '../ChainTile';
import type { AnnotationImageMeta, Chain } from '../types';
import { rotationKeyFor } from '../utils/rotationKey';

interface Props {
  chain: Chain;
  metaByAnnotationId: Map<string, AnnotationImageMeta>;
  metaLoading: boolean;
  categoryColor: string;
  /** Rotation steps (mod 4) keyed by camera (or per-image fallback). */
  cameraRotations: Map<string, number>;
  onRotateKey: (key: string) => void;
  /** Zoom-out steps keyed by annotation id (per-tile, survives navigation). */
  tileZoom: Map<string, number>;
  onZoomChange: (annotationId: string, next: number) => void;
  /** Builds the ImageLoader URL for a given annotation. */
  openImageHrefFor: (annotation: Chain['annotations'][number]) => string;
  /** Toggles `obscured` on an annotation. */
  onToggleObscured: (annotationId: string) => void;
}

/**
 * Single-tile view of a chain: shows one annotation's tile filling the modal
 * with prev/next controls to page through the chain's sightings. Shares the
 * same {@link ChainTile} (and its hover actions) as the grid view, so rotation,
 * obscured toggling and "open image" behave identically. Arrow keys also page.
 */
export function ChainTilePaginator({
  chain,
  metaByAnnotationId,
  metaLoading,
  categoryColor,
  cameraRotations,
  onRotateKey,
  tileZoom,
  onZoomChange,
  openImageHrefFor,
  onToggleObscured,
}: Props) {
  const total = chain.annotations.length;
  const [index, setIndex] = useState(0);

  // Keep the index in range if the chain shrinks (e.g. obscured re-fetch).
  const safeIndex = Math.min(index, Math.max(0, total - 1));

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, Math.min(i, total - 1) - 1));
  }, [total]);
  const goNext = useCallback(() => {
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goPrev, goNext]);

  const annotation = chain.annotations[safeIndex];
  if (!annotation) {
    return (
      <div className='p-6 text-center text-muted-foreground'>
        No tiles in chain.
      </div>
    );
  }

  const rotKey = rotationKeyFor(
    metaByAnnotationId.get(annotation.id),
    annotation.imageId,
  );

  return (
    <div className='flex flex-col items-center' style={{ gap: 12 }}>
      <div
        className='flex items-center justify-center'
        style={{ gap: 12, width: '100%' }}
      >
        <button
          type='button'
          className='chain-viewer-paginator-nav'
          onClick={goPrev}
          disabled={safeIndex <= 0}
          title='Previous tile (←)'
          aria-label='Previous tile'
        >
          <ChevronLeft size={28} strokeWidth={2.5} />
        </button>
        <div
          style={{
            flex: '0 1 auto',
            width: 'min(100%, 60vh)',
            maxWidth: 'calc(100% - 112px)',
          }}
        >
          <ChainTile
            key={annotation.id}
            annotation={annotation}
            meta={metaByAnnotationId.get(annotation.id)}
            metaLoading={metaLoading}
            categoryColor={categoryColor}
            rotation={cameraRotations.get(rotKey) ?? 0}
            onRotate={() => onRotateKey(rotKey)}
            zoomOut={tileZoom.get(annotation.id) ?? 0}
            onZoomChange={(next) => onZoomChange(annotation.id, next)}
            openImageHref={openImageHrefFor(annotation)}
            onToggleObscured={() => onToggleObscured(annotation.id)}
          />
        </div>
        <button
          type='button'
          className='chain-viewer-paginator-nav'
          onClick={goNext}
          disabled={safeIndex >= total - 1}
          title='Next tile (→)'
          aria-label='Next tile'
        >
          <ChevronRight size={28} strokeWidth={2.5} />
        </button>
      </div>
      <div className='text-muted-foreground' style={{ fontSize: 13 }}>
        {safeIndex + 1} of {total}
      </div>
    </div>
  );
}
