# User statistics stream processor

The function consumes new `Observation` records from DynamoDB Streams. It uses
atomic DynamoDB `ADD` updates for `UserStats` and Queue progress.

Each effect is paired with a conditional receipt write in the same DynamoDB
transaction. The receipt key contains the stream event ID, so batch replays and
ambiguous network retries cannot increment either aggregate twice. Receipts
expire after 30 days through DynamoDB TTL.

After the transactions commit, key-only AppSync updates notify existing
`UserStats.onUpdate` and `Queue.onUpdate` subscribers.

Every annotator on a queue increments the same Queue item, and the key-only
AppSync notifications write it too, so concurrent invocations collide there
routinely. DynamoDB cancels the losing transaction with `TransactionConflict`
and the AWS SDK does not retry that, so each transaction is retried in process
with full-jitter backoff. A cancelled transaction never commits, so the retry
is safe without consulting the receipt.

The handler throws on the first failed record, so the batch retries. The event
source mapping bisects failed batches, bounds retries and record age, and sends
an exhausted record's shard position to the retained
`DetwebStatsReliability/UserStatsStreamFailures` queue instead of letting a
poison record stall the shard. Failure-queue depth, function errors, and
iterator age are alarmed.

## Alarm notifications

Set `STATS_ALARM_EMAIL` in the Amplify branch environment variables (App
settings -> Environment variables, branch `master`) and redeploy. The synth
creates an SNS topic in `DetwebStatsReliability` and subscribes the address to
every statistics alarm across all three stacks, for both the ALARM and the OK
transition, so a recovery is reported as clearly as a failure. Each subscriber
must confirm the AWS subscription email once.

Several recipients can be given as a comma-separated list. An address that is
not a valid email fails the build deliberately: a typo must not masquerade as
working alerting. Leaving the variable unset keeps the alarms in place with no
notification action.

The GraphQL folder is generated with:

```shell
npx ampx generate graphql-client-code --out amplify/functions/updateUserStats/graphql --app-id <app-id> --branch <branch>
```

The app ID and branch are optional when a deployed sandbox is available.
