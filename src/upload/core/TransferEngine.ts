import { isAbortError, uploadOriginal } from '../../storage/upload';
import type { ImageData } from '../../types/ImageData';
import { PhashIndex } from '../phashDedup';
import { PhashService } from '../phashService';
import { runPool } from './pool';
import type { RecordWriter } from './RecordWriter';
import { classifyError, errorMessage } from './retry';
import type { UploadStateStore } from './persistence';
import type { DuplicateRecord, ItemFailure } from './types';

const SEED_CONCURRENCY = 5;
const UPLOAD_CONCURRENCY = 6;
const BYTES_REPORT_INTERVAL_MS = 300;

export type { ItemFailure };

export interface TransferInput {
  projectId: string;
  /** Files already on S3 that are missing DB records. */
  seedPaths: string[];
  /** Files that still need uploading to S3. */
  uploadImages: ImageData[];
  fileByPath: Map<string, File>;
  imageByPath: Map<string, ImageData>;
  /** originalPaths that already have DB records; used as a claim set. */
  knownDbPaths: Set<string>;
  makeKey: (originalPath: string) => string;
  phashIndex: PhashIndex<{ originalPath: string }>;
  /** Paths whose phash was seeded from existing DB records. */
  dbSeededPaths: Set<string>;
  /** Physical CCW correction to apply to the stored image at this path. */
  rotationForPath: (originalPath: string) => number;
}

export interface TransferCallbacks {
  onItemProcessed: () => void;
  onDuplicate: (dup: DuplicateRecord) => void;
  /** Total bytes transferred to S3 so far in this run (throttled). */
  onBytesUploaded: (bytes: number) => void;
}

interface PhashCheck {
  phash: string | null;
  duplicateOf: string | null;
  scope: 'batch' | 'db' | null;
}

// Structural type covering both uploadData overload results (key/path).
interface UploadTask {
  cancel: () => void;
  result: Promise<unknown>;
}

// Runs DB seeding and S3 upload stages; fatal errors abort immediately.
export class TransferEngine {
  private inFlight = new Set<UploadTask>();
  private failures: ItemFailure[] = [];
  private completedBytes = 0;
  private inFlightBytes = new Map<string, number>();
  private lastBytesReport = 0;

  constructor(
    private recordWriter: RecordWriter,
    private phashService: PhashService,
    private store: UploadStateStore,
    private callbacks: TransferCallbacks,
    private signal: AbortSignal
  ) {}

  async run(input: TransferInput): Promise<{ failures: ItemFailure[] }> {
    this.failures = [];
    const onAbort = () => {
      // Cancel in-flight S3 transfers so pause takes effect immediately.
      for (const task of this.inFlight) {
        try {
          task.cancel();
        } catch {
          /* task may already be settled */
        }
      }
    };
    this.signal.addEventListener('abort', onAbort, { once: true });
    try {
      await runPool(
        input.seedPaths,
        SEED_CONCURRENCY,
        (path) => this.seedItem(path, input),
        this.signal
      );
      await runPool(
        input.uploadImages,
        UPLOAD_CONCURRENCY,
        (image) => this.uploadItem(image, input),
        this.signal
      );
    } finally {
      this.signal.removeEventListener('abort', onAbort);
    }
    return { failures: this.failures };
  }

  // Hash a file and atomically test-and-insert against the shared index.
  // findMatch+add is synchronous, so concurrent workers can't both classify
  // the same hash as unique.
  private async checkPhashDup(
    file: File,
    originalPath: string,
    input: TransferInput
  ): Promise<PhashCheck> {
    const phash = await this.phashService.hash(file);
    if (!phash) return { phash: null, duplicateOf: null, scope: null };
    const existing = input.phashIndex.findMatch(phash);
    if (existing && existing.payload.originalPath !== originalPath) {
      // Anything seeded from DB at session start is "db"; anything added
      // during the run is "batch".
      const scope: 'batch' | 'db' = input.dbSeededPaths.has(
        existing.payload.originalPath
      )
        ? 'db'
        : 'batch';
      return { phash, duplicateOf: existing.payload.originalPath, scope };
    }
    input.phashIndex.add(phash, { originalPath });
    return { phash, duplicateOf: null, scope: null };
  }

  private reportBytes(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastBytesReport < BYTES_REPORT_INTERVAL_MS) {
      return;
    }
    this.lastBytesReport = now;
    let total = this.completedBytes;
    for (const bytes of this.inFlightBytes.values()) total += bytes;
    this.callbacks.onBytesUploaded(total);
  }

  private handleItemError(originalPath: string, err: unknown): void {
    if (isAbortError(err) || this.signal.aborted) return;
    console.error(`Error processing image ${originalPath}:`, err);
    if (classifyError(err) === 'fatal') {
      // Fatal errors should surface immediately, not retry in the pool.
      throw err;
    }
    this.failures.push({ originalPath, message: errorMessage(err) });
  }

  /** Creates DB records for a file that is already on S3. */
  private async seedItem(
    originalPath: string,
    input: TransferInput
  ): Promise<void> {
    try {
      const imageData = input.imageByPath.get(originalPath);
      if (!imageData) return;

      // Claim this path before any async work so no other worker creates it.
      if (input.knownDbPaths.has(originalPath)) return;
      input.knownDbPaths.add(originalPath);

      const fileObj = input.fileByPath.get(originalPath);
      const fileType = fileObj?.type ?? 'application/octet-stream';

      // Without a file object we cannot hash; seed the record anyway.
      let phashForRecord: string | undefined;
      if (fileObj) {
        const { phash, duplicateOf, scope } = await this.checkPhashDup(
          fileObj,
          originalPath,
          input
        );
        if (duplicateOf) {
          this.callbacks.onDuplicate({
            originalPath,
            matchedPath: duplicateOf,
            scope: scope!,
          });
          return;
        }
        phashForRecord = phash ?? undefined;
      }

      const created = await this.recordWriter.createImageRecords(
        imageData,
        fileType,
        phashForRecord
      );
      this.store.addCreatedImage(created);
    } catch (err) {
      this.handleItemError(originalPath, err);
    } finally {
      this.callbacks.onItemProcessed();
    }
  }

  /** Uploads a file to S3, then creates its DB records. */
  private async uploadItem(
    image: ImageData,
    input: TransferInput
  ): Promise<void> {
    let cancelled = false;
    try {
      const file = input.fileByPath.get(image.originalPath);
      if (!file) {
        // Verification cannot succeed while a manifest file is unavailable.
        this.failures.push({
          originalPath: image.originalPath,
          message: 'Not found in the selected folder',
        });
        return;
      }

      // Phash check before uploading so duplicates never spend bandwidth.
      const { phash, duplicateOf, scope } = await this.checkPhashDup(
        file,
        image.originalPath,
        input
      );
      if (duplicateOf) {
        this.callbacks.onDuplicate({
          originalPath: image.originalPath,
          matchedPath: duplicateOf,
          scope: scope!,
        });
        return;
      }

      const task = uploadOriginal({
        projectId: input.projectId,
        originalPath: image.originalPath,
        file,
        rotation: input.rotationForPath(image.originalPath),
        onProgress: (transferredBytes) => {
          this.inFlightBytes.set(image.originalPath, transferredBytes);
          this.reportBytes();
        },
      });
      this.inFlight.add(task);
      try {
        await task.result;
        this.completedBytes += file.size;
      } catch (err) {
        if (isAbortError(err)) {
          cancelled = true;
          return;
        }
        throw err;
      } finally {
        this.inFlight.delete(task);
        this.inFlightBytes.delete(image.originalPath);
        this.reportBytes(true);
      }
      this.store.markUploaded(image.originalPath);

      // Claim this path before any async work so no other worker creates it.
      if (input.knownDbPaths.has(image.originalPath)) return;
      input.knownDbPaths.add(image.originalPath);

      const created = await this.recordWriter.createImageRecords(
        image,
        file.type,
        phash ?? undefined
      );
      this.store.addCreatedImage(created);
    } catch (err) {
      this.handleItemError(image.originalPath, err);
    } finally {
      if (!cancelled) {
        this.callbacks.onItemProcessed();
      }
    }
  }
}
