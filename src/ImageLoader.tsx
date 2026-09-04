import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { client } from './stores/appClient';
import AnnotationWorkspace from './AnnotationWorkspace';
import type { ImageType } from './schemaTypes';

export function ImageLoader() {
  const { imageId, annotationSetId } = useParams();
  const [image, setImage] = useState<ImageType | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.models.Image.get(
      { id: imageId! },
      {
        selectionSet: [
          'id',
          'width',
          'height',
          'latitude',
          'longitude',
          'altitude_wgs84',
          'altitude_egm96',
          'altitude_agl',
        ],
      }
    ).then(({ data }) => {
      if (!cancelled && data) setImage(data as ImageType);
    });
    return () => {
      cancelled = true;
    };
  }, [imageId, annotationSetId]);

  return (
    <div
      className='d-flex flex-column align-items-center w-100 h-100'
      style={{ paddingTop: '12px', paddingBottom: '12px' }}
    >
      {image && (
        <AnnotationWorkspace
          visible={true}
          location={{
            image,
            annotationSetId: annotationSetId!,
            x: image.width / 2,
            y: image.height / 2,
            width: image.width,
            height: image.height,
          }}
          hideNavButtons={true}
        />
      )}
    </div>
  );
}
