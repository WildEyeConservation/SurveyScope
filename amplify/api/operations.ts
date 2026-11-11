import { ROW_SOURCES } from '../../shared/rowSources';
import type { Access } from './access';
import {
  dispatchTarget,
  requireDetectorImages,
  requireRegistrationImages,
} from './dispatch';
import { badRequest, forbidden } from './errors';
import { authorizeLaunch, type LaunchStore } from './launch';
import type { Models, Result } from './models';
import type { QueueActivity } from './queueStore';
import type { Row } from './schema';
import {
  assignedTransect,
  holdJob,
  workableQueue,
  type TaskContext,
} from './tasks';

export interface OperationContext {
  access: Access;
  models: Models;
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

const readableImage: Authorize = async ({ access, models }, args) => {
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
    if (
      !access.isSysadmin &&
      !access.actor.groups.includes(`chainshare-${shared.shareId}`)
    ) {
      throw forbidden();
    }
    return;
  }
  const image = await models.load('Image', { id: stringArg(args, 'imageId') });
  if (!image || !(await models.allows('Image', 'read', image)))
    throw forbidden();
};

const transectHolder: Authorize = ({ tasks }, args) =>
  assignedTransect(tasks, stringArg(args, 'transectRowId'));

const queueWorker: Authorize = async ({ access, models }, args) => {
  const id = stringArg(args, 'id');
  const queue = await models.load('Queue', { id });
  if (typeof queue?.projectId !== 'string') throw forbidden();
  if ((await access.surveyStanding(queue.projectId))?.role === 'admin') return;
  if (!(await access.tasks()).leases.some((l) => l.queueId === id))
    throw forbidden();
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
  const tasks = await ctx.access.tasks();
  if (
    !tasks.leases.some(
      (l) => l.queueId === queue.id && tasks.image(request.imageId),
    )
  ) {
    throw forbidden();
  }
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
  const source =
    ROW_SOURCES[stringArg(args, 'source') as keyof typeof ROW_SOURCES];
  if (!source) throw badRequest('Unknown source');
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
    await requireDetectorImages(ctx.launches, project, args.images);
    const target = await dispatchTarget(ctx.launches, operation);
    return new Authorized({ args: { ...args, ...target } });
  };

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
  },
  respondToInvite: { fn: 'respondToInvite', authorize: signedIn },
  removeUserFromOrganization: {
    fn: 'removeUserFromOrganization',
    authorize: organizationAdmin('organizationId'),
  },
  updateOrganizationMemberAdmin: {
    fn: 'updateOrganizationMemberAdmin',
    authorize: organizationAdmin('organizationId'),
  },
  syncOrganizationGroups: { fn: 'syncOrganizationGroups', authorize: signedIn },
  updateProjectMemberships: {
    fn: 'updateProjectMemberships',
    authorize: surveyAdmin('projectId'),
  },
  reportClientError: { fn: 'reportClientError', authorize: signedIn },
  deleteProjectInFull: {
    fn: 'deleteProject',
    authorize: surveyAdmin('projectId'),
  },
  recomputeBoundaryStatus: {
    fn: 'recomputeBoundaryStatus',
    authorize: surveyAdmin('projectId'),
    async: true,
  },
  deleteQueueMutation: {
    fn: 'deleteQueue',
    authorize: surveyAdminOf('Queue', 'queueId'),
  },
  cancelIndividualIdJob: {
    fn: 'cancelIndividualIdJob',
    authorize: surveyAdminOf('IndividualIdJob', 'jobId'),
  },
  launchAnnotationSet: { fn: 'launchAnnotationSet', authorize: launch },
  launchFalseNegatives: { fn: 'launchFalseNegatives', authorize: launch },
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
  imageDownloadUrl: { fn: 'imageAccess', authorize: readableImage },
  generateTile: { fn: 'generateTile', authorize: readableImage },
  incrementQueueCount: {
    authorize: queueWorker,
    run: async (ctx, args) => ({
      data: await ctx.queues.recordObservation(stringArg(args, 'id')),
    }),
  },
  // Opening a queue counts as activity, before any task is held.
  touchQueue: {
    authorize: (ctx, args) => workableQueue(ctx.tasks, stringArg(args, 'id')),
    run: async (ctx, args) => ({
      data: await ctx.queues.touch(stringArg(args, 'id')),
    }),
  },
  infoTagWork: { fn: 'infoTagWork', authorize: infoTagWorker },
  recordWorkflowTask: { fn: 'recordWorkflowTask', authorize: signedIn },
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
  queryWorkflowStats: {
    fn: 'queryWorkflowStats',
    authorize: surveyAdmin('projectId'),
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
