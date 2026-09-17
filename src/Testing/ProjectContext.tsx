import { Project, Management } from '../UserContext';
import { Schema } from '../amplify/client-schema';
import { UserContext, GlobalContext } from '../Context';
import { useContext, useEffect, useState } from 'react';
import { fetchAllPaginatedResults } from '../utils';

export default function ProjectContext({
  children,
  surveyId,
}: {
  children: React.ReactNode;
  surveyId: string;
}) {
  const { user } = useContext(UserContext)!;
  const { client } = useContext(GlobalContext)!;
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
      <Management>{children}</Management>
    </Project>
  ) : null;
}
