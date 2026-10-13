import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Form } from 'react-bootstrap';
import {
  orientationCorrectionFor,
  type CameraOrientationRotations,
  type ImageOrientationGroup,
} from '../../types/Orientation';

// Each camera is split strictly by the source image's displayed dimensions.
// Landscape and portrait images can therefore receive independent physical
// corrections while every image within a camera+shape group stays consistent.
export interface OrientationCameraGroup {
  cameraName: string;
  orientationGroup: ImageOrientationGroup;
  files: File[];
}

interface OrientationReviewProps {
  cameraGroups: OrientationCameraGroup[];
  rotations: CameraOrientationRotations;
  setRotations: React.Dispatch<
    React.SetStateAction<CameraOrientationRotations>
  >;
}

const groupLabel = (group: ImageOrientationGroup) =>
  group === 'portrait' ? 'Portrait source images' : 'Landscape source images';

function ExpandedSample({
  url,
  title,
  rotation,
  onRotate,
  onNextSample,
  onClose,
}: {
  url: string;
  title: string;
  rotation: number;
  onRotate: () => void;
  onNextSample?: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const quarterTurn = rotation % 180 !== 0;

  useEffect(() => setView({ scale: 1, x: 0, y: 0 }), [url]);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    setView((prev) => {
      const scale = Math.min(
        Math.max(prev.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 1),
        20
      );
      if (scale === 1) return { scale, x: 0, y: 0 };
      const ratio = scale / prev.scale;
      // Keep the point under the cursor fixed.
      return {
        scale,
        x: cx - (cx - prev.x) * ratio,
        y: cy - (cy - prev.y) * ratio,
      };
    });
  };

  return createPortal(
    <div
      className='d-flex flex-column'
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        backgroundColor: 'rgba(0,0,0,0.95)',
      }}
    >
      <div className='d-flex align-items-center gap-2 p-2 text-white'>
        <strong className='text-truncate' style={{ flex: 1, minWidth: 0 }}>
          {title}
        </strong>
        <span
          className='text-muted d-none d-md-inline'
          style={{ fontSize: 12 }}
        >
          Scroll to zoom, drag to pan
        </span>
        <Button size='sm' variant='secondary' onClick={onRotate}>
          ↺ Rotate
        </Button>
        {onNextSample && (
          <Button size='sm' variant='outline-secondary' onClick={onNextSample}>
            Another sample
          </Button>
        )}
        <Button size='sm' variant='outline-light' onClick={onClose}>
          Close
        </Button>
      </div>
      <div
        onWheel={handleWheel}
        onPointerDown={(e) => {
          dragRef.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const last = dragRef.current;
          if (!last) return;
          dragRef.current = { x: e.clientX, y: e.clientY };
          setView((prev) => ({
            ...prev,
            x: prev.x + e.clientX - last.x,
            y: prev.y + e.clientY - last.y,
          }));
        }}
        onPointerUp={() => (dragRef.current = null)}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          touchAction: 'none',
        }}
      >
        <img
          src={url}
          alt={title}
          draggable={false}
          style={{
            // A quarter turn swaps which viewport side limits the image.
            maxWidth: quarterTurn ? 'calc(100vh - 60px)' : '100vw',
            maxHeight: quarterTurn ? '100vw' : 'calc(100vh - 60px)',
            transform: `translate(${view.x}px, ${view.y}px) scale(${
              view.scale
            }) rotate(${-rotation}deg)`,
            userSelect: 'none',
          }}
        />
      </div>
    </div>,
    document.body
  );
}

function CameraOrientationCard({
  group,
  rotation,
  onRotate,
  onReset,
}: {
  group: OrientationCameraGroup;
  rotation: number;
  onRotate: () => void;
  onReset: () => void;
}) {
  // Start from the middle of the flight rather than the first frame, which is
  // often a ground/calibration shot; "Another sample" strides through the set.
  const [sampleIdx, setSampleIdx] = useState(() =>
    Math.floor(group.files.length / 2)
  );
  const file = group.files[Math.min(sampleIdx, group.files.length - 1)];
  const [url, setUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const nextSample = () => {
    const stride = Math.max(1, Math.floor(group.files.length / 7));
    setSampleIdx((prev) => (prev + stride) % group.files.length);
  };

  return (
    <div
      className='border border-dark p-2'
      style={{ width: 360, backgroundColor: 'rgba(0,0,0,0.15)' }}
    >
      <div className='d-flex justify-content-between align-items-center mb-1'>
        <strong>{groupLabel(group.orientationGroup)}</strong>
        <span className='text-muted' style={{ fontSize: 12 }}>
          {group.files.length} image{group.files.length === 1 ? '' : 's'}
        </span>
      </div>
      <div
        style={{
          height: 320,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: '#000',
        }}
      >
        {url ? (
          <img
            src={url}
            alt={file?.webkitRelativePath || group.cameraName}
            title='Click to expand'
            onClick={() => setExpanded(true)}
            style={{
              cursor: 'zoom-in',
              maxWidth: 300,
              maxHeight: 300,
              objectFit: 'contain',
              // CSS rotate() is clockwise; the stored correction is CCW.
              transform: `rotate(${-rotation}deg)`,
              transition: 'transform 0.2s ease',
            }}
          />
        ) : (
          <span className='text-muted'>Loading…</span>
        )}
      </div>
      <div
        className='text-truncate text-muted mt-1'
        style={{ fontSize: 11 }}
        title={file?.webkitRelativePath}
      >
        {file?.webkitRelativePath}
      </div>
      <div className='d-flex gap-2 mt-2'>
        <Button
          size='sm'
          variant='secondary'
          onClick={onRotate}
          title='Rotate 90° counter-clockwise'
        >
          ↺ Rotate
        </Button>
        <Button
          size='sm'
          variant='outline-secondary'
          disabled={rotation === 0}
          onClick={onReset}
        >
          Reset
        </Button>
        <Button
          size='sm'
          variant='outline-secondary'
          disabled={!url}
          onClick={() => setExpanded(true)}
        >
          ⤢ Expand
        </Button>
        <Button
          size='sm'
          variant='outline-secondary'
          className='ms-auto'
          disabled={group.files.length <= 1}
          onClick={nextSample}
        >
          Another sample
        </Button>
      </div>
      {expanded && url && (
        <ExpandedSample
          url={url}
          title={`${group.cameraName} · ${file?.webkitRelativePath ?? ''}`}
          rotation={rotation}
          onRotate={onRotate}
          onNextSample={group.files.length > 1 ? nextSample : undefined}
          onClose={() => setExpanded(false)}
        />
      )}
      <div className='mt-2' style={{ fontSize: 12 }}>
        {rotation === 0 ? (
          <span className='text-success'>
            Orientation looks correct — no correction applied.
          </span>
        ) : (
          <span className='text-warning'>
            This {group.orientationGroup} group will be physically rotated{' '}
            {rotation}° counter-clockwise.
          </span>
        )}
      </div>
    </div>
  );
}

export default function OrientationReview({
  cameraGroups,
  rotations,
  setRotations,
}: OrientationReviewProps) {
  if (cameraGroups.length === 0) return null;

  const cameraNames = Array.from(
    new Set(cameraGroups.map((group) => group.cameraName))
  );

  const setGroupRotation = (
    cameraName: string,
    orientationGroup: ImageOrientationGroup,
    nextRotation: (current: number) => number
  ) =>
    setRotations((prev) => {
      const next = { ...prev };
      const camera = { ...(prev[cameraName] ?? {}) };
      const rotation = nextRotation(camera[orientationGroup] ?? 0) % 360;

      if (rotation === 0) delete camera[orientationGroup];
      else camera[orientationGroup] = rotation;

      if (Object.keys(camera).length === 0) delete next[cameraName];
      else next[cameraName] = camera;
      return next;
    });

  return (
    <Form.Group className='mt-3'>
      <Form.Label className='mb-0'>Camera Orientation Check</Form.Label>
      <Form.Text className='d-block mb-2 mt-0' style={{ fontSize: '12px' }}>
        Each camera is split into landscape and portrait source images. Review
        every group shown and rotate its sample until it looks upright; click a
        sample to expand it and zoom in. The selected correction applies to all
        images in that camera and shape group. Uploaded copies are physically
        normalized before processing; files on your computer are not modified.
      </Form.Text>

      <div className='d-flex flex-column gap-3'>
        {cameraNames.map((cameraName) => (
          <div
            key={cameraName}
            className='border-start border-3 border-secondary ps-3'
          >
            <div className='mb-2'>
              <span
                className='d-block text-uppercase text-muted'
                style={{ fontSize: 10, letterSpacing: '0.08em' }}
              >
                Camera
              </span>
              <strong>{cameraName}</strong>
            </div>
            <div className='d-flex flex-wrap gap-3'>
              {cameraGroups
                .filter((group) => group.cameraName === cameraName)
                .map((group) => {
                  const rotation = orientationCorrectionFor(
                    rotations,
                    cameraName,
                    group.orientationGroup
                  );
                  return (
                    <CameraOrientationCard
                      key={`${cameraName}:${group.orientationGroup}`}
                      group={group}
                      rotation={rotation}
                      onRotate={() =>
                        setGroupRotation(
                          cameraName,
                          group.orientationGroup,
                          (current) => current + 90
                        )
                      }
                      onReset={() =>
                        setGroupRotation(
                          cameraName,
                          group.orientationGroup,
                          () => 0
                        )
                      }
                    />
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </Form.Group>
  );
}
