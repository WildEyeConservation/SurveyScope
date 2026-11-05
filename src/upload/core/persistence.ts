import localforage from 'localforage';
import type {
  CreatedImage,
  ImageData,
  UploadedFiles,
} from '../../types/ImageData';
import type { UploadMetadata } from './types';

// Keep store names stable so interrupted uploads remain resumable.
export const fileStore = localforage.createInstance({
  name: 'fileStore',
  storeName: 'files',
});

export const fileStoreUploaded = localforage.createInstance({
  name: 'fileStoreUploaded',
  storeName: 'filesUploaded',
});

export const createdImagesStore = localforage.createInstance({
  name: 'createdImagesStore',
  storeName: 'createdImages',
});

export const metadataStore = localforage.createInstance({
  name: 'metadataStore',
  storeName: 'metadata',
});

const FLUSH_INTERVAL_MS = 1000;

// Per-session store view with serialized, debounced writes.
export class UploadStateStore {
  private uploadedPaths: string[] = [];
  private createdImages: CreatedImage[] = [];
  private writeChain: Promise<void> = Promise.resolve();
  private uploadedFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private createdFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private projectId: string) {}

  async getImages(): Promise<ImageData[]> {
    return ((await fileStore.getItem(this.projectId)) as ImageData[]) ?? [];
  }

  setImages(images: ImageData[]): Promise<void> {
    return this.enqueue(async () => {
      await fileStore.setItem(this.projectId, images);
    });
  }

  async loadUploadedPaths(): Promise<string[]> {
    this.uploadedPaths =
      ((await fileStoreUploaded.getItem(this.projectId)) as UploadedFiles) ??
      [];
    return [...this.uploadedPaths];
  }

  /** Replaces the uploaded set (used when seeding from an S3 listing). */
  setUploadedPaths(paths: string[]): Promise<void> {
    this.uploadedPaths = [...paths];
    return this.flushUploadedNow();
  }

  /** Records one uploaded file; the write is debounced and serialized. */
  markUploaded(originalPath: string): void {
    this.uploadedPaths.push(originalPath);
    if (this.uploadedFlushTimer === null) {
      this.uploadedFlushTimer = setTimeout(() => {
        this.uploadedFlushTimer = null;
        void this.flushUploadedNow();
      }, FLUSH_INTERVAL_MS);
    }
  }

  async loadCreatedImages(): Promise<CreatedImage[]> {
    this.createdImages =
      ((await createdImagesStore.getItem(this.projectId)) as CreatedImage[]) ??
      [];
    return [...this.createdImages];
  }

  setCreatedImages(images: CreatedImage[]): Promise<void> {
    this.createdImages = [...images];
    return this.flushCreatedNow();
  }

  addCreatedImage(image: CreatedImage): void {
    this.createdImages.push(image);
    if (this.createdFlushTimer === null) {
      this.createdFlushTimer = setTimeout(() => {
        this.createdFlushTimer = null;
        void this.flushCreatedNow();
      }, FLUSH_INTERVAL_MS);
    }
  }

  async getMetadata(): Promise<UploadMetadata | null> {
    return (await metadataStore.getItem(
      this.projectId,
    )) as UploadMetadata | null;
  }

  /** Forces all pending debounced writes out; call before finalize/pause. */
  async flush(): Promise<void> {
    if (this.uploadedFlushTimer !== null) {
      clearTimeout(this.uploadedFlushTimer);
      this.uploadedFlushTimer = null;
    }
    if (this.createdFlushTimer !== null) {
      clearTimeout(this.createdFlushTimer);
      this.createdFlushTimer = null;
    }
    await this.flushUploadedNow();
    await this.flushCreatedNow();
  }

  async clearProject(): Promise<void> {
    // flush() cancels the debounce timers so no write can fire after the
    // removes below and resurrect the cleared keys.
    await this.flush();
    await fileStore.removeItem(this.projectId);
    await fileStoreUploaded.removeItem(this.projectId);
    await metadataStore.removeItem(this.projectId);
    await createdImagesStore.removeItem(this.projectId);
  }

  private flushUploadedNow(): Promise<void> {
    const snapshot = [...this.uploadedPaths];
    return this.enqueue(async () => {
      await fileStoreUploaded.setItem(this.projectId, snapshot);
    });
  }

  private flushCreatedNow(): Promise<void> {
    const snapshot = [...this.createdImages];
    return this.enqueue(async () => {
      await createdImagesStore.setItem(this.projectId, snapshot);
    });
  }

  private enqueue(write: () => Promise<void>): Promise<void> {
    this.writeChain = this.writeChain.then(write, write);
    return this.writeChain;
  }
}

/** Clears every store entry for a project (used by the delete flow). */
export async function clearProjectStores(projectId: string): Promise<void> {
  await fileStore.removeItem(projectId);
  await fileStoreUploaded.removeItem(projectId);
  await metadataStore.removeItem(projectId);
  await createdImagesStore.removeItem(projectId);
}
