// '*' denotes a sysadmin-only channel carrying every row.
export const DATA_CHANNELS: Record<string, string[]> = {
  OrganizationMembership: ['userId', 'organizationId'],
  OrganizationRegistration: ['*'],
  UserProjectMembership: ['userId', 'projectId'],
  Project: ['organizationId'],
  Category: ['projectId'],
  AnnotationSet: ['projectId'],
  ImageSet: ['projectId'],
  LocationSet: ['projectId'],
  Queue: ['projectId'],
  TestPreset: ['organizationId'],
  // One image and annotation set, so a lease limited to a set hears only that set.
  Annotation: ['imageSet'],
  JollyResultsMembership: ['surveyId'],
  UserStats: ['projectId'],
};

// Fields of each model that events may carry; storage-only attributes stay out.
export const DATA_FIELDS: Record<string, string[]> = {
  OrganizationMembership: [
    'id',
    'organizationId',
    'userId',
    'isAdmin',
    'isTested',
    'group',
    'createdAt',
    'updatedAt',
  ],
  OrganizationRegistration: [
    'id',
    'organizationName',
    'briefDescription',
    'requestedBy',
    'owner',
    'status',
    'createdAt',
    'updatedAt',
  ],
  UserProjectMembership: [
    'id',
    'userId',
    'projectId',
    'isAdmin',
    'queueId',
    'backupQueueId',
    'group',
    'createdAt',
    'updatedAt',
  ],
  Project: [
    'id',
    'organizationId',
    'name',
    'tags',
    'createdBy',
    'hidden',
    'status',
    'tiledLocationSetId',
    'defaultZoom',
    'pretileManifestS3Key',
    'uploadDefaults',
    'strataNetwork',
    'boundaryRecomputeRequested',
    'boundaryRecomputeLeaseUntil',
    'group',
    'createdAt',
    'updatedAt',
  ],
  Category: [
    'id',
    'projectId',
    'annotationSetId',
    'name',
    'color',
    'shortcutKey',
    'annotationCount',
    'group',
    'createdAt',
    'updatedAt',
  ],
  AnnotationSet: [
    'id',
    'projectId',
    'name',
    'register',
    'group',
    'createdAt',
    'updatedAt',
  ],
  ImageSet: [
    'id',
    'projectId',
    'name',
    'imageCount',
    'group',
    'createdAt',
    'updatedAt',
  ],
  LocationSet: [
    'id',
    'projectId',
    'name',
    'description',
    'locationCount',
    'group',
    'createdAt',
    'updatedAt',
  ],
  Queue: [
    'id',
    'projectId',
    'name',
    'batchSize',
    'totalBatches',
    'url',
    'zoom',
    'hidden',
    'approximateSize',
    'tag',
    'requeueAt',
    'updatedAt',
    'annotationSetId',
    'locationSetId',
    'confidenceThreshold',
    'launchedCount',
    'observedCount',
    'infoTagProtocolVersion',
    'locationManifestS3Key',
    'emptyQueueTimestamp',
    'requeuesCompleted',
    'lastObservationAt',
    'lastAccessedAt',
    'inactivityWarnedAt',
    'cancelAfter',
    'group',
    'createdAt',
  ],
  TestPreset: [
    'id',
    'organizationId',
    'name',
    'ownerProjectId',
    'group',
    'createdAt',
    'updatedAt',
  ],
  Annotation: [
    'id',
    'projectId',
    'setId',
    'source',
    'categoryId',
    'imageId',
    'x',
    'y',
    'obscured',
    'oov',
    'outsideBoundary',
    'objectId',
    'reviewCatId',
    'reviewedBy',
    'infoTaggedBy',
    'infoTagRevision',
    'owner',
    'group',
    'createdAt',
    'updatedAt',
  ],
  JollyResultsMembership: [
    'id',
    'surveyId',
    'annotationSetId',
    'userId',
    'group',
    'createdAt',
    'updatedAt',
  ],
  UserStats: [
    'id',
    'projectId',
    'setId',
    'date',
    'userId',
    'observationCount',
    'sightingCount',
    'annotationTime',
    'annotationCount',
    'activeTime',
    'searchTime',
    'searchCount',
    'waitingTime',
    'group',
    'createdAt',
    'updatedAt',
  ],
};

export function publicFields(model: string, item: Record<string, unknown>) {
  const fields = Object.prototype.hasOwnProperty.call(DATA_FIELDS, model)
    ? DATA_FIELDS[model]
    : [];
  return Object.fromEntries(
    fields
      .filter((f) => Object.prototype.hasOwnProperty.call(item, f))
      .map((f) => [f, item[f]]),
  );
}

// Channel fields built from several row fields, joined with '_'.
const COMPOSITE: Record<string, Record<string, string[]>> = {
  Annotation: { imageSet: ['imageId', 'setId'] },
};

function compositeParts(model: string, field: string) {
  return Object.prototype.hasOwnProperty.call(COMPOSITE, model) &&
    Object.prototype.hasOwnProperty.call(COMPOSITE[model], field)
    ? COMPOSITE[model][field]
    : undefined;
}

// The value of a channel field for a row (or a filter's pins), if it has one.
export function channelValue(
  model: string,
  field: string,
  row: Record<string, unknown>,
): string | undefined {
  const parts = compositeParts(model, field);
  const values = (parts ?? [field]).map((f) => row[f]);
  if (!values.every((v) => typeof v === 'string' && SEGMENT.test(v)))
    return undefined;
  return values.join('_');
}

// The row fields a channel value stands for.
export function channelRow(
  model: string,
  field: string,
  value: string,
): Record<string, string> | undefined {
  const parts = compositeParts(model, field);
  if (!parts) return { [field]: value };
  const values = value.split('_');
  if (values.length !== parts.length || values.some((v) => !SEGMENT.test(v)))
    return undefined;
  return Object.fromEntries(parts.map((p, i) => [p, values[i]]));
}

// Rows only admins may see go to an `admin<Field>` channel instead.
const ADMIN_ONLY: Record<string, (item: Record<string, unknown>) => boolean> = {
  Queue: (item) => item.hidden === true,
};

export const adminField = (field: string) =>
  `admin${field[0].toUpperCase()}${field.slice(1)}`;

export function hasAdminChannel(model: string) {
  return Object.prototype.hasOwnProperty.call(ADMIN_ONLY, model);
}

// Subscriptions are re-authorised each window. A window, plus how early it may
// be joined, plus PUBLISH_SLACK_MS for server clocks and delivery, stays within
// REVOCATION_MS, so lost access ends within that.
export const EPOCH_MS = 3.5 * 60_000;
export const PUBLISH_SLACK_MS = 40_000;
// Clients join the next window this long before it starts.
export const EPOCH_LEAD_MS = 30_000;
export const SKEW_MS = 20_000;
export const REVOCATION_MS = 5 * 60_000;

export const epochAt = (ms: number) => Math.floor(ms / EPOCH_MS);

const SEGMENT = /^[A-Za-z0-9-]{1,50}$/;

export const channelBase = (model: string, field: string, value: string) =>
  `/data/${model}/${field}/${value}`;

export const channelPath = (
  model: string,
  field: string,
  value: string,
  epoch: number,
) => `${channelBase(model, field, value)}/${epoch}`;

export function channelsFor(
  model: string,
  item: Record<string, unknown>,
  epoch: number,
): string[] {
  const fields = Object.prototype.hasOwnProperty.call(DATA_CHANNELS, model)
    ? DATA_CHANNELS[model]
    : [];
  const adminOnly = hasAdminChannel(model) && ADMIN_ONLY[model](item);
  return fields.flatMap((field) => {
    if (field === '*') return [channelPath(model, 'all', 'all', epoch)];
    const value = channelValue(model, field, item);
    if (value === undefined) return [];
    return [
      channelPath(model, adminOnly ? adminField(field) : field, value, epoch),
    ];
  });
}

// Epochs a subscriber may join at `now`, allowing for clock drift.
export function joinableEpochs(now: number, skewMs = SKEW_MS): number[] {
  const current = epochAt(now);
  const epochs = new Set([current]);
  if (now + EPOCH_LEAD_MS + skewMs >= (current + 1) * EPOCH_MS)
    epochs.add(current + 1);
  if (now - skewMs < current * EPOCH_MS) epochs.add(current - 1);
  return [...epochs];
}
