import { useEffect, useRef, useState } from 'react';
import { Form } from 'react-bootstrap';
import { useUsers } from '../apiInterface';
import { useSystemMaintenance } from './context';
import { MaintenanceControls } from './MaintenanceAdmin';
import {
  getUserAnnouncement,
  setUserAnnouncement,
  type UserAnnouncement,
} from './api';
import type { MaintenanceInput } from './state';

export default function UserMaintenanceAdmin() {
  const { users: allUsers } = useUsers();
  const [userId, setUserId] = useState('');
  return (
    <>
      <Form.Group controlId='announcement-recipient' className='m-2'>
        <Form.Label>Recipient</Form.Label>
        <Form.Select
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        >
          <option value=''>Choose a user</option>
          {allUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name || user.email || user.id}
              {user.name && user.email ? ` (${user.email})` : ''}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
      {userId && <UserControls key={userId} userId={userId} />}
    </>
  );
}

function UserControls({ userId }: { userId: string }) {
  const global = useSystemMaintenance();
  const [state, setState] = useState<UserAnnouncement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const accept = (next: UserAnnouncement) => {
    if (mounted.current)
      setState((previous) =>
        !previous || next.revision >= previous.revision ? next : previous
      );
  };
  const refresh = async () => {
    try {
      accept(await getUserAnnouncement(userId));
      if (mounted.current) setError(null);
    } catch {
      if (mounted.current)
        setError(
          'Unable to load this user’s announcement. Refresh to try again.'
        );
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
    // The keyed component is recreated when the recipient changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = async (input: MaintenanceInput) => {
    accept(await setUserAnnouncement({ ...input, userId }));
  };
  return (
    <MaintenanceControls
      {...global}
      personal
      state={state}
      error={error}
      refresh={refresh}
      save={save}
    />
  );
}
