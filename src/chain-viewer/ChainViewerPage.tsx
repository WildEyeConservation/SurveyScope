import { useContext } from 'react';
import { useParams } from 'react-router-dom';
import { UserContext } from '../Context';
import { HerdViewHarness } from './HerdViewHarness';

/**
 * Route element for `/surveys/:surveyId/set/:annotationSetId/chain-viewer`.
 * Defaults to the herd view (a stripped-down ChainLinker for walking neighbour
 * pairs that contain animals); per-chain tiles open as a modal from a marker.
 * Gates access to sysadmins — the workflow is experimental and not yet ready
 * for general orgadmin use.
 */
export function ChainViewerPage() {
  const { annotationSetId } = useParams();
  const { cognitoGroups } = useContext(UserContext)!;
  const isSysadmin = cognitoGroups.includes('sysadmin');

  if (!annotationSetId) {
    return (
      <div className='p-6 text-light'>
        Missing <code>annotationSetId</code> in the URL.
      </div>
    );
  }
  if (!isSysadmin) {
    return (
      <div className='p-6 text-light'>
        Chain viewer is restricted to sysadmins.
      </div>
    );
  }

  return <HerdViewHarness annotationSetId={annotationSetId} />;
}
