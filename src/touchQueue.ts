const HOUR_MS = 60 * 60 * 1000;
const lastTouched = new Map<string, number>();

// Resolve dynamically because client types come from deployed outputs.
export async function touchQueue(
  client: { mutations: unknown },
  id: string,
  force = false
): Promise<boolean> {
  const now = Date.now();
  if (!force && now - (lastTouched.get(id) ?? 0) < HOUR_MS) return true;
  const touch = (client.mutations as Record<string, unknown>).touchQueue;
  if (typeof touch !== 'function') return false;
  lastTouched.set(id, now);
  try {
    const { errors } = await (
      touch as (args: { id: string }) => Promise<{ errors?: unknown[] }>
    )({ id });
    if (errors?.length) throw new Error(JSON.stringify(errors));
    return true;
  } catch (error) {
    lastTouched.delete(id);
    console.warn('touchQueue failed', error);
    return false;
  }
}
