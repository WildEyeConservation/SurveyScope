import { isWithinLocationBounds } from '../../shared/locationGeometry';
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
// Leases never show a tester the answers inside their own test boxes.
// Someone who left the organisation no longer reaches their own old rows; a
// channel of their own, which names no survey, stays open.
const selfInSurvey = (field: string): Rule => ({
  check: async ({ access }, row, scope) => {
    if (row[field] === undefined) return undefined;
    if (!access.isSelf(row[field])) return false;
    if (!scope?.projectId) return true;
    return Boolean(await access.surveyStanding(scope.projectId));
  },
  fields: [field, 'projectId'],
});
// Annotators mark by hand; other sources come from admins and backends.
const annotatorSource: Rule = {
  check: (_ctx, row) =>
    row.source === undefined ||
    row.source === null ||
    row.source === 'manual' ||
    row.source === 'individual-id' ||
    row.source === 'projected-overlap' ||
    (typeof row.source === 'string' && row.source.startsWith('manual-')),
  fields: ['source'],
};
// An annotation's labels come from its own annotation set.
const categoriesInSet: Rule = {
  check: async ({ models }, row) => {
    for (const field of ['categoryId', 'reviewCatId']) {
      const id = row[field];
      if (id === undefined || id === null) continue;
      const category = await models.load('Category', { id: String(id) });
      if (!category || category.annotationSetId !== row.setId) return false;
    }
    return true;
  },
  fields: ['categoryId', 'reviewCatId', 'setId'],
};
// Survey members come from the survey's own organisation.
const memberOfOrganization: Rule = {
  check: async ({ access }, row, scope) =>
    typeof row.userId !== 'string' || !scope?.projectId
      ? undefined
      : access.inSurveyOrganization(scope.projectId, row.userId),
  fields: ['userId'],
};
// Legacy surveys keep raw storage keys, which only sysadmins may name.
const notLegacy: Rule = {
  check: async ({ models }, _row, scope) => {
    if (!scope?.projectId) return undefined;
    const project = await models.load('Project', { id: scope.projectId });
    return !(Array.isArray(project?.tags) && project.tags.includes('legacy'));
  },
};
const leasedAnnotation: Rule = {
  check: async ({ access }, r) => {
    const verdict = (await access.tasks()).readsAnnotation(
      r.imageId,
      r.setId,
      r.projectId,
    );
    if (!verdict || typeof r.imageId !== 'string') return verdict;
    const boxes = (await access.testPool()).boxes.get(r.imageId);
    if (!boxes?.length) return verdict;
    // Without a position, as for a live channel, the whole image is withheld.
    if (typeof r.x !== 'number' || typeof r.y !== 'number') return false;
    const point = { x: r.x, y: r.y };
    return !boxes.some(
      (b) =>
        (r.setId === undefined || b.setId === r.setId) &&
        isWithinLocationBounds(point, b.box),
    );
  },
  fields: ['imageId', 'setId', 'projectId', 'x', 'y'],
};
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

// Reviewers read a share only while it is active.
const shareReviewer: Rule = {
  check: async ({ access, models }, _row, scope) => {
    if (!scope?.shareId) return undefined;
    if (access.isSysadmin) return true;
    if (!access.reviewsShare(scope.shareId)) return false;
    const share = await models.load('ChainShare', { shareId: scope.shareId });
    return share?.status === 'active';
  },
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
// Rows that backend functions write; admins may only read and remove them.
const backendOwned = (scope: ScopeSpec, read: Rule[] = []): ModelPolicy => ({
  scope,
  read: [surveyAdmin, ...read],
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
    read: [selfInSurvey('userId'), surveyAdmin],
    create: [{ all: [surveyAdmin, memberOfOrganization] }],
    update: [selfInSurvey('userId'), surveyAdmin],
    delete: [surveyAdmin],
    restricted: [
      { fields: ['isAdmin', 'userId'], rules: [surveyAdmin] },
      {
        fields: ['userId'],
        rules: [{ all: [surveyAdmin, memberOfOrganization] }],
        onCreate: true,
      },
    ],
  },
  Project: {
    scope: { survey: 'id' },
    read: [surveyMember, organizationAdmin, resultsReader],
    create: [organizationAdmin],
    update: [surveyAdmin],
    // Surveys are removed with deleteProjectInFull, which removes their rows too.
    restricted: [{ fields: ['tags'], rules: [], onCreate: true }],
    serverId: true,
    creator: 'createdBy',
    managed: ['pretileManifestS3Key', 'boundaryRecomputeLeaseUntil', 'hidden'],
    updatable: [
      'name',
      'status',
      'tags',
      'tiledLocationSetId',
      'defaultZoom',
      'uploadDefaults',
      'strataNetwork',
      'boundaryRecomputeRequested',
    ],
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
          // Only the standard label, and only while the set lacks one.
          {
            check: async ({ models }, r) => {
              if (
                r.name !== 'False Positive' ||
                (r.shortcutKey ?? '+') !== '+' ||
                (r.color ?? '#888888') !== '#888888' ||
                typeof r.annotationSetId !== 'string'
              )
                return false;
              const existing = await models.run(
                'Category',
                'categoriesByAnnotationSetId',
                [{ annotationSetId: r.annotationSetId }],
              );
              return !(existing.data as Row[]).some(
                (c) => String(c.name).trim().toLowerCase() === 'false positive',
              );
            },
            fields: ['name', 'shortcutKey', 'color', 'annotationSetId'],
          },
        ],
      },
    ],
    managed: ['annotationCount'],
  },
  // Parents of parent-scoped rows get server ids, so a deleted one's children
  // cannot be adopted by recreating its id elsewhere.
  AnnotationSet: {
    ...administered({ survey: 'projectId' }, [surveyMember, resultsReader]),
    managed: ['register'],
    serverId: true,
  },
  Camera: administered({ survey: 'projectId' }, [surveyMember, resultsReader]),
  // Launch functions create queues; people only change the zoom.
  Queue: {
    ...backendOwned({ survey: 'projectId' }, [
      { all: [surveyMember, visibleQueue] },
    ]),
    update: [surveyAdmin],
    updatable: ['zoom'],
  },
  IndividualIdJob: backendOwned({ survey: 'projectId' }, [surveyMember]),
  ProjectTestConfig: administered({ survey: 'projectId' }, [surveyMember]),
  TestPresetProject: {
    scope: { survey: 'projectId' },
    read: [surveyMember],
    create: [organizationAdmin],
    delete: [organizationAdmin],
  },
  TestPreset: {
    scope: { organization: 'organizationId' },
    serverId: true,
    read: [organizationAdmin, ownerSurveyAdmin],
    create: [organizationAdmin],
    update: [organizationAdmin, ownerSurveyAdmin],
    delete: [organizationAdmin],
    restricted: [{ fields: ['ownerProjectId'], rules: [organizationAdmin] }],
  },
  Stratum: administered({ survey: 'projectId' }, [resultsReader]),
  Shapefile: administered({ survey: 'projectId' }, [resultsReader]),
  ShapefileExclusions: administered({ survey: 'projectId' }, [resultsReader]),
  ImageSet: { ...administered({ survey: 'projectId' }), serverId: true },
  ImageSetMembership: administered({ parent: 'imageSetId' }),
  LocationSet: {
    ...administered({ survey: 'projectId' }),
    updatable: ['name', 'description'],
    serverId: true,
  },
  LocationSetMembership: backendOwned({ parent: 'locationSetId' }),
  TasksOnAnnotationSet: backendOwned({ parent: 'annotationSetId' }),
  Transect: administered({ survey: 'projectId' }),
  CameraOverlap: administered({ survey: 'projectId' }),
  TilingTask: backendOwned({ survey: 'projectId' }),
  TilingBatch: backendOwned({ parent: 'tilingTaskId' }),
  RegistrationProgress: backendOwned({ survey: 'projectId' }),
  RegistrationBucketStat: backendOwned({ survey: 'projectId' }),
  ImageProcessedBy: backendOwned({ survey: 'projectId' }),
  Object: backendOwned({ survey: 'projectId' }),
  Image: {
    ...administered({ survey: 'projectId' }, [taskImage('id')]),
    managed: ['tiledAt'],
    restricted: [
      {
        fields: ['originalPath'],
        rules: [{ all: [surveyAdmin, notLegacy] }],
        onCreate: true,
      },
    ],
    updatable: [
      'transectId',
      'latitude',
      'longitude',
      'cameraId',
      'boundaryOverride',
    ],
  },
  ImageFile: {
    scope: { survey: 'projectId' },
    read: [surveyAdmin, taskImage('imageId')],
    delete: [surveyAdmin],
  },
  Location: {
    ...administered({ survey: 'projectId' }, [
      task(
        (t, r) => t.location(r.id, r.imageId, r.projectId),
        ['id', 'imageId'],
      ),
    ]),
    update: undefined,
    managed: ['confidence'],
  },
  Annotation: {
    scope: { survey: 'projectId' },
    read: [surveyAdmin, leasedAnnotation],
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
    // Annotators remove their own marks; whole-job leases may tidy anyone's.
    delete: [
      surveyAdmin,
      {
        all: [
          task(
            (t, r) => t.writesAnnotation(r.imageId, r.setId, r.projectId),
            ['imageId', 'setId'],
          ),
          {
            check: async (ctx, r) =>
              r.owner === undefined
                ? undefined
                : r.owner === null ||
                  ctx.access.isSelf(r.owner) ||
                  Boolean((await ctx.access.tasks()).wholeSurvey(r.projectId)),
            fields: ['owner', 'projectId'],
          },
        ],
      },
    ],
    restricted: [
      { fields: ['projectId', 'imageId', 'setId'], rules: [surveyAdmin] },
      {
        fields: ['categoryId', 'reviewCatId', 'setId'],
        rules: [categoriesInSet],
        onCreate: true,
      },
      {
        fields: ['source'],
        rules: [surveyAdmin, annotatorSource],
        onCreate: true,
      },
    ],
    managed: ['infoTaggedBy', 'infoTagRevision', 'createdAt'],
    updatable: [
      'x',
      'y',
      'categoryId',
      'obscured',
      'oov',
      'outsideBoundary',
      'objectId',
      'reviewCatId',
      'reviewedBy',
    ],
    selfFields: ['reviewedBy'],
    owner: 'owner',
  },
  Observation: {
    scope: { survey: 'projectId' },
    read: [surveyAdmin, selfInSurvey('owner')],
    create: [
      surveyAdmin,
      task(
        (t, r) =>
          t.observes(
            r.id,
            r.locationId,
            r.annotationSetId,
            r.projectId,
            r.queueId,
          ),
        ['id', 'locationId', 'annotationSetId', 'queueId'],
      ),
    ],
    delete: [surveyAdmin],
    managed: ['createdAt'],
    owner: 'owner',
  },
  ImageNeighbour: {
    ...backendOwned({ survey: 'projectId' }, [
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
    updatable: [
      'homography',
      'homographySource',
      'skipped',
      'suggestedPointsKept',
    ],
  },
  InfoTag: administered({ survey: 'projectId' }, [surveyMember]),
  AnnotationInfoTag: backendOwned({ survey: 'projectId' }, [
    throughParent('Annotation', 'annotationId', 'read'),
  ]),
  IndividualIdTransect: backendOwned({ survey: 'projectId' }, [
    selfInSurvey('assignedUserId'),
  ]),
  // Written by /tasks/test/submit, which grades on the server.
  TestResult: {
    scope: { survey: 'projectId' },
    read: [selfInSurvey('userId'), surveyAdmin],
    delete: [surveyAdmin],
  },
  TestResultCategoryCount: {
    scope: { parent: 'testResultId' },
    read: [throughParent('TestResult', 'testResultId', 'read')],
    delete: [surveyAdmin],
  },
  TestPresetLocation: {
    scope: { parent: 'testPresetId' },
    // The server picks tests, so testers never list where they are.
    read: [organizationAdmin],
    create: [organizationAdmin],
    delete: [organizationAdmin],
  },
  LocationAnnotationCount: administered({ parent: 'annotationSetId' }),
  JollyResult: {
    scope: { survey: 'surveyId' },
    read: [
      surveyAdmin,
      { results: { survey: 'surveyId', set: 'annotationSetId' } },
    ],
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
    read: [surveyAdmin, selfInSurvey('userId')],
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
