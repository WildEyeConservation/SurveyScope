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
  // Images whose annotations it may change; neighbours are only shown.
  writeImageIds?: string[];
  // Annotations a review task is about.
  annotationIds?: string[];
  locationIds: string[];
  // Image pairs as `${image1Id}|${image2Id}`.
  pairs: string[];
  readSetIds: string[];
  writeSetIds: string[];
  // Individual ID holds a whole job: every image of the survey, one set.
  wholeSurvey?: boolean;
  // Finished; kept briefly so the annotator can page back to it.
  acked?: boolean;
  // Handed back to the queue; it grants nothing more.
  released?: boolean;
  // Its work was saved, so it may be acknowledged.
  done?: boolean;
  // It has added to its queue's observed count.
  counted?: boolean;
  // The task asked to be skipped when its location already holds annotations.
  skipIfAnnotated?: boolean;
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
    // Served again after every location was tested, and when it was issued.
    repeat?: boolean;
    issuedAt?: string;
    // The due occurrence it was served for.
    dueId?: string;
    // Fixed by the first submission.
    grade?: {
      testAnimals: number;
      totalMissedAnimals: number;
      falsePositives?: number;
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

  // A test lease shows only its own location, not detector boxes near the answers.
  location(id: unknown, imageId: unknown, projectId?: unknown) {
    if (!str(id) && !str(imageId)) return undefined;
    return this.some(
      (l) =>
        l.locationIds.includes(String(id)) ||
        (l.kind !== 'test' &&
          (l.imageIds.includes(String(imageId)) ||
            this.inSurvey(l, projectId))),
    );
  }

  // A test lease never reads annotations: they include the answers.
  // A lease reads its own sets on its images; one without sets reads any.
  readsAnnotation(imageId: unknown, setId: unknown, projectId?: unknown) {
    if (!str(imageId) && !str(setId)) return undefined;
    const inSets = (l: Lease) =>
      !str(setId) ||
      l.readSetIds.length === 0 ||
      l.readSetIds.includes(String(setId));
    return this.some(
      (l) =>
        l.kind !== 'test' &&
        ((l.imageIds.includes(String(imageId)) && inSets(l)) ||
          (this.inSurvey(l, projectId) &&
            l.readSetIds.includes(String(setId)))),
    );
  }

  writesAnnotation(imageId: unknown, setId: unknown, projectId?: unknown) {
    if (!str(imageId) || !str(setId)) return undefined;
    return this.some(
      (l) =>
        l.writeSetIds.includes(String(setId)) &&
        ((l.writeImageIds ?? l.imageIds).includes(String(imageId)) ||
          this.inSurvey(l, projectId)),
    );
  }

  writesSet(setId: unknown) {
    if (!str(setId)) return undefined;
    return this.some((l) => l.writeSetIds.includes(String(setId)));
  }

  // One observation per received message, named queue-message:<messageId>,
  // credited to the queue that message came from.
  observes(
    id: unknown,
    locationId: unknown,
    setId: unknown,
    projectId?: unknown,
    queueId?: unknown,
  ) {
    if (!str(locationId) || !str(setId)) return undefined;
    const noQueue = queueId === undefined || queueId === null;
    // queue-message ids belong to queue tasks alone.
    const queueMessage = String(id ?? '').startsWith('queue-message:');
    return this.some(
      (l) =>
        l.writeSetIds.includes(String(setId)) &&
        ((this.inSurvey(l, projectId) && noQueue && !queueMessage) ||
          (l.locationIds.includes(String(locationId)) &&
            id === `queue-message:${l.messageId}` &&
            (noQueue || queueId === l.queueId))),
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
