import { useEffect, useRef } from 'react';
import { client } from '../../stores/appClient';

const PING_MIN_INTERVAL_MS = 60_000;
// Matches the server-side release window so the user is bounced before the cron frees their transect.
const IDLE_LIMIT_MS = 30 * 60_000;
const IDLE_CHECK_MS = 60_000;

export function useActivityHeartbeat(params: {
  transectRowId: string | null | undefined;
  onLost: () => void;
}) {
  const { transectRowId, onLost } = params;
  const lastActivityRef = useRef<number>(Date.now());
  const lastPingRef = useRef<number>(0);
  const onLostRef = useRef(onLost);
  useEffect(() => {
    onLostRef.current = onLost;
  }, [onLost]);

  useEffect(() => {
    if (!transectRowId) return;
    let cancelled = false;

    const ping = async () => {
      try {
        const res: any = await (
          client as any
        ).mutations.pingIndividualIdTransect(
          { id: transectRowId },
          { retry: false }
        );
        if (res?.errors && res.errors.length > 0 && !cancelled) {
          onLostRef.current();
        }
      } catch {
        // Conditional write failed — transect was released by the cron.
        if (!cancelled) onLostRef.current();
      }
    };

    const onActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      if (now - lastPingRef.current >= PING_MIN_INTERVAL_MS) {
        lastPingRef.current = now;
        void ping();
      }
    };

    // Ping immediately so the release window restarts from "now".
    lastActivityRef.current = Date.now();
    lastPingRef.current = Date.now();
    void ping();

    window.addEventListener('pointerdown', onActivity, true);
    window.addEventListener('keydown', onActivity, true);

    const idleTimer = setInterval(() => {
      if (Date.now() - lastActivityRef.current > IDLE_LIMIT_MS && !cancelled) {
        onLostRef.current();
      }
    }, IDLE_CHECK_MS);

    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', onActivity, true);
      window.removeEventListener('keydown', onActivity, true);
      clearInterval(idleTimer);
    };
  }, [transectRowId]);
}
