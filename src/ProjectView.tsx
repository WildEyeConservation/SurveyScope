import { Project, Management } from './UserContext';
import { Outlet } from 'react-router-dom';
import { Schema } from './amplify/client-schema';
import { UserContext, GlobalContext } from './Context';
import { useContext, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchAllPaginatedResults } from './utils';
import { useCognitoGroups } from './cognitoGroups';

export default function ProjectView() {
  const { user } = useContext(UserContext)!;
  const { client } = useContext(GlobalContext)!;
  const { surveyId } = useParams();
  const cognitoGroups = useCognitoGroups();
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
    // Groups can change after load (e.g. the organisation group sync), revealing the survey.
  }, [user.userId, surveyId, cognitoGroups]);

  return currentPM ? (
    <Project currentPM={currentPM}>
      <Management>
        <Outlet />
      </Management>
    </Project>
  ) : null;
}
