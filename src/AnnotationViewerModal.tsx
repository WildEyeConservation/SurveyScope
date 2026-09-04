import { useEffect, useMemo, useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { client } from './stores/appClient';
import AnnotationWorkspace from './AnnotationWorkspace';

export default function AnnotationViewerModal({
  show,
  onClose,
  imageId,
  annotationSetId,
  imageIds,
  onNavigate,
}: {
  show: boolean;
  onClose: () => void;
  imageId: string | null;
  annotationSetId: string;
  imageIds: string[];
  onNavigate: (imageId: string) => void;
}) {
  const [imageMeta, setImageMeta] = useState<{
    id: string;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!imageId) {
        setImageMeta(null);
        return;
      }
      const resp: any = await (client as any).models.Image.get(
        { id: imageId },
        { selectionSet: ['id', 'width', 'height', 'timestamp'] }
      );
      const data = (resp?.data ?? null) as {
        id: string;
        width: number;
        height: number;
      } | null;
      if (!cancelled) {
        setImageMeta(
          data ? { id: data.id, width: data.width, height: data.height } : null
        );
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  const currentIndex = useMemo(
    () => (imageId ? imageIds.indexOf(imageId) : -1),
    [imageId, imageIds]
  );
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < imageIds.length - 1;

  const handlePrevious = () => {
    if (hasPrevious) onNavigate(imageIds[currentIndex - 1]);
  };

  const handleNext = () => {
    if (hasNext) onNavigate(imageIds[currentIndex + 1]);
  };

  return (
    <Modal show={show} onHide={onClose} size='xl'>
      <Modal.Header closeButton>
        <Modal.Title>
          Annotate Image{' '}
          {imageId ? `(${currentIndex + 1} of ${imageIds.length})` : ''}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ height: '75vh' }}>
        {imageId && imageMeta ? (
          <div className='w-100 h-100' style={{ position: 'relative' }}>
            <AnnotationWorkspace
              visible={true}
              hideZoomSetting={true}
              hideNavButtons={true}
              location={{
                image: {
                  id: imageMeta.id,
                  width: imageMeta.width,
                  height: imageMeta.height,
                },
                annotationSetId,
                x: imageMeta.width / 2,
                y: imageMeta.height / 2,
                width: imageMeta.width,
                height: imageMeta.height,
              }}
            />
          </div>
        ) : (
          <div>No image selected.</div>
        )}
      </Modal.Body>
      <Modal.Footer className='d-flex justify-content-between'>
        <div className='d-flex flex-row gap-2'>
          <Button
            className='d-flex flex-row align-items-center justify-content-center h-100'
            variant='primary'
            onClick={handlePrevious}
            disabled={!hasPrevious}
            style={{ width: '110px' }}
          >
            <ChevronLeft />
            <span className='d-none d-sm-block'>Previous</span>
          </Button>
          <Button
            className='d-flex flex-row align-items-center justify-content-center h-100'
            variant='primary'
            onClick={handleNext}
            disabled={!hasNext}
            style={{ width: '110px' }}
          >
            <span className='d-none d-sm-block'>Next</span>
            <ChevronRight />
          </Button>
        </div>
        <Button variant='dark' onClick={onClose}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
