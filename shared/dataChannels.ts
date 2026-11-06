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

const SEGMENT = /^[A-Za-z0-9-]{1,50}$/;

export const channelPath = (model: string, field: string, value: string) =>
  `/data/${model}/${field}/${value}`;

export function channelsFor(
  model: string,
  item: Record<string, unknown>,
): string[] {
  return (DATA_CHANNELS[model] ?? []).flatMap((field) => {
    if (field === '*') return [channelPath(model, 'all', 'all')];
    const value = item[field];
    return typeof value === 'string' && SEGMENT.test(value)
      ? [channelPath(model, field, value)]
      : [];
  });
}
