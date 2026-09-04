import { useContext, useState } from 'react';
import { UserContext } from '../Context';
import { client } from '../stores/appClient';
import { Schema } from '../amplify/client-schema';
import Button from 'react-bootstrap/Button';
import { Bell, Check, X, RefreshCw } from 'lucide-react';
import { Card } from 'react-bootstrap';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export default function Notifications() {
  const [show, setShow] = useState(false);
  const { user } = useContext(UserContext)!;
  const username = user.username;

  const { data: allInvites, isFetching, refetch } = useQuery<Schema['OrganizationInvite']['type'][]>({
    queryKey: ['OrganizationInvite', username],
    queryFn: async () => {
      const result = await client.models.OrganizationInvite.organizationInvitesByUsername({ username });
      return result.data;
    },
    enabled: !!username,
    staleTime: 0,
    gcTime: 0,
  });

  const pendingInvites = allInvites?.filter((inv) => inv.status === 'pending') ?? [];
  const totalNotifications = pendingInvites.length;

  return (
    <div className='position-relative'>
      <button
        className='text-muted px-2 d-flex align-items-center justify-content-center'
        style={{
          position: 'relative',
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
        onClick={() => setShow(!show)}
      >
        <div
          className='d-none d-lg-block'
          style={{ position: 'relative', height: '100%' }}
        >
          <div
            className='text-white bg-primary'
            style={{
              position: 'absolute',
              top: -5,
              right: -5,
              borderRadius: '50%',
              minWidth: '16px',
              height: '16px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              fontSize: '14px',
            }}
          >
            {totalNotifications}
          </div>
          <Bell className='d-none d-lg-block' />
        </div>
        <span className='d-block d-lg-none'>Notifications</span>
      </button>
      {show && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 1,
          }}
          onClick={() => setShow(false)}
        />
      )}
      {username && (
        <Card
          className='position-fixed w-100 mt-lg-3'
          style={{
            maxWidth: '400px',
            right: 0,
            opacity: show ? 1 : 0,
            pointerEvents: show ? 'auto' : 'none',
            transition: 'opacity 0.15s ease-in-out',
            overflow: 'auto',
            zIndex: 2,
          }}
        >
          <Card.Header className='d-flex justify-content-between align-items-center'>
            <div className='d-flex align-items-center gap-2'>
              <Card.Title className='mb-0'>Notifications</Card.Title>
              <Button
                variant='link'
                size='sm'
                className='p-0 text-muted'
                onClick={() => refetch()}
                disabled={isFetching}
                title='Refresh'
              >
                <RefreshCw size={16} className={isFetching ? 'spinning' : undefined} />
              </Button>
            </div>
            <X onClick={() => setShow(false)} style={{ cursor: 'pointer' }} />
          </Card.Header>
          <Card.Body>
            <Inbox invites={pendingInvites} queryKey={['OrganizationInvite', username]} />
          </Card.Body>
        </Card>
      )}
    </div>
  );
}

function Inbox({
  invites,
  queryKey,
}: {
  invites: Schema['OrganizationInvite']['type'][];
  queryKey: unknown[];
}) {
  return invites.length === 0 ? (
    <h5 className='text-center mb-0 p-2'>Empty</h5>
  ) : (
    <>
      {invites.map((invite, i) => (
        <Invite key={invite.id} invite={invite} index={i} queryKey={queryKey} />
      ))}
    </>
  );
}

function Invite({
  invite,
  index,
  queryKey,
}: {
  invite: Schema['OrganizationInvite']['type'];
  index: number;
  queryKey: unknown[];
}) {
  const queryClient = useQueryClient();
  const [responding, setResponding] = useState(false);

  function updateCacheStatus(status: 'accepted' | 'declined') {
    queryClient.setQueryData<Schema['OrganizationInvite']['type'][]>(
      queryKey,
      (old) => old?.map((inv) => inv.id === invite.id ? { ...inv, status } : inv)
    );
  }

  async function acceptInvite() {
    setResponding(true);
    try {
      const { data, errors } = await client.mutations.respondToInvite({
        inviteId: invite.id,
        accept: true,
      });
      if (errors?.length) {
        alert(errors[0].message);
        return;
      }
      updateCacheStatus('accepted');

      // Check if user was added to the cognito group or hit the limit
      let parsed = data;
      while (typeof parsed === 'string') parsed = JSON.parse(parsed);
      if (parsed?.addedToGroup) {
        // Clear cache and reload to pick up new cognito group
        localStorage.clear();
        sessionStorage.clear();
        if (window.indexedDB && 'databases' in indexedDB) {
          indexedDB.databases().then((dbs) => {
            dbs.forEach((db) => { if (db.name) indexedDB.deleteDatabase(db.name); });
          });
        }
        if ('caches' in window) {
          caches.keys().then((names) => { names.forEach((n) => caches.delete(n)); });
        }
        window.location.reload();
      } else if (parsed && !parsed.addedToGroup) {
        alert('You belong to too many organisations. Go to Settings > Active Organisations to choose which ones are active.');
      }
    } catch (err: any) {
      alert(err.message ?? 'Failed to accept invite');
    } finally {
      setResponding(false);
    }
  }

  async function declineInvite() {
    setResponding(true);
    try {
      const { errors } = await client.mutations.respondToInvite({
        inviteId: invite.id,
        accept: false,
      });
      if (errors?.length) {
        alert(errors[0].message);
        return;
      }
      updateCacheStatus('declined');
    } catch (err: any) {
      alert(err.message ?? 'Failed to decline invite');
    } finally {
      setResponding(false);
    }
  }

  return (
    <div
      className={`d-flex flex-row gap-2 text-primary-subtle text-start p-2 ${index % 2 !== 0 ? 'bg-secondary text-dark' : ''
        }`}
    >
      <div>
        <p className='mb-2' style={{ fontSize: '1.25rem' }}>
          Organization Invite
        </p>
        <p className='mb-0'>
          <b>
            {(invite as any).organizationName ?? 'Unknown Organization'}
          </b>{' '}
          invited you to their organisation.
        </p>
      </div>
      <div className='d-flex gap-1'>
        <Button variant='success' onClick={acceptInvite} disabled={responding}>
          <Check />
        </Button>
        <Button variant='danger' onClick={declineInvite} disabled={responding}>
          <X />
        </Button>
      </div>
    </div>
  );
}
