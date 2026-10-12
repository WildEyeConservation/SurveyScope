export type ProjectRow = {
  id: string;
  name: string;
  status: string | null;
  createdAt: string | null;
  organizationId: string | null;
};

export type ImageSetRow = {
  id: string;
  name: string;
  imageCount: number | null;
};

export type AnnotationSetRow = {
  id: string;
  name: string;
  annotationCount: number | null;
  register: boolean | null;
  createdAt: string | null;
};

export type LocationSetRow = {
  id: string;
  name: string;
  description: string | null;
  locationCount: number | null;
  createdAt: string | null;
};

export type QueueRow = {
  id: string;
  name: string;
  tag: string | null;
  annotationSetId: string | null;
  locationSetId: string | null;
  confidenceThreshold: number | null;
  launchedCount: number | null;
  observedCount: number | null;
  approximateSize: number | null;
  requeuesCompleted: number | null;
  lastObservationAt: string | null;
  createdAt: string | null;
};

export type RegistrationProgressRow = {
  pairsCreated: number | null;
  pairsProcessed: number | null;
  pendingCount: number | null;
  lastKickoffAt: string | null;
  lastChangeAt: string | null;
  cleanupState: string | null;
};

export type RegistrationBucketRow = {
  cameraPairKey: string;
  bucketIndex: number;
  successCount: number | null;
};

export type RegistrationRows = {
  progress: RegistrationProgressRow | null;
  buckets: RegistrationBucketRow[];
};

export type ImageRow = {
  id: string;
  width: number | null;
  height: number | null;
  timestamp: number | null;
  originalPath: string | null;
  cameraId: string | null;
};

export type NeighbourRow = {
  image1Id: string;
  image2Id: string;
  homography: (number | null)[] | null;
  homographySource: string | null;
  skipped: boolean | null;
  suggestedPointsKept: number | null;
  cameraPairKey: string | null;
  registrationProcessed: boolean;
  registrationFailed: boolean;
};

export type ProcessedByRow = {
  imageId: string;
  source: string;
};

export type LocationRow = {
  id: string;
  imageId: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  source: string;
  confidence: number | null;
};

export type AnnotationRow = {
  id: string;
  imageId: string;
  categoryId: string;
  objectId: string | null;
  x: number;
  y: number;
  source: string;
  oov: boolean | null;
  obscured: boolean | null;
  owner: string | null;
  reviewedBy: string | null;
  infoTaggedBy: string | null;
  createdAt: string | null;
};

export type ObservationRow = {
  locationId: string;
  owner: string | null;
  source: string | null;
  createdAt: string | null;
};

export type CategoryRow = {
  id: string;
  name: string;
};

export type TaskRow = {
  locationSetId: string;
  createdAt: string | null;
};
