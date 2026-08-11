# User statistics stream processor

The function consumes new `Observation` records from DynamoDB Streams. It uses
atomic DynamoDB `ADD` updates for `UserStats` and Queue progress.

Each effect is paired with a conditional receipt write in the same DynamoDB
transaction. The receipt key contains the stream event ID, so batch replays and
ambiguous network retries cannot increment either aggregate twice. Receipts
expire after 30 days through DynamoDB TTL.

After the transactions commit, key-only AppSync updates notify existing
`UserStats.onUpdate` and `Queue.onUpdate` subscribers.

The handler throws on the first failed record, so the batch retries. The event
source mapping bisects failed batches, bounds retries and record age, and sends
an exhausted record's shard position to the retained
`DetwebStatsReliability/UserStatsStreamFailures` queue instead of letting a
poison record stall the shard. Failure-queue depth, function errors, and
iterator age are alarmed; set `STATS_ALARM_EMAIL` in the build environment to
subscribe an email address to every statistics alarm.

The GraphQL folder is generated with:

```shell
npx ampx generate graphql-client-code --out amplify/functions/updateUserStats/graphql --app-id <app-id> --branch <branch>
```

The app ID and branch are optional when a deployed sandbox is available.
