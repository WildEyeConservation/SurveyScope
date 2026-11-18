import { fetchAuthSession } from 'aws-amplify/auth';
import { events } from 'aws-amplify/data';
import outputs from '../../amplify_outputs.json';
import {
  adminField,
  channelBase,
  DATA_CHANNELS,
  EPOCH_LEAD_MS,
  EPOCH_MS,
  epochAt,
  hasAdminChannel,
} from '../../shared/dataChannels';

type Row = Record<string, unknown>;
type Operation = (...args: unknown[]) => unknown;

const apiUrl = (outputs.custom as { apiUrl?: string }).apiUrl;
const controllers = new WeakMap<Promise<unknown>, AbortController>();
// Channel windows follow the server's clock, learned from API responses.
let clockOffsetMs = 0;
const serverNow = () => Date.now() + clockOffsetMs;

async function post(path: string, body: unknown, signal: AbortSignal) {
  if (!apiUrl)
    throw new Error('The API URL is missing from amplify_outputs.json');
  const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
  if (!token) throw new Error('Not signed in');
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
  const date = Date.parse(response.headers.get('date') ?? '');
  if (Number.isFinite(date)) clockOffsetMs = date - Date.now();
  const json = await response.json().catch(() => null);
  if (response.ok) return json;
  // Deterministic failures come back like GraphQL errors; anything else is retried.
  if (Array.isArray(json?.errors)) return { data: null, errors: json.errors };
  throw new Error(`Request to ${path} failed with ${response.status}`);
}

export function apiRequest(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const request = post(path, body, controller.signal);
  controllers.set(request, controller);
  return request;
}

export function cancelApiRequest(request: Promise<unknown>) {
  const controller = controllers.get(request);
  controller?.abort();
  return Boolean(controller);
}

function eqPins(filter: unknown): Row {
  const pins: Row = {};
  const visit = (f: unknown) => {
    if (!f || typeof f !== 'object') return;
    for (const [key, value] of Object.entries(f as Row)) {
      if (key === 'and' && Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object' && 'eq' in value) {
        pins[key] = (value as Row).eq;
      }
    }
  };
  visit(filter);
  return pins;
}

function matches(item: Row, filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return true;
  return Object.entries(filter as Row).every(([key, condition]) => {
    if (key === 'and')
      return (condition as unknown[]).every((f) => matches(item, f));
    if (key === 'or')
      return (condition as unknown[]).some((f) => matches(item, f));
    if (key === 'not') return !matches(item, condition);
    const c = (condition ?? {}) as Row;
    const value = item[key];
    if ('eq' in c) return value === c.eq;
    if ('ne' in c) return value !== c.ne;
    if ('attributeExists' in c)
      return (value !== undefined && value !== null) === c.attributeExists;
    return true;
  });
}

// Channel paths without their window; the admin one may be refused.
export function channelsForFilter(
  model: string,
  filter: unknown,
): { base: string; optional: boolean }[] {
  const fields = DATA_CHANNELS[model] ?? [];
  const pins = eqPins(filter);
  const field = fields.find((f) => typeof pins[f] === 'string');
  if (!field)
    return fields.includes('*')
      ? [{ base: channelBase(model, 'all', 'all'), optional: false }]
      : [];
  const value = pins[field] as string;
  return [
    { base: channelBase(model, field, value), optional: false },
    ...(hasAdminChannel(model)
      ? [{ base: channelBase(model, adminField(field), value), optional: true }]
      : []),
  ];
}

type Listener = (type: string, item: Row) => void;
const channels = new Map<
  string,
  { listeners: Set<Listener>; close: () => void }
>();

function connect(
  path: string,
  deliver: Listener,
  onError: (e: unknown) => void,
  onReady: () => void,
) {
  let closed = false;
  let close = () => {
    closed = true;
  };
  events
    .connect(path)
    .then((channel) => {
      if (closed) return channel.close();
      const subscription = channel.subscribe({
        next: (message: { event?: { type?: string; item?: Row } }) => {
          const { type, item } = message.event ?? {};
          if (type && item) deliver(type, item);
        },
        error: onError,
      });
      // Only the server's acceptance counts; a refusal arrives through `error`.
      subscription.ready.then(onReady, () => {});
      close = () => {
        subscription.unsubscribe();
        channel.close();
      };
    })
    .catch(onError);
  return () => close();
}

const MAX_JOIN_FAILURES = 3;

// Joins each window's channel before it opens and leaves the old one after.
function rotate(
  base: string,
  deliver: Listener,
  onError: (e: unknown) => void,
  onDead: () => void,
) {
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const open = new Map<number, () => void>();
  const fail = (epoch: number) => (e: unknown) => {
    if (stopped) return;
    open.get(epoch)?.();
    open.delete(epoch);
    failures += 1;
    if (failures >= MAX_JOIN_FAILURES) {
      stop();
      onDead();
      onError(e);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(schedule, 5_000 * failures);
  };
  const join = (epoch: number) => {
    if (!open.has(epoch))
      open.set(
        epoch,
        connect(`${base}/${epoch}`, deliver, fail(epoch), () => {
          failures = 0;
        }),
      );
  };
  const schedule = () => {
    if (stopped) return;
    const now = serverNow();
    const epoch = epochAt(now);
    join(epoch);
    for (const [e, close] of open) {
      if (e < epoch && now - epoch * EPOCH_MS > 15_000) {
        close();
        open.delete(e);
      }
    }
    const boundary = (epoch + 1) * EPOCH_MS;
    const joinAt = boundary - EPOCH_LEAD_MS + Math.random() * 20_000;
    if (now >= joinAt) join(epoch + 1);
    const next = [joinAt, boundary + 15_000].find((t) => t > now) ?? now + 1000;
    clearTimeout(timer);
    timer = setTimeout(schedule, next - now);
  };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    open.forEach((close) => close());
    open.clear();
  };
  schedule();
  return stop;
}

function listen(
  base: string,
  listener: Listener,
  onError: (e: unknown) => void,
) {
  let entry = channels.get(base);
  if (!entry) {
    const listeners = new Set<Listener>();
    const close = rotate(
      base,
      (type, item) => listeners.forEach((l) => l(type, item)),
      onError,
      () => {
        if (channels.get(base) === entry) channels.delete(base);
      },
    );
    entry = { listeners, close };
    channels.set(base, entry);
  }
  entry.listeners.add(listener);
  return () => {
    entry!.listeners.delete(listener);
    if (entry!.listeners.size === 0) {
      channels.delete(base);
      entry!.close();
    }
  };
}

function subscription(model: string, type: 'create' | 'update' | 'delete') {
  return (options?: { filter?: unknown }) => ({
    subscribe(observer: {
      next: (item: Row) => void;
      error?: (e: unknown) => void;
    }) {
      const onError = (e: unknown) => observer.error?.(e);
      const paths = channelsForFilter(model, options?.filter);
      if (paths.length === 0) {
        onError(
          new Error(
            `${model} changes need a filter on ${DATA_CHANNELS[model]?.join(' or ')}`,
          ),
        );
        return { unsubscribe() {} };
      }
      const stops = paths.map(({ base, optional }) =>
        listen(
          base,
          (eventType, item) => {
            if (eventType === type && matches(item, options?.filter))
              observer.next(item);
          },
          // Only admins may join the admin channel.
          optional ? () => {} : onError,
        ),
      );
      return { unsubscribe: () => stops.forEach((stop) => stop()) };
    },
  });
}

interface Introspection {
  models: Record<
    string,
    { attributes?: { type: string; properties?: { queryField?: string } }[] }
  >;
}

export function httpModel(
  model: string,
  introspection: Introspection,
): Record<string, unknown> {
  const ops: Record<string, unknown> = {};
  const indexes = (introspection.models[model]?.attributes ?? [])
    .filter((a) => a.type === 'key' && a.properties?.queryField)
    .map((a) => a.properties!.queryField!);
  for (const op of ['get', 'list', 'create', 'update', 'delete', ...indexes]) {
    ops[op] = (...args: unknown[]) => apiRequest('/data', { model, op, args });
  }
  ops.onCreate = subscription(model, 'create');
  ops.onUpdate = subscription(model, 'update');
  ops.onDelete = subscription(model, 'delete');
  return ops;
}

export function httpOperation(
  type: 'query' | 'mutation',
  name: string,
): Operation {
  return (args?: unknown) =>
    apiRequest('/operation', { type, name, args: args ?? {} });
}
