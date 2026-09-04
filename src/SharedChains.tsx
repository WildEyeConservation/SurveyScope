import { useEffect, useState } from 'react';
import { Card, Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { client } from './stores/appClient';
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
  const navigate = useNavigate();
  const [shares, setShares] = useState<ShareRow[]>([]);

  useEffect(() => {
    (async () => {
      const rows = (await fetchAllPaginatedResults(client.models.ChainShare.list, {
        selectionSet: [
          'shareId',
          'surveyName',
          'annotationSetName',
          'status',
        ] as const,
        limit: 10000,
      })) as ShareRow[];
      setShares(rows.filter((s) => s.status !== 'revoked'));
    })();
  }, []);

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
        <Card.Header className='d-flex justify-content-between align-items-center gap-2'>
          <Card.Title className='mb-0'>
            <h4 className='mb-0'>Shared Chain Reviews</h4>
          </Card.Title>
        </Card.Header>
        <Card.Body className='d-flex flex-column gap-2'>
          {shares.length > 0 ? (
            shares.map((share) => (
              <div
                key={share.shareId}
                className='d-flex flex-row justify-content-between align-items-center gap-2 border border-dark p-3'
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
        </Card.Body>
      </Card>
    </div>
  );
}
