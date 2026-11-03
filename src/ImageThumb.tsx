import { useContext, useEffect, useState } from 'react';
import { loadImageFiles, sourceKeyOf } from './annotator/useImageFileSource';
import { GlobalContext } from './Context';
import { getTileBlob, onImageSessionChange } from './StorageLayer';

const TILE_SIZE = 256;
const thumbs = new Map<string, Promise<string | null>>();
onImageSessionChange(() => thumbs.clear());

// The whole image sits in the top-left of the pyramid's single zoom-0 tile.
function loadThumb(
  client: Parameters<typeof loadImageFiles>[0],
  image: { id: string; width: number; height: number },
) {
  let thumb = thumbs.get(image.id);
  if (!thumb) {
    thumb = (async () => {
      const key = sourceKeyOf(await loadImageFiles(client, image.id));
      if (!key) return null;
      const blob = await getTileBlob(`slippymaps/${key}/0/0/0.png`, {
        imageId: image.id,
        width: image.width,
        height: image.height,
      });
      const bitmap = await createImageBitmap(blob);
      const maxZ = Math.max(
        0,
        Math.ceil(Math.log2(Math.max(image.width, image.height) / TILE_SIZE)),
      );
      const scale = 2 ** -maxZ;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas
        .getContext('2d')
        ?.drawImage(
          bitmap,
          0,
          0,
          canvas.width,
          canvas.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      return canvas.toDataURL('image/jpeg', 0.7);
    })().catch(() => {
      thumbs.delete(image.id);
      return null;
    });
    thumbs.set(image.id, thumb);
    for (const oldest of thumbs.keys()) {
      if (thumbs.size <= 500) break;
      thumbs.delete(oldest);
    }
  }
  return thumb;
}

export default function ImageThumb({
  image,
  className,
}: {
  image: { id: string; width?: number | null; height?: number | null };
  className?: string;
}) {
  const { client } = useContext(GlobalContext)!;
  const [src, setSrc] = useState<string | null>(null);
  const { id, width, height } = image;

  useEffect(() => {
    if (!width || !height) return;
    let cancelled = false;
    setSrc(null);
    loadThumb(client as Parameters<typeof loadImageFiles>[0], {
      id,
      width,
      height,
    }).then((url) => !cancelled && setSrc(url));
    return () => {
      cancelled = true;
    };
  }, [client, id, width, height]);

  return (
    <div className={className}>
      {src && <img src={src} alt='' className='h-full w-full object-cover' />}
    </div>
  );
}
