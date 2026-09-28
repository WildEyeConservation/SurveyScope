import { useState, type FormEvent } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import { useSystemMaintenance } from './context';
import { maintenancePhase, validateSchedule, type MessageType } from './state';

export default function MaintenanceAdmin() {
  return <MaintenanceControls {...useSystemMaintenance()} />;
}

export function MaintenanceControls({
  state,
  now,
  error,
  refresh,
  save,
  personal = false,
}: ReturnType<typeof useSystemMaintenance> & { personal?: boolean }) {
  const [message, setMessage] = useState(
    personal
      ? ''
      : 'SurveyScope will be temporarily unavailable while we install an update. Please save your work before access pauses.'
  );
  const [messageType, setMessageType] = useState<MessageType>('update');
  const [publishNow, setPublishNow] = useState(true);
  const [publishAt, setPublishAt] = useState('');
  const [denyAccess, setDenyAccess] = useState(false);
  const [denyNow, setDenyNow] = useState(false);
  const [denyAccessAt, setDenyAccessAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const phase = maintenancePhase(state, now);
  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ text: success, error: false });
    } catch {
      setFeedback({
        text: 'Could not save. Another sysadmin may have changed the schedule. Refresh the status and try again.',
        error: true,
      });
      void refresh();
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!state) return;
    const toISO = (value: string) =>
      Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
    const input = {
      expectedRevision: state.revision,
      message: message.trim(),
      messageType,
      publishAt: publishNow ? new Date(now).toISOString() : toISO(publishAt),
      denyAccessAt: denyAccess
        ? denyNow
          ? new Date(now).toISOString()
          : toISO(denyAccessAt)
        : null,
    };
    const validation =
      validateSchedule(input) ||
      (denyAccess && !input.denyAccessAt
        ? 'Choose when access should pause.'
        : null);
    if (validation) {
      setFeedback({ text: validation, error: true });
      return;
    }
    void run(
      () => save(input),
      personal
        ? 'Saved. The selected user will receive the announcement automatically.'
        : 'Announcement saved. All connected users will receive it automatically.'
    );
  };
  const finish = () => {
    if (!state) return;
    void run(
      () =>
        save({
          expectedRevision: state.revision,
          message: '',
          messageType: 'update',
          publishAt: null,
          denyAccessAt: null,
        }),
      'Access restored and announcement removed.'
    );
  };
  return (
    <div className='p-2' style={{ maxWidth: 850 }}>
      <h5>
        {personal
          ? 'User announcement and access'
          : 'System announcements and maintenance'}
      </h5>
      <p>
        {personal
          ? 'Send a private announcement to this user and optionally pause their access. Other users are unaffected. Sysadmins retain access.'
          : 'Notify every signed-in user, then optionally pause access while you update the app. Sysadmins retain access to these controls.'}
      </p>
      {error && (
        <Alert variant='danger'>
          {error}{' '}
          <Button size='sm' onClick={() => void refresh()}>
            Refresh status
          </Button>
        </Alert>
      )}
      <Alert variant={phase === 'blocked' ? 'warning' : 'info'}>
        <strong>
          {phase === 'blocked'
            ? 'Access is paused'
            : state?.message
            ? 'Announcement configured'
            : state
            ? 'Access is open'
            : 'Loading status…'}
        </strong>
        {state?.message && (
          <>
            <p
              className='mb-1 mt-2'
              style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            >
              {state.message}
            </p>
            <div>
              Show banner: {new Date(state.publishAt!).toLocaleString()}
            </div>
            <div>
              Pause access:{' '}
              {state.denyAccessAt
                ? new Date(state.denyAccessAt).toLocaleString()
                : 'Not scheduled'}
            </div>
          </>
        )}
      </Alert>
      {personal && (
        <p className='small text-muted'>
          One announcement is stored per user. Replacing it updates their
          message and schedule. Restoring this user does not override global
          maintenance.
        </p>
      )}
      {feedback && (
        <Alert variant={feedback.error ? 'danger' : 'success'}>
          {feedback.text}
        </Alert>
      )}
      <Form onSubmit={submit}>
        <fieldset disabled={busy || !state || !!error || phase === 'blocked'}>
          <Form.Group controlId='maintenance-type' className='mb-3'>
            <Form.Label>Message type</Form.Label>
            <Form.Select
              value={messageType}
              onChange={(e) => setMessageType(e.target.value as MessageType)}
            >
              <option value='update'>Update</option>
              <option value='information'>Information</option>
              <option value='warning'>Warning</option>
            </Form.Select>
          </Form.Group>
          <Form.Group controlId='maintenance-message' className='mb-3'>
            <Form.Label>Banner message</Form.Label>
            <Form.Control
              as='textarea'
              rows={3}
              maxLength={2000}
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Form.Group>
          <Form.Check
            id='maintenance-publish-now'
            label='Show announcement now'
            checked={publishNow}
            onChange={(e) => setPublishNow(e.target.checked)}
            className='mb-2'
          />
          {!publishNow && (
            <Form.Group controlId='maintenance-publish-at' className='mb-3'>
              <Form.Label>Show announcement at</Form.Label>
              <Form.Control
                type='datetime-local'
                required
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
              />
            </Form.Group>
          )}
          <Form.Check
            id='maintenance-deny'
            label={
              personal
                ? 'Temporarily deny access to this user (except sysadmins)'
                : 'Temporarily deny access to all users (except sysadmins)'
            }
            checked={denyAccess}
            onChange={(e) => setDenyAccess(e.target.checked)}
            className='mb-2'
          />
          {denyAccess && (
            <Form.Check
              id='maintenance-deny-now'
              label='Pause access immediately'
              checked={denyNow}
              onChange={(event) => setDenyNow(event.target.checked)}
              className='mb-2'
            />
          )}
          {denyAccess && !denyNow && (
            <Form.Group controlId='maintenance-deny-at' className='mb-3'>
              <Form.Label>Deny access at</Form.Label>
              <Form.Control
                type='datetime-local'
                required
                value={denyAccessAt}
                onChange={(e) => setDenyAccessAt(e.target.value)}
              />
            </Form.Group>
          )}
          <p className='small text-muted'>
            Times use your local timezone (
            {Intl.DateTimeFormat().resolvedOptions().timeZone}). Access stays
            paused until a sysadmin restores it.
          </p>
          <Button type='submit' disabled={busy}>
            {busy
              ? 'Saving…'
              : state?.message
              ? 'Replace announcement / schedule'
              : 'Publish / schedule announcement'}
          </Button>
        </fieldset>
      </Form>
      <Button
        className='mt-3'
        variant='success'
        onClick={finish}
        disabled={busy || !state || !!error || !state.message}
      >
        Grant access again and remove message
      </Button>
    </div>
  );
}
