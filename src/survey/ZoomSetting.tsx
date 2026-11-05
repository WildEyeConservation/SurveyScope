import { Label } from '@/components/ui/label';
import { useState } from 'react';
import ZoomPreviewModal from './ZoomPreviewModal';
import {
  DEFAULT_ZOOM_OFFSET,
  type ZoomPreviewCandidate,
  type ZoomPreviewMode,
} from './zoomPreview';

export default function ZoomSetting({
  mode,
  zoom,
  onChange,
  loadCandidates,
  disabled,
}: {
  mode: ZoomPreviewMode;
  zoom: number | undefined;
  onChange: (zoom: number | undefined) => void;
  loadCandidates: () => Promise<ZoomPreviewCandidate[]>;
  disabled?: boolean;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const label =
    zoom !== undefined
      ? `Level ${zoom}`
      : mode === 'level'
        ? 'Auto'
        : `Level ${DEFAULT_ZOOM_OFFSET} (default)`;

  return (
    <div>
      <Label className='mb-1'>Zoom</Label>
      <button
        type='button'
        disabled={disabled}
        onClick={() => setShowPreview(true)}
        title={
          mode === 'level'
            ? 'The zoom level images open at. Auto fits each location to the screen.'
            : 'How far the job zooms in on each annotation when it opens.'
        }
        className='flex w-full items-center justify-between border border-input bg-field px-3 py-1.5 text-left text-base text-field-foreground disabled:opacity-65'
      >
        <span>{label}</span>
        <span className='text-sm text-[#6c757d]'>Change</span>
      </button>
      <ZoomPreviewModal
        show={showPreview}
        mode={mode}
        loadCandidates={loadCandidates}
        zoom={zoom}
        onConfirm={(next) => {
          onChange(next);
          setShowPreview(false);
        }}
        onClose={() => setShowPreview(false)}
      />
    </div>
  );
}
