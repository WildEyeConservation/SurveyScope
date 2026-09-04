import { Project, Management } from './UserContext';
import { Outlet } from 'react-router-dom';
import { useParams } from 'react-router-dom';
import { useCurrentMembership } from './data/memberships';

export default function ProjectView() {
  const { surveyId } = useParams();
  const { data: currentPM } = useCurrentMembership(surveyId);

  return currentPM ? (
    <Project currentPM={currentPM}>
      <Management>
        <Outlet />
      </Management>
    </Project>
  ) : null;
}
