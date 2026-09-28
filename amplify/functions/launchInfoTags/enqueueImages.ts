import {
  SendMessageBatchCommand,
  type SendMessageBatchCommandOutput,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import pLimit from 'p-limit';

const MAX_ATTEMPTS = 5;
type SendBatch = (
  command: SendMessageBatchCommand
) => Promise<Pick<SendMessageBatchCommandOutput, 'Successful' | 'Failed'>>;

export async function enqueueInfoTagImages(
  input: {
    queueUrl: string;
    queueId: string;
    annotationSetId: string;
    categoryIds: string[];
    items: Array<{ imageId: string }>;
  },
  send: SendBatch,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms))
): Promise<void> {
  const limit = pLimit(10);
  const tasks: Array<Promise<void>> = [];
  for (let offset = 0; offset < input.items.length; offset += 10) {
    const entries = input.items
      .slice(offset, offset + 10)
      .map((item, index) => ({
        Id: `msg-${offset + index}`,
        MessageBody: JSON.stringify({
          imageId: item.imageId,
          annotationSetId: input.annotationSetId,
          categoryIds: input.categoryIds,
          queueId: input.queueId,
        }),
      }));
    tasks.push(limit(() => sendBatch(entries)));
  }

  // Finish all senders before the handler restores the project status on error.
  // The queue and its already-written manifests remain available for recovery.
  const results = await Promise.allSettled(tasks);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failure) throw failure.reason;

  async function sendBatch(entries: SendMessageBatchRequestEntry[]) {
    let pending = entries;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // The SDK handles request-level retries. If its response remains uncertain,
      // propagate the error rather than blindly replaying the whole batch here.
      const result = await send(
        new SendMessageBatchCommand({
          QueueUrl: input.queueUrl,
          Entries: pending,
        })
      );
      const failed = new Map(
        (result.Failed ?? []).map((entry) => [entry.Id, entry])
      );
      const successful = new Set(
        (result.Successful ?? []).map((entry) => entry.Id)
      );
      const unconfirmed = pending.filter(
        (entry) => !failed.has(entry.Id) && !successful.has(entry.Id)
      );
      if (unconfirmed.length) {
        throw new Error(
          `Info Tags queue ${
            input.queueId
          }: SQS did not confirm entries ${unconfirmed
            .map((entry) => entry.Id)
            .join(', ')}`
        );
      }
      pending = pending.filter((entry) => failed.has(entry.Id));
      if (!pending.length) return;

      if (
        attempt === MAX_ATTEMPTS ||
        pending.some((entry) => failed.get(entry.Id)?.SenderFault)
      ) {
        const details = pending
          .map((entry) => `${entry.Id}: ${failed.get(entry.Id)?.Code}`)
          .join(', ');
        throw new Error(
          `Info Tags queue ${input.queueId}: SQS enqueue failed after ${attempt} attempt(s) (${details})`
        );
      }
      // Retry only explicitly failed entries, with bounded exponential jitter.
      await wait(
        Math.floor(Math.random() * Math.min(4000, 250 * 2 ** (attempt - 1)))
      );
    }
  }
}
