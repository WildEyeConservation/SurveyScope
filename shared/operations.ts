// Router-only operations, in GraphQL type notation, expanded to model introspection.

type Spec = { returns: string; args?: Record<string, string> };
const op = (returns: string, args?: Record<string, string>): Spec => ({
  returns,
  args,
});

const QUERIES = {
  listUsers: op('ListUsersReturnType', { nextToken: 'String' }),
  listGroupsForUser: op('AWSJSON', { userId: 'String!', nextToken: 'String' }),
  uploadedImagePaths: op('[String]', { projectId: 'ID!', paths: '[String!]!' }),
  signImageUploadParts: op('AWSJSON', {
    projectId: 'ID!',
    originalPath: 'String!',
    uploadId: 'String!',
    partNumbers: '[Int!]!',
  }),
  getFalseNegativesStatus: op('AWSJSON', {
    projectId: 'ID!',
    annotationSetId: 'ID!',
  }),
  falseNegativeFileUrl: op('AWSJSON', {
    annotationSetId: 'ID!',
    kind: 'String!',
  }),
  signImageTiles: op('AWSJSON', {
    imageId: 'ID!',
    sourceKey: 'String!',
    sharedImageId: 'ID',
    tiles: 'AWSJSON!',
  }),
  signImageTilePack: op('AWSJSON', {
    imageId: 'ID!',
    sourceKey: 'String!',
    sharedImageId: 'ID',
  }),
  imageDownloadUrl: op('AWSJSON', { imageId: 'ID!', sourceKey: 'String!' }),
  generateTile: op('[String]', {
    imageKey: 'String!',
    imageId: 'ID!',
    sharedImageId: 'ID',
    zs: '[Int!]!',
    rows: '[Int!]!',
    cols: '[Int!]!',
  }),
  getAdminStats: op('AWSJSON'),
  queryWorkflowStats: op('AWSJSON', {
    projectId: 'String!',
    annotationSetIds: '[String]',
    startDate: 'String',
    endDate: 'String',
  }),
  queryWorkflowEvents: op('AWSJSON', {
    projectId: 'String!',
    runIds: '[String]',
    startAt: 'String',
    endAt: 'String',
    nextToken: 'String',
    limit: 'Int',
    summary: 'Boolean',
  }),
  jollyStatusUrl: op('AWSJSON', {
    surveyId: 'ID!',
    annotationSetId: 'ID!',
    jobId: 'ID!',
  }),
  speciesNotebookLabels: op('AWSJSON', { projectId: 'ID!' }),
  speciesNotebookExamples: op('AWSJSON', { projectId: 'ID!', name: 'String!' }),
  speciesNotebookCrop: op('AWSJSON', { token: 'String!' }),
  getRowChunk: op('AWSJSON', {
    source: 'String!',
    scopeId: 'String!',
    fields: '[String]!',
    beginsWith: 'String',
    between: '[Float]',
    betweenText: '[String]',
    cursor: 'String',
  }),
};

const MUTATIONS = {
  createGroup: op('AWSJSON', { groupName: 'String!' }),
  addUserToGroup: op('AWSJSON', { userId: 'String!', groupName: 'String!' }),
  removeUserFromGroup: op('AWSJSON', {
    userId: 'String!',
    groupName: 'String!',
  }),
  createOrganizationMutation: op('AWSJSON', {
    name: 'String!',
    description: 'String',
    adminEmail: 'String!',
    registrationId: 'String',
  }),
  inviteUserToOrganization: op('AWSJSON', {
    organizationId: 'String!',
    email: 'String!',
  }),
  respondToInvite: op('AWSJSON', { inviteId: 'String!', accept: 'Boolean!' }),
  removeUserFromOrganization: op('AWSJSON', {
    organizationId: 'String!',
    userId: 'String!',
  }),
  updateOrganizationMemberAdmin: op('AWSJSON', {
    organizationId: 'String!',
    userId: 'String!',
    isAdmin: 'Boolean!',
  }),
  syncOrganizationGroups: op('Boolean'),
  updateProjectMemberships: op('AWSJSON', { projectId: 'String!' }),
  reportClientError: op('AWSJSON', {
    message: 'String!',
    stack: 'String',
    status: 'String',
    url: 'String',
    userAgent: 'String',
  }),
  deleteProjectInFull: op('AWSJSON', { projectId: 'String!' }),
  recomputeBoundaryStatus: op('EventInvocationResponse', {
    projectId: 'String!',
  }),
  deleteQueueMutation: op('AWSJSON', { queueId: 'String!' }),
  cancelIndividualIdJob: op('AWSJSON', { jobId: 'String!' }),
  launchAnnotationSet: op('AWSJSON', { request: 'String!' }),
  launchFalseNegatives: op('AWSJSON', { request: 'String!' }),
  launchQCReview: op('AWSJSON', { request: 'String!' }),
  launchInfoTags: op('AWSJSON', { request: 'String!' }),
  launchHomography: op('AWSJSON', { request: 'String!' }),
  launchIndividualId: op('AWSJSON', { request: 'String!' }),
  runImageRegistration: op('AWSJSON', {
    projectId: 'String!',
    metadata: 'String!',
    images: '[String]',
  }),
  runScoutbot: op('AWSJSON', {
    projectId: 'String!',
    images: '[String]',
    setId: 'String!',
    rotation: 'Int',
    landscape: 'Boolean',
  }),
  runMadDetector: op('AWSJSON', {
    projectId: 'String!',
    images: '[String]',
    setId: 'String!',
  }),
  runStormflyDetector: op('AWSJSON', {
    projectId: 'String!',
    images: '[String]',
    setId: 'String!',
    rotation: 'Int',
    landscape: 'Boolean',
  }),
  runOwlDDetector: op('AWSJSON', {
    projectId: 'String!',
    images: '[String]',
    setId: 'String!',
    rotation: 'Int',
    landscape: 'Boolean',
  }),
  runElephantDetector: op('AWSJSON', {
    projectId: 'String!',
    images: '[String]',
    setId: 'String!',
    rotation: 'Int',
    landscape: 'Boolean',
  }),
  prepareImageUpload: op('AWSJSON', {
    projectId: 'ID!',
    originalPath: 'String!',
    contentType: 'String!',
    rotation: 'Int',
  }),
  createImageMultipartUpload: op('AWSJSON', {
    projectId: 'ID!',
    originalPath: 'String!',
    contentType: 'String!',
    rotation: 'Int',
  }),
  completeImageMultipartUpload: op('AWSJSON', {
    projectId: 'ID!',
    originalPath: 'String!',
    uploadId: 'String!',
    parts: 'AWSJSON!',
  }),
  abortImageMultipartUpload: op('Boolean', {
    projectId: 'ID!',
    originalPath: 'String!',
    uploadId: 'String!',
  }),
  registerImageFile: op('AWSJSON', {
    projectId: 'ID!',
    imageId: 'ID!',
    originalPath: 'String!',
  }),
  prepareWorkflowUpload: op('AWSJSON', { kind: 'String!', projectId: 'ID!' }),
  deleteFalseNegativeFiles: op('Boolean', { annotationSetId: 'ID!' }),
  incrementQueueCount: op('Int', { id: 'ID!' }),
  touchQueue: op('Boolean', { id: 'ID!' }),
  infoTagWork: op('AWSJSON', { request: 'String!' }),
  recordWorkflowTask: op('AWSJSON', {
    workflowRunId: 'String!',
    workItemType: 'String!',
    workItemId: 'String!',
    outcome: 'String!',
    idempotencyKey: 'String',
    startedAt: 'String',
    activeTimeMs: 'Int',
    waitingTimeMs: 'Int',
    skipped: 'Boolean',
    metrics: 'AWSJSON',
  }),
  claimIndividualIdTransect: op('AWSJSON', { jobId: 'String!' }),
  completeIndividualIdTransect: op('AWSJSON', { transectRowId: 'String!' }),
  snapshotChainShare: op('AWSJSON', {
    annotationSetId: 'String!',
    shareId: 'String!',
  }),
  revokeChainShare: op('AWSJSON', { shareId: 'String!' }),
  generateSurveyResults: op('AWSJSON', {
    surveyId: 'String!',
    annotationSetId: 'String!',
    categoryIds: '[String]!',
  }),
  pingIndividualIdTransect: op('AWSJSON', { id: 'ID!' }),
};

const TYPES: Record<string, Record<string, string>> = {
  UserType: { name: 'String', id: 'ID!', email: 'String', isAdmin: 'Boolean' },
  ListUsersReturnType: { Users: '[UserType]', NextToken: 'String' },
  EventInvocationResponse: { success: 'Boolean!' },
};

export type OperationType = 'query' | 'mutation';

export interface FieldIntrospection {
  name: string;
  isArray: boolean;
  type: string | { nonModel: string };
  isRequired: boolean;
  isArrayNullable?: boolean;
  attributes?: [];
}

export interface OperationIntrospection extends FieldIntrospection {
  arguments?: Record<string, FieldIntrospection>;
}

function field(name: string, notation: string): FieldIntrospection {
  const match = /^(\[)?(\w+)(!)?(\])?(!)?$/.exec(notation);
  if (!match || Boolean(match[1]) !== Boolean(match[4])) {
    throw new Error(`Unreadable type ${notation} for ${name}`);
  }
  const [, list, base, inner, , outer] = match;
  const type = base in TYPES ? { nonModel: base } : base;
  if (!list) return { name, isArray: false, type, isRequired: Boolean(inner) };
  return {
    name,
    isArray: true,
    type,
    isRequired: Boolean(inner),
    isArrayNullable: !outer,
  };
}

function expand(
  specs: Record<string, Spec>,
): Record<string, OperationIntrospection> {
  return Object.fromEntries(
    Object.entries(specs).map(([name, spec]) => [
      name,
      {
        ...field(name, spec.returns),
        ...(spec.args && {
          arguments: Object.fromEntries(
            Object.entries(spec.args).map(([arg, type]) => [
              arg,
              field(arg, type),
            ]),
          ),
        }),
      },
    ]),
  );
}

export const OPERATIONS_SCHEMA = {
  queries: expand(QUERIES),
  mutations: expand(MUTATIONS),
  nonModels: Object.fromEntries(
    Object.entries(TYPES).map(([name, fields]) => [
      name,
      {
        name,
        fields: Object.fromEntries(
          Object.entries(fields).map(([f, type]) => [
            f,
            { ...field(f, type), attributes: [] },
          ]),
        ),
      },
    ]),
  ),
};

export function operationType(name: string): OperationType | undefined {
  if (Object.prototype.hasOwnProperty.call(QUERIES, name)) return 'query';
  if (Object.prototype.hasOwnProperty.call(MUTATIONS, name)) return 'mutation';
  return undefined;
}

function specOf(name: string): Spec | undefined {
  if (Object.prototype.hasOwnProperty.call(QUERIES, name))
    return (QUERIES as Record<string, Spec>)[name];
  if (Object.prototype.hasOwnProperty.call(MUTATIONS, name))
    return (MUTATIONS as Record<string, Spec>)[name];
  return undefined;
}

export function operationReturnsJson(name: string): boolean {
  return specOf(name)?.returns === 'AWSJSON';
}

// Generous enough for batched image lists and inline launch requests.
export const ARG_LIMITS = {
  listLength: 100_000,
  stringLength: 1_000_000,
  idLength: 1024,
  jsonChars: 2_000_000,
  jsonDepth: 32,
} as const;
const INT_MIN = -(2 ** 31);
const INT_MAX = 2 ** 31 - 1;

function jsonDepthWithin(value: unknown, limit: number): boolean {
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (typeof node !== 'object' || node === null) continue;
    if (depth > limit) return false;
    for (const child of Object.values(node)) stack.push([child, depth + 1]);
  }
  return true;
}

function jsonMatches(value: unknown): boolean {
  let parsed: unknown = value;
  let text: string | undefined;
  try {
    if (typeof value === 'string') {
      if (value.length > ARG_LIMITS.jsonChars) return false;
      parsed = JSON.parse(value);
    } else {
      text = JSON.stringify(value);
      if (text === undefined || text.length > ARG_LIMITS.jsonChars)
        return false;
    }
  } catch {
    return false;
  }
  return jsonDepthWithin(parsed, ARG_LIMITS.jsonDepth);
}

function scalarMatches(base: string, value: unknown): boolean {
  switch (base) {
    case 'String':
      return (
        typeof value === 'string' && value.length <= ARG_LIMITS.stringLength
      );
    case 'ID':
      return typeof value === 'string' && value.length <= ARG_LIMITS.idLength;
    case 'Int':
      return (
        Number.isInteger(value) &&
        (value as number) >= INT_MIN &&
        (value as number) <= INT_MAX
      );
    case 'Float':
      return typeof value === 'number' && Number.isFinite(value);
    case 'Boolean':
      return typeof value === 'boolean';
    case 'AWSJSON':
      return value !== undefined && jsonMatches(value);
    default:
      return false;
  }
}

// The router has no GraphQL layer, so it checks arguments against these specs.
export function operationArgsError(
  name: string,
  args: Record<string, unknown>,
): string | null {
  const spec = specOf(name);
  if (!spec) return `Unknown operation ${name}`;
  const declared = spec.args ?? {};
  for (const key of Object.keys(args)) {
    if (!Object.prototype.hasOwnProperty.call(declared, key))
      return `${name} takes no argument ${key}`;
  }
  for (const [key, notation] of Object.entries(declared)) {
    const f = field(key, notation);
    const base = typeof f.type === 'string' ? f.type : f.type.nonModel;
    const value = args[key];
    const required = f.isArray ? !f.isArrayNullable : f.isRequired;
    if (value === undefined || value === null) {
      if (required) return `${name} needs ${key}`;
      continue;
    }
    if (!f.isArray) {
      if (!scalarMatches(base, value)) return `${key} must be ${notation}`;
      continue;
    }
    if (!Array.isArray(value)) return `${key} must be ${notation}`;
    if (value.length > ARG_LIMITS.listLength)
      return `${key} has more than ${ARG_LIMITS.listLength} items`;
    for (const item of value) {
      if (item === null || item === undefined) {
        if (f.isRequired) return `${key} must be ${notation}`;
      } else if (!scalarMatches(base, item)) {
        return `${key} must be ${notation}`;
      }
    }
  }
  return null;
}
