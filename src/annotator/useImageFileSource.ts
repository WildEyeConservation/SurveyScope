import { useContext, useEffect, useMemo, useState } from 'react';
import { GlobalContext } from '../Context';
import type { ImageFileType } from '../schemaTypes';
import { tileLoadStats, timed } from '../storage/tileLoadStats';
import { onImageSessionChange } from '../StorageLayer';

type FilesClient = {
  models: {
    ImageFile: {
      imagesByimageId: (args: {
        imageId: string;
      }) => Promise<{ data: ImageFileType[] }>;
    };
  };
};

const MAX_CACHED = 200;
const files = new Map<string, Promise<ImageFileType[]>>();
onImageSessionChange(() => files.clear());

export function loadImageFiles(
  client: FilesClient,
  imageId: string,
  taskId?: string
): Promise<ImageFileType[]> {
  const cached = files.get(imageId);
  if (cached) return cached;
  const loading = timed(
    () =>
      client.models.ImageFile.imagesByimageId({ imageId }).then(
        ({ data }) => data
      ),
    (ms) => {
      if (taskId) tileLoadStats.step(taskId, 'fileLookup', ms);
    }
  );
  files.set(imageId, loading);
  const forget = () => {
    if (files.get(imageId) === loading) files.delete(imageId);
  };
  // Files may still be registering, so an empty answer is asked again.
  loading.then((data) => data.length === 0 && forget(), forget);
  for (const oldest of files.keys()) {
    if (files.size <= MAX_CACHED) break;
    files.delete(oldest);
  }
  return loading;
}

export const sourceKeyOf = (imageFiles: ImageFileType[]) =>
  imageFiles.find((file) => file.type === 'image/jpeg')?.key;

export default function useImageFileSource(imageId: string, taskId?: string) {
  const { client } = useContext(GlobalContext)!;
  const [imageFiles, setImageFiles] = useState<ImageFileType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setImageFiles([]);
    setLoading(true);

    loadImageFiles(client as unknown as FilesClient, imageId, taskId)
      .then((data) => {
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
  }, [client, imageId, taskId]);

  const sourceKey = useMemo(() => sourceKeyOf(imageFiles), [imageFiles]);

  return { imageFiles, loading, sourceKey };
}
