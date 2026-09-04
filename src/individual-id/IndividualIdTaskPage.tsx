import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { client } from '../stores/appClient';
import { IndividualIdHarness } from './IndividualIdHarness';
import { useActivityHeartbeat } from './hooks/useActivityHeartbeat';

/**
 * Route parent for the Individual ID workflow.
 *
 * The transect is claimed on the Jobs page (claimIndividualIdTransect lambda);
 * the resulting ids are passed here via navigation state — NOT the URL — so a
 * transect can't be opened by guessing a query string. History state survives
 * an F5 reload; a fresh/direct navigation has no state, so we bounce the user
 * back to /jobs where they explicitly take a job.
 */
type ClaimState = {
  transectRowId?: string;
  transectId?: string;
  categoryId?: string;
  annotationSetId?: string;
  /** Workflow Run id for statistics; absent for jobs launched before it existed. */
  jobId?: string;
};

export function IndividualIdTaskPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? null) as ClaimState | null;

  const hasClaim = !!(state && state.transectId && state.categoryId);

  const goToJobs = useCallback(() => {
    navigate('/jobs', { replace: true });
  }, [navigate]);

  // Transect finished: mark it complete server-side (ACID decrement of the
  // job's remaining-transects counter; the lambda finishes the job when it
  // hits zero), then return to Jobs. Guarded so the harness firing onComplete
  // can't double-submit.
  const completingRef = useRef(false);
  const handleComplete = useCallback(async () => {
    if (completingRef.current) return;
    completingRef.current = true;
    try {
      if (state?.transectRowId) {
        await (client as any).mutations.completeIndividualIdTransect(
          { transectRowId: state.transectRowId },
          { retry: false }
        );
      }
    } catch (e) {
      console.error('Failed to complete Individual ID transect', e);
    } finally {
      goToJobs();
    }
  }, [state, goToJobs]);

  useEffect(() => {
    if (!hasClaim) goToJobs();
  }, [hasClaim, goToJobs]);

  // Heartbeat + 30-min idle / lost-lock redirect.
  useActivityHeartbeat({
    transectRowId: state?.transectRowId ?? null,
    onLost: goToJobs,
  });

  if (!hasClaim) return null;

  return (
    <IndividualIdHarness
      transectId={state!.transectId!}
      categoryId={state!.categoryId!}
      annotationSetId={state!.annotationSetId}
      jobId={state!.jobId}
      onComplete={handleComplete}
    />
  );
}
