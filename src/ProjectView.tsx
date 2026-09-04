import { Project, Management } from './UserContext';
import { Outlet } from 'react-router-dom';
import { UserContext } from './Context';
import { client } from './stores/appClient';
import { useContext } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

export default function ProjectView() {
  const { user } = useContext(UserContext)!;
  const { surveyId } = useParams();

  // Route-driven membership load. TanStack Query caches per surveyId so
  // navigating between surveys does not refetch unrelated project data, and
  // the Project/Management providers below become pure render wrappers.
  const { data: currentPM } = useQuery({
    queryKey: ['currentPM', user.userId, surveyId],
    queryFn: async () => {
      if (!surveyId || !user.userId) return null;
      const {
        data: [pm],
      } =
        await client.models.UserProjectMembership.userProjectMembershipsByUserId(
          { userId: user.userId },
          { filter: { projectId: { eq: surveyId } } }
        );
      return pm ?? null;
    },
    enabled: Boolean(surveyId && user.userId),
    staleTime: 30_000,
  });

  return currentPM ? (
    <Project currentPM={currentPM}>
      <Management>
        <Outlet />
      </Management>
    </Project>
  ) : null;
}
