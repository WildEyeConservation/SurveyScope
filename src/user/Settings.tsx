import { UserIcon } from 'lucide-react';
import { useContext, useState, useEffect } from 'react';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { UserContext } from '../Context';
import { useUsers } from '../apiInterface';
import { Button } from 'react-bootstrap';
import { Modal, Header, Title, Body, Footer } from '../Modal';

export default function Settings({ signOut }: { signOut: () => void }) {
  const [show, setShow] = useState(false);
  const { user } = useContext(UserContext)!;
  const { users } = useUsers();

  const [userAttributes, setUserAttributes] = useState<{ name?: string; email?: string }>({});

  useEffect(() => {
    fetchUserAttributes().then((attrs) => {
      setUserAttributes({ name: attrs.name, email: attrs.email });
    });
  }, []);

  const username = users?.find((u) => u.id === user.username)?.name ?? userAttributes.name;
  const email = users?.find((u) => u.id === user.username)?.email ?? userAttributes.email;

  const clearSiteData = () => {
    if (
      !window.confirm(
        'Are you sure you want to clear the site data? Do not proceed if you have unsaved work or busy uploading files.'
      )
    ) {
      return;
    }

    localStorage.clear();
    sessionStorage.clear();

    if (window.indexedDB) {
      if ('databases' in indexedDB) {
        indexedDB.databases().then((databases) => {
          databases.forEach((db) => {
            if (db.name) {
              indexedDB.deleteDatabase(db.name);
            }
          });
        });
      }
    }

    document.cookie.split(';').forEach((cookie) => {
      const eqPos = cookie.indexOf('=');
      const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
      document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    });

    if ('caches' in window) {
      caches.keys().then((names) => {
        names.forEach((name) => {
          caches.delete(name);
        });
      });
    }

    window.location.reload();
  };

  return (
    <>
      <button
        className='text-muted px-2 d-flex align-items-center justify-content-center'
        style={{
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
        onClick={() => setShow(true)}
      >
        <UserIcon className='d-none d-lg-block' />
        <span className='d-block d-lg-none'>User</span>
      </button>

      <Modal
        show={show}
        onHide={() => setShow(false)}
        size='lg'
        centered
      >
        <Header>
          <Title>Settings</Title>
        </Header>
        <Body className='p-0'>
          <div className='p-3'>
            <div className='d-flex flex-column gap-2'>
              <p className='mb-0'>Username: {username}</p>
              <p className='mb-0'>Email: {email}</p>
            </div>
            <Button
              className='w-100 mt-3'
              variant='outline-danger'
              onClick={signOut}
            >
              Sign Out
            </Button>
            <Button
              className='w-100 mt-2'
              variant='outline-warning'
              onClick={clearSiteData}
            >
              Clear Cache
            </Button>
          </div>
        </Body>
        <Footer>
          <Button variant='dark' onClick={() => setShow(false)}>
            Close
          </Button>
        </Footer>
      </Modal>
    </>
  );
}
