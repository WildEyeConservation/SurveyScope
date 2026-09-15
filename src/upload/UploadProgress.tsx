import { useEffect, useState } from 'react';
import { Button } from 'react-bootstrap';
import { AlertTriangle, Pause, Play, WifiOff, X } from 'lucide-react';
import BlockedUploadModal from './BlockedUploadModal';
import { uploadOrchestrator } from './core/UploadOrchestrator';
import { useUploadStatus, useUploadUi } from './uploadUi';

// Navbar upload status pill.
export default function UploadProgress() {
  const snapshot = useUploadStatus();
  const { deletingProjectId, deleteStep, deleteTotal } = useUploadUi();
  const [showDetails, setShowDetails] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // A blocked upload cannot continue until the user chooses an action.
  const phase = snapshot?.phase;
  useEffect(() => {
    if (phase === 'blocked') setShowBlocked(true);
  }, [phase]);

  if (deletingProjectId) {
    return (
      <div className='px-2'>
        <p className='m-0'>{`Deleting survey: ${deleteStep}/${deleteTotal}`}</p>
      </div>
    );
  }

  if (!snapshot) return null;

  const offline =
    !isOnline ||
    (snapshot.phase === 'paused' && snapshot.pauseReason === 'offline');

  if (offline) {
    return (
      <div className='px-2 d-flex flex-row align-items-center gap-2'>
        <WifiOff className='text-warning' />
        <p className='m-0 text-warning'>Waiting for connection...</p>
      </div>
    );
  }

  const {
    processed,
    total,
    bytesUploaded,
    bytesTotal,
    throughputBps,
    etaSeconds,
    failures,
    blocked,
    attempt,
    errorMessage,
    projectId,
  } = snapshot;

  const percent =
    bytesTotal > 0
      ? Math.min(100, Math.round((bytesUploaded / bytesTotal) * 100))
      : total > 0
      ? Math.round((processed / total) * 100)
      : 0;

  const dotColor =
    phase === 'failed'
      ? 'red'
      : phase === 'blocked'
      ? 'orange'
      : phase === 'waiting-retry' || phase === 'paused'
      ? 'yellow'
      : 'lime';

  const controlButton = (
    icon: React.ReactNode,
    title: string,
    onClick: () => void
  ) => (
    <Button
      size='sm'
      variant='outline-light'
      className='py-0 px-1 border-0'
      title={title}
      onClick={onClick}
    >
      {icon}
    </Button>
  );

  let statusContent: React.ReactNode;
  let controls: React.ReactNode = null;

  switch (phase) {
    case 'preparing':
      statusContent = <p className='m-0'>Preparing upload...</p>;
      controls = controlButton(<Pause size={16} />, 'Pause upload', () =>
        uploadOrchestrator.pause('user')
      );
      break;
    case 'uploading':
      statusContent = (
        <div className='d-flex flex-column'>
          <p className='m-0'>{`${percent}% uploaded`}</p>
          {(throughputBps !== null || etaSeconds !== null) && (
            <p className='m-0' style={{ fontSize: 12 }}>
              {throughputBps !== null && `${formatRate(throughputBps)}`}
              {throughputBps !== null && etaSeconds !== null && ' • '}
              {etaSeconds !== null && `${formatDuration(etaSeconds)} left`}
            </p>
          )}
        </div>
      );
      controls = controlButton(<Pause size={16} />, 'Pause upload', () =>
        uploadOrchestrator.pause('user')
      );
      break;
    case 'waiting-retry':
      statusContent = (
        <p className='m-0'>{`Retrying... (attempt ${attempt})`}</p>
      );
      controls = controlButton(<Pause size={16} />, 'Pause upload', () =>
        uploadOrchestrator.pause('user')
      );
      break;
    case 'finalizing':
      statusContent = (
        <p className='m-0'>{snapshot.statusMessage ?? 'Finishing up...'}</p>
      );
      break;
    case 'paused':
      statusContent = <p className='m-0'>Upload paused</p>;
      controls = (
        <>
          {controlButton(<Play size={16} />, 'Resume upload', () =>
            uploadOrchestrator.resume(projectId)
          )}
          {controlButton(<X size={16} />, 'Dismiss', () =>
            uploadOrchestrator.discard()
          )}
        </>
      );
      break;
    case 'blocked':
      statusContent = (
        <p className='m-0 text-warning'>
          {`${blocked.length} image${
            blocked.length === 1 ? '' : 's'
          } could not be uploaded`}
        </p>
      );
      controls = controlButton(
        <AlertTriangle size={16} className='text-warning' />,
        'Review the images that could not be uploaded',
        () => setShowBlocked(true)
      );
      break;
    case 'failed':
      statusContent = <p className='m-0 text-danger'>Upload error</p>;
      controls = (
        <>
          {controlButton(<Play size={16} />, 'Retry upload', () =>
            uploadOrchestrator.resume(projectId)
          )}
          {controlButton(<X size={16} />, 'Dismiss', () =>
            uploadOrchestrator.discard()
          )}
        </>
      );
      break;
    default:
      return null;
  }

  const isBlocked = phase === 'blocked';
  const hasDetails =
    !isBlocked && (failures.length > 0 || Boolean(errorMessage));
  const onPillClick = isBlocked
    ? () => setShowBlocked(true)
    : hasDetails
    ? () => setShowDetails((s) => !s)
    : undefined;

  return (
    <>
      <div className='px-2 position-relative'>
        <div
          className='d-flex flex-row align-items-center gap-2'
          style={{ cursor: onPillClick ? 'pointer' : undefined }}
          onClick={onPillClick}
        >
          <div
            style={{
              width: 10,
              height: 10,
              backgroundColor: dotColor,
              borderRadius: 5,
              flexShrink: 0,
            }}
          />
          {statusContent}
          {!isBlocked && failures.length > 0 && (
            <span
              className='badge bg-warning text-dark'
              title={`${failures.length} file(s) failed in the last attempt`}
            >
              {failures.length}
            </span>
          )}
          {controls}
        </div>
        {showDetails && hasDetails && (
          <div
            className='position-absolute bg-dark text-light border border-secondary rounded p-2'
            style={{
              top: '100%',
              right: 0,
              zIndex: 2000,
              minWidth: 320,
              maxWidth: 480,
              maxHeight: 320,
              overflowY: 'auto',
              fontSize: 12,
            }}
          >
            {errorMessage && <p className='mb-2 text-danger'>{errorMessage}</p>}
            {failures.length > 0 && (
              <>
                <p className='mb-1'>
                  {failures.length} file{failures.length === 1 ? '' : 's'}{' '}
                  failed in the last attempt:
                </p>
                <ul className='mb-2 ps-3'>
                  {failures.slice(0, 50).map((f) => (
                    <li key={f.originalPath}>
                      <code style={{ fontSize: 11 }}>{f.originalPath}</code>{' '}
                      <span className='text-warning'>({f.message})</span>
                    </li>
                  ))}
                  {failures.length > 50 && (
                    <li>…and {failures.length - 50} more</li>
                  )}
                </ul>
                {(phase === 'paused' || phase === 'failed') && (
                  <Button
                    size='sm'
                    variant='warning'
                    onClick={() => {
                      setShowDetails(false);
                      uploadOrchestrator.resume(projectId);
                    }}
                  >
                    Retry failed files
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <BlockedUploadModal
        show={isBlocked && showBlocked}
        blocked={blocked}
        projectId={projectId}
        onClose={() => setShowBlocked(false)}
        onRetry={() => {
          setShowBlocked(false);
          uploadOrchestrator.resume(projectId);
        }}
        onContinueWithout={() => {
          setShowBlocked(false);
          uploadOrchestrator.skipBlocked();
        }}
      />
    </>
  );
}

function formatRate(bytesPerSecond: number): string {
  const mbps = bytesPerSecond / (1024 * 1024);
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
