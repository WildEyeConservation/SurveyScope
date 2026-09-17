import { Project, Management } from './UserContext';
import { Outlet } from 'react-router-dom';
import { Schema } from './amplify/client-schema';
import { UserContext, GlobalContext } from './Context';
import { useContext, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchAllPaginatedResults } from './utils';

export default function ProjectView() {
  const { user } = useContext(UserContext)!;
  const { client } = useContext(GlobalContext)!;
  const { surveyId } = useParams();
  const [currentPM, setCurrentPM] = useState<
    Schema['UserProjectMembership']['type'] | null
  >(null);

  useEffect(() => {
    const fetchCurrentPM = async () => {
      if (!surveyId || !user.userId) {
        return;
      }

      // Filter applies after the page limit, so paginate.
      const [currentPM] = await fetchAllPaginatedResults(
        client.models.UserProjectMembership.userProjectMembershipsByUserId,
        {
          userId: user.userId,
          filter: { projectId: { eq: surveyId } },
        }
      );
      setCurrentPM(currentPM);
    };
    fetchCurrentPM();
  }, [user.userId, surveyId]);

  return currentPM ? (
    <Project currentPM={currentPM}>
      <Management>
        <Outlet />
      </Management>
    </Project>
  ) : null;
}
