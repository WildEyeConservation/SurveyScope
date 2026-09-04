import { useParams } from 'react-router-dom';
import { useSession } from '../../session';
import { SharedHerdViewHarness } from './SharedHerdViewHarness';

/**
 * Route element for `/shared-chains/:shareId`. Gated to reviewers who hold the
 * per-share Cognito group `chainshare-<shareId>` (or sysadmins). Entitlement is
 * the group membership itself — the read-only snapshot tables are only legible
 * to that group.
 */
export function SharedChainViewerPage() {
  const { shareId } = useParams();
  const { cognitoGroups } = useSession();

  if (!shareId) {
    return (
      <div className='p-4 text-light'>
        Missing <code>shareId</code> in the URL.
      </div>
    );
  }

  const entitled =
    cognitoGroups.includes('sysadmin') ||
    cognitoGroups.includes(`chainshare-${shareId}`);

  if (!entitled) {
    return (
      <div className='p-4 text-light'>
        This shared chain review is not available to your account.
      </div>
    );
  }

  return <SharedHerdViewHarness shareId={shareId} />;
}
