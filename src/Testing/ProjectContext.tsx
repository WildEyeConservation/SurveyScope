import { Project, Management } from '../UserContext';
import { Schema } from '../amplify/client-schema';
import { UserContext } from '../Context';
import { client } from '../stores/appClient';
import { useContext, useEffect, useState } from 'react';

export default function ProjectContext({
  children,
  surveyId,
}: {
  children: React.ReactNode;
  surveyId: string;
}) {
  const { user } = useContext(UserContext)!;
  const [currentPM, setCurrentPM] = useState<
    Schema['UserProjectMembership']['type'] | null
  >(null);

  useEffect(() => {
    const fetchCurrentPM = async () => {
      if (!surveyId || !user.userId) {
        return;
      }

      const {
        data: [currentPM],
      } =
        await client.models.UserProjectMembership.userProjectMembershipsByUserId(
          {
            userId: user.userId,
          },
          {
            filter: {
              projectId: {
                eq: surveyId,
              },
            },
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
