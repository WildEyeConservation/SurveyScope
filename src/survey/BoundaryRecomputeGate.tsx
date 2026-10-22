import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { GlobalContext } from '../Context';
import { boundaryRecomputePending } from '../utils/shapefileUtils';

export default function BoundaryRecomputeGate({
  projectId,
  what,
  children,
}: {
  projectId: string;
  what: string;
  children: ReactNode;
}) {
  const { client } = useContext(GlobalContext)!;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const { data } = await (client.models.Project.get as any)(
          { id: projectId },
          {
            selectionSet: [
              'boundaryRecomputeRequested',
              'boundaryRecomputeLeaseUntil',
            ],
          },
          { signal }
        );
        if (signal.aborted) return;
        if (data && boundaryRecomputePending(data)) {
          timer = setTimeout(check, 3000);
        } else {
          setReady(true);
        }
      } catch (err) {
        if (signal.aborted) return;
        console.error('Failed to check the survey area status:', err);
        setReady(true);
      }
    };
    check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, projectId, ready]);

  if (ready) return <>{children}</>;
  return (
    <div className='d-flex flex-column align-items-center gap-3 p-4'>
      <div className='d-flex align-items-center gap-2'>
        <Spinner animation='border' />
        <span>Applying the survey area and strata to the images</span>
      </div>
      <span className='text-muted' style={{ fontSize: 14 }}>
        {what} open once every image and transect has been checked against the
        survey area and strata.
      </span>
      <Button variant='outline-secondary' onClick={() => setReady(true)}>
        Continue without waiting
      </Button>
    </div>
  );
}
