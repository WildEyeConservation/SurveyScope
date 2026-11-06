import { fetchAuthSession } from 'aws-amplify/auth';
import { events } from 'aws-amplify/data';
import outputs from '../../amplify_outputs.json';
import { channelPath, DATA_CHANNELS } from '../../shared/dataChannels';

type Row = Record<string, unknown>;
type Operation = (...args: unknown[]) => unknown;

const apiUrl = (outputs.custom as { apiUrl?: string }).apiUrl;
const controllers = new WeakMap<Promise<unknown>, AbortController>();

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

export function channelFor(model: string, filter: unknown): string | undefined {
  const fields = DATA_CHANNELS[model] ?? [];
  const pins = eqPins(filter);
  const field = fields.find((f) => typeof pins[f] === 'string');
  if (field) return channelPath(model, field, pins[field] as string);
  return fields.includes('*') ? channelPath(model, 'all', 'all') : undefined;
}

type Listener = (type: string, item: Row) => void;
const channels = new Map<
  string,
  { listeners: Set<Listener>; close: () => void }
>();

function listen(
  path: string,
  listener: Listener,
  onError: (e: unknown) => void,
) {
  let entry = channels.get(path);
  if (!entry) {
    const listeners = new Set<Listener>();
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
            if (type && item) listeners.forEach((l) => l(type, item));
          },
          error: onError,
        });
        close = () => {
          subscription.unsubscribe();
          channel.close();
        };
      })
      .catch(onError);
    entry = { listeners, close: () => close() };
    channels.set(path, entry);
  }
  entry.listeners.add(listener);
  return () => {
    entry!.listeners.delete(listener);
    if (entry!.listeners.size === 0) {
      channels.delete(path);
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
      const path = channelFor(model, options?.filter);
      if (!path) {
        onError(
          new Error(
            `${model} changes need a filter on ${DATA_CHANNELS[model]?.join(' or ')}`,
          ),
        );
        return { unsubscribe() {} };
      }
      const stop = listen(
        path,
        (eventType, item) => {
          if (eventType === type && matches(item, options?.filter))
            observer.next(item);
        },
        onError,
      );
      return { unsubscribe: stop };
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
