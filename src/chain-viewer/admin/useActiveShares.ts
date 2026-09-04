import { useQuery } from '@tanstack/react-query';
import { client } from '../../stores/appClient';
import { fetchAllPaginatedResults } from '../../utils';

export interface ActiveShare {
  shareId: string;
  surveyName: string | null;
  annotationSetName: string | null;
  annotationSetId: string;
}

/** Non-revoked chain shares, for the Results / Disagreement share pickers. */
export function useActiveShares() {
  return useQuery<ActiveShare[]>({
    queryKey: ['active-chain-shares'],
    staleTime: 60_000,
    queryFn: async () => {
      const rows = (await fetchAllPaginatedResults(client.models.ChainShare.list, {
        selectionSet: [
          'shareId',
          'surveyName',
          'annotationSetName',
          'annotationSetId',
          'status',
        ] as const,
        limit: 10000,
      })) as Array<{
        shareId: string;
        surveyName?: string | null;
        annotationSetName?: string | null;
        annotationSetId: string;
        status?: string | null;
      }>;
      return rows
        .filter((s) => s.status !== 'revoked')
        .map((s) => ({
          shareId: s.shareId,
          surveyName: s.surveyName ?? null,
          annotationSetName: s.annotationSetName ?? null,
          annotationSetId: s.annotationSetId,
        }));
    },
  });
}

/** Map a ChainReviewFeedback `owner` ("sub::username" or "sub") to its sub. */
export function ownerToUserId(owner: string): string {
  return owner.includes('::') ? owner.split('::')[0] : owner;
}
