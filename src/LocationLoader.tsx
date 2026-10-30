import { useContext, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import AnnotationWorkspace from './AnnotationWorkspace';
import { GlobalContext } from './Context';

export function LocationLoader() {
  const { locationId, annotationSetId } = useParams();
  const [location, setLocation] = useState<any>(null);
  const { client } = useContext(GlobalContext)!;

  useEffect(() => {
    let cancelled = false;
    client.models.Location.get(
      { id: locationId! },
      {
        selectionSet: [
          'id',
          'x',
          'y',
          'width',
          'height',
          'confidence',
          'image.id',
          'image.width',
          'image.height',
          'image.latitude',
          'image.longitude',
          'image.altitude_wgs84',
          'image.altitude_egm96',
          'image.altitude_agl',
        ],
      },
    ).then(({ data }) => {
      if (!cancelled) setLocation(data);
    });
    return () => {
      cancelled = true;
    };
  }, [locationId, annotationSetId]);

  return (
    <div
      className='flex h-full w-full flex-col items-center'
      style={{ paddingTop: '12px', paddingBottom: '12px' }}
    >
      {location && (
        <AnnotationWorkspace
          visible={true}
          location={{ ...location, annotationSetId }}
          hideNavButtons
        />
      )}
    </div>
  );
}
