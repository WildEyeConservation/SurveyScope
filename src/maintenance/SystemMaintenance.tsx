import { MaintenanceContext } from './context';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Hub } from 'aws-amplify/utils';
import {
  getMaintenance,
  setMaintenance,
  subscribeMaintenance,
  getUserAnnouncement,
  subscribeUserAnnouncement,
} from './api';
import {
  setMaintenanceAccessBlocked,
  type MaintenanceInput,
  type MaintenanceState,
} from './state';

export function SystemMaintenanceProvider({
  children,
  isSysadmin,
}: {
  children: ReactNode;
  isSysadmin: boolean;
}) {
  const [state, setState] = useState<MaintenanceState | null>(null);
  const [userState, setUserState] = useState<MaintenanceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const clock = useRef({ server: Date.now(), monotonic: performance.now() });
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const acceptRef = useRef<(next: MaintenanceState) => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let reading = false;
    const subscriptions: { unsubscribe(): void }[] = [];
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const makeAccept = (setter: (state: MaintenanceState) => void) => {
      let revision = -1;
      return (next: MaintenanceState) => {
        if (disposed || next.revision < revision) return;
        revision = next.revision;
        setter(next);
      };
    };
    const accept = makeAccept(setState);
    const acceptUser = makeAccept(setUserState);
    const unsubscribe = () => {
      subscriptions
        .splice(0)
        .forEach((subscription) => subscription.unsubscribe());
    };
    acceptRef.current = accept;
    const refresh = async () => {
      if (reading || disposed) return;
      reading = true;
      try {
        const [next, personal] = await Promise.all([
          getMaintenance(),
          getUserAnnouncement(),
        ]);
        if (disposed) return;
        // Only query responses set the clock; subscription events may be delayed.
        clock.current = {
          server: Date.parse(next.serverTime),
          monotonic: performance.now(),
        };
        setNow(clock.current.server);
        accept(next);
        acceptUser(personal);
        setError(null);
      } catch {
        if (!disposed)
          setError('Unable to verify app availability. Reconnecting…');
      } finally {
        reading = false;
      }
    };
    refreshRef.current = refresh;
    const connect = () => {
      if (disposed) return;
      unsubscribe();
      const retry = () => {
        if (disposed || reconnect) return;
        void refresh();
        reconnect = setTimeout(() => {
          reconnect = undefined;
          connect();
        }, 5000);
      };
      try {
        subscriptions.push(
          subscribeUserAnnouncement((next) => {
            acceptUser(next);
            void refresh();
          }, retry)
        );
        subscriptions.push(
          subscribeMaintenance((next) => {
            accept(next);
            void refresh();
          }, retry)
        );
      } catch {
        retry();
      }
      void refresh();
    };
    const stopHub = Hub.listen('api', ({ payload }) => {
      if (payload.event === 'ConnectionStateChange') void refresh();
    });
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visible);
    connect();
    const poll = setInterval(refresh, 15000);
    const tick = setInterval(
      () =>
        setNow(
          clock.current.server + performance.now() - clock.current.monotonic
        ),
      250
    );
    return () => {
      disposed = true;
      unsubscribe();
      if (reconnect) clearTimeout(reconnect);
      clearInterval(poll);
      clearInterval(tick);
      stopHub();
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', visible);
      setMaintenanceAccessBlocked(false);
    };
  }, []);

  const save = async (input: MaintenanceInput) => {
    const next = await setMaintenance(input);
    acceptRef.current(next);
    await refreshRef.current();
  };
  return (
    <MaintenanceContext.Provider
      value={{
        state,
        userState,
        now,
        error,
        refresh: () => refreshRef.current(),
        save,
        isSysadmin,
      }}
    >
      {children}
    </MaintenanceContext.Provider>
  );
}
