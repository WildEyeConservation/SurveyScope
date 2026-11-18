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
  Annotation: ['imageId'],
  JollyResultsMembership: ['surveyId'],
  UserStats: ['projectId'],
};

// Rows only admins may see go to an `admin<Field>` channel instead.
const ADMIN_ONLY: Record<string, (item: Record<string, unknown>) => boolean> = {
  Queue: (item) => item.hidden === true,
};

export const adminField = (field: string) =>
  `admin${field[0].toUpperCase()}${field.slice(1)}`;

export function hasAdminChannel(model: string) {
  return Object.prototype.hasOwnProperty.call(ADMIN_ONLY, model);
}

// Subscriptions are re-authorised each window, so lost access ends within one.
export const EPOCH_MS = 5 * 60_000;
// Clients join the next window this long before it starts.
export const EPOCH_LEAD_MS = 45_000;

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
    const value = item[field];
    if (typeof value !== 'string' || !SEGMENT.test(value)) return [];
    return [
      channelPath(model, adminOnly ? adminField(field) : field, value, epoch),
    ];
  });
}

// Epochs a subscriber may join at `now`, allowing for clock drift.
export function joinableEpochs(now: number, skewMs = 30_000): number[] {
  const current = epochAt(now);
  const epochs = new Set([current]);
  if (now + EPOCH_LEAD_MS + skewMs >= (current + 1) * EPOCH_MS)
    epochs.add(current + 1);
  if (now - skewMs < current * EPOCH_MS) epochs.add(current - 1);
  return [...epochs];
}
