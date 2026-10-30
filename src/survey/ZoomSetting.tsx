import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
      <Label className='mb-0'>Zoom Level</Label>
      <span
        className='mb-1 block text-muted-foreground'
        style={{ fontSize: '12px' }}
      >
        {mode === 'level'
          ? 'The zoom level images open at in the job. Auto fits each location to the screen.'
          : 'How far the job zooms in on each annotation when it opens.'}
      </span>
      <div className='flex items-center gap-2'>
        <Input type='text' value={label} disabled readOnly />
        <Button
          variant='info'
          className='text-nowrap'
          disabled={disabled}
          onClick={() => setShowPreview(true)}
        >
          Change zoom
        </Button>
      </div>
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
