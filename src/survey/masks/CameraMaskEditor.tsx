import { useEffect, useState } from 'react';
import { Button } from 'react-bootstrap';
import MaskCanvas from './MaskCanvas';
import type { MaskSample } from './samplePreview';
import type { CameraMasks, MaskPolygon } from '../../types/CameraMask';
import type { ImageOrientationGroup } from '../../types/Orientation';

export interface MaskTarget {
  cameraName: string;
  shape: ImageOrientationGroup;
  samples: MaskSample[];
}

interface CameraMaskEditorProps {
  targets: MaskTarget[];
  masks: Record<string, CameraMasks>;
  onChange: (
    cameraName: string,
    shape: ImageOrientationGroup,
    polygons: MaskPolygon[]
  ) => void;
}

const targetKey = (target: MaskTarget) =>
  `${target.cameraName}:${target.shape}`;

const regionLabel = (count: number) =>
  count === 0 ? 'No mask' : `${count} region${count === 1 ? '' : 's'}`;

export default function CameraMaskEditor({
  targets,
  masks,
  onChange,
}: CameraMaskEditorProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const target =
    targets.find((t) => targetKey(t) === selectedKey) ?? targets[0];
  const sample = target?.samples[sampleIdx % (target.samples.length || 1)];

  const activeKey = target ? targetKey(target) : null;
  useEffect(() => {
    setSampleIdx(0);
  }, [activeKey]);

  useEffect(() => {
    if (!sample) return;
    let cancelled = false;
    let revoke: (() => void) | undefined;
    setSampleUrl(null);
    setError(null);
    sample
      .load()
      .then((loaded) => {
        if (cancelled) return loaded.revoke();
        revoke = loaded.revoke;
        setSampleUrl(loaded.url);
      })
      .catch((e: unknown) => {
        console.error('Failed to load mask sample', e);
        if (!cancelled) setError('Could not load this sample image.');
      });
    return () => {
      cancelled = true;
      revoke?.();
    };
  }, [sample]);

  if (!target) {
    return <p className='text-muted mb-0'>No camera images to mask yet.</p>;
  }

  const polygons = masks[target.cameraName]?.[target.shape] ?? [];
  const copyTargets = targets.filter(
    (t) => t.shape === target.shape && t.cameraName !== target.cameraName
  );
  const sampleCount = target.samples.length;
  const step = (delta: number) =>
    setSampleIdx((prev) => (prev + delta + sampleCount) % sampleCount);

  return (
    <div className='d-flex gap-3'>
      <div
        className='d-flex flex-column gap-2'
        style={{ width: 200, flex: '0 0 auto' }}
      >
        {targets.map((t) => {
          const key = targetKey(t);
          const selected = key === targetKey(target);
          return (
            <button
              key={key}
              type='button'
              onClick={() => setSelectedKey(key)}
              className={`text-start text-white p-2 border ${
                selected ? 'border-primary' : 'border-dark'
              }`}
              style={{
                backgroundColor: selected
                  ? 'rgba(223,105,25,0.15)'
                  : 'rgba(0,0,0,0.15)',
              }}
            >
              <strong className='d-block text-truncate'>{t.cameraName}</strong>
              <span className='text-muted' style={{ fontSize: 12 }}>
                {t.shape === 'portrait' ? 'Portrait' : 'Landscape'} ·{' '}
                {regionLabel(masks[t.cameraName]?.[t.shape]?.length ?? 0)}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div>
          {sampleUrl ? (
            <MaskCanvas
              imageUrl={sampleUrl}
              polygons={polygons}
              onChange={(next) =>
                onChange(target.cameraName, target.shape, next)
              }
            />
          ) : (
            <div className='p-3 text-muted'>{error ?? 'Loading sample…'}</div>
          )}
        </div>
        <div className='d-flex flex-wrap align-items-center gap-2 mt-2'>
          <Button
            size='sm'
            variant='secondary'
            disabled={sampleCount <= 1}
            onClick={() => step(-1)}
          >
            ‹ Sample
          </Button>
          <Button
            size='sm'
            variant='secondary'
            disabled={sampleCount <= 1}
            onClick={() => step(1)}
          >
            Sample ›
          </Button>
          <span
            className='text-muted text-truncate'
            style={{ fontSize: 12, flex: 1, minWidth: 0 }}
            title={sample?.label}
          >
            {(sampleIdx % sampleCount) + 1} of {sampleCount} · {sample?.label}
          </span>
          {copyTargets.length > 0 && (
            <Button
              size='sm'
              variant='outline-secondary'
              disabled={polygons.length === 0}
              onClick={() =>
                copyTargets.forEach((t) =>
                  onChange(t.cameraName, t.shape, polygons)
                )
              }
              title={`Replace the ${target.shape} mask of every other camera with this one`}
            >
              Copy to other cameras
            </Button>
          )}
          <Button
            size='sm'
            variant='outline-secondary'
            disabled={polygons.length === 0}
            onClick={() => onChange(target.cameraName, target.shape, [])}
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}
