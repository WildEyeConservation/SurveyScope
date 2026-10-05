import { useEffect, useRef, useState } from 'react';
import { ScanEye } from 'lucide-react';
import { fetchCenteredCrop, getCropZoomRange } from '../utils/tileCrop';
import type { AnnotationImageMeta } from '../types';

interface Props {
  meta: AnnotationImageMeta | undefined;
  x: number;
  y: number;
  /** OOV rows have placeholder coords — render a placeholder instead of a crop. */
  oov?: boolean;
  /** Ring colour drawn on the marker (category colour). */
  markerColor?: string;
  /** Rendered size in px (square). */
  size?: number;
}

/**
 * Slim, chrome-free thumbnail centred on one annotation — the same crop path
 * `ChainTile` uses ({@link fetchCenteredCrop}), without zoom/rotate/obscured
 * controls. Used by the admin Disagreement Explorer to preview annotations.
 */
export function AnnotationCrop({
  meta,
  x,
  y,
  oov = false,
  markerColor = '#facc15',
  size = 88,
}: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (oov || !meta || !meta.sourceKey) {
      setImgSrc(null);
      return;
    }
    let cancelled = false;
    setError(false);
    const { maxZ } = getCropZoomRange(meta.width, meta.height);
    fetchCenteredCrop({
      sourceKey: meta.sourceKey,
      imageId: meta.imageId,
      sharedImageId: meta.sharedImageId,
      imageWidth: meta.width,
      imageHeight: meta.height,
      x,
      y,
      zoom: maxZ,
    })
      .then(({ canvas, markerX, markerY }) => {
        if (cancelled) return;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.beginPath();
          ctx.arc(markerX, markerY, 8, 0, Math.PI * 2);
          ctx.strokeStyle = markerColor;
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
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [meta, x, y, oov, markerColor]);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  const boxStyle: React.CSSProperties = {
    width: size,
    height: size,
    flex: `0 0 ${size}px`,
    background: '#1f2933',
    borderRadius: 6,
    overflow: 'hidden',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#bcccdc',
    fontSize: 11,
  };

  if (oov) {
    return (
      <div style={boxStyle} title='Out of view'>
        <ScanEye size={24} strokeWidth={1.5} opacity={0.6} />
      </div>
    );
  }
  if (imgSrc) {
    return (
      <div style={boxStyle}>
        <img
          src={imgSrc}
          alt='annotation crop'
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }
  return <div style={boxStyle}>{error ? 'n/a' : '…'}</div>;
}
