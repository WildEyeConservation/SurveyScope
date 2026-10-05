import { MaintenanceContext } from './context';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Hub } from 'aws-amplify/utils';
import * as maintenanceApi from './api';
import {
  canReloadForMaintenance,
  setMaintenanceAccessBlocked,
  type MaintenanceInput,
  type MaintenanceState,
} from './state';

export function SystemMaintenanceProvider({
  children,
  isSysadmin,
  api = maintenanceApi,
}: {
  children: ReactNode;
  isSysadmin: boolean;
  api?: Pick<
    typeof maintenanceApi,
    | 'getMaintenance'
    | 'getUserAnnouncement'
    | 'setMaintenance'
    | 'subscribeMaintenance'
    | 'subscribeUserAnnouncement'
  >;
}) {
  const [state, setState] = useState<MaintenanceState | null>(null);
  const [userState, setUserState] = useState<MaintenanceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Number.NaN);
  const clock = useRef({ server: Number.NaN, monotonic: performance.now() });
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const acceptRef = useRef<(next: MaintenanceState) => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let reading = false;
    let readId = 0;
    let readController: AbortController | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
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
    const invalidate = () => {
      if (disposed) return;
      readId++;
      reading = false;
      clearTimeout(deadline);
      readController?.abort();
      // Block synchronously: the upload online listener runs before refresh.
      if (!isSysadmin)
        setMaintenanceAccessBlocked(true, canReloadForMaintenance());
      setError('Unable to verify app availability. Reconnecting…');
    };
    const refresh = async () => {
      if (reading || disposed) return;
      if (navigator.onLine === false) {
        invalidate();
        return;
      }
      reading = true;
      const currentRead = ++readId;
      readController = new AbortController();
      deadline = setTimeout(invalidate, 10000);
      try {
        const [next, personal] = await Promise.all([
          api.getMaintenance(readController.signal),
          api.getUserAnnouncement(undefined, readController.signal),
        ]);
        if (disposed || currentRead !== readId) return;
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
        if (currentRead === readId) invalidate();
      } finally {
        if (currentRead === readId) {
          reading = false;
          clearTimeout(deadline);
        }
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
          api.subscribeUserAnnouncement((next) => {
            acceptUser(next);
            void refresh();
          }, retry)
        );
        subscriptions.push(
          api.subscribeMaintenance((next) => {
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
    window.addEventListener('offline', invalidate);
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
      readController?.abort();
      clearTimeout(deadline);
      unsubscribe();
      if (reconnect) clearTimeout(reconnect);
      clearInterval(poll);
      clearInterval(tick);
      stopHub();
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', invalidate);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [api, isSysadmin]);

  const save = async (input: MaintenanceInput) => {
    const next = await api.setMaintenance(input);
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
