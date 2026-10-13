import React, { useEffect, useRef, useState } from 'react';
import { Button } from 'react-bootstrap';
import type { MaskPolygon } from '../../types/CameraMask';

const MASK_COLOR = '#97009c';
const CLOSE_DISTANCE = 15; // screen px

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

interface MaskCanvasProps {
  imageUrl: string;
  polygons: MaskPolygon[];
  onChange: (polygons: MaskPolygon[]) => void;
}

export default function MaskCanvas({
  imageUrl,
  polygons,
  onChange,
}: MaskCanvasProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null
  );
  const [draft, setDraft] = useState<MaskPolygon>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef<{ polygon: number; vertex: number } | null>(null);

  useEffect(() => {
    setSize(null);
    setDraft([]);
  }, [imageUrl]);

  const eventToFraction = (e: React.MouseEvent): [number, number] | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return [
      clamp01((e.clientX - rect.left) / rect.width),
      clamp01((e.clientY - rect.top) / rect.height),
    ];
  };

  const closeDraft = () => {
    if (draft.length >= 3) onChange([...polygons, draft]);
    setDraft([]);
  };

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    // The second click of a double-click only closes the polygon.
    if (draggingRef.current || e.detail > 1) return;
    const point = eventToFraction(e);
    const rect = svgRef.current?.getBoundingClientRect();
    if (!point || !rect) return;
    if (draft.length >= 3) {
      const dx = (point[0] - draft[0][0]) * rect.width;
      const dy = (point[1] - draft[0][1]) * rect.height;
      if (Math.hypot(dx, dy) < CLOSE_DISTANCE) {
        closeDraft();
        return;
      }
    }
    setDraft((prev) => [...prev, point]);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const dragging = draggingRef.current;
    if (!dragging) return;
    const point = eventToFraction(e);
    if (!point) return;
    onChange(
      polygons.map((polygon, p) =>
        p === dragging.polygon
          ? polygon.map((vertex, v) => (v === dragging.vertex ? point : vertex))
          : polygon
      )
    );
  };

  const stroke = size ? Math.max(2, size.width / 500) : 2;
  const radius = size ? Math.max(4, size.width / 200) : 4;
  const points = (polygon: MaskPolygon) =>
    polygon
      .map(([x, y]) => `${x * (size?.width ?? 0)},${y * (size?.height ?? 0)}`)
      .join(' ');

  return (
    <div
      style={{
        position: 'relative',
        width: size
          ? `min(100%, calc(60vh * ${size.width / size.height}))`
          : '100%',
        margin: '0 auto',
        lineHeight: 0,
      }}
    >
      <img
        src={imageUrl}
        alt='Mask sample'
        draggable={false}
        onLoad={(e) =>
          setSize({
            width: e.currentTarget.naturalWidth,
            height: e.currentTarget.naturalHeight,
          })
        }
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
      {size && (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${size.width} ${size.height}`}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            cursor: 'crosshair',
            touchAction: 'none',
          }}
          onClick={handleClick}
          onDoubleClick={(e) => {
            e.preventDefault();
            closeDraft();
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={() => {
            // Defer so the click that ends a drag is not read as a new corner.
            setTimeout(() => (draggingRef.current = null), 0);
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {polygons.map((polygon, p) => (
            <g key={p}>
              <polygon
                points={points(polygon)}
                fill={MASK_COLOR}
                fillOpacity={0.3}
                stroke={MASK_COLOR}
                strokeWidth={stroke}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(polygons.filter((_, i) => i !== p));
                }}
              />
              {polygon.map((vertex, v) => (
                <circle
                  key={v}
                  cx={vertex[0] * size.width}
                  cy={vertex[1] * size.height}
                  r={radius}
                  fill='#ffffff'
                  stroke={MASK_COLOR}
                  strokeWidth={stroke / 1.5}
                  style={{ cursor: 'move' }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    draggingRef.current = { polygon: p, vertex: v };
                    svgRef.current?.setPointerCapture(e.pointerId);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ))}
            </g>
          ))}
          {draft.length > 0 && (
            <g>
              <polyline
                points={points(draft)}
                fill='none'
                stroke={MASK_COLOR}
                strokeDasharray={`${stroke * 3},${stroke * 2}`}
                strokeWidth={stroke}
              />
              {draft.map((vertex, v) => (
                <circle
                  key={v}
                  cx={vertex[0] * size.width}
                  cy={vertex[1] * size.height}
                  r={radius}
                  fill={v === 0 ? MASK_COLOR : '#ffffff'}
                  stroke={MASK_COLOR}
                  strokeWidth={stroke / 1.5}
                />
              ))}
            </g>
          )}
        </svg>
      )}
      {draft.length > 0 && (
        <Button
          size='sm'
          variant='secondary'
          style={{ position: 'absolute', top: 8, right: 8 }}
          onClick={() => setDraft([])}
        >
          Cancel polygon
        </Button>
      )}
    </div>
  );
}
