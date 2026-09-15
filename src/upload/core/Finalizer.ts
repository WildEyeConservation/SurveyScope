import { registerImageFile } from '../../storage/api';
import type { CreatedImage } from '../../types/ImageData';
import { fetchAllPaginatedResults } from '../../utils';
import { logAdminAction } from '../../utils/adminActionLogger';
import { DETECTOR_DISPATCH } from './modelDispatch';
import type { UploadStateStore } from './persistence';
import { runPool, sleep } from './pool';
import type { ProjectKeyInfo } from './projectKeys';
import { FatalUploadError, withRetry } from './retry';
import type { DuplicateRecord, UploadBackend, UploadClient } from './types';

const BATCH_SIZE = 500;
const BATCH_OVERLAP = 10;
const DUP_CONCURRENCY = 10;
const RECONCILE_CONCURRENCY = 5;

// Written by runImageRegistration for every image it has queued.
export const REGISTRATION_DISPATCH_SOURCE = 'registration-dispatch';
const REGISTRATION_CONCURRENCY = 4;
const REGISTRATION_ROUNDS = 3;
// AppSync times out at 30 s while the Lambda may still be running.
const MARKER_POLL_INTERVAL_MS = 5_000;
const MARKER_POLL_TIMEOUT_MS = 5 * 60_000;

interface DbImage {
  id: string;
  originalPath: string;
  timestamp: number;
  cameraId?: string | null;
  createdAt?: string;
  memberships: { id: string }[];
  files: { id: string; type?: string | null }[];
}

export interface FinalizerContext {
  client: UploadClient;
  backend: UploadBackend;
  projectId: string;
  imageSetId: string;
  keyInfo: ProjectKeyInfo;
  store: UploadStateStore;
  userId: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface RegistrationBatch {
  payload: CreatedImage[];
  /** First and last non-overlap image; both marked means the batch landed. */
  probeIds: string[];
}

// Post-transfer completion: dedupe, reconcile, dispatch, and audit.
export class Finalizer {
  constructor(private ctx: FinalizerContext) {}

  async run(duplicates: DuplicateRecord[]): Promise<void> {
    const { client, projectId, imageSetId, keyInfo, store, userId } = this.ctx;
    const { organizationId } = keyInfo;

    // Fetch images with their related memberships and files in one query so
    // duplicate deletion needs no extra round-trips.
    const allDbImages = (await fetchAllPaginatedResults(
      client.models.Image.imagesByProjectId,
      {
        projectId,
        selectionSet: [
          'id',
          'originalPath',
          'timestamp',
          'cameraId',
          'createdAt',
          'memberships.id',
          'files.id',
          'files.type',
        ],
        limit: 10000,
      }
    )) as DbImage[];

    const imagesByPath = new Map<string, DbImage[]>();
    for (const img of allDbImages) {
      const existing = imagesByPath.get(img.originalPath);
      if (existing) {
        existing.push(img);
      } else {
        imagesByPath.set(img.originalPath, [img]);
      }
    }

    // DB-level deduplication guardrail: keep the earliest record per path.
    const duplicateImages: DbImage[] = [];
    imagesByPath.forEach((images) => {
      if (images.length <= 1) return;
      images.sort((a, b) =>
        (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
      );
      for (let i = 1; i < images.length; i++) {
        duplicateImages.push(images[i]);
      }
    });

    if (duplicateImages.length > 0) {
      console.warn(
        `Removing ${duplicateImages.length} duplicate Image record(s) for project ${projectId}`
      );
      await runPool(duplicateImages, DUP_CONCURRENCY, async (dupImage) => {
        try {
          for (const m of dupImage.memberships ?? []) {
            await client.models.ImageSetMembership.delete({ id: m.id });
          }
          for (const f of dupImage.files ?? []) {
            await client.models.ImageFile.delete({ id: f.id });
          }
          await client.models.Image.delete({ id: dupImage.id });
        } catch (err) {
          console.error(
            `Failed to delete duplicate image ${dupImage.id}:`,
            err
          );
        }
      });
    }

    // Deduplicated list from authoritative DB records (after cleanup).
    const dedupedDbImages = Array.from(imagesByPath.values()).map(
      (images) => images[0]
    );

    // Reconcile orphaned records: Images missing their Membership or
    // ImageFile. Happens when Image.create succeeded but a follow-up create
    // failed even after retries.
    const orphanedImages = dedupedDbImages.filter(
      (img) =>
        (img.memberships ?? []).length === 0 || (img.files ?? []).length === 0
    );

    if (orphanedImages.length > 0) {
      console.warn(
        `Reconciling ${orphanedImages.length} image(s) with missing membership/file records`
      );
      await runPool(orphanedImages, RECONCILE_CONCURRENCY, async (img) => {
        try {
          if ((img.memberships ?? []).length === 0) {
            await withRetry(() =>
              client.models.ImageSetMembership.create({
                imageId: img.id,
                imageSetId,
                group: organizationId,
              })
            );
          }
          if ((img.files ?? []).length === 0) {
            await withRetry(() => registerImageFile(projectId, img.id, img.originalPath));
          }
        } catch (err) {
          console.error(`Failed to reconcile image ${img.id}:`, err);
        }
      });
    }

    // Full survey set for detectors with their own processedBy guards.
    const allProjectImages: CreatedImage[] = dedupedDbImages
      .map((img) => ({
        id: img.id,
        originalPath: img.originalPath,
        timestamp: img.timestamp,
        cameraId: img.cameraId ?? undefined,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    // Set image count from authoritative deduplicated DB records.
    await client.models.ImageSet.update({
      id: imageSetId,
      imageCount: dedupedDbImages.length,
    });

    const metadata = await store.getMetadata();
    const model = metadata?.model ?? 'manual';
    const masks = metadata?.masks ?? [];

    // Whole-project, marker-driven: not limited to this session's files.
    await this.dispatchRegistration(allProjectImages, masks);
    if (this.ctx.signal?.aborted) return;

    if (model === 'manual') {
      await client.models.Project.update({
        id: projectId,
        status: 'processing-registration',
      });
    } else {
      await this.dispatchDetector(model, allProjectImages);
    }

    await this.logDuplicates(duplicates);

    // Log session completion once all records are authoritative.
    if (organizationId) {
      await logAdminAction(
        client,
        userId,
        `Completed upload: ${dedupedDbImages.length} image${
          dedupedDbImages.length === 1 ? '' : 's'
        } now in survey`,
        projectId,
        organizationId
      );
    }

    client.mutations.updateProjectMemberships({ projectId });
  }

  /** Dispatches unmarked images, confirms via markers, retries the rest. */
  private async dispatchRegistration(
    allProjectImages: CreatedImage[],
    masks: number[][][]
  ): Promise<void> {
    const { signal, onProgress } = this.ctx;

    for (let round = 1; round <= REGISTRATION_ROUNDS; round++) {
      if (signal?.aborted) return;
      onProgress?.('Checking image registration...');
      const dispatched = await this.fetchDispatchedImageIds();
      const candidates = allProjectImages.filter(
        (img) => !dispatched.has(img.id)
      );
      if (candidates.length === 0) return;

      const registrationImages = computeRegistrationImages(
        allProjectImages,
        candidates
      );
      const candidateIds = new Set(candidates.map((img) => img.id));
      const batches = buildRegistrationBatches(registrationImages);
      console.info(
        `Registration round ${round}: ${candidates.length} image(s) not yet dispatched in ${batches.length} batch(es)`
      );

      let done = 0;
      const unconfirmed: RegistrationBatch[] = [];
      onProgress?.(
        `Starting image registration (0/${batches.length} batches)...`
      );
      await runPool(
        batches,
        REGISTRATION_CONCURRENCY,
        async (batch) => {
          const ok = await this.invokeRegistration(batch, candidateIds, masks);
          if (!ok) unconfirmed.push(batch);
          done += 1;
          onProgress?.(
            `Starting image registration (${done}/${batches.length} batches)...`
          );
        },
        signal
      );
      if (signal?.aborted) return;

      if (unconfirmed.length > 0) {
        onProgress?.(
          `Waiting for ${unconfirmed.length} registration batch(es) to confirm...`
        );
        await this.awaitBatchMarkers(unconfirmed);
      }
    }

    if (signal?.aborted) return;
    const dispatched = await this.fetchDispatchedImageIds();
    const remaining = allProjectImages.filter(
      (img) => !dispatched.has(img.id)
    ).length;
    if (remaining > 0) {
      throw new Error(
        `All images are uploaded, but image registration could not be started for ${remaining} image${
          remaining === 1 ? '' : 's'
        }. Resume the upload to retry.`
      );
    }
  }

  private async fetchDispatchedImageIds(): Promise<Set<string>> {
    const { client, projectId } = this.ctx;
    const rows = (await fetchAllPaginatedResults(
      client.models.ImageProcessedBy.processedByProjectIdAndSource,
      {
        projectId,
        source: { eq: REGISTRATION_DISPATCH_SOURCE },
        selectionSet: ['imageId'],
        limit: 10000,
      }
    )) as { imageId: string }[];
    return new Set(rows.map((r) => r.imageId));
  }

  /** False means unconfirmed, not failed. */
  private async invokeRegistration(
    batch: RegistrationBatch,
    candidateIds: Set<string>,
    masks: number[][][]
  ): Promise<boolean> {
    const { client, backend, projectId } = this.ctx;
    const payload = batch.payload.map((img) => ({
      id: img.id,
      originalPath: img.originalPath,
      timestamp: img.timestamp,
      cameraId: img.cameraId,
    }));
    // Lets the handler drop stale bridge pairs across newly inserted images.
    const sessionIds = payload
      .filter((img) => candidateIds.has(img.id))
      .map((img) => img.id);
    try {
      const result = await client.mutations.runImageRegistration(
        {
          projectId,
          metadata: JSON.stringify({ masks, images: payload, sessionIds }),
          queueUrl: backend.custom.lightglueTaskQueueUrl,
        },
        { retry: false }
      );
      return isRegistrationSuccess(result?.data);
    } catch (err) {
      console.warn(
        `runImageRegistration batch did not confirm (${batch.payload.length} images):`,
        err
      );
      return false;
    }
  }

  private async awaitBatchMarkers(batches: RegistrationBatch[]): Promise<void> {
    const { client, signal } = this.ctx;
    const pending = new Set(batches);
    const deadline = Date.now() + MARKER_POLL_TIMEOUT_MS;
    while (pending.size > 0 && Date.now() < deadline && !signal?.aborted) {
      await sleep(MARKER_POLL_INTERVAL_MS, signal);
      for (const batch of Array.from(pending)) {
        let marked = true;
        for (const imageId of batch.probeIds) {
          const { data } = await client.models.ImageProcessedBy.get(
            { imageId, source: REGISTRATION_DISPATCH_SOURCE },
            { selectionSet: ['imageId'] }
          );
          if (!data) {
            marked = false;
            break;
          }
        }
        if (marked) pending.delete(batch);
      }
    }
    if (pending.size > 0) {
      console.warn(
        `${pending.size} registration batch(es) still unconfirmed after ${MARKER_POLL_TIMEOUT_MS / 1000}s`
      );
    }
  }

  private async dispatchDetector(
    model: string,
    allProjectImages: CreatedImage[]
  ): Promise<void> {
    const { client, backend, projectId, keyInfo } = this.ctx;
    const config = DETECTOR_DISPATCH[model];
    if (!config) {
      console.warn(`Unknown model '${model}', skipping detector dispatch`);
      return;
    }

    const setName = `${projectId}${config.setSuffix}`;
    let locationSetId = (await this.findLocationSetByName(setName))?.id ?? null;
    if (!locationSetId) {
      const { data: createdLocationSet } =
        await client.models.LocationSet.create({
          name: setName,
          projectId,
          group: keyInfo.organizationId,
        });
      locationSetId = createdLocationSet?.id ?? null;
    }
    if (!locationSetId) {
      throw new FatalUploadError(
        `Failed to create location set '${setName}' for model dispatch`
      );
    }

    // Skip images the detector has already processed.
    const processedRecords = await fetchAllPaginatedResults(
      client.models.ImageProcessedBy.processedByProjectIdAndSource,
      {
        projectId,
        source: { eq: config.processedSource },
        selectionSet: ['imageId'],
        limit: 10000,
      }
    );
    const processedImageIds = new Set(
      (processedRecords as { imageId: string }[]).map((r) => r.imageId)
    );
    const unprocessedImages = allProjectImages.filter(
      (img) => !processedImageIds.has(img.id)
    );

    for (let i = 0; i < unprocessedImages.length; i += BATCH_SIZE) {
      const batch = unprocessedImages.slice(i, i + BATCH_SIZE);
      config.dispatch(client, {
        projectId,
        images: batch.map(
          (image) => `${image.id}---${keyInfo.makeKey(image.originalPath)}`
        ),
        setId: locationSetId,
        bucket: backend.storage.buckets[1].bucket_name,
        queueUrl: config.queueUrl(backend),
      });
    }

    await client.models.Project.update({
      id: projectId,
      status: config.nextStatus,
    });
  }

  private async findLocationSetByName(name: string) {
    const { client, projectId } = this.ctx;
    let nextToken: string | null | undefined = undefined;
    do {
      const res = await client.models.LocationSet.locationSetsByProjectId(
        {
          projectId,
          nextToken,
        } as { projectId: string; nextToken?: string | null },
        {
          selectionSet: ['id', 'name'],
          limit: 10000,
        }
      );
      const match =
        res.data?.find((ls: { name?: string | null }) => ls?.name === name) ??
        null;
      if (match) return match;
      nextToken = res.nextToken as string | null | undefined;
    } while (nextToken);
    return null;
  }

  // Truncate duplicate audit logs to stay under DynamoDB item limits.
  private async logDuplicates(duplicates: DuplicateRecord[]): Promise<void> {
    const { client, projectId, keyInfo, userId } = this.ctx;
    if (duplicates.length === 0 || !keyInfo.organizationId) return;

    const MAX_MESSAGE_CHARS = 30000;
    const header = `Skipped ${duplicates.length} hash-based duplicate${
      duplicates.length === 1 ? '' : 's'
    } during upload:`;
    const lines = duplicates.map(
      (d) =>
        `- ${d.originalPath} matches ${d.matchedPath} (${
          d.scope === 'db' ? 'already in survey' : 'within this upload'
        })`
    );
    let message = `${header}\n${lines.join('\n')}`;
    if (message.length > MAX_MESSAGE_CHARS) {
      const kept: string[] = [];
      let used = header.length + 1;
      let truncatedAt = lines.length;
      for (let i = 0; i < lines.length; i++) {
        const next = used + lines[i].length + 1;
        if (next > MAX_MESSAGE_CHARS - 64) {
          truncatedAt = i;
          break;
        }
        kept.push(lines[i]);
        used = next;
      }
      const remaining = lines.length - truncatedAt;
      message = `${header}\n${kept.join('\n')}\n…and ${remaining} more (truncated)`;
    }
    await logAdminAction(
      client,
      userId,
      message,
      projectId,
      keyInfo.organizationId
    );
  }
}

function isRegistrationSuccess(data: unknown): boolean {
  let body: unknown = data;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return false;
    }
  }
  if (!body || typeof body !== 'object') return false;
  const statusCode = (body as { statusCode?: unknown }).statusCode;
  return statusCode === undefined || statusCode === 200;
}

export function buildRegistrationBatches(
  registrationImages: CreatedImage[],
  batchSize = BATCH_SIZE,
  overlapCount = BATCH_OVERLAP
): RegistrationBatch[] {
  const batches: RegistrationBatch[] = [];
  for (let i = 0; i < registrationImages.length; i += batchSize) {
    const fresh = registrationImages.slice(i, i + batchSize);
    const overlap =
      i > 0 ? registrationImages.slice(Math.max(0, i - overlapCount), i) : [];
    const probeIds = Array.from(
      new Set([fresh[0].id, fresh[fresh.length - 1].id])
    );
    batches.push({ payload: overlap.concat(fresh), probeIds });
  }
  return batches;
}

// Adds adjacent already-dispatched images so pairs bridge dispatch batches.
export function computeRegistrationImages(
  allProjectImages: CreatedImage[],
  sessionImages: CreatedImage[]
): CreatedImage[] {
  const sessionIdsForReg = new Set(sessionImages.map((img) => img.id));

  // Keep buckets sorted by timestamp; input is already sorted.
  const allByCamera = new Map<string | null, CreatedImage[]>();
  for (const img of allProjectImages) {
    const camKey = img.cameraId ?? null;
    let bucket = allByCamera.get(camKey);
    if (!bucket) {
      bucket = [];
      allByCamera.set(camKey, bucket);
    }
    bucket.push(img);
  }

  const boundaryIds = new Set<string>();
  for (const [, bucket] of allByCamera) {
    for (let idx = 0; idx < bucket.length; idx++) {
      if (!sessionIdsForReg.has(bucket[idx].id)) continue;
      // immediate same-camera predecessor
      if (idx > 0 && !sessionIdsForReg.has(bucket[idx - 1].id)) {
        boundaryIds.add(bucket[idx - 1].id);
      }
      // immediate same-camera successor
      if (
        idx < bucket.length - 1 &&
        !sessionIdsForReg.has(bucket[idx + 1].id)
      ) {
        boundaryIds.add(bucket[idx + 1].id);
      }
    }
  }

  // Cross-camera boundaries: for each session image, on every OTHER camera,
  // include the temporally-nearest non-session image on each side.
  for (const sessionImg of sessionImages) {
    const myCam = sessionImg.cameraId ?? null;
    for (const [otherCam, otherBucket] of allByCamera) {
      if (otherCam === myCam || otherBucket.length === 0) continue;
      // Binary search for the insertion point of sessionImg.timestamp
      let lo = 0;
      let hi = otherBucket.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (otherBucket[mid].timestamp < sessionImg.timestamp) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0) {
        const before = otherBucket[lo - 1];
        if (!sessionIdsForReg.has(before.id)) boundaryIds.add(before.id);
      }
      if (lo < otherBucket.length) {
        const after = otherBucket[lo];
        if (!sessionIdsForReg.has(after.id)) boundaryIds.add(after.id);
      }
    }
  }

  return [
    ...sessionImages,
    ...allProjectImages.filter((img) => boundaryIds.has(img.id)),
  ].sort((a, b) => a.timestamp - b.timestamp);
}
