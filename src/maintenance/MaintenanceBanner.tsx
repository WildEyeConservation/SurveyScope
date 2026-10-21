import { Alert } from 'react-bootstrap';
import { useSystemMaintenance } from './context';
import { type MaintenanceState, maintenancePhase } from './state';

export function MaintenanceBanner() {
  const { state, userState, now, isSysadmin } = useSystemMaintenance();
  return (
    <>
      <Announcement
        state={state}
        now={now}
        isSysadmin={isSysadmin}
        personal={false}
      />
      <Announcement
        state={userState}
        now={now}
        isSysadmin={isSysadmin}
        personal
      />
    </>
  );
}

function Announcement({
  state,
  now,
  isSysadmin,
  personal,
}: {
  state: MaintenanceState | null;
  now: number;
  isSysadmin: boolean;
  personal: boolean;
}) {
  const phase = maintenancePhase(state, now);
  if (!state || (phase !== 'announced' && phase !== 'blocked')) return null;
  return (
    <Alert
      variant={state.messageType === 'information' ? 'info' : 'warning'}
      role='status'
      className='mb-0 rounded-0 flex-shrink-0 py-2 px-3'
      style={{
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        maxHeight: '30vh',
        overflowY: 'auto',
      }}
    >
      <strong>
        {personal && 'For you - '}
        {state.messageType === 'update'
          ? 'Update'
          : state.messageType === 'warning'
          ? 'Warning'
          : 'Notice'}
        :{' '}
      </strong>
      {state.message}
      {state.denyAccessAt && (
        <div className='small mt-1'>
          {phase === 'blocked'
            ? 'Access is temporarily paused.'
            : `Access will pause at ${new Date(
                state.denyAccessAt
              ).toLocaleString()}. Please save your work before then.`}
          {isSysadmin && ' Sysadmins retain access.'}
        </div>
      )}
    </Alert>
  );
}
