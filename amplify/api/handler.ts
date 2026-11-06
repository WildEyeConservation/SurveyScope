import { operationReturnsJson, operationType } from '../../shared/operations';
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
import { type Row, SchemaInfo } from './schema';
import type { TaskContext } from './tasks';
import * as tasks from './tasks';
import { dynamoLeaseTable, sqsTaskQueue } from './taskStore';

interface HttpEvent {
  rawPath: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
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

async function requestContext(actor: Actor) {
  const { client, introspection } = await amplifyData();
  const schema = new SchemaInfo(introspection);
  const store = new AmplifyAccessStore(client, dynamoLeaseTable);
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
    queue: sqsTaskQueue,
    leases: dynamoLeaseTable,
    neighbours: (imageId) => store.neighbours(imageId),
  };
  return {
    schema,
    access,
    models,
    data,
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

function decodeClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new ApiError(401, 'Unauthorized', 'Missing token');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

// Token verification is delegated to API Gateway's JWT authorizer.
function actorFromHeaders(headers: HttpEvent['headers'] = {}): Actor {
  const header = headers.authorization ?? headers.Authorization ?? '';
  const claims = decodeClaims(header.replace(/^Bearer\s+/i, ''));
  if (claims.token_use !== 'access' || typeof claims.sub !== 'string') {
    throw new ApiError(401, 'Unauthorized', 'An access token is required');
  }
  const groups = claims['cognito:groups'];
  return {
    sub: claims.sub,
    username:
      typeof claims.username === 'string' ? claims.username : claims.sub,
    groups: Array.isArray(groups)
      ? groups.filter((g): g is string => typeof g === 'string')
      : [],
    claims,
  };
}

async function runOperation(ctx: Context, body: Row): Promise<Result> {
  const { type, name } = body;
  if ((type !== 'query' && type !== 'mutation') || typeof name !== 'string') {
    throw badRequest('Invalid operation');
  }
  const policy = OPERATIONS[name];
  if (!policy || operationType(name) !== type)
    throw forbidden(`${name} is not available`);
  const given = isObject(body.args) ? body.args : {};
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

async function route(path: string, actor: Actor, body: Row): Promise<Result> {
  const ctx = await requestContext(actor);
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
    case '/results/link':
      return results.link(ctx, body);
    case '/results/share':
      return results.share(ctx, body);
    case '/results/redeem':
      return results.redeem(ctx, body);
    default:
      throw new ApiError(404, 'NotFound', `No route ${path}`);
  }
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
    const actor = actorFromHeaders(event.headers);
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
    return json(200, await route(event.rawPath, actor, body));
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
    const [namespace, model, field, value] = event.info.channel.segments;
    if (
      event.info.operation !== 'SUBSCRIBE' ||
      namespace !== 'data' ||
      !identity?.sub
    ) {
      return { error: 'Unauthorized' };
    }
    const ctx = await requestContext({
      sub: identity.sub,
      username: identity.username ?? identity.sub,
      groups: identity.groups ?? [],
      claims: identity.claims ?? {},
    });
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
