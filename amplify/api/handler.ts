import {
  AdminListGroupsForUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { joinableEpochs } from '../../shared/dataChannels';
import {
  operationArgsError,
  operationReturnsJson,
  operationType,
} from '../../shared/operations';
import type { NotebookCrop } from '../../shared/speciesNotebook';
import { Access, type Actor } from './access';
import { AmplifyAccessStore, AmplifyDataLayer, amplifyData } from './data';
import { ApiError, badRequest, forbidden } from './errors';
import { invokeFunction, invokeResolver, resolverIdentity } from './invoke';
import { launchStore } from './launchStore';
import { Models, type Result, type WriteGuard } from './models';
import { Authorized, OPERATIONS } from './operations';
import { POLICIES } from './policies';
import { dynamoQueueActivity } from './queueStore';
import * as results from './results';
import { SchemaInfo, type Row } from './schema';
import * as tasks from './tasks';
import { noteSavedWork, type TaskContext } from './tasks';
import { dynamoLeaseTable, sqsTaskQueue } from './taskStore';

interface HttpEvent {
  rawPath: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: {
    http: { method: string };
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
}

interface EventsRequest {
  identity?: {
    sub?: string;
    username?: string;
    groups?: string[] | null;
    claims?: Record<string, unknown>;
  } | null;
  info: { operation: string; channel: { segments: string[] } };
}

const isObject = (v: unknown): v is Row =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const cognito = new CognitoIdentityProviderClient({});

// Token groups can outlive a removal by up to an hour, so privileged ones are rechecked.
const LIVE_GROUP = (group: string) =>
  group === 'sysadmin' || group.startsWith('chainshare-');

async function liveGroups(actor: Actor): Promise<string[]> {
  if (!actor.groups.some(LIVE_GROUP)) return actor.groups;
  const current = new Set<string>();
  let nextToken: string | undefined;
  do {
    const page = await cognito.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: actor.username,
        NextToken: nextToken,
      }),
    );
    for (const group of page.Groups ?? [])
      if (group.GroupName) current.add(group.GroupName);
    nextToken = page.NextToken;
  } while (nextToken);
  return actor.groups.filter((g) => !LIVE_GROUP(g) || current.has(g));
}

async function requestContext(token: Actor, fresh = false) {
  const actor = { ...token, groups: await liveGroups(token) };
  const { client, introspection } = await amplifyData();
  const schema = new SchemaInfo(introspection);
  const store = new AmplifyAccessStore(client, dynamoLeaseTable, fresh);
  const access = new Access(actor, store);
  const data = new AmplifyDataLayer(client);
  const guard: WriteGuard = async (fn, fieldName, input) => {
    const identity = resolverIdentity(actor, await access.organizationIds());
    const verdict = await invokeFunction(fn, { identity, fieldName, input });
    return !verdict.failed && verdict.result === true;
  };
  const models = new Models(access, data, schema, POLICIES, guard);
  const tasks: TaskContext = {
    access,
    models,
    data,
    queue: sqsTaskQueue,
    leases: dynamoLeaseTable,
    neighbours: (imageId) => store.neighbours(imageId),
  };
  models.afterWrite = (model, op, row) => noteSavedWork(tasks, model, op, row);
  const images = {
    crop: async (imageId: string, point: { x: number; y: number }) => {
      const result = await invokeResolver('imageAccess', {
        typeName: 'Query',
        fieldName: 'speciesNotebookCrop',
        arguments: { imageId, ...point },
        identity: resolverIdentity(actor, await access.organizationIds()),
      });
      if (result.errors?.length) throw new Error('Could not load the image');
      return (result.data ?? null) as NotebookCrop | null;
    },
  };
  return {
    schema,
    access,
    models,
    data,
    images,
    secret: () => {
      if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
      return process.env.JWT_SECRET;
    },
    tasks,
    launches: launchStore,
    queues: dynamoQueueActivity,
    update: (model: string, input: Row) => data.update(model, input, {}),
  };
}

type Context = Awaited<ReturnType<typeof requestContext>>;

// HTTP APIs pass list claims as "[a b]".
function claimList(value: unknown): string[] {
  if (Array.isArray(value))
    return value.filter((g): g is string => typeof g === 'string');
  if (typeof value !== 'string') return [];
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  return inner ? inner.split(/\s+/).filter(Boolean) : [];
}

// Only claims API Gateway's authorizer has verified are used.
function actorFromEvent(event: HttpEvent): Actor {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (
    !claims ||
    claims.token_use !== 'access' ||
    typeof claims.sub !== 'string' ||
    claims.sub === ''
  ) {
    throw new ApiError(401, 'Unauthorized', 'An access token is required');
  }
  return {
    sub: claims.sub,
    username:
      typeof claims.username === 'string' && claims.username !== ''
        ? claims.username
        : claims.sub,
    groups: claimList(claims['cognito:groups']),
    claims,
  };
}

async function runOperation(ctx: Context, body: Row): Promise<Result> {
  const { type, name } = body;
  if ((type !== 'query' && type !== 'mutation') || typeof name !== 'string') {
    throw badRequest('Invalid operation');
  }
  const policy = Object.hasOwn(OPERATIONS, name) ? OPERATIONS[name] : undefined;
  if (!policy || operationType(name) !== type)
    throw forbidden(`${name} is not available`);
  const given = isObject(body.args) ? body.args : {};
  const invalid = operationArgsError(name, given);
  if (invalid) throw badRequest(invalid);
  const verdict = await policy.authorize(ctx, given);
  const grant = verdict instanceof Authorized ? verdict.grant : {};
  const args = grant.args ?? given;
  if (policy.run) return policy.run(ctx, args);
  if (!policy.fn) throw forbidden();
  const identity = resolverIdentity(ctx.access.actor, [
    ...(await ctx.access.organizationIds()),
    ...(grant.groups ?? []),
  ]);
  if (policy.guard?.when(args)) {
    const guard = await invokeFunction(policy.guard.fn, {
      identity,
      fieldName: name,
      input: args,
    });
    if (guard.failed || guard.result !== true) throw forbidden();
  }
  const result = await invokeResolver(
    policy.fn,
    {
      typeName: type === 'query' ? 'Query' : 'Mutation',
      fieldName: name,
      arguments: args,
      identity,
    },
    policy.async,
  );
  if (!result.errors?.length) await policy.after?.(ctx, args, result);
  if (
    result.data !== null &&
    result.data !== undefined &&
    typeof result.data !== 'string' &&
    operationReturnsJson(name)
  ) {
    return { ...result, data: JSON.stringify(result.data) };
  }
  return result;
}

// Writes that grant or remove access are checked without the grant cache.
const FRESH_MODELS = new Set([
  'UserProjectMembership',
  'OrganizationMembership',
  'Project',
  'TestPreset',
  'TestPresetProject',
  'JollyResultsMembership',
  'ResultSharingToken',
]);

async function route(path: string, actor: Actor, body: Row): Promise<Result> {
  const name = path === '/operation' ? body.name : undefined;
  const fresh =
    (typeof name === 'string' &&
      Object.hasOwn(OPERATIONS, name) &&
      Boolean(OPERATIONS[name].fresh)) ||
    (path === '/data' &&
      ['create', 'update', 'delete'].includes(String(body.op)) &&
      FRESH_MODELS.has(String(body.model)));
  const ctx = await requestContext(actor, fresh);
  switch (path) {
    case '/data': {
      const { model, op, args } = body;
      if (typeof model !== 'string' || typeof op !== 'string')
        throw badRequest('Invalid request');
      return ctx.models.run(model, op, Array.isArray(args) ? args : []);
    }
    case '/operation':
      return runOperation(ctx, body);
    case '/tasks/receive':
      return tasks.receive(ctx.tasks, body);
    case '/tasks/receive-batch':
      return tasks.receiveBatch(ctx.tasks, body);
    case '/tasks/ack':
      return tasks.ack(ctx.tasks, body);
    case '/tasks/visibility':
      return tasks.visibility(ctx.tasks, body);
    case '/tasks/depth':
      return tasks.depth(ctx.tasks, body);
    case '/tasks/test':
      return tasks.test(ctx.tasks, body);
    case '/tasks/test/submit':
      return tasks.submitTest(ctx.tasks, body);
    case '/results/link':
      return results.link(ctx, body);
    case '/results/share':
      return results.share(ctx, body);
    case '/results/revoke':
      return results.revoke(ctx, body);
    case '/results/redeem':
      return results.redeem(ctx, body);
    default:
      throw new ApiError(404, 'NotFound', `No route ${path}`);
  }
}

// API Gateway gives up at 30 seconds; answer first so the client does not retry.
const DEADLINE_MS = 27_000;

function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ApiError(
            504,
            'Timeout',
            'The request is taking too long and may still finish. Check before trying again.',
          ),
        ),
      DEADLINE_MS,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function http(event: HttpEvent) {
  try {
    if (event.requestContext.http.method !== 'POST')
      throw new ApiError(405, 'BadRequest', 'POST only');
    const actor = actorFromEvent(event);
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : (event.body ?? '');
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      throw badRequest('Invalid JSON');
    }
    if (!isObject(body)) throw badRequest('Invalid request');
    return json(200, await withDeadline(route(event.rawPath, actor, body)));
  } catch (error) {
    if (error instanceof ApiError) {
      return json(error.status, {
        errors: [{ errorType: error.errorType, message: error.message }],
      });
    }
    console.error('Request failed', error);
    return json(500, {
      errors: [{ errorType: 'InternalError', message: 'Internal error' }],
    });
  }
}

async function subscribe(event: EventsRequest) {
  try {
    const identity = event.identity;
    const segments = event.info.channel.segments;
    const [namespace, model, field, value, epoch] = segments;
    if (
      event.info.operation !== 'SUBSCRIBE' ||
      namespace !== 'data' ||
      segments.length !== 5 ||
      !joinableEpochs(Date.now()).map(String).includes(epoch) ||
      !identity?.sub
    ) {
      return { error: 'Unauthorized' };
    }
    const ctx = await requestContext(
      {
        sub: identity.sub,
        username: identity.username ?? identity.sub,
        groups: identity.groups ?? [],
        claims: identity.claims ?? {},
      },
      true,
    );
    const allowed =
      Boolean(model && field && value) &&
      (await ctx.models.canSubscribe(model, field, value));
    return allowed ? null : { error: 'Unauthorized' };
  } catch (error) {
    if (!(error instanceof ApiError))
      console.error('Subscribe check failed', error);
    return { error: 'Unauthorized' };
  }
}

export const handler = async (event: HttpEvent | EventsRequest) =>
  'info' in event && event.info?.channel
    ? subscribe(event)
    : http(event as HttpEvent);
