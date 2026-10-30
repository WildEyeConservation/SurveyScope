import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlobalContext } from './Context';
import { fetchAllPaginatedResults } from './utils';

type ShareRow = {
  shareId: string;
  surveyName?: string | null;
  annotationSetName?: string | null;
  status?: string | null;
};

/**
 * Landing page for external reviewers: lists the chain-viewer shares the
 * signed-in account can see (auth scopes ChainShare reads to the reviewer's
 * `chainshare-*` groups). Mirrors SharedResults.
 */
export default function SharedChains() {
  const { client } = useContext(GlobalContext)!;
  const navigate = useNavigate();
  const [shares, setShares] = useState<ShareRow[]>([]);

  useEffect(() => {
    (async () => {
      const rows = (await fetchAllPaginatedResults(
        client.models.ChainShare.list,
        {
          selectionSet: [
            'shareId',
            'surveyName',
            'annotationSetName',
            'status',
          ] as const,
          limit: 10000,
        },
      )) as ShareRow[];
      setShares(rows.filter((s) => s.status === 'active'));
    })();
  }, [client]);

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '1555px',
        marginTop: '16px',
        marginBottom: '16px',
      }}
    >
      <Card>
        <CardHeader className='flex items-center justify-between gap-2'>
          <CardTitle className='mb-0'>
            <h4 className='mb-0'>Shared Chain Reviews</h4>
          </CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-2'>
          {shares.length > 0 ? (
            shares.map((share) => (
              <div
                key={share.shareId}
                className='flex flex-row items-center justify-between gap-2 border border-dark p-4'
              >
                <div>
                  <p className='mb-0'>Survey: {share.surveyName ?? '—'}</p>
                  <p className='mb-0'>
                    Annotation Set: {share.annotationSetName ?? '—'}
                  </p>
                </div>
                <Button
                  variant='primary'
                  onClick={() => navigate(`/shared-chains/${share.shareId}`)}
                >
                  Open Chain Viewer
                </Button>
              </div>
            ))
          ) : (
            <p>No chain reviews have been shared with you.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
