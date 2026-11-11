import type { TestPool } from './access';
import type { TaskScope } from './leases';
import type { ModelPolicy, Rule, ScopeSpec } from './models';
import type { Row } from './schema';

const surveyAdmin: Rule = { survey: 'admin' };
const surveyMember: Rule = { survey: 'member' };
const organizationMember: Rule = { organization: 'member' };
const organizationAdmin: Rule = { organization: 'admin' };
// Results readers see what the results pages draw, however few sets they hold.
const resultsReader: Rule = {
  check: async ({ access }, _row, scope) =>
    scope?.projectId
      ? (await access.resultsSets(scope.projectId)).length > 0
      : undefined,
};
// A query precheck knows only its key, not whether the queue is hidden.
const visibleQueue: Rule = {
  check: (_ctx, row) =>
    row.id === undefined ? undefined : row.hidden !== true,
  fields: ['hidden'],
};
const ownerSurveyAdmin: Rule = {
  check: async ({ access }, row) => {
    if (typeof row.ownerProjectId !== 'string') return undefined;
    const standing = await access.surveyStanding(row.ownerProjectId);
    if (standing?.role !== 'admin') return false;
    return (
      row.organizationId === undefined ||
      standing.organizationId === row.organizationId
    );
  },
  fields: ['ownerProjectId'],
};

const task = (
  test: (tasks: TaskScope, row: Row) => boolean | undefined,
  fields: string[],
): Rule => ({
  check: async ({ access }, row) => test(await access.tasks(), row),
  fields: [...fields, 'projectId'],
});
const taskImage = (field: string) =>
  task((t, r) => t.image(r[field], r.projectId), [field]);
const testPool = (
  test: (pool: TestPool, row: Row) => boolean | undefined,
  fields: string[],
): Rule => ({
  check: async ({ access }, row) => test(await access.testPool(), row),
  fields,
});
const inTestPool = testPool(
  (pool, r) =>
    r.locationId === undefined || r.annotationSetId === undefined
      ? undefined
      : pool.locations.has(`${r.locationId}|${r.annotationSetId}`),
  ['locationId', 'annotationSetId'],
);
const throughParent = (
  model: string,
  field: string,
  action: 'read' | 'update',
): Rule => ({
  check: async ({ models }, row) => {
    if (typeof row[field] !== 'string') return undefined;
    const parent = await models.load(model, { id: row[field] });
    return Boolean(parent) && models.allows(model, action, parent!);
  },
  fields: [field],
});

const shareReviewer: Rule = {
  check: ({ access }, _row, scope) =>
    scope?.shareId ? access.reviewsShare(scope.shareId) : undefined,
};
const snapshot: ModelPolicy = {
  scope: { share: 'shareId' },
  read: [shareReviewer],
};
const ownFeedback: Rule = { all: [shareReviewer, { self: 'owner' }] };

const administered = (scope: ScopeSpec, read: Rule[] = []): ModelPolicy => ({
  scope,
  read: [surveyAdmin, ...read],
  create: [surveyAdmin],
  update: [surveyAdmin],
  delete: [surveyAdmin],
});

export const POLICIES: Record<string, ModelPolicy> = {
  Organization: {
    scope: { organization: 'id' },
    read: [organizationMember],
    scan: true,
  },
  OrganizationMembership: {
    scope: { organization: 'organizationId' },
    read: [{ self: 'userId' }, organizationMember],
    update: [organizationAdmin],
    managed: ['isAdmin'],
  },
  OrganizationInvite: {
    scope: { organization: 'organizationId' },
    read: [{ self: 'username' }, organizationAdmin],
  },
  OrganizationRegistration: {
    scope: { global: true },
  },
  ClientErrorReport: {
    scope: { global: true },
  },
  UserProjectMembership: {
    scope: { survey: 'projectId' },
    read: [{ self: 'userId' }, surveyAdmin],
    create: [surveyAdmin],
    update: [{ self: 'userId' }, surveyAdmin],
    delete: [surveyAdmin],
    restricted: [{ fields: ['isAdmin', 'userId'], rules: [surveyAdmin] }],
  },
  Project: {
    scope: { survey: 'id' },
    read: [surveyMember, organizationAdmin, resultsReader],
    create: [organizationAdmin],
    update: [surveyAdmin],
    delete: [surveyAdmin],
    restricted: [{ fields: ['tags'], rules: [], onCreate: true }],
    scan: true,
  },
  Category: {
    ...administered({ survey: 'projectId' }, [
      surveyMember,
      resultsReader,
      testPool(
        (pool, r) =>
          r.annotationSetId === undefined
            ? undefined
            : pool.setIds.has(String(r.annotationSetId)),
        ['annotationSetId'],
      ),
    ]),
    // QC reviewers add the set's False Positive label when it is missing.
    create: [
      surveyAdmin,
      {
        all: [
          surveyMember,
          task((t, r) => t.writesSet(r.annotationSetId), ['annotationSetId']),
          { check: (_ctx, r) => r.name === 'False Positive' },
        ],
      },
    ],
  },
  AnnotationSet: administered({ survey: 'projectId' }, [
    surveyMember,
    resultsReader,
  ]),
  Camera: administered({ survey: 'projectId' }, [surveyMember, resultsReader]),
  Queue: {
    ...administered({ survey: 'projectId' }, [
      { all: [surveyMember, visibleQueue] },
    ]),
    managed: ['url'],
  },
  IndividualIdJob: administered({ survey: 'projectId' }, [surveyMember]),
  ProjectTestConfig: administered({ survey: 'projectId' }, [surveyMember]),
  TestPresetProject: {
    scope: { survey: 'projectId' },
    read: [surveyMember],
    create: [organizationAdmin],
    delete: [organizationAdmin],
  },
  TestPreset: {
    scope: { organization: 'organizationId' },
    read: [organizationAdmin, ownerSurveyAdmin],
    create: [organizationAdmin],
    update: [organizationAdmin, ownerSurveyAdmin],
    delete: [organizationAdmin],
    restricted: [{ fields: ['ownerProjectId'], rules: [organizationAdmin] }],
  },
  Stratum: administered({ survey: 'projectId' }, [resultsReader]),
  Shapefile: administered({ survey: 'projectId' }, [resultsReader]),
  ShapefileExclusions: administered({ survey: 'projectId' }, [resultsReader]),
  ImageSet: administered({ survey: 'projectId' }),
  ImageSetMembership: administered({ parent: 'imageSetId' }),
  LocationSet: administered({ survey: 'projectId' }),
  LocationSetMembership: administered({ parent: 'locationSetId' }),
  TasksOnAnnotationSet: administered({ parent: 'annotationSetId' }),
  Transect: administered({ survey: 'projectId' }),
  CameraOverlap: administered({ survey: 'projectId' }),
  TilingTask: administered({ survey: 'projectId' }),
  TilingBatch: administered({ parent: 'tilingTaskId' }),
  RegistrationProgress: administered({ survey: 'projectId' }),
  RegistrationBucketStat: administered({ survey: 'projectId' }),
  ImageProcessedBy: administered({ survey: 'projectId' }),
  Object: administered({ survey: 'projectId' }),
  Image: administered({ survey: 'projectId' }, [taskImage('id')]),
  ImageFile: {
    scope: { survey: 'projectId' },
    read: [surveyAdmin, taskImage('imageId')],
    delete: [surveyAdmin],
  },
  Location: administered({ survey: 'projectId' }, [
    task((t, r) => t.location(r.id, r.imageId, r.projectId), ['id', 'imageId']),
  ]),
  Annotation: {
    scope: { survey: 'projectId' },
    read: [
      surveyAdmin,
      task(
        (t, r) => t.readsAnnotation(r.imageId, r.setId, r.projectId),
        ['imageId', 'setId'],
      ),
    ],
    create: [
      surveyAdmin,
      task(
        (t, r) => t.writesAnnotation(r.imageId, r.setId, r.projectId),
        ['imageId', 'setId'],
      ),
    ],
    update: [
      surveyAdmin,
      task(
        (t, r) => t.writesAnnotation(r.imageId, r.setId, r.projectId),
        ['imageId', 'setId'],
      ),
    ],
    delete: [
      surveyAdmin,
      task(
        (t, r) => t.writesAnnotation(r.imageId, r.setId, r.projectId),
        ['imageId', 'setId'],
      ),
    ],
    restricted: [
      { fields: ['projectId', 'imageId', 'setId'], rules: [surveyAdmin] },
    ],
    owner: 'owner',
  },
  Observation: {
    scope: { survey: 'projectId' },
    read: [surveyAdmin, { self: 'owner' }],
    create: [
      surveyAdmin,
      task(
        (t, r) => t.observes(r.locationId, r.annotationSetId, r.projectId),
        ['locationId', 'annotationSetId'],
      ),
    ],
    delete: [surveyAdmin],
    owner: 'owner',
  },
  ImageNeighbour: {
    ...administered({ survey: 'projectId' }, [
      task(
        (t, r) =>
          t.image(r.image1Id, r.projectId) || t.image(r.image2Id, r.projectId),
        ['image1Id', 'image2Id'],
      ),
    ]),
    update: [
      surveyAdmin,
      task((t, r) => t.pair(r.image1Id, r.image2Id), ['image1Id', 'image2Id']),
    ],
  },
  InfoTag: administered({ survey: 'projectId' }, [surveyMember]),
  AnnotationInfoTag: administered({ survey: 'projectId' }, [
    throughParent('Annotation', 'annotationId', 'read'),
  ]),
  IndividualIdTransect: administered({ survey: 'projectId' }, [
    { self: 'assignedUserId' },
  ]),
  TestResult: {
    scope: { survey: 'projectId' },
    read: [{ self: 'userId' }, surveyAdmin],
    create: [
      {
        all: [
          { self: 'userId' },
          surveyMember,
          task((t, r) => t.tested(r.locationId), ['locationId']),
        ],
      },
    ],
    update: [{ self: 'userId' }, surveyAdmin],
    delete: [surveyAdmin],
    restricted: [
      {
        fields: ['userId', 'locationId', 'annotationSetId', 'testPresetId'],
        rules: [surveyAdmin],
      },
    ],
    // The tested location belongs to the preset's own survey.
    crossScope: ['locationId', 'annotationSetId'],
  },
  TestResultCategoryCount: {
    scope: { parent: 'testResultId' },
    read: [throughParent('TestResult', 'testResultId', 'read')],
    create: [throughParent('TestResult', 'testResultId', 'update')],
    update: [throughParent('TestResult', 'testResultId', 'update')],
    delete: [surveyAdmin],
  },
  TestPresetLocation: {
    scope: { parent: 'testPresetId' },
    read: [
      organizationAdmin,
      testPool(
        (pool, r) =>
          r.testPresetId === undefined
            ? undefined
            : pool.presetIds.has(String(r.testPresetId)),
        ['testPresetId'],
      ),
    ],
    create: [organizationAdmin],
    delete: [organizationAdmin],
  },
  LocationAnnotationCount: administered({ parent: 'annotationSetId' }, [
    inTestPool,
  ]),
  JollyResult: {
    scope: { survey: 'surveyId' },
    read: [
      surveyAdmin,
      { results: { survey: 'surveyId', set: 'annotationSetId' } },
    ],
    update: [surveyAdmin],
    delete: [surveyAdmin],
  },
  JollyResultsMembership: {
    scope: { survey: 'surveyId' },
    read: [surveyAdmin, { self: 'userId' }],
    create: [surveyAdmin],
    delete: [surveyAdmin],
    scan: true,
  },
  ResultSharingToken: {
    scope: { survey: 'surveyId' },
  },
  UserStats: {
    scope: { survey: 'projectId' },
    read: [surveyAdmin, { self: 'userId' }],
  },
  ClientLog: {
    scope: { global: true },
    read: [{ self: 'userId' }],
    create: [{ self: 'userId' }],
    owner: 'owner',
  },
  ChainShare: { ...snapshot, scan: true },
  SharedChainAnnotation: snapshot,
  SharedChainImage: snapshot,
  SharedChainLocation: snapshot,
  SharedChainCategory: snapshot,
  SharedChainNeighbour: snapshot,
  ChainReviewFeedback: {
    scope: { share: 'shareId' },
    read: [ownFeedback],
    create: [ownFeedback],
    update: [ownFeedback],
    delete: [ownFeedback],
    guard: 'chainMutationGuard',
    owner: 'owner',
  },
  AdminActionLog: {
    scope: { survey: 'projectId' },
    read: [surveyAdmin],
    create: [{ all: [surveyAdmin, { self: 'userId' }] }],
  },
};
