import type { DataClient } from '../../../amplify/shared/data-schema.generated';
import type { PersistedCameraOrientationRotations } from '../../types/Orientation';

// UploadOrchestrator owns all transitions. The normal path is
// idle -> preparing -> uploading -> finalizing -> completed. Active work can
// also retry, pause, fail, block for user input, or be cancelled.
export type SessionPhase =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'waiting-retry'
  | 'paused'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export type PauseReason = 'user' | 'offline' | 'availability' | 'fatal-error';

export const ACTIVE_PHASES: SessionPhase[] = [
  'preparing',
  'uploading',
  'waiting-retry',
  'finalizing',
];

export interface ItemFailure {
  originalPath: string;
  message: string;
}

export type BlockedReasonKind =
  | 'missing-from-folder'
  | 'transfer-failed'
  | 'not-in-storage';

export interface BlockedItem {
  originalPath: string;
  kind: BlockedReasonKind;
  /** Human-readable reason used in the UI and CSV export. */
  reason: string;
}

export interface SessionSnapshot {
  projectId: string;
  phase: SessionPhase;
  pauseReason?: PauseReason;
  /** Human-readable message for failed / fatal-paused sessions. */
  errorMessage?: string;
  processed: number;
  total: number;
  /** Bytes transferred / expected for the S3-upload portion of this run. */
  bytesUploaded: number;
  bytesTotal: number;
  /** Moving-window throughput; null until enough samples exist. */
  throughputBps: number | null;
  etaSeconds: number | null;
  /** Per-file failures from the most recent transfer run. */
  failures: ItemFailure[];
  /** Files awaiting a retry-or-skip decision in the blocked phase. */
  blocked: BlockedItem[];
  /** > 0 while in waiting-retry; the delay currently being waited out. */
  retryDelayMs: number;
  attempt: number;
  /** Finalizing-phase progress detail. */
  statusMessage?: string;
}

export interface DuplicateRecord {
  originalPath: string;
  matchedPath: string;
  scope: 'batch' | 'db';
}

export interface UploadMetadata {
  model?: string;
  masks?: number[][][];
  folderCameraMapping?: Record<string, string>;
  /**
   * Per-camera, per-source-shape CCW corrections (90/180/270). The upload
   * trigger physically rotates the stored JPEG before processing begins.
   */
  rotations?: PersistedCameraOrientationRotations;
}

export interface UploadBackend {
  custom: {
    generalBucketName: string;
    lightglueTaskQueueUrl: string;
    scoutbotTaskQueueUrl: string;
    elephantDetectorTaskQueueUrl: string;
    madDetectorTaskQueueUrl: string;
    stormflyDetectorTaskQueueUrl: string;
    owlDDetectorTaskQueueUrl: string;
  };
  storage: { buckets: { bucket_name: string }[] };
}

export type UploadClient = DataClient;
