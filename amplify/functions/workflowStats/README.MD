# Workflow statistics foundation

## Status

The existing Observation-to-UserStats pipeline remains the production reporting
path. Species Labelling and False Negatives now also write to the generalized
tables in shadow mode. No existing statistics UI or production aggregate is
replaced by this slice.

## Stable workflow identity

The shared workflow registry defines these durable identifiers:

| Identifier | Display name | Completion unit |
|---|---|---|
| `species-labelling` | Species Labelling | Location |
| `false-negatives` | False Negatives | Tile |
| `qc-review` | Review | Annotation |
| `info-tags` | Info Tags | Image |
| `homographies` | Homographies | Image pair |
| `individual-id` | ChainLinker | Image pair |

`Queue.tag` and `Queue.name` are not workflow identifiers. Queue IDs can be
reused as Workflow Run IDs for the five SQS-backed workflows. Individual ID can
use its durable job ID as the run ID.

ChainLinker reports one completed unit per image pair, with `annotationsLinked`
alongside it. Pair count alone understates effort, because pairs differ wildly
in how many animals they contain; the two figures are only meaningful together.

Its active time is measured differently from the Observation-based workflows.
Those record plain wall-clock from the task becoming visible to it being
submitted, bounded by a tight per-task cap. A pair holding hundreds of animals
can honestly take half an hour, so a cap loose enough to be fair to it would
also absorb a break. ChainLinker therefore accumulates time between user
interactions and discards gaps longer than 90 seconds, reporting time worked
rather than time elapsed.

## Physical storage

The Amplify data stack is close to its CloudFormation change-set resource cap.
The following concepts are therefore standalone DynamoDB tables in the sibling
`DetwebWorkflowStats` stack rather than Amplify Data models:

### Workflow Runs

Primary key: `runId`.

Required attributes are `workflowType`, `projectId`, `annotationSetId`,
`organizationId`, `status`, and `launchedAt`. A project and launch-time index
supports the Jobs and Statistics run selectors. Runs are durable even when the
corresponding Queue is deleted.

### Workflow Task Events

Primary key: `eventId`.

An event is immutable. Its ID is derived from schema version, workflow type,
run ID, and an adapter-provided idempotency key. Events retain server-derived
actor identity, work-item identity, timing, outcome, and validated
workflow-specific metrics. A run and completion-time index supports audit and
reconciliation reads.

### Workflow Daily Stats

Primary key: `scopeKey`; sort key: `bucketKey`.

The scope contains project, annotation set, and workflow. The bucket contains
date, user, and run, so a date-range query can be summed across users or runs
without scanning unrelated projects or workflows.

## Write contract

Adapters must complete work in this order:

1. Persist the workflow's domain changes.
2. Record the workflow task event.
3. Acknowledge or delete the work message.

The event writer performs one DynamoDB transaction:

1. Condition-check that the Workflow Run matches the workflow, project,
   annotation set, and organization.
2. Insert the immutable event if its ID does not already exist.
3. Atomically add common and workflow-specific totals to Workflow Daily Stats.

If the transaction response is lost, the writer performs a strongly consistent
event read. A matching input digest proves the original transaction committed.
The immutable event is therefore also the idempotency receipt.

The generic writer is an internal Lambda and is deliberately not exposed to the
browser. The Observation adapter shares the same transactional store directly.
Future authenticated adapters must derive the user ID and organization from
request identity and membership checks. They must not copy an actor ID supplied
by the browser.

## First migration slice

Species Labelling and False Negatives are the first shadow-mode migration slice:

1. Normal and distributed launches create a durable Workflow Run immediately
   after creating the Queue and before enqueueing work. The Queue ID is the
   `runId`.
2. A temporary second Observation stream consumer resolves workflow identity
   from the durable run rather than `Queue.tag` or `Observation.source`.
3. The adapter uses `Observation.id` as the idempotency source. The completed
   work item is the Location record: `workItemType` is `location` for Species
   Labelling and `tile` for False Negatives, matching the registry units.
4. Test observations whose annotation set differs from the run are excluded.
5. Legacy observations without a Workflow Run are explicitly logged and
   skipped, so they cannot block the live stream shard.
6. Run creation is best-effort because shadow statistics must not prevent a
   real workflow launch. The immutable source Observation remains available
   for reconciliation.

The shadow mapping starts at `TRIM_HORIZON`, filters to inserts, reports partial
batch failures, bisects failed batches, bounds retry age and count, and routes
exhausted records to a retained encrypted SQS failure queue. Lambda errors,
throttles, duration, iterator age, and visible failure messages are alarmed.

The remaining acceptance step for this slice is to deploy it in a non-production
environment, launch both workflows, and reconcile old UserStats against new
Workflow Daily Stats for those run IDs before enabling any new reporting UI.

## Deferred decisions

- ChainLinker common unit and pair-level semantics.
- Retention period for immutable task events.
- Whether corrected domain outcomes produce compensating events or a new event
  version.
- The authenticated query surface for the Workflow Statistics UI.
- Historical backfill rules and how partial history is labelled.
