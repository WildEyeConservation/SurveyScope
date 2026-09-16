import type { ImageData } from '../../types/ImageData';
import {
  orientationCorrectionFor,
  orientationGroupForDimensions,
} from '../../types/Orientation';
import { fetchAllPaginatedResults } from '../../utils';
import { logAdminAction } from '../../utils/adminActionLogger';
import { PhashIndex } from '../phashDedup';
import { PhashService } from '../phashService';
import { buildCameraResolver, type CameraResolver } from './cameras';
import { ElevationService } from './elevation';
import { Finalizer } from './Finalizer';
import { UploadStateStore } from './persistence';
import { runPool, sleep } from './pool';
import { getProjectKeyInfo, type ProjectKeyInfo } from './projectKeys';
import { RecordWriter } from './RecordWriter';
import {
  backoffDelayMs,
  classifyError,
  errorMessage,
  FatalUploadError,
} from './retry';
import { listUploadedOriginalPaths } from './s3';
import { TransferEngine, type TransferInput } from './TransferEngine';
import { removeDirectoryHandle } from './dirHandles';
import {
  ACTIVE_PHASES,
  type BlockedItem,
  type DuplicateRecord,
  type ItemFailure,
  type PauseReason,
  type SessionPhase,
  type SessionSnapshot,
  type UploadBackend,
  type UploadClient,
} from './types';

const MAX_SESSION_ATTEMPTS = 20;
const THROUGHPUT_WINDOW_MS = 30000;
const SKIP_DELETE_CONCURRENCY = 5;
const MAX_NO_PROGRESS_ATTEMPTS = 3;

const RESUMABLE_PHASES: SessionPhase[] = ['paused', 'failed', 'blocked'];

export interface StartInput {
  client: UploadClient;
  backend: UploadBackend;
  projectId: string;
  userId: string;
  files: File[];
}

interface InternalSession {
  projectId: string;
  client: UploadClient;
  backend: UploadBackend;
  userId: string;
  fileByPath: Map<string, File>;
  store: UploadStateStore;
  elevation: ElevationService;
  phase: SessionPhase;
  pauseReason?: PauseReason;
  errorMessage?: string;
  processed: number;
  total: number;
  bytesUploaded: number;
  bytesTotal: number;
  throughputBps: number | null;
  etaSeconds: number | null;
  byteSamples: { t: number; bytes: number }[];
  failures: ItemFailure[];
  retryDelayMs: number;
  attempt: number;
  controller: AbortController;
  duplicates: DuplicateRecord[];
  startLogged: boolean;
  /** Files missing from S3 after the previous verification. */
  lastRemainingCount: number | null;
  /** Consecutive verify rounds that left that count unchanged. */
  noProgressAttempts: number;
  /** Files awaiting a retry-or-skip decision. */
  blockedItems: BlockedItem[];
  releaseLock: () => void;
}

interface PreparedPlan {
  keyInfo: ProjectKeyInfo;
  imageSetId: string;
  input: TransferInput;
  cameras: CameraResolver;
}

type Listener = (snapshot: SessionSnapshot | null) => void;

// Owns upload state outside React so remounts do not kill transfers.
export class UploadOrchestrator {
  private session: InternalSession | null = null;
  private listeners = new Set<Listener>();
  // Cached so getSnapshot is referentially stable for useSyncExternalStore.
  private cachedSnapshot: SessionSnapshot | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', () => {
        if (this.session && ACTIVE_PHASES.includes(this.session.phase)) {
          this.pause('offline');
        }
      });
      window.addEventListener('online', () => {
        if (this.session?.phase === 'paused' &&
            this.session.pauseReason === 'offline') {
          this.resume(this.session.projectId);
        }
      });
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SessionSnapshot | null {
    return this.cachedSnapshot;
  }

  isActive(projectId?: string): boolean {
    if (!this.session) return false;
    if (projectId && this.session.projectId !== projectId) return false;
    return ACTIVE_PHASES.includes(this.session.phase);
  }

  /** True when a stopped session for this project can resume in memory. */
  canResumeInMemory(projectId: string): boolean {
    return (
      this.session !== null &&
      this.session.projectId === projectId &&
      RESUMABLE_PHASES.includes(this.session.phase) &&
      this.session.fileByPath.size > 0
    );
  }

  start(input: StartInput): void {
    if (this.session && ACTIVE_PHASES.includes(this.session.phase)) {
      if (this.session.projectId === input.projectId) return;
      console.warn(
        `Upload for project ${this.session.projectId} is active; ignoring start for ${input.projectId}`
      );
      return;
    }

    // Refresh file handles when the user re-picks a paused/failed upload.
    if (this.session && this.session.projectId === input.projectId) {
      for (const file of input.files) {
        this.session.fileByPath.set(file.webkitRelativePath, file);
      }
      this.resume(input.projectId);
      return;
    }

    this.session?.releaseLock();

    const session: InternalSession = {
      projectId: input.projectId,
      client: input.client,
      backend: input.backend,
      userId: input.userId,
      fileByPath: new Map(
        input.files.map((f) => [f.webkitRelativePath, f])
      ),
      store: new UploadStateStore(input.projectId),
      elevation: new ElevationService({
        bucketName: input.backend.custom.generalBucketName,
      }),
      phase: 'idle',
      processed: 0,
      total: 0,
      bytesUploaded: 0,
      bytesTotal: 0,
      throughputBps: null,
      etaSeconds: null,
      byteSamples: [],
      failures: [],
      retryDelayMs: 0,
      attempt: 1,
      controller: new AbortController(),
      duplicates: [],
      startLogged: false,
      lastRemainingCount: null,
      noProgressAttempts: 0,
      blockedItems: [],
      releaseLock: () => {},
    };
    this.session = session;
    void this.beginSession(session);
  }

  /** Hold the per-project Web Lock for the full upload session. */
  private async beginSession(session: InternalSession): Promise<void> {
    const acquired = await acquireProjectLock(session);
    if (!acquired) {
      session.errorMessage =
        'This survey is already being uploaded in another tab or window.';
      session.pauseReason = 'fatal-error';
      this.setPhase(session, 'failed');
      return;
    }
    await this.runLoop(session);
  }

  pause(reason: PauseReason = 'user'): void {
    const session = this.session;
    if (!session || !ACTIVE_PHASES.includes(session.phase)) return;
    session.pauseReason = reason;
    session.controller.abort();
  }

  /** Resumes a paused/failed/blocked in-memory session. False if none. */
  resume(projectId: string): boolean {
    const session = this.session;
    if (
      !session ||
      session.projectId !== projectId ||
      !RESUMABLE_PHASES.includes(session.phase)
    ) {
      return false;
    }
    this.rearmSession(session);
    void this.runLoop(session);
    return true;
  }

  /**
   * Drops the blocked files from the survey and finishes the upload without
   * them: the manifest entries go, along with any Image records that point at
   * bytes which never reached storage. Returns false when nothing is blocked.
   */
  skipBlocked(): boolean {
    const session = this.session;
    if (!session || session.phase !== 'blocked') return false;
    const skipped = session.blockedItems;
    if (skipped.length === 0) return false;

    this.rearmSession(session);
    void this.dropAndRun(session, skipped);
    return true;
  }

  private rearmSession(session: InternalSession): void {
    session.pauseReason = undefined;
    session.errorMessage = undefined;
    session.blockedItems = [];
    session.attempt = 1;
    session.retryDelayMs = 0;
    // A resume may include newly selected files.
    session.lastRemainingCount = null;
    session.noProgressAttempts = 0;
    session.controller = new AbortController();
  }

  private async dropAndRun(
    session: InternalSession,
    skipped: BlockedItem[]
  ): Promise<void> {
    this.setPhase(session, 'preparing');
    try {
      await this.dropSkippedImages(session, skipped);
    } catch (err) {
      console.error('Failed to drop skipped images:', err);
      session.errorMessage = `Could not remove the skipped files: ${errorMessage(err)}`;
      session.blockedItems = skipped;
      this.setPhase(session, 'blocked');
      return;
    }
    await this.runLoop(session);
  }

  /**
   * Removes skipped paths from the manifest and deletes any Image records (and
   * their memberships/files) created for them, so downstream processing never
   * sees an image whose original is not in storage.
   */
  private async dropSkippedImages(
    session: InternalSession,
    skipped: BlockedItem[]
  ): Promise<void> {
    const paths = new Set(skipped.map((item) => item.originalPath));

    // Delete dependent records before their parent, then update the manifest.
    const dbImages = (await fetchAllPaginatedResults(
      session.client.models.Image.imagesByProjectId,
      {
        projectId: session.projectId,
        selectionSet: ['id', 'originalPath', 'memberships.id', 'files.id'],
        limit: 10000,
      }
    )) as {
      id: string;
      originalPath: string;
      memberships: { id: string }[];
      files: { id: string }[];
    }[];

    const orphans = dbImages.filter((img) => paths.has(img.originalPath));
    if (orphans.length > 0) {
      await runPool(orphans, SKIP_DELETE_CONCURRENCY, async (img) => {
        for (const m of img.memberships ?? []) {
          assertMutationSucceeded(
            await session.client.models.ImageSetMembership.delete({ id: m.id }),
            `delete image-set membership ${m.id}`
          );
        }
        for (const f of img.files ?? []) {
          assertMutationSucceeded(
            await session.client.models.ImageFile.delete({ id: f.id }),
            `delete image file ${f.id}`
          );
        }
        assertMutationSucceeded(
          await session.client.models.Image.delete({ id: img.id }),
          `delete image ${img.id}`
        );
      });
    }

    const manifest = await session.store.getImages();
    await session.store.setImages(
      manifest.filter((img) => !paths.has(img.originalPath))
    );

    const keyInfo = await getProjectKeyInfo(session.client, session.projectId);
    if (keyInfo.organizationId) {
      const lines = skipped.map(
        (item) => `- ${item.originalPath} (${item.reason})`
      );
      await logAdminAction(
        session.client,
        session.userId,
        truncateForLog(
          `Continued upload without ${skipped.length} image${
            skipped.length === 1 ? '' : 's'
          } that could not be uploaded:`,
          lines
        ),
        session.projectId,
        keyInfo.organizationId
      ).catch(() => {
        /* noop: audit logging must not block the upload */
      });
    }
  }

  /** Aborts and discards the session (delete flow). Stores are untouched. */
  cancel(): void {
    const session = this.session;
    if (!session) return;
    session.pauseReason = undefined;
    session.controller.abort();
    this.setPhase(session, 'cancelled');
    session.releaseLock();
    this.clearSession();
  }

  /** Drops a stopped session (e.g. user dismisses the error pill). */
  discard(): void {
    const session = this.session;
    if (!session || ACTIVE_PHASES.includes(session.phase)) return;
    session.releaseLock();
    this.clearSession();
  }

  private clearSession(): void {
    this.session = null;
    this.cachedSnapshot = null;
    for (const listener of this.listeners) {
      try {
        listener(null);
      } catch (err) {
        console.error('Upload listener failed:', err);
      }
    }
  }

  private async runLoop(session: InternalSession): Promise<void> {
    for (;;) {
      let phashService: PhashService | null = null;
      try {
        this.setPhase(session, 'preparing');
        const plan = await this.prepare(session);
        if (await this.handleInterrupt(session)) return;

        this.setPhase(session, 'uploading');
        phashService = new PhashService(4);
        const engine = new TransferEngine(
          new RecordWriter({
            client: session.client,
            projectId: session.projectId,
            organizationId: plan.keyInfo.organizationId,
            imageSetId: plan.imageSetId,
            makeKey: plan.keyInfo.makeKey,
            elevation: session.elevation,
            cameras: plan.cameras,
            signal: session.controller.signal,
          }),
          phashService,
          session.store,
          {
            onItemProcessed: () => {
              session.processed += 1;
              this.emit(session);
            },
            onDuplicate: (dup) => {
              if (
                !session.duplicates.some(
                  (d) => d.originalPath === dup.originalPath
                )
              ) {
                session.duplicates.push(dup);
              }
            },
            onBytesUploaded: (bytes) => {
              session.bytesUploaded = bytes;
              updateThroughput(session);
              this.emit(session);
            },
          },
          session.controller.signal
        );
        const { failures } = await engine.run(plan.input);
        session.failures = failures;
        phashService.destroy();
        phashService = null;
        await session.store.flush();
        if (await this.handleInterrupt(session)) return;

        // Prune hash duplicates skipped by the transfer engine.
        await this.pruneDuplicates(session);

        // Verify every manifest item is on S3 before finalizing.
        const { remainingPaths, uploadedPaths } =
          await this.verify(session, plan.keyInfo);
        const remainingCount = remainingPaths.length;
        if (remainingCount > 0 || failures.length > 0) {
          // Missing local files cannot recover without user action. Otherwise,
          // allow several verification rounds with no progress before blocking.
          if (remainingCount === session.lastRemainingCount) {
            session.noProgressAttempts += 1;
          } else {
            session.noProgressAttempts = 0;
          }
          session.lastRemainingCount = remainingCount;
          const unwinnable = remainingPaths.every(
            (path) => !session.fileByPath.has(path)
          );
          if (
            remainingCount > 0 &&
            (unwinnable ||
              session.noProgressAttempts >= MAX_NO_PROGRESS_ATTEMPTS)
          ) {
            console.warn(
              `Upload blocked on ${remainingCount} file(s) for project ${session.projectId}:`,
              remainingPaths
            );
            session.blockedItems = buildBlockedItems(
              session,
              remainingPaths,
              failures
            );
            session.errorMessage = `${remainingCount} image${
              remainingCount === 1 ? '' : 's'
            } could not be uploaded.`;
            this.setPhase(session, 'blocked');
            return;
          }
          const failureNote =
            failures.length > 0
              ? `; ${failures.length} failed (first: ${failures[0].message})`
              : '';
          throw new Error(
            `${Math.max(remainingCount, failures.length)} file(s) not uploaded yet${failureNote}`
          );
        }
        session.lastRemainingCount = null;

        this.setPhase(session, 'finalizing');
        const finalizer = new Finalizer({
          client: session.client,
          backend: session.backend,
          projectId: session.projectId,
          imageSetId: plan.imageSetId,
          keyInfo: plan.keyInfo,
          store: session.store,
          userId: session.userId,
        });
        await finalizer.run(uploadedPaths, session.duplicates);

        await session.store.clearProject();
        await removeDirectoryHandle(session.projectId).catch(() => {});
        this.setPhase(session, 'completed');
        session.releaseLock();
        this.clearSession();
        return;
      } catch (err) {
        phashService?.destroy();
        await session.store.flush().catch(() => {});
        if (await this.handleInterrupt(session)) return;

        const isFatal = classifyError(err) === 'fatal';
        const attemptsExhausted = session.attempt >= MAX_SESSION_ATTEMPTS;
        if (isFatal || attemptsExhausted) {
          console.error('Upload session failed:', err);
          session.errorMessage = attemptsExhausted && !isFatal
            ? `Upload kept failing after ${MAX_SESSION_ATTEMPTS} attempts. Last error: ${errorMessage(err)}`
            : errorMessage(err);
          session.pauseReason = 'fatal-error';
          this.setPhase(session, 'failed');
          return;
        }

        session.attempt += 1;
        session.retryDelayMs = backoffDelayMs(session.attempt);
        console.warn(
          `Upload attempt ${session.attempt - 1} failed (${errorMessage(err)}); retrying in ${Math.round(session.retryDelayMs / 1000)}s`,
          err
        );
        this.setPhase(session, 'waiting-retry');
        await sleep(session.retryDelayMs, session.controller.signal);
        session.retryDelayMs = 0;
        if (await this.handleInterrupt(session)) return;
      }
    }
  }

  /** Build the work plan from S3, DB state, and the persisted manifest. */
  private async prepare(session: InternalSession): Promise<PreparedPlan> {
    const { client, projectId, store } = session;

    // Best-effort start ping; the UI heartbeat keeps it fresh after this.
    try {
      await client.models.Project.update({ id: projectId, status: 'uploading' });
      try {
        await client.mutations.updateProjectMemberships({ projectId });
      } catch {
        /* noop: membership ping best-effort */
      }
    } catch {
      /* noop */
    }

    const keyInfo = await getProjectKeyInfo(client, projectId);

    const {
      data: [imageSet],
    } = await client.models.ImageSet.imageSetsByProjectId({ projectId });
    if (!imageSet?.id) {
      throw new FatalUploadError(
        `No image set found for project ${projectId}`
      );
    }

    const storedImages = await store.getImages();
    const uploadMetadata = await store.getMetadata();
    const cameras = await buildCameraResolver(
      client,
      projectId,
      uploadMetadata?.folderCameraMapping ?? {}
    );
    const storedImageByPath = new Map(
      storedImages.map((image) => [image.originalPath, image])
    );
    const rotationForPath = (originalPath: string): number => {
      const cameraName = cameras.resolveCameraName(originalPath);
      const image = storedImageByPath.get(originalPath);
      if (!cameraName || !image) return 0;

      // New manifests preserve the pre-correction shape explicitly. The
      // dimension fallback keeps older interrupted uploads resumable.
      const orientationGroup =
        image.sourceOrientationGroup ??
        orientationGroupForDimensions(image.width, image.height);
      return orientationCorrectionFor(
        uploadMetadata?.rotations,
        cameraName,
        orientationGroup
      );
    };

    // Drop manifest entries without valid GPS (they can't produce usable
    // Image records) and persist the pruned manifest.
    const { validImages, invalidPaths } = storedImages.reduce(
      (acc: { validImages: ImageData[]; invalidPaths: string[] }, image) => {
        if (hasValidLatLng(image.latitude, image.longitude)) {
          acc.validImages.push(image);
        } else {
          acc.invalidPaths.push(image.originalPath);
        }
        return acc;
      },
      { validImages: [], invalidPaths: [] }
    );
    if (invalidPaths.length > 0) {
      console.warn(
        `Skipping ${invalidPaths.length} image${
          invalidPaths.length === 1 ? '' : 's'
        } with missing GPS coordinates:`,
        invalidPaths
      );
      await store.setImages(validImages);
    }

    const localPaths = new Set(validImages.map((img) => img.originalPath));
    const s3Files = await listUploadedOriginalPaths({
      projectId,
      keyInfo,
      localPaths,
    });

    const dbRawImages = (await fetchAllPaginatedResults(
      client.models.Image.imagesByProjectId,
      {
        projectId,
        selectionSet: ['id', 'originalPath', 'timestamp', 'cameraId', 'phash'],
        limit: 10000,
      }
    )) as {
      id: string;
      originalPath: string;
      timestamp: number;
      cameraId?: string | null;
      phash?: string | null;
    }[];

    // Seed the in-memory phash index from existing DB records. The index is
    // shared by both seed and upload workers.
    const phashIndex = new PhashIndex<{ originalPath: string }>(4);
    const dbSeededPaths = new Set<string>();
    for (const img of dbRawImages) {
      if (img.phash) {
        phashIndex.add(img.phash, { originalPath: img.originalPath });
        dbSeededPaths.add(img.originalPath);
      }
    }

    // Track which files are already on S3 / already have DB records.
    const uploadedFiles = Array.from(s3Files);
    await store.setUploadedPaths(uploadedFiles);

    const knownDbPaths = new Set(dbRawImages.map((img) => img.originalPath));
    await store.setCreatedImages(
      dbRawImages.map((img) => ({
        id: img.id,
        originalPath: img.originalPath,
        timestamp: img.timestamp,
        cameraId: img.cameraId ?? undefined,
      }))
    );

    // DB-seed tasks normally reuse files already on S3. If a correction is
    // requested, re-upload the local source instead: a stale upload may have
    // put the original bytes on S3 before the normalization metadata existed,
    // so no upload-trigger event would otherwise arrive to rotate it.
    const seedPaths = uploadedFiles.filter(
      (path) => !knownDbPaths.has(path) && rotationForPath(path) === 0
    );
    const uploadImages = validImages.filter(
      (image) =>
        !s3Files.has(image.originalPath) ||
        (!knownDbPaths.has(image.originalPath) &&
          rotationForPath(image.originalPath) !== 0)
    );

    session.total = seedPaths.length + uploadImages.length;
    session.processed = 0;
    session.failures = [];
    session.bytesUploaded = 0;
    session.bytesTotal = uploadImages.reduce(
      (acc, img) => acc + (session.fileByPath.get(img.originalPath)?.size ?? 0),
      0
    );
    session.byteSamples = [];
    session.throughputBps = null;
    session.etaSeconds = null;
    this.emit(session);

    if (
      keyInfo.organizationId &&
      session.total > 0 &&
      !session.startLogged
    ) {
      session.startLogged = true;
      const uploadBytes = uploadImages.reduce(
        (acc, img) => acc + (session.fileByPath.get(img.originalPath)?.size ?? 0),
        0
      );
      const seedNote =
        seedPaths.length > 0
          ? `, ${seedPaths.length} already on S3 awaiting DB sync`
          : '';
      await logAdminAction(
        client,
        session.userId,
        `Started upload: ${uploadImages.length} file${
          uploadImages.length === 1 ? '' : 's'
        } queued (${formatBytes(uploadBytes)})${seedNote}`,
        projectId,
        keyInfo.organizationId
      );
    }

    const imageByPath = new Map(
      validImages.map((img) => [img.originalPath, img])
    );

    return {
      keyInfo,
      imageSetId: imageSet.id,
      input: {
        seedPaths,
        uploadImages,
        fileByPath: session.fileByPath,
        imageByPath,
        knownDbPaths,
        makeKey: keyInfo.makeKey,
        phashIndex,
        dbSeededPaths,
        rotationForPath,
      },
      cameras,
    };
  }

  private async pruneDuplicates(session: InternalSession): Promise<void> {
    if (session.duplicates.length === 0) return;
    const dupePaths = new Set(session.duplicates.map((d) => d.originalPath));
    const stored = await session.store.getImages();
    const remaining = stored.filter((img) => !dupePaths.has(img.originalPath));
    if (remaining.length !== stored.length) {
      await session.store.setImages(remaining);
    }
  }

  private async verify(
    session: InternalSession,
    keyInfo: ProjectKeyInfo
  ): Promise<{ remainingPaths: string[]; uploadedPaths: Set<string> }> {
    const manifest = await session.store.getImages();
    const localPaths = new Set(manifest.map((img) => img.originalPath));
    const onS3 = await listUploadedOriginalPaths({
      projectId: session.projectId,
      keyInfo,
      localPaths,
    });
    const uploadedPaths = new Set(
      manifest
        .map((img) => img.originalPath)
        .filter((path) => onS3.has(path))
    );
    await session.store.setUploadedPaths(Array.from(uploadedPaths));
    return {
      remainingPaths: manifest
        .map((img) => img.originalPath)
        .filter((path) => !uploadedPaths.has(path)),
      uploadedPaths,
    };
  }

  /** Returns true when pause/cancel interrupted the run loop. */
  private async handleInterrupt(session: InternalSession): Promise<boolean> {
    if (!session.controller.signal.aborted) return false;
    await session.store.flush().catch(() => {});
    if (session.phase === 'cancelled') {
      // cancel() already transitioned and dropped the session.
      return true;
    }
    this.setPhase(session, 'paused');
    return true;
  }

  private setPhase(session: InternalSession, phase: SessionPhase): void {
    session.phase = phase;
    this.emit(session);
  }

  private emit(session: InternalSession): void {
    const snapshot = snapshotOf(session);
    this.cachedSnapshot = snapshot;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('Upload listener failed:', err);
      }
    }
  }
}

function snapshotOf(session: InternalSession): SessionSnapshot {
  return {
    projectId: session.projectId,
    phase: session.phase,
    pauseReason: session.pauseReason,
    errorMessage: session.errorMessage,
    processed: session.processed,
    total: session.total,
    bytesUploaded: session.bytesUploaded,
    bytesTotal: session.bytesTotal,
    throughputBps: session.throughputBps,
    etaSeconds: session.etaSeconds,
    failures: session.failures,
    blocked: session.blockedItems,
    retryDelayMs: session.retryDelayMs,
    attempt: session.attempt,
  };
}

/** Builds the user-facing reason for each path still missing from storage. */
function buildBlockedItems(
  session: InternalSession,
  remainingPaths: string[],
  failures: ItemFailure[]
): BlockedItem[] {
  const failureByPath = new Map(
    failures.map((failure) => [failure.originalPath, failure.message])
  );
  return remainingPaths.map((originalPath) => {
    const failure = failureByPath.get(originalPath);
    if (failure) {
      return {
        originalPath,
        kind: 'transfer-failed' as const,
        reason: failure,
      };
    }
    if (!session.fileByPath.has(originalPath)) {
      return {
        originalPath,
        kind: 'missing-from-folder' as const,
        reason: 'Not found in the selected folder',
      };
    }
    return {
      originalPath,
      kind: 'not-in-storage' as const,
      reason: 'Upload did not complete - file is not in storage',
    };
  });
}

function assertMutationSucceeded(
  result: { errors?: readonly { message: string }[] },
  operation: string
): void {
  if (!result.errors?.length) return;
  throw new Error(
    `Could not ${operation}: ${result.errors
      .map((error) => error.message)
      .join('; ')}`
  );
}

/** Joins a header and lines while bounding the audit-log message size. */
function truncateForLog(header: string, lines: string[]): string {
  const MAX_MESSAGE_CHARS = 30000;
  const full = `${header}\n${lines.join('\n')}`;
  if (full.length <= MAX_MESSAGE_CHARS) return full;
  const kept: string[] = [];
  let used = header.length + 1;
  for (const line of lines) {
    if (used + line.length + 1 > MAX_MESSAGE_CHARS - 64) break;
    kept.push(line);
    used += line.length + 1;
  }
  return `${header}\n${kept.join('\n')}\n…and ${
    lines.length - kept.length
  } more (truncated)`;
}

/** Moving-window (30s) byte throughput and ETA. */
function updateThroughput(session: InternalSession): void {
  const now = Date.now();
  session.byteSamples.push({ t: now, bytes: session.bytesUploaded });
  while (
    session.byteSamples.length > 2 &&
    session.byteSamples[0].t < now - THROUGHPUT_WINDOW_MS
  ) {
    session.byteSamples.shift();
  }
  const first = session.byteSamples[0];
  const last = session.byteSamples[session.byteSamples.length - 1];
  const dtSeconds = (last.t - first.t) / 1000;
  if (dtSeconds >= 2 && last.bytes > first.bytes) {
    session.throughputBps = (last.bytes - first.bytes) / dtSeconds;
    session.etaSeconds =
      session.throughputBps > 0
        ? Math.max(0, session.bytesTotal - session.bytesUploaded) /
          session.throughputBps
        : null;
  }
}

/** Exclusive per-project Web Lock; falls open if the API is unavailable. */
function acquireProjectLock(session: InternalSession): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    navigator.locks
      .request(
        `detweb-upload:${session.projectId}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            settled = true;
            resolve(false);
            return;
          }
          session.releaseLock = release;
          settled = true;
          resolve(true);
          await held;
        }
      )
      .catch((err) => {
        if (!settled) {
          console.warn('Web Lock acquisition failed; continuing without:', err);
          settled = true;
          resolve(true);
        }
      });
  });
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const hasValidLatLng = (lat: unknown, lng: unknown): boolean =>
  isFiniteNumber(lat) &&
  lat >= -90 &&
  lat <= 90 &&
  isFiniteNumber(lng) &&
  lng >= -180 &&
  lng <= 180;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(2)} ${units[i]}`;
}

// Module-level singleton: the session must outlive any React component.
export const uploadOrchestrator = new UploadOrchestrator();
