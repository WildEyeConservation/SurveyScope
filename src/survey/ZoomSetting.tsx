import { useState } from 'react';
import { Button, Form } from 'react-bootstrap';
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
    <Form.Group>
      <Form.Label className='mb-0'>Zoom Level</Form.Label>
      <span className='text-muted d-block mb-1' style={{ fontSize: '12px' }}>
        {mode === 'level'
          ? 'The zoom level images open at in the job. Auto fits each location to the screen.'
          : 'How far the job zooms in on each annotation when it opens.'}
      </span>
      <div className='d-flex align-items-center gap-2'>
        <Form.Control type='text' value={label} disabled readOnly />
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
    </Form.Group>
  );
}
