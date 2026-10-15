import type { BoundaryStatus } from '../../../shared/boundaryStatus';

export function boundaryStatusChange(
  current: BoundaryStatus | null | undefined,
  next: BoundaryStatus | null
): 'skip' | 'set' | 'remove' {
  if ((current ?? 'inside') === (next ?? 'inside')) return 'skip';
  return next ? 'set' : 'remove';
}

export interface RecomputeLease {
  // False when another run holds the lease.
  acquire(): Promise<boolean>;
  // Expiry of the current lease, which its holder keeps extending.
  current(): Promise<string | null>;
  // False when a new request arrived during the pass.
  release(): Promise<boolean>;
  // Clears the request and extends the lease before another pass.
  renew(): Promise<void>;
}

export async function runSerialized(
  lease: RecomputeLease,
  pass: () => Promise<void>,
  options: { sleep: (ms: number) => Promise<void>; holderCheckMs: number }
): Promise<number> {
  for (;;) {
    if (await lease.acquire()) break;
    const seen = await lease.current();
    await options.sleep(options.holderCheckMs);
    const now = await lease.current();
    if (now && now !== seen) return 0;
  }
  let passes = 0;
  for (;;) {
    passes += 1;
    await pass();
    if (await lease.release()) return passes;
    await lease.renew();
  }
}
