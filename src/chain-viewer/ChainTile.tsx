import { useEffect, useRef, useState } from 'react';
import {
  Eye,
  ExternalLink,
  EyeOff,
  RotateCw,
  ScanEye,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CHAIN_TILE_SIZE,
  fetchCenteredCrop,
  getCropZoomRange,
} from './utils/tileCrop';
import type { AnnotationImageMeta, ChainAnnotation } from './types';

interface Props {
  annotation: ChainAnnotation;
  meta: AnnotationImageMeta | undefined;
  /** Loading state of the chain's image metadata (drives the hover popup). */
  metaLoading: boolean;
  categoryColor: string;
  /** Rotation in 90° steps. 0 = no rotation, 1 = -90°, 2 = -180°, 3 = -270°. */
  rotation: number;
  onRotate: () => void;
  /**
   * Zoom-out steps from the tightest crop (0 = native resolution). Each step
   * loads a lower slippy level showing more of the image. Controlled by the
   * parent (keyed per annotation) so it survives navigation / remounts.
   */
  zoomOut: number;
  /** Request a new zoom-out step for this tile. */
  onZoomChange: (next: number) => void;
  /** Target for the "open image" button — uses the ImageLoader route. */
  openImageHref: string;
  /** Toggle `obscured` on the annotation; persists to the DB. */
  onToggleObscured: () => void;
}

/**
 * Renders the centred thumbnail for a single annotation in the current chain.
 * The tile is composed in a canvas-backed `<img>` (object URL) once we have
 * the image's dimensions and sourceKey — both come from the chain meta-fetch
 * the harness kicks off on chain change.
 *
 * Hovering the tile reveals a bottom-overlay popup with the annotation's
 * image path and camera name. The popup is rendered inside the tile (rather
 * than above it) so the scroll container can't clip it.
 *
 * A small rotate button in the top-right rotates the image -90° per click;
 * the parent persists the rotation per camera so all tiles from the same
 * camera rotate together and the choice survives chain navigation.
 */
export function ChainTile({
  annotation,
  meta,
  metaLoading,
  categoryColor,
  rotation,
  onRotate,
  zoomOut,
  onZoomChange,
  openImageHref,
  onToggleObscured,
}: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const maxZoomOut = meta ? getCropZoomRange(meta.width, meta.height).maxSteps : 0;
  const effectiveZoomOut = Math.min(zoomOut, maxZoomOut);

  useEffect(() => {
    // OOV rows mark "animal known to be in this image but not visible".
    // The (x, y) on the row is placeholder data — fetching a tile centred
    // there would render meaningless pixels, so we skip the fetch and let
    // the OOV placeholder render instead.
    if (annotation.oov) {
      setImgSrc(null);
      return;
    }
    if (!meta || !meta.sourceKey) {
      setImgSrc(null);
      return;
    }
    let cancelled = false;
    setError(null);
    const { maxZ } = getCropZoomRange(meta.width, meta.height);
    fetchCenteredCrop({
      sourceKey: meta.sourceKey,
      imageId: meta.imageId,
      sharedImageId: meta.sharedImageId,
      imageWidth: meta.width,
      imageHeight: meta.height,
      x: annotation.x,
      y: annotation.y,
      zoom: maxZ - effectiveZoomOut,
    })
      .then(({ canvas, markerX, markerY }) => {
        if (cancelled) return;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.beginPath();
          ctx.arc(markerX, markerY, 8, 0, Math.PI * 2);
          ctx.strokeStyle = categoryColor;
          ctx.lineWidth = 2;
          ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
          ctx.shadowBlur = 3;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        canvas.toBlob((blob) => {
          if (cancelled || !blob) return;
          const url = URL.createObjectURL(blob);
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = url;
          setImgSrc(url);
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [
    annotation.id,
    annotation.x,
    annotation.y,
    annotation.oov,
    meta,
    categoryColor,
    effectiveZoomOut,
  ]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const popupPath = meta?.originalPath ?? null;
  const popupCamera = meta?.cameraName ?? meta?.cameraSerial ?? null;
  const rotationDeg = (rotation % 4) * 90;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1 / 1',
        background: '#1f2933',
        borderRadius: 6,
        overflow: 'hidden',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}
      className='chain-viewer-tile'
    >
      {annotation.oov ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: '#bcccdc',
            fontSize: 12,
            textAlign: 'center',
            padding: 12,
          }}
        >
          <ScanEye size={36} strokeWidth={1.5} opacity={0.6} />
          <div style={{ fontWeight: 600 }}>Out of view</div>
          <div style={{ opacity: 0.7, fontSize: 11 }}>
            Animal is on this image but not visible.
          </div>
        </div>
      ) : imgSrc ? (
        <img
          src={imgSrc}
          alt={`Annotation ${annotation.id}`}
          width={CHAIN_TILE_SIZE}
          height={CHAIN_TILE_SIZE}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            objectFit: 'cover',
            transform: `rotate(${rotationDeg}deg)`,
            transition: 'transform 180ms ease',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#bcccdc',
            fontSize: 12,
          }}
        >
          {error ? 'Tile unavailable' : 'Loading…'}
        </div>
      )}
      {annotation.oov ? (
        <div
          className='chain-viewer-obscured-badge'
          title='Out of view — animal known to be in this image but not visible'
        >
          <ScanEye size={11} strokeWidth={2.5} />
          <span>OOV</span>
        </div>
      ) : (
        <button
          type='button'
          className={
            'chain-viewer-obscured-toggle ' +
            (annotation.obscured
              ? 'chain-viewer-obscured-toggle--active'
              : 'chain-viewer-obscured-toggle--inactive')
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggleObscured();
            e.currentTarget.blur();
          }}
          title={
            annotation.obscured
              ? 'Marked as obscured — click to remove'
              : 'Click to mark as obscured'
          }
          aria-pressed={annotation.obscured}
        >
          {annotation.obscured ? (
            <EyeOff size={11} strokeWidth={2.5} />
          ) : (
            <Eye size={11} strokeWidth={2.5} />
          )}
          <span>{annotation.obscured ? 'Obscured' : 'Visible'}</span>
        </button>
      )}
      {!annotation.oov && maxZoomOut > 0 && (
        <>
          <button
            type='button'
            className='chain-viewer-tile-zoom chain-viewer-tile-zoom-1'
            onClick={(e) => {
              e.stopPropagation();
              onZoomChange(Math.max(0, effectiveZoomOut - 1));
              e.currentTarget.blur();
            }}
            disabled={effectiveZoomOut <= 0}
            title='Zoom in (this tile only)'
            aria-label='Zoom in'
          >
            <ZoomIn size={14} strokeWidth={2.5} />
          </button>
          <button
            type='button'
            className='chain-viewer-tile-zoom chain-viewer-tile-zoom-2'
            onClick={(e) => {
              e.stopPropagation();
              onZoomChange(Math.min(maxZoomOut, effectiveZoomOut + 1));
              e.currentTarget.blur();
            }}
            disabled={effectiveZoomOut >= maxZoomOut}
            title='Zoom out (this tile only)'
            aria-label='Zoom out'
          >
            <ZoomOut size={14} strokeWidth={2.5} />
          </button>
        </>
      )}
      <button
        type='button'
        className='chain-viewer-tile-action chain-viewer-tile-action-1'
        onClick={(e) => {
          e.stopPropagation();
          onRotate();
          e.currentTarget.blur();
        }}
        title='Rotate tile (and all tiles from this camera) 90°'
        aria-label='Rotate 90 degrees'
      >
        <RotateCw size={14} strokeWidth={2.5} />
      </button>
      <a
        className='chain-viewer-tile-action chain-viewer-tile-action-2'
        href={openImageHref}
        target='_blank'
        rel='noopener noreferrer'
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.blur();
        }}
        title='Open image in a new tab'
        aria-label='Open image in a new tab'
      >
        <ExternalLink size={14} strokeWidth={2.5} />
      </a>
      <div className='chain-viewer-tile-popup'>
        {metaLoading && !meta ? (
          <span style={{ fontStyle: 'italic', opacity: 0.7 }}>
            Loading image info…
          </span>
        ) : (
          <>
            <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>
              {popupPath ?? 'Unknown path'}
            </div>
            <div style={{ opacity: 0.85, marginTop: 2 }}>
              Camera: {popupCamera ?? 'Unknown'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
