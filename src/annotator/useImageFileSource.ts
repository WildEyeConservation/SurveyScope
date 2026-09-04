import { useEffect, useMemo, useState } from 'react';
import { client } from '../stores/appClient';
import type { ImageFileType } from '../schemaTypes';

export default function useImageFileSource(imageId: string) {
  const [imageFiles, setImageFiles] = useState<ImageFileType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setImageFiles([]);
    setLoading(true);

    client.models.ImageFile.imagesByimageId({ imageId })
      .then(({ data }) => {
        if (!cancelled) setImageFiles(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error('Error fetching image files:', error);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [imageId]);

  const sourceKey = useMemo(
    () => imageFiles.find((file) => file.type === 'image/jpeg')?.key,
    [imageFiles]
  );

  return { imageFiles, loading, sourceKey };
}
