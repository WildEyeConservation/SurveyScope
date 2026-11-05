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
import { useContext, useEffect, useMemo, useState } from 'react';
import type { BoundaryStatus } from '../shared/boundaryStatus';
import AnnotationWorkspace from './AnnotationWorkspace';
import { GlobalContext } from './Context';

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
  const { client } = useContext(GlobalContext)!;
  const [imageMeta, setImageMeta] = useState<{
    id: string;
    width: number;
    height: number;
    boundaryStatus?: BoundaryStatus | null;
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
        {
          selectionSet: [
            'id',
            'width',
            'height',
            'timestamp',
            'boundaryStatus',
          ],
        },
      );
      const data = (resp?.data ?? null) as {
        id: string;
        width: number;
        height: number;
        boundaryStatus?: BoundaryStatus | null;
      } | null;
      if (!cancelled) {
        setImageMeta(
          data
            ? {
                id: data.id,
                width: data.width,
                height: data.height,
                boundaryStatus: data.boundaryStatus,
              }
            : null,
        );
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [client, imageId]);

  const currentIndex = useMemo(
    () => (imageId ? imageIds.indexOf(imageId) : -1),
    [imageId, imageIds],
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
    <Dialog open={show} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size='xl'>
        <DialogHeader closeButton>
          <DialogTitle>
            Annotate Image{' '}
            {imageId ? `(${currentIndex + 1} of ${imageIds.length})` : ''}
          </DialogTitle>
        </DialogHeader>
        <DialogBody style={{ height: '75vh' }}>
          {imageId && imageMeta ? (
            <div className='h-full w-full' style={{ position: 'relative' }}>
              <AnnotationWorkspace
                visible={true}
                hideZoomSetting={true}
                hideNavButtons={true}
                location={{
                  image: {
                    id: imageMeta.id,
                    width: imageMeta.width,
                    height: imageMeta.height,
                    boundaryStatus: imageMeta.boundaryStatus,
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
        </DialogBody>
        <DialogFooter className='flex justify-between'>
          <Button variant='ghost' onClick={onClose}>
            Close
          </Button>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
