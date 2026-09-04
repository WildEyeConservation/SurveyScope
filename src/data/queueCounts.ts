import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../session';

export function useQueueMessageCount(url: string | undefined) {
  const { getSqsClient } = useSession();
  const { data } = useQuery({
    queryKey: ['sqsMessageCount', url],
    queryFn: async () => {
      const sqsClient = await getSqsClient();
      const result = await sqsClient.send(
        new GetQueueAttributesCommand({
          QueueUrl: url,
          AttributeNames: ['ApproximateNumberOfMessages'],
        })
      );
      return Number(result.Attributes?.ApproximateNumberOfMessages ?? 0);
    },
    enabled: Boolean(url),
    staleTime: 0,
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
  });

  // undefined until the first answer so callers can tell "unknown" from "empty".
  return data;
}
