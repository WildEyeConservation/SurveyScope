import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import LightImageView from './LightImageView';

export default function ImageViewerModal({
  show,
  onClose,
  imageId,
  annotationSetId,
  imageIds,
  onNavigate,
  categoryIds = [],
}: {
  show: boolean;
  onClose: () => void;
  imageId: string | null;
  annotationSetId: string;
  imageIds: string[];
  onNavigate: (imageId: string) => void;
  categoryIds?: string[];
}) {
  const currentIndex = imageId ? imageIds.indexOf(imageId) : -1;
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < imageIds.length - 1;

  const handlePrevious = () => {
    if (hasPrevious) {
      onNavigate(imageIds[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (hasNext) {
      onNavigate(imageIds[currentIndex + 1]);
    }
  };

  return (
    <Dialog open={show} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size='xl'>
        <DialogHeader closeButton>
          <DialogTitle>
            View Image{' '}
            {imageId ? `(${currentIndex + 1} of ${imageIds.length})` : ''}
          </DialogTitle>
        </DialogHeader>
        <DialogBody style={{ height: '75vh' }}>
          {imageId ? (
            <div className='h-full w-full' style={{ position: 'relative' }}>
              <LightImageView
                imageId={imageId}
                annotationSetId={annotationSetId}
                categoryIds={categoryIds}
              />
            </div>
          ) : (
            <div>No image selected.</div>
          )}
        </DialogBody>
        <DialogFooter className='flex justify-between'>
          <div className='flex flex-row gap-2'>
            <Button
              className='flex h-full flex-row items-center justify-center'
              variant='primary'
              onClick={handlePrevious}
              disabled={!hasPrevious}
              style={{ width: '110px' }}
            >
              <ChevronLeft className='size-6' />
              <span className='hidden sm:block'>Previous</span>
            </Button>
            <Button
              className='flex h-full flex-row items-center justify-center'
              variant='primary'
              onClick={handleNext}
              disabled={!hasNext}
              style={{ width: '110px' }}
            >
              <span className='hidden sm:block'>Next</span>
              <ChevronRight className='size-6' />
            </Button>
          </div>
          <Button variant='dark' onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
