import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { UploadOrchestrator } from '../upload/core/UploadOrchestrator';
import type { PauseReason, SessionPhase } from '../upload/core/types';
import { setMaintenanceAccessBlocked } from './state';

afterEach(() => setMaintenanceAccessBlocked(false));

// Exercise the real pause/resume/interrupt paths with the transfer loop stubbed.
function upload(phase: SessionPhase, pauseReason?: PauseReason) {
  const orchestrator = new UploadOrchestrator();
  const session = {
    projectId: 'survey',
    phase,
    pauseReason,
    controller: new AbortController(),
    store: { flush: async () => {} },
  };
  let runs = 0;
  const internals = orchestrator as unknown as {
    session: typeof session;
    runLoop: () => Promise<void>;
    handleInterrupt: (target: typeof session) => Promise<boolean>;
  };
  internals.session = session;
  internals.runLoop = async () => {
    runs++;
    session.phase = 'uploading';
  };
  return { orchestrator, session, internals, runs: () => runs };
}

for (const reason of ['offline', 'availability'] as const) {
  test(`${reason} pause resumes after availability recovers`, () => {
    const { orchestrator, runs } = upload('paused', reason);
    setMaintenanceAccessBlocked(true);
    orchestrator.resumeAfterAvailabilityCheck();
    assert.equal(runs(), 0);
    setMaintenanceAccessBlocked(false);
    orchestrator.resumeAfterAvailabilityCheck();
    assert.equal(runs(), 1);
    orchestrator.resumeAfterAvailabilityCheck();
    assert.equal(runs(), 1);
  });
}

test('availability recovery does not resume explicit user pauses', () => {
  const { orchestrator, runs } = upload('paused', 'user');
  orchestrator.resumeAfterAvailabilityCheck();
  assert.equal(runs(), 0);
});

test('availability checks preserve a user pause while its transfer drains', () => {
  const { orchestrator, session } = upload('uploading');
  orchestrator.pause();
  orchestrator.pause('availability');
  assert.equal(session.pauseReason, 'user');
});

test('an explicit pause overrides a draining availability pause', () => {
  const { orchestrator, session } = upload('uploading');
  orchestrator.pause('availability');
  orchestrator.pause();
  assert.equal(session.pauseReason, 'user');
});

test('recovery before the aborted transfer drains still resumes the upload', async () => {
  const { orchestrator, session, internals, runs } = upload('uploading');
  setMaintenanceAccessBlocked(true);
  orchestrator.pause('availability');
  setMaintenanceAccessBlocked(false);
  orchestrator.resumeAfterAvailabilityCheck();
  assert.equal(runs(), 0);
  await internals.handleInterrupt(session);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runs(), 1);
});

test('confirmed maintenance prevents resume after the aborted transfer drains', async () => {
  const { orchestrator, session, internals, runs } = upload('uploading');
  setMaintenanceAccessBlocked(true, true);
  orchestrator.pause('availability');
  await internals.handleInterrupt(session);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runs(), 0);
});
