import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowTaskFromObservation } from './observationAdapter';

const observation = {
  id: 'observation-1',
  annotationSetId: 'set-1',
  createdAt: '2026-08-06T10:00:12.000Z',
  owner: 'identity::user-1',
  projectId: 'project-1',
  locationId: 'location-1',
  queueId: 'queue-1',
  annotationCount: 3,
  timeTaken: 12_000,
  waitingTime: 500,
};

const speciesRun = {
  runId: 'queue-1',
  workflowType: 'species-labelling' as const,
  projectId: 'project-1',
  annotationSetId: 'set-1',
  organizationId: 'organization-1',
};

test('maps an Observation into a Species Labelling shadow event', () => {
  const decision = workflowTaskFromObservation(observation, speciesRun);
  assert.equal(decision.kind, 'project');
  if (decision.kind !== 'project') return;

  assert.equal(decision.actor.userId, 'user-1');
  assert.equal(decision.task.workflowRunId, 'queue-1');
  assert.equal(decision.task.outcome, 'sighting');
  assert.deepEqual(decision.task.metrics, {
    sightings: 1,
    annotationsAdded: 3,
    emptySearches: 0,
    searchTimeMs: 0,
    annotationTimeMs: 12_000,
  });
});

test('maps the same Observation to False Negative workflow metrics from its run', () => {
  const decision = workflowTaskFromObservation(observation, {
    ...speciesRun,
    workflowType: 'false-negatives',
  });
  assert.equal(decision.kind, 'project');
  if (decision.kind !== 'project') return;

  assert.deepEqual(decision.task.metrics, {
    missedAnimalsFound: 3,
    annotationsAdded: 3,
  });
});

test('excludes ephemeral test observations whose annotation set differs from the run', () => {
  const decision = workflowTaskFromObservation(
    { ...observation, annotationSetId: 'ephemeral-test-set' },
    speciesRun
  );
  assert.deepEqual(decision, {
    kind: 'skip',
    reason: 'test-or-mismatched-set',
  });
});
