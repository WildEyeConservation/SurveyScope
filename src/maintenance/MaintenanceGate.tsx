import {
  useLayoutEffect,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button, Modal, Spinner } from 'react-bootstrap';
import { useQueryClient } from '@tanstack/react-query';
import { useSystemMaintenance } from './context';
import { MaintenanceBanner } from './MaintenanceBanner';
import { maintenancePhase, setMaintenanceAccessBlocked } from './state';

export function MaintenanceGate({
  children,
  signOut,
  pauseUploads,
  resumeUploads,
}: {
  children: ReactNode;
  signOut: () => void;
  pauseUploads: () => void;
  resumeUploads: () => void;
}) {
  const { state, userState, now, error, refresh, isSysadmin } =
    useSystemMaintenance();
  const queryClient = useQueryClient();
  const phase = maintenancePhase(state, now);
  const blocked =
    !isSysadmin &&
    (phase === 'blocked' || maintenancePhase(userState, now) === 'blocked');
  const [wasBlocked, setWasBlocked] = useState(false);
  const unavailable =
    !isSysadmin &&
    (!state ||
      !userState ||
      !Number.isFinite(now) ||
      !!error ||
      blocked ||
      wasBlocked);

  useLayoutEffect(
    () => () => {
      // Transfers and queued calls outlive the signed-in workspace.
      setMaintenanceAccessBlocked(true);
      pauseUploads();
    },
    [pauseUploads]
  );

  useLayoutEffect(() => {
    setMaintenanceAccessBlocked(unavailable, blocked || wasBlocked);
    if (unavailable) pauseUploads();
    else resumeUploads();
    if (blocked && !wasBlocked) {
      setWasBlocked(true);
      void queryClient.cancelQueries();
      queryClient.clear();
    }
  }, [
    unavailable,
    blocked,
    wasBlocked,
    queryClient,
    pauseUploads,
    resumeUploads,
  ]);

  // Keep the same workspace tree through verification failures so local edits
  // survive reconnection. Confirmed maintenance still tears down work.
  const keepWorkspace =
    isSysadmin ||
    (!!state && !!userState && Number.isFinite(now) && !blocked && !wasBlocked);
  const restored = wasBlocked && !blocked && !error;
  return (
    // Portal events bubble through their React ancestors, including events
    // from Bootstrap's focused outer dialog (outside its inner ModalDialog).
    <div
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (!unavailable) return;
        event.stopPropagation();
        if (event.key !== 'Tab') return;
        const dialog =
          event.target instanceof Element
            ? event.target.closest(
                '[aria-labelledby="maintenance-status-title"]'
              )
            : null;
        if (!dialog) return;
        const buttons = dialog.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)'
        );
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        const active = dialog.ownerDocument.activeElement;
        if (event.shiftKey && (active === first || active === dialog)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (active === last || active === dialog)) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onKeyUp={(event: KeyboardEvent<HTMLElement>) => {
        if (unavailable) event.stopPropagation();
      }}
    >
      <div hidden={unavailable} aria-hidden={unavailable || undefined}>
        {keepWorkspace ? children : null}
      </div>
      <Modal
        show={unavailable}
        fullscreen
        animation={false}
        backdrop='static'
        keyboard={false}
        aria-labelledby='maintenance-status-title'
        contentClassName='min-vh-100'
      >
        <MaintenanceBanner />
        <div className='m-auto p-4 text-center' style={{ maxWidth: 680 }}>
          <h1 id='maintenance-status-title'>
            {restored
              ? 'Access restored'
              : blocked
              ? 'Access paused'
              : error
              ? 'Reconnecting'
              : 'Checking app availability'}
          </h1>
          <p>
            {restored
              ? 'The update is complete. Reload to use the latest version of SurveyScope.'
              : blocked
              ? 'Your access is temporarily paused. This page will let you know when you can return.'
              : error || 'Please wait…'}
          </p>
          {!restored && !error && (
            <Spinner
              animation='border'
              role='status'
              aria-label='Waiting for app availability'
            />
          )}
          <div className='d-flex gap-2 justify-content-center mt-3'>
            {restored && (
              <Button onClick={() => window.location.reload()}>
                Reload and return to app
              </Button>
            )}
            {error && <Button onClick={() => void refresh()}>Retry</Button>}
            <Button variant='outline-light' onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
