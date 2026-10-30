import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlobalContext, UserContext } from './Context.tsx';
import { fetchAllPaginatedResults } from './utils.tsx';

export default function SharedResults() {
  const { client } = useContext(GlobalContext)!;
  const { user } = useContext(UserContext)!;
  const navigate = useNavigate();
  const [annotationSets, setAnnotationSets] = useState<
    { id: string; name: string; projectId: string; projectName: string }[]
  >([]);

  useEffect(() => {
    async function fetchAnnotationSets() {
      const jollyResultsMemberships = await fetchAllPaginatedResults<any>(
        client.models.JollyResultsMembership.list as any,
        { filter: { userId: { eq: user?.userId } }, limit: 10000 } as any,
      );
      const annotationSets = await Promise.all(
        jollyResultsMemberships.map(async (result) => {
          const { data: annotationSet } = await client.models.AnnotationSet.get(
            { id: result.annotationSetId },
            {
              selectionSet: ['id', 'name', 'projectId', 'project.name'],
            },
          );
          return annotationSet;
        }),
      );
      if (annotationSets) {
        setAnnotationSets(
          annotationSets
            .filter(
              (
                annotationSet,
              ): annotationSet is NonNullable<typeof annotationSet> =>
                annotationSet !== null,
            )
            .map((annotationSet) => ({
              id: annotationSet.id,
              name: annotationSet.name,
              projectId: annotationSet.projectId,
              projectName: annotationSet.project.name,
            })),
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
        <CardHeader className='flex items-center justify-between gap-2'>
          <CardTitle className='mb-0 w-full' style={{ maxWidth: '300px' }}>
            <h4 className='mb-0'>Shared Results</h4>
          </CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-2'>
          {annotationSets.length > 0 ? (
            annotationSets.map((annotationSet) => (
              <div
                key={annotationSet.id}
                className='flex flex-row items-center justify-between gap-2 border border-dark p-4'
              >
                <div>
                  <p className='mb-0'>Survey: {annotationSet.projectName}</p>
                  <p className='mb-0'>Annotation Set: {annotationSet.name}</p>
                </div>
                <Button
                  variant='primary'
                  onClick={() => {
                    navigate(
                      `/jolly/${annotationSet.projectId}/${annotationSet.id}`,
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
        </CardContent>
      </Card>
    </div>
  );
}
