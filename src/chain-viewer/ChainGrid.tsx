import { ChainTile } from './ChainTile';
import type { AnnotationImageMeta, Chain } from './types';
import { rotationKeyFor } from './utils/rotationKey';

interface Props {
  chain: Chain;
  metaByAnnotationId: Map<string, AnnotationImageMeta>;
  metaLoading: boolean;
  categoryColor: string;
  /** Number of columns. `null` falls back to the auto-fill responsive grid. */
  columns: number | null;
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
 * Grid of tiles for every annotation in the supplied chain. Column count is
 * either user-fixed (`columns`) or auto-fills based on viewport width. The
 * parent card constrains height so the grid scrolls vertically when a chain
 * has many sightings.
 */
export function ChainGrid({
  chain,
  metaByAnnotationId,
  metaLoading,
  categoryColor,
  columns,
  cameraRotations,
  onRotateKey,
  tileZoom,
  onZoomChange,
  openImageHrefFor,
  onToggleObscured,
}: Props) {
  const gridTemplateColumns =
    columns === null
      ? 'repeat(auto-fill, minmax(180px, 1fr))'
      : `repeat(${columns}, 1fr)`;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns,
        gap: 12,
        width: '100%',
      }}
    >
      {chain.annotations.map((a) => {
        const meta = metaByAnnotationId.get(a.id);
        const rotKey = rotationKeyFor(meta, a.imageId);
        const rotation = cameraRotations.get(rotKey) ?? 0;
        return (
          <ChainTile
            key={a.id}
            annotation={a}
            meta={meta}
            metaLoading={metaLoading}
            categoryColor={categoryColor}
            rotation={rotation}
            onRotate={() => onRotateKey(rotKey)}
            zoomOut={tileZoom.get(a.id) ?? 0}
            onZoomChange={(next) => onZoomChange(a.id, next)}
            openImageHref={openImageHrefFor(a)}
            onToggleObscured={() => onToggleObscured(a.id)}
          />
        );
      })}
    </div>
  );
}
