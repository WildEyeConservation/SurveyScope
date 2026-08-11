import React, { useCallback, useRef, useState } from 'react';
import FileInput from './FileInput';
import { Button, Form } from 'react-bootstrap';

interface ImageMaskEditorProps {
  setMasks: (masks: number[][][]) => void;
}

type Polygon = { id: string; vertices: [number, number][] }; // image px, y from top

const MASK_COLOR = '#97009c';
const CLOSE_DISTANCE = 15; // px in image space (scaled) to close on first vertex

/*
Polygon mask editor drawn as an SVG overlay on the sample image — click to
add vertices, click the first vertex (or double-click) to close, drag
vertices to adjust, right-click a polygon to remove it.

Masks use the persisted coordinate convention: [x, y] with y measured from
the image bottom.
*/
const ImageMaskEditor: React.FC<ImageMaskEditorProps> = ({ setMasks }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [polygons, setPolygons] = useState<Polygon[]>([]);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef<{ polygonId: string; vertexIndex: number } | null>(
    null
  );

  const handleFileChange = (file: File[]) => {
    if (file && file[0]) {
      const url = URL.createObjectURL(file[0]);
      setImageUrl(url);
      setPolygons([]);
      setDraft([]);
      setMasks([]);
      const img = new Image();
      img.onload = () => {
        setImageDimensions({
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.src = url;
    }
  };

  const publishMasks = useCallback(
    (polys: Polygon[]) => {
      if (!imageDimensions) return;
      setMasks(
        polys.map((p) =>
          p.vertices.map(([x, y]) => [
            Math.min(Math.max(x, 0), imageDimensions.width),
            // Preserve the legacy CRS.Simple convention: y from image bottom
            imageDimensions.height -
              Math.min(Math.max(y, 0), imageDimensions.height),
          ])
        )
      );
    },
    [setMasks, imageDimensions]
  );

  const eventToImagePx = (
    e: React.MouseEvent<SVGSVGElement>
  ): [number, number] | null => {
    const svg = svgRef.current;
    if (!svg || !imageDimensions) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * imageDimensions.width;
    const y = ((e.clientY - rect.top) / rect.height) * imageDimensions.height;
    return [
      Math.min(Math.max(x, 0), imageDimensions.width),
      Math.min(Math.max(y, 0), imageDimensions.height),
    ];
  };

  const closeDraft = () => {
    if (draft.length >= 3) {
      const next = [
        ...polygons,
        { id: crypto.randomUUID(), vertices: draft },
      ];
      setPolygons(next);
      publishMasks(next);
    }
    setDraft([]);
  };

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingRef.current) return;
    const px = eventToImagePx(e);
    if (!px) return;
    // Clicking near the first draft vertex closes the polygon
    if (draft.length >= 3) {
      const [fx, fy] = draft[0];
      const scale = imageDimensions!.width /
        (svgRef.current?.getBoundingClientRect().width ?? 1);
      if (Math.hypot(px[0] - fx, px[1] - fy) < CLOSE_DISTANCE * scale) {
        closeDraft();
        return;
      }
    }
    setDraft((prev) => [...prev, px]);
  };

  const handleVertexPointerDown = (
    polygonId: string,
    vertexIndex: number,
    e: React.PointerEvent
  ) => {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = { polygonId, vertexIndex };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const dragging = draggingRef.current;
    if (!dragging) return;
    const px = eventToImagePx(e as any);
    if (!px) return;
    setPolygons((prev) =>
      prev.map((p) =>
        p.id === dragging.polygonId
          ? {
              ...p,
              vertices: p.vertices.map((v, i) =>
                i === dragging.vertexIndex ? px : v
              ),
            }
          : p
      )
    );
  };

  const handlePointerUp = () => {
    if (draggingRef.current) {
      draggingRef.current = null;
      // publish with the latest state
      setPolygons((prev) => {
        publishMasks(prev);
        return prev;
      });
    }
  };

  const removePolygon = (id: string) => {
    const next = polygons.filter((p) => p.id !== id);
    setPolygons(next);
    publishMasks(next);
  };

  const toPointsAttr = (vertices: [number, number][]) =>
    vertices.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <Form.Group className='mt-3'>
      <Form.Label className='d-block mb-0'>
        Create Image Masks (optional)
      </Form.Label>
      <Form.Text
        className='d-block text-muted m-0 mb-2'
        style={{ fontSize: '12px' }}
      >
        Use this tool to create masks for your images. Masks are used to remove
        static objects such as a wheel from your images when processing. Click
        on the image to add polygon corners; click the first corner (or
        double-click) to finish a polygon. Drag corners to adjust and
        right-click a polygon to remove it.
      </Form.Text>
      {imageUrl && imageDimensions && (
        <div
          style={{
            position: 'relative',
            marginTop: '8px',
            marginBottom: '12px',
            width: '100%',
          }}
        >
          <img
            src={imageUrl}
            alt='Mask sample'
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${imageDimensions.width} ${imageDimensions.height}`}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              cursor: 'crosshair',
            }}
            onClick={handleClick}
            onDoubleClick={(e) => {
              e.preventDefault();
              closeDraft();
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onContextMenu={(e) => e.preventDefault()}
          >
            {polygons.map((p) => (
              <g key={p.id}>
                <polygon
                  points={toPointsAttr(p.vertices)}
                  fill={MASK_COLOR}
                  fillOpacity={0.25}
                  stroke={MASK_COLOR}
                  strokeWidth={Math.max(2, imageDimensions.width / 500)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removePolygon(p.id);
                  }}
                />
                {p.vertices.map((v, i) => (
                  <circle
                    key={i}
                    cx={v[0]}
                    cy={v[1]}
                    r={Math.max(4, imageDimensions.width / 250)}
                    fill='#ffffff'
                    stroke={MASK_COLOR}
                    strokeWidth={Math.max(1.5, imageDimensions.width / 800)}
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => handleVertexPointerDown(p.id, i, e)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ))}
              </g>
            ))}
            {draft.length > 0 && (
              <g>
                <polyline
                  points={toPointsAttr(draft)}
                  fill='none'
                  stroke={MASK_COLOR}
                  strokeDasharray='6,4'
                  strokeWidth={Math.max(2, imageDimensions.width / 500)}
                />
                {draft.map((v, i) => (
                  <circle
                    key={i}
                    cx={v[0]}
                    cy={v[1]}
                    r={Math.max(4, imageDimensions.width / 250)}
                    fill={i === 0 ? MASK_COLOR : '#ffffff'}
                    stroke={MASK_COLOR}
                    strokeWidth={Math.max(1.5, imageDimensions.width / 800)}
                  />
                ))}
              </g>
            )}
          </svg>
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
      )}
      <FileInput
        id='mask-image-input'
        onFileChange={handleFileChange}
        accept='image/*'
      >
        <p className='mb-0'>
          {imageUrl ? 'Change Image' : 'Select Sample Image'}
        </p>
      </FileInput>
    </Form.Group>
  );
};

export default ImageMaskEditor;
