// Match SQS visibility so failed or abandoned tasks can be redelivered.
export function createLocationLeases(
  leaseMs: number,
  now: () => number = () => Date.now(),
) {
  const until = new Map<string, number>();
  return {
    claim(locationId: string): boolean {
      const expires = until.get(locationId);
      if (expires !== undefined && expires > now()) return false;
      until.set(locationId, now() + leaseMs);
      return true;
    },
    release(locationId: string) {
      until.delete(locationId);
    },
  };
}
