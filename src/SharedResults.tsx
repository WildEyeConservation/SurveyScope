import { useContext, useEffect, useState } from 'react';
import { UserContext } from './Context.tsx';
import { client } from './stores/appClient';
import { Card, Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { fetchAllPaginatedResults } from './utils.tsx';

export default function SharedResults() {
  const { user } = useContext(UserContext)!;
  const navigate = useNavigate();
  const [annotationSets, setAnnotationSets] = useState<
    { id: string; name: string; projectId: string; projectName: string }[]
  >([]);

  useEffect(() => {
    async function fetchAnnotationSets() {
      const jollyResultsMemberships = await fetchAllPaginatedResults<any>(
        client.models.JollyResultsMembership.list as any,
        { filter: { userId: { eq: user?.userId } }, limit: 10000 } as any
      );
      const annotationSets = await Promise.all(
        jollyResultsMemberships.map(async (result) => {
          const { data: annotationSet } = await client.models.AnnotationSet.get(
            { id: result.annotationSetId },
            {
              selectionSet: ['id', 'name', 'projectId', 'project.name'],
            }
          );
          return annotationSet;
        })
      );
      if (annotationSets) {
        setAnnotationSets(
          annotationSets
            .filter((annotationSet): annotationSet is NonNullable<typeof annotationSet> => annotationSet !== null)
            .map((annotationSet) => ({
              id: annotationSet.id,
              name: annotationSet.name,
              projectId: annotationSet.projectId,
              projectName: annotationSet.project.name,
            }))
        );
      }
    }

    fetchAnnotationSets();
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
          <Card.Title className='mb-0 w-100' style={{ maxWidth: '300px' }}>
            <h4 className='mb-0'>Shared Results</h4>
          </Card.Title>
        </Card.Header>
        <Card.Body className='d-flex flex-column gap-2'>
          {annotationSets.length > 0 ? (
            annotationSets.map((annotationSet) => (
              <div
                key={annotationSet.id}
                className='d-flex flex-row justify-content-between align-items-center gap-2 border border-dark p-3'
              >
                <div>
                  <p className='mb-0'>Survey: {annotationSet.projectName}</p>
                  <p className='mb-0'>Annotation Set: {annotationSet.name}</p>
                </div>
                <Button
                  variant='primary'
                  onClick={() => {
                    navigate(
                      `/jolly/${annotationSet.projectId}/${annotationSet.id}`
                    );
                  }}
                >
                  View Results
                </Button>
              </div>
            ))
          ) : (
            <p>No results have been shared with you.</p>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
