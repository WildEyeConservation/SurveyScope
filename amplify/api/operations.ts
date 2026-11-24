import { ROW_SOURCES } from '../../shared/rowSources';
import type { Access } from './access';
import {
  dispatchTarget,
  requireDetectorImages,
  requireRegistrationImages,
} from './dispatch';
import { badRequest, forbidden } from './errors';
import { authorizeLaunch, type LaunchStore } from './launch';
import type { Lease } from './leases';
import type { DataLayer, Models, Result } from './models';
import type { QueueActivity } from './queueStore';
import type { Row } from './schema';
import * as notebook from './speciesNotebook';
import {
  assignedTransect,
  holdJob,
  markDone,
  workableQueue,
  type TaskContext,
} from './tasks';

export interface OperationContext {
  access: Access;
  models: Models;
  data: DataLayer;
  secret: () => string;
  images: notebook.NotebookContext['images'];
  launches: LaunchStore;
  tasks: TaskContext;
  queues: QueueActivity;
  update(model: string, input: Row): Promise<Result>;
}

type Authorize = (ctx: OperationContext, args: Row) => Promise<unknown>;

// Group grants apply only to this invocation.
export class Authorized {
  constructor(readonly grant: { args?: Row; groups?: string[] }) {}
}

export interface OperationPolicy {
  // The defineFunction name of the Lambda resolver that does the work, unless `run` does it.
  fn?: string;
  run?: (ctx: OperationContext, args: Row) => Promise<Result>;
  authorize: Authorize;
  // A Lambda that the AppSync pipeline runs before `fn` and that must answer true.
  guard?: { fn: string; when: (args: Row) => boolean };
  async?: boolean;
  // Destructive or role-changing work reads access afresh, not from the cache.
  fresh?: boolean;
  after?: (ctx: OperationContext, args: Row, result: Result) => Promise<void>;
}

export function stringArg(args: Row, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || value === '')
    throw badRequest(`Missing ${name}`);
  return value;
}

const signedIn: Authorize = async () => {};
const sysadmin: Authorize = async ({ access }) => access.requireSysadmin();
const organizationAdmin =
  (field: string): Authorize =>
  ({ access }, args) =>
    access.requireOrganizationAdmin(stringArg(args, field));
const surveyAdmin =
  (field: string): Authorize =>
  ({ access }, args) =>
    access.requireSurveyAdmin(stringArg(args, field));

const surveyMember =
  (field: string): Authorize =>
  ({ access }, args) =>
    access.requireSurveyMember(stringArg(args, field));

const surveyAdminOf =
  (model: string, field: string): Authorize =>
  async ({ access, models }, args) => {
    const row = await models.load(model, { id: stringArg(args, field) });
    if (typeof row?.projectId !== 'string') throw forbidden();
    return access.requireSurveyAdmin(row.projectId);
  };

async function requireInSurvey(
  { models }: OperationContext,
  projectId: string,
  refs: [model: string, id: unknown][],
) {
  for (const [model, id] of refs) {
    if (id === undefined || id === null || id === '') continue;
    if (typeof id !== 'string') throw badRequest(`Invalid ${model} id`);
    const row = await models.load(model, { id });
    if (row?.projectId !== projectId)
      throw forbidden(`${model} ${id} is not in this survey`);
  }
}

const launch: Authorize = async (ctx, args) =>
  new Authorized({
    args: await authorizeLaunch(ctx.access, ctx.launches, args),
  });

// Downloads serve the original file, so a chain share does not reach them.
// Access that comes only from a task lasts no longer than the task.
const surveyImage: Authorize = async ({ access, models }, args) => {
  const image = await models.load('Image', { id: stringArg(args, 'imageId') });
  if (!image || !(await models.allows('Image', 'read', image)))
    throw forbidden();
  if (
    access.isSysadmin ||
    (await access.isSurveyAdmin(String(image.projectId)))
  )
    return;
  const now = Math.floor(Date.now() / 1000);
  const remaining = Math.max(
    0,
    ...(await access.tasks()).leases
      .filter(
        (l) =>
          l.imageIds.includes(String(image.id)) ||
          (l.wholeSurvey && l.projectId === image.projectId),
      )
      .map((l) => l.expiresAt - now),
  );
  // Signed links last at least a minute, so a task about to end gets none.
  if (remaining < 60) throw forbidden('The task has ended');
  return new Authorized({ args: { ...args, maxExpiresIn: remaining } });
};

const readableImage: Authorize = async (ctx, args) => {
  const { access, models } = ctx;
  if (args.sharedImageId !== undefined && args.sharedImageId !== null) {
    const shared = await models.load('SharedChainImage', {
      id: stringArg(args, 'sharedImageId'),
    });
    if (
      typeof shared?.shareId !== 'string' ||
      shared.sourceImageId !== args.imageId
    )
      throw forbidden();
    const share = await models.load('ChainShare', { shareId: shared.shareId });
    if (share?.status !== 'active') throw forbidden();
    if (!access.reviewsShare(shared.shareId)) throw forbidden();
    return;
  }
  return surveyImage(ctx, args);
};

const transectHolder: Authorize = ({ tasks }, args) =>
  assignedTransect(tasks, stringArg(args, 'transectRowId'));

const queueWorker: Authorize = async ({ access, models }, args) => {
  const id = stringArg(args, 'id');
  const queue = await models.load('Queue', { id });
  if (typeof queue?.projectId !== 'string') throw forbidden();
  await access.requireSurveyMember(queue.projectId);
};

// Each finished task adds to its queue's count once, however often it is sent.
// Location tasks are counted from their observation, so only others count here.
const countObservation = async (
  ctx: OperationContext,
  args: Row,
): Promise<Result> => {
  const id = stringArg(args, 'id');
  for (const lease of (await ctx.access.tasks()).leases) {
    if (
      lease.kind !== 'queue' ||
      lease.queueId !== id ||
      !lease.done ||
      lease.counted ||
      lease.locationIds.length
    )
      continue;
    if (await ctx.queues.recordTaskObservation(id, lease))
      return { data: true };
  }
  return { data: null };
};

const infoTagWorker: Authorize = async (ctx, args) => {
  let request: Row;
  try {
    request = JSON.parse(stringArg(args, 'request'));
  } catch {
    throw badRequest('Invalid request');
  }
  const queue = await ctx.models.load('Queue', {
    id: stringArg(request, 'queueId'),
  });
  if (typeof queue?.projectId !== 'string') throw forbidden();
  if ((await ctx.access.surveyStanding(queue.projectId))?.role === 'admin')
    return;
  // The image must come from a task of this very queue.
  const tasks = await ctx.access.tasks();
  if (
    !tasks.leases.some(
      (l) =>
        l.kind === 'queue' &&
        l.queueId === queue.id &&
        typeof request.imageId === 'string' &&
        (l.writeImageIds ?? l.imageIds).includes(request.imageId),
    )
  ) {
    throw forbidden();
  }
};

function parsedRequest(args: Row): Row {
  try {
    const request = JSON.parse(String(args.request));
    return typeof request === 'object' && request ? request : {};
  } catch {
    return {};
  }
}

// Image pairs are recorded as `a::b` or `a__b`; leases hold `a|b`.
function pairOf(key: string): [string, string] | null {
  for (const separator of ['::', '__']) {
    const parts = key.split(separator);
    if (parts.length === 2 && parts.every(Boolean)) return [parts[0], parts[1]];
  }
  return null;
}

// Whether a queue lease covers the work item a workflow record names.
async function holdsItem(
  ctx: OperationContext,
  lease: Lease,
  queueId: string,
  type: string,
  itemId: string,
) {
  if (lease.kind !== 'queue' || lease.queueId !== queueId) return false;
  if (type === 'image-pair') {
    const pair = pairOf(itemId);
    return Boolean(
      pair &&
      (lease.pairs.includes(`${pair[0]}|${pair[1]}`) ||
        lease.pairs.includes(`${pair[1]}|${pair[0]}`)),
    );
  }
  if (type !== 'annotation') return false;
  // A review task covers exactly its annotations.
  if (lease.annotationIds?.length) return lease.annotationIds.includes(itemId);
  // Info Tags tasks name an image; their records name its annotations.
  const annotation = await ctx.models.load('Annotation', { id: itemId });
  return (
    typeof annotation?.imageId === 'string' &&
    annotation.projectId === lease.grantedFor &&
    (lease.writeImageIds ?? lease.imageIds).includes(annotation.imageId)
  );
}

// One spelling per pair, so a pair is recorded once however it is named.
function canonicalItem(type: string, itemId: string) {
  const pair = type === 'image-pair' ? pairOf(itemId) : null;
  if (!pair) return itemId;
  const separator = itemId.includes('::') ? '::' : '__';
  return [...pair].sort().join(separator);
}

// Workflow records come only from work the caller holds: a queue task, or an
// Individual ID job, whose run id is the job id.
const workflowWorker: Authorize = async (ctx, args) => {
  const { access, models } = ctx;
  const runId = stringArg(args, 'workflowRunId');
  const type = stringArg(args, 'workItemType');
  const itemId = stringArg(args, 'workItemId');
  const grant = new Authorized({
    args: { ...args, workItemId: canonicalItem(type, itemId) },
  });
  const queue = await models.load('Queue', { id: runId });
  if (typeof queue?.projectId === 'string') {
    await access.requireSurveyMember(queue.projectId);
    if (await access.isSurveyAdmin(queue.projectId)) return grant;
    for (const lease of (await access.tasks()).leases)
      if (await holdsItem(ctx, lease, runId, type, itemId)) return grant;
    throw forbidden();
  }
  const job = await models.load('IndividualIdJob', { id: runId });
  if (typeof job?.projectId !== 'string') throw forbidden();
  await access.requireSurveyMember(job.projectId);
  if (await access.isSurveyAdmin(job.projectId)) return;
  if (!(await access.tasks()).leases.some((l) => l.leaseId === `job-${runId}`))
    throw forbidden();
  return grant;
};

const ping = async (ctx: OperationContext, args: Row): Promise<Result> => {
  const transect = await assignedTransect(ctx.tasks, stringArg(args, 'id'));
  const result = await ctx.update('IndividualIdTransect', {
    id: transect.id,
    lastActiveAt: new Date().toISOString(),
  });
  await holdJob(ctx.tasks, String(transect.jobId));
  return { ...result, data: result.data ? JSON.stringify(result.data) : null };
};

const RESULTS_SOURCES = new Set([
  'annotationsByAnnotationSetId',
  'categoriesByProjectId',
  'imagesByProjectId',
  'imageNeighboursByProjectId',
]);

const rowChunk: Authorize = async ({ access, models }, args) => {
  const name = stringArg(args, 'source');
  if (!Object.hasOwn(ROW_SOURCES, name)) throw badRequest('Unknown source');
  const source = ROW_SOURCES[name as keyof typeof ROW_SOURCES];
  const scopeId = stringArg(args, 'scopeId');
  let projectId = scopeId;
  if (source.scope !== 'project') {
    const row = await models.load(
      source.scope === 'annotationSet' ? 'AnnotationSet' : 'LocationSet',
      {
        id: scopeId,
      },
    );
    if (typeof row?.projectId !== 'string') throw forbidden();
    projectId = row.projectId;
  }
  if ((await access.surveyStanding(projectId))?.role === 'admin') return;
  const sets = await access.resultsSets(projectId);
  const reader =
    RESULTS_SOURCES.has(String(args.source)) &&
    sets.length > 0 &&
    (source.scope !== 'annotationSet' || sets.includes(scopeId));
  if (!reader) throw forbidden();
  const organizationId = await access.organizationOfProject(projectId);
  return new Authorized({ groups: organizationId ? [organizationId] : [] });
};

const surveyResults: Authorize = async (ctx, args) => {
  const surveyId = stringArg(args, 'surveyId');
  await ctx.access.requireSurveyAdmin(surveyId);
  const categories = Array.isArray(args.categoryIds) ? args.categoryIds : [];
  await requireInSurvey(ctx, surveyId, [
    ['AnnotationSet', args.annotationSetId],
    ...categories.map((id): [string, unknown] => ['Category', id]),
  ]);
};

const detector =
  (operation: string): Authorize =>
  async (ctx, args) => {
    const projectId = stringArg(args, 'projectId');
    await ctx.access.requireSurveyAdmin(projectId);
    await requireInSurvey(ctx, projectId, [['LocationSet', args.setId]]);
    const project = await ctx.models.load('Project', { id: projectId });
    if (!project) throw forbidden();
    await requireDetectorImages(ctx.launches, project, args.images, (imageId) =>
      imageFiles(ctx, imageId),
    );
    const target = await dispatchTarget(ctx.launches, operation);
    return new Authorized({ args: { ...args, ...target } });
  };

async function imageFiles(ctx: OperationContext, imageId: string) {
  const rows: Row[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await ctx.tasks.data.query(
      'ImageFile',
      'imagesByimageId',
      { imageId },
      { nextToken, limit: 100 },
    );
    if (page.errors?.length && !page.data)
      throw new Error(
        `Could not read image files: ${JSON.stringify(page.errors)}`,
      );
    rows.push(...(page.data ?? []));
    nextToken = page.nextToken;
  } while (nextToken);
  return rows;
}

const registration: Authorize = async (ctx, args) => {
  const projectId = stringArg(args, 'projectId');
  await ctx.access.requireSurveyAdmin(projectId);
  await requireRegistrationImages(ctx.launches, projectId, args.metadata);
  const { queueUrl } = await dispatchTarget(
    ctx.launches,
    'runImageRegistration',
  );
  return new Authorized({ args: { ...args, queueUrl } });
};

export const OPERATIONS: Record<string, OperationPolicy> = {
  listUsers: { fn: 'list-users', authorize: signedIn },
  listGroupsForUser: { fn: 'list-groups-for-user', authorize: sysadmin },
  createGroup: { fn: 'create-group', authorize: sysadmin },
  addUserToGroup: {
    fn: 'add-user-to-group',
    authorize: sysadmin,
    guard: {
      fn: 'chainMutationGuard',
      when: (args) => String(args.groupName ?? '').startsWith('chainshare-'),
    },
  },
  removeUserFromGroup: { fn: 'remove-user-from-group', authorize: sysadmin },
  createOrganizationMutation: { fn: 'createOrganization', authorize: sysadmin },
  inviteUserToOrganization: {
    fn: 'inviteUserToOrganization',
    authorize: organizationAdmin('organizationId'),
    fresh: true,
  },
  respondToInvite: { fn: 'respondToInvite', authorize: signedIn },
  removeUserFromOrganization: {
    fn: 'removeUserFromOrganization',
    authorize: organizationAdmin('organizationId'),
    fresh: true,
  },
  updateOrganizationMemberAdmin: {
    fn: 'updateOrganizationMemberAdmin',
    authorize: organizationAdmin('organizationId'),
    fresh: true,
  },
  syncOrganizationGroups: { fn: 'syncOrganizationGroups', authorize: signedIn },
  updateProjectMemberships: {
    fn: 'updateProjectMemberships',
    authorize: surveyAdmin('projectId'),
    fresh: true,
  },
  reportClientError: { fn: 'reportClientError', authorize: signedIn },
  // Large surveys take longer than a request may last; callers do not wait.
  deleteProjectInFull: {
    fn: 'deleteProject',
    authorize: surveyAdmin('projectId'),
    async: true,
    fresh: true,
  },
  recomputeBoundaryStatus: {
    fn: 'recomputeBoundaryStatus',
    authorize: surveyAdmin('projectId'),
    async: true,
  },
  deleteQueueMutation: {
    fn: 'deleteQueue',
    authorize: surveyAdminOf('Queue', 'queueId'),
    fresh: true,
  },
  cancelIndividualIdJob: {
    fn: 'cancelIndividualIdJob',
    authorize: surveyAdminOf('IndividualIdJob', 'jobId'),
    fresh: true,
  },
  launchAnnotationSet: { fn: 'launchAnnotationSet', authorize: launch },
  launchFalseNegatives: { fn: 'launchFalseNegatives', authorize: launch },
  getFalseNegativesStatus: {
    fn: 'launchFalseNegatives',
    authorize: surveyAdmin('projectId'),
  },
  launchQCReview: { fn: 'launchQCReview', authorize: launch },
  launchInfoTags: { fn: 'launchInfoTags', authorize: launch },
  launchHomography: { fn: 'launchHomography', authorize: launch },
  launchIndividualId: { fn: 'launchIndividualId', authorize: launch },
  runImageRegistration: {
    fn: 'runImageRegistration',
    authorize: registration,
  },
  runScoutbot: { fn: 'runScoutbot', authorize: detector('runScoutbot') },
  runMadDetector: {
    fn: 'runMadDetector',
    authorize: detector('runMadDetector'),
  },
  runStormflyDetector: {
    fn: 'runStormflyDetector',
    authorize: detector('runStormflyDetector'),
  },
  runOwlDDetector: {
    fn: 'runOwlDDetector',
    authorize: detector('runOwlDDetector'),
  },
  runElephantDetector: {
    fn: 'runElephantDetector',
    authorize: detector('runElephantDetector'),
  },
  uploadedImagePaths: {
    fn: 'imageAccess',
    authorize: surveyAdmin('projectId'),
  },
  prepareImageUpload: {
    fn: 'imageAccess',
    authorize: surveyAdmin('projectId'),
  },
  createImageMultipartUpload: {
    fn: 'imageAccess',
    authorize: surveyAdmin('projectId'),
  },
  signImageUploadParts: {
    fn: 'imageAccess',
    authorize: surveyAdmin('projectId'),
  },
  completeImageMultipartUpload: {
    fn: 'imageAccess',
    authorize: surveyAdmin('projectId'),
  },
  abortImageMultipartUpload: {
    fn: 'imageAccess',
    authorize: surveyAdmin('projectId'),
  },
  registerImageFile: {
    fn: 'imageAccess',
    authorize: async (ctx, args) => {
      const projectId = stringArg(args, 'projectId');
      await ctx.access.requireSurveyAdmin(projectId);
      await requireInSurvey(ctx, projectId, [['Image', args.imageId]]);
    },
  },
  prepareWorkflowUpload: {
    fn: 'workflowFiles',
    authorize: surveyAdmin('projectId'),
  },
  falseNegativeFileUrl: {
    fn: 'workflowFiles',
    authorize: surveyAdminOf('AnnotationSet', 'annotationSetId'),
  },
  deleteFalseNegativeFiles: {
    fn: 'workflowFiles',
    authorize: surveyAdminOf('AnnotationSet', 'annotationSetId'),
  },
  signImageTiles: { fn: 'imageAccess', authorize: readableImage },
  signImageTilePack: { fn: 'imageAccess', authorize: readableImage },
  imageDownloadUrl: { fn: 'imageAccess', authorize: surveyImage },
  generateTile: { fn: 'generateTile', authorize: readableImage },
  incrementQueueCount: { authorize: queueWorker, run: countObservation },
  // Opening a queue counts as activity, before any task is held.
  touchQueue: {
    authorize: (ctx, args) => workableQueue(ctx.tasks, stringArg(args, 'id')),
    run: async (ctx, args) => ({
      data: await ctx.queues.touch(stringArg(args, 'id')),
    }),
  },
  infoTagWork: {
    fn: 'infoTagWork',
    authorize: infoTagWorker,
    after: async (ctx, args, result) => {
      const request = parsedRequest(args);
      const response =
        typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
      // Completing it, or a claim on an image someone already finished.
      if (response?.status !== 'completed') return;
      await markDone(
        ctx.tasks,
        (l) =>
          l.queueId === request.queueId &&
          (l.writeImageIds ?? l.imageIds).includes(String(request.imageId)),
      );
    },
  },
  // Statistics only: completion comes from the work itself being saved.
  recordWorkflowTask: { fn: 'recordWorkflowTask', authorize: workflowWorker },
  claimIndividualIdTransect: {
    fn: 'claimIndividualIdTransect',
    authorize: async ({ access, models }, args) => {
      const job = await models.load('IndividualIdJob', {
        id: stringArg(args, 'jobId'),
      });
      if (typeof job?.projectId !== 'string') throw forbidden();
      await access.requireSurveyMember(job.projectId);
    },
    after: async (ctx, args, result) => {
      const claim =
        typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
      if (claim?.transectRowId) await holdJob(ctx.tasks, String(args.jobId));
    },
  },
  completeIndividualIdTransect: {
    fn: 'completeIndividualIdTransect',
    authorize: transectHolder,
  },
  snapshotChainShare: { fn: 'createChainShare', authorize: sysadmin },
  revokeChainShare: { fn: 'revokeChainShare', authorize: sysadmin },
  getAdminStats: { fn: 'getAdminStats', authorize: sysadmin },
  // Annotators compare themselves with their teammates; raw events stay with admins.
  queryWorkflowStats: {
    fn: 'queryWorkflowStats',
    authorize: surveyMember('projectId'),
  },
  queryWorkflowEvents: {
    fn: 'queryWorkflowEvents',
    authorize: surveyAdmin('projectId'),
  },
  generateSurveyResults: {
    fn: 'generateSurveyResults',
    authorize: surveyResults,
  },
  jollyStatusUrl: { fn: 'workflowFiles', authorize: surveyResults },
  getRowChunk: { fn: 'getRowChunk', authorize: rowChunk },
  speciesNotebookLabels: {
    authorize: surveyMember('projectId'),
    run: notebook.labels,
  },
  speciesNotebookExamples: {
    authorize: surveyMember('projectId'),
    run: notebook.examples,
  },
  // The token names the survey; crop checks it and the caller's membership.
  speciesNotebookCrop: { authorize: signedIn, run: notebook.crop },
  pingIndividualIdTransect: {
    authorize: ({ tasks }, args) =>
      assignedTransect(tasks, stringArg(args, 'id')),
    run: ping,
  },
};

export const INVOKED_FUNCTIONS = [
  ...new Set(
    Object.values(OPERATIONS).flatMap((op) =>
      [op.fn, op.guard?.fn].filter((fn): fn is string => Boolean(fn)),
    ),
  ),
];
