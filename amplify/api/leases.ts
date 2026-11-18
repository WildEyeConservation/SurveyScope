export interface Lease {
  userId: string;
  leaseId: string;
  kind: 'queue' | 'test' | 'job';
  projectId: string;
  // The survey whose membership the lease came from; it ends with that membership.
  grantedFor: string;
  queueId?: string;
  queueUrl?: string;
  receiptHandle?: string;
  // The message a queue lease came from; its observation is named after it.
  messageId?: string;
  imageIds: string[];
  locationIds: string[];
  // Image pairs as `${image1Id}|${image2Id}`.
  pairs: string[];
  readSetIds: string[];
  writeSetIds: string[];
  // Individual ID holds a whole job: every image of the survey, one set.
  wholeSurvey?: boolean;
  // Finished; kept briefly so the annotator can page back to it.
  acked?: boolean;
  // A test lease's fixed box and answer key, graded by the server.
  test?: {
    testPresetId: string;
    annotationSetId: string;
    jobSetId: string;
    locationId: string;
    imageId: string;
    // Served box, which may be grown to a tile, and the box that is graded.
    box: { x: number; y: number; width: number; height: number };
    answerBox: { x: number; y: number; width: number; height: number };
    grown: boolean;
    // Fixed by the first submission.
    grade?: {
      testAnimals: number;
      totalMissedAnimals: number;
      counts: { categoryName: string; userCount: number; testCount: number }[];
    };
    submitted?: boolean;
  };
  expiresAt: number;
}

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

export class TaskScope {
  constructor(readonly leases: Lease[]) {}

  private some(test: (lease: Lease) => boolean) {
    return this.leases.some(test);
  }

  private inSurvey(lease: Lease, projectId: unknown) {
    return Boolean(lease.wholeSurvey) && lease.projectId === projectId;
  }

  image(id: unknown, projectId?: unknown) {
    const imageId = str(id);
    if (!imageId) return undefined;
    return this.some(
      (l) => l.imageIds.includes(imageId) || this.inSurvey(l, projectId),
    );
  }

  location(id: unknown, imageId: unknown, projectId?: unknown) {
    if (!str(id) && !str(imageId)) return undefined;
    return this.some(
      (l) =>
        l.locationIds.includes(String(id)) ||
        l.imageIds.includes(String(imageId)) ||
        this.inSurvey(l, projectId),
    );
  }

  // A test lease never reads annotations: they include the answers.
  readsAnnotation(imageId: unknown, setId: unknown, projectId?: unknown) {
    if (!str(imageId) && !str(setId)) return undefined;
    return this.some(
      (l) =>
        l.kind !== 'test' &&
        (l.imageIds.includes(String(imageId)) ||
          (this.inSurvey(l, projectId) &&
            l.readSetIds.includes(String(setId)))),
    );
  }

  writesAnnotation(imageId: unknown, setId: unknown, projectId?: unknown) {
    if (!str(imageId) || !str(setId)) return undefined;
    return this.some(
      (l) =>
        l.writeSetIds.includes(String(setId)) &&
        (l.imageIds.includes(String(imageId)) || this.inSurvey(l, projectId)),
    );
  }

  writesSet(setId: unknown) {
    if (!str(setId)) return undefined;
    return this.some((l) => l.writeSetIds.includes(String(setId)));
  }

  // One observation per received message, named queue-message:<messageId>.
  observes(
    id: unknown,
    locationId: unknown,
    setId: unknown,
    projectId?: unknown,
  ) {
    if (!str(locationId) || !str(setId)) return undefined;
    return this.some(
      (l) =>
        l.writeSetIds.includes(String(setId)) &&
        (this.inSurvey(l, projectId) ||
          (l.locationIds.includes(String(locationId)) &&
            id === `queue-message:${l.messageId}`)),
    );
  }

  wholeSurvey(projectId: unknown) {
    if (!str(projectId)) return undefined;
    return this.some((l) => this.inSurvey(l, projectId));
  }

  pair(image1Id: unknown, image2Id: unknown) {
    if (!str(image1Id) || !str(image2Id)) return undefined;
    return this.some(
      (l) =>
        l.pairs.includes(`${image1Id}|${image2Id}`) ||
        l.pairs.includes(`${image2Id}|${image1Id}`),
    );
  }
}
