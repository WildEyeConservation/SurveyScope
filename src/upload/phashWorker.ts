/// <reference lib="webworker" />
import { bmvbhash } from 'blockhash-core';
import exifr from 'exifr';

interface HashRequest {
  id: number;
  file: File;
}

interface HashSuccess {
  id: number;
  phash: string;
}

interface HashFailure {
  id: number;
  error: string;
}

type HashResponse = HashSuccess | HashFailure;

const HASH_BITS = 16; // 256-bit hash → 64 hex chars (16×16 grid)
const RESIZE_TARGET = 256;

async function decodeForHashing(file: File): Promise<ImageBitmap> {
  // Fast path: most survey JPEGs embed a small EXIF thumbnail (~160×120).
  // Decoding it is ~10ms vs 500ms–2s for a full 25MB JPEG.
  let thumbBytes: ArrayBuffer | undefined;
  try {
    thumbBytes = (await exifr.thumbnail(file)) as ArrayBuffer | undefined;
  } catch {
    thumbBytes = undefined;
  }

  if (thumbBytes && thumbBytes.byteLength > 0) {
    const blob = new Blob([thumbBytes], { type: 'image/jpeg' });
    return createImageBitmap(blob, {
      resizeWidth: RESIZE_TARGET,
      resizeHeight: RESIZE_TARGET,
      resizeQuality: 'medium',
    });
  }

  // Fallback: decode the full file but cap memory by resizing during decode.
  return createImageBitmap(file, {
    resizeWidth: RESIZE_TARGET,
    resizeHeight: RESIZE_TARGET,
    resizeQuality: 'medium',
  });
}

async function computePhash(file: File): Promise<string> {
  const bitmap = await decodeForHashing(file);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return bmvbhash(
      {
        width: imageData.width,
        height: imageData.height,
        data: imageData.data,
      },
      HASH_BITS,
    );
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (event: MessageEvent<HashRequest>) => {
  const { id, file } = event.data;
  try {
    const phash = await computePhash(file);
    const response: HashResponse = { id, phash };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: HashResponse = {
      id,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};

export {};
