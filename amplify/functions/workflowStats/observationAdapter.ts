import type { WorkflowMetricKey, WorkflowType } from '../../../shared/workflowStats';
import { statsDeltaFromObservation } from '../updateUserStats/core';
import type {
  RecordWorkflowTaskEventInput,
  WorkflowActor,
} from './core';

export interface WorkflowRunIdentity {
  runId: string;
  workflowType: WorkflowType;
  projectId: string;
  annotationSetId: string;
  organizationId: string;
}

export type ObservationProjectionDecision =
  | {
      kind: 'project';
      actor: WorkflowActor;
      task: RecordWorkflowTaskEventInput;
      completedAt: string;
    }
  | {
      kind: 'skip';
      reason: 'test-or-mismatched-set' | 'unsupported-workflow';
    };

export function workflowTaskFromObservation(
  observation: Record<string, unknown>,
  run: WorkflowRunIdentity
): ObservationProjectionDecision {
  if (
    run.workflowType !== 'species-labelling' &&
    run.workflowType !== 'false-negatives'
  ) {
    return { kind: 'skip', reason: 'unsupported-workflow' };
  }

  const delta = statsDeltaFromObservation(observation);
  if (
    delta.projectId !== run.projectId ||
    delta.setId !== run.annotationSetId ||
    delta.queueId !== run.runId
  ) {
    // Test tasks write Observations against an ephemeral annotation-set ID.
    // They are intentionally excluded from throughput reporting.
    return { kind: 'skip', reason: 'test-or-mismatched-set' };
  }

  const locationId = observation.locationId;
  if (typeof locationId !== 'string' || locationId.trim() === '') {
    throw new Error(`Observation ${delta.observationId} has no locationId`);
  }
  const completedAt = observation.createdAt;
  if (typeof completedAt !== 'string') {
    throw new Error(`Observation ${delta.observationId} has no createdAt`);
  }

  const annotationCount = Math.round(delta.annotationCount);
  const activeTimeMs = Math.round(delta.activeTime);
  const waitingTimeMs = Math.round(delta.waitingTime);
  const metrics: Partial<Record<WorkflowMetricKey, number>> =
    run.workflowType === 'species-labelling'
      ? {
          sightings: delta.sightingCount,
          annotationsAdded: annotationCount,
          emptySearches: delta.searchCount,
          searchTimeMs: Math.round(delta.searchTime),
          annotationTimeMs: Math.round(delta.annotationTime),
        }
      : {
          missedAnimalsFound: annotationCount,
          annotationsAdded: annotationCount,
        };

  return {
    kind: 'project',
    actor: {
      userId: delta.userId,
      organizationId: run.organizationId,
    },
    completedAt,
    task: {
      idempotencyKey: `observation:${delta.observationId}`,
      workflowType: run.workflowType,
      workflowRunId: run.runId,
      projectId: run.projectId,
      annotationSetId: run.annotationSetId,
      // The registry unit for False Negatives is the tile; the work item ID is
      // still the Location record that represents that tile.
      workItemType:
        run.workflowType === 'false-negatives' ? 'tile' : 'location',
      workItemId: locationId,
      activeTimeMs,
      waitingTimeMs,
      outcome: annotationCount > 0 ? 'sighting' : 'empty-search',
      skipped: false,
      metrics,
    },
  };
}
