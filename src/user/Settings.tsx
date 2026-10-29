import { UserIcon } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import {
  confirmUserAttribute,
  fetchUserAttributes,
  updateUserAttribute,
} from 'aws-amplify/auth';
import { Button, Form, InputGroup } from 'react-bootstrap';
import { Modal, Header, Title, Body, Footer } from '../Modal';
import { isValidEmail, normalizeEmail } from '../../shared/email';

type Status = { variant: 'success' | 'danger'; text: string } | null;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function Settings({ signOut }: { signOut: () => void }) {
  const [show, setShow] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [usernameDraft, setUsernameDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const loadAttributes = useCallback(async () => {
    const attrs = await fetchUserAttributes();
    setUsername(attrs.preferred_username ?? '');
    setEmail(attrs.email ?? '');
    setUsernameDraft(attrs.preferred_username ?? '');
    setEmailDraft(attrs.email ?? '');
  }, []);

  useEffect(() => {
    if (!show) return;
    setStatus(null);
    loadAttributes().catch((error) =>
      setStatus({ variant: 'danger', text: errorText(error) })
    );
  }, [show, loadAttributes]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setStatus(null);
    try {
      await action();
    } catch (error) {
      setStatus({ variant: 'danger', text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const trimmedUsername = usernameDraft.trim();
  const newEmail = normalizeEmail(emailDraft);
  const usernameChanged =
    trimmedUsername !== '' && trimmedUsername !== username;
  const emailChanged = newEmail !== '' && newEmail !== normalizeEmail(email);

  const saveUsername = () =>
    run(async () => {
      await updateUserAttribute({
        userAttribute: {
          attributeKey: 'preferred_username',
          value: trimmedUsername,
        },
      });
      await loadAttributes();
      setStatus({ variant: 'success', text: 'Username updated.' });
    });

  const sendEmailCode = (address: string) =>
    run(async () => {
      if (!isValidEmail(address)) {
        throw new Error('Enter a valid email address');
      }
      const { nextStep } = await updateUserAttribute({
        userAttribute: { attributeKey: 'email', value: address },
      });
      if (nextStep.updateAttributeStep === 'CONFIRM_ATTRIBUTE_WITH_CODE') {
        setPendingEmail(address);
        setCode('');
        setStatus({
          variant: 'success',
          text: `We sent a verification code to ${address}. Your current email stays active until you confirm it.`,
        });
      } else {
        await loadAttributes();
        setStatus({ variant: 'success', text: 'Email updated.' });
      }
    });

  const confirmEmail = () =>
    run(async () => {
      await confirmUserAttribute({
        userAttributeKey: 'email',
        confirmationCode: code.trim(),
      });
      setPendingEmail(null);
      setCode('');
      await loadAttributes();
      setStatus({
        variant: 'success',
        text: 'Email updated. Use your new email the next time you sign in.',
      });
    });

  const cancelEmailChange = () => {
    setPendingEmail(null);
    setCode('');
    setEmailDraft(email);
    setStatus(null);
  };

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
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                if (usernameChanged) saveUsername();
              }}
            >
              <Form.Group className='mb-3' controlId='settings-username'>
                <Form.Label>Username</Form.Label>
                <InputGroup>
                  <Form.Control
                    value={usernameDraft}
                    onChange={(e) => setUsernameDraft(e.target.value)}
                    disabled={busy}
                    maxLength={128}
                  />
                  <Button
                    type='submit'
                    variant='primary'
                    disabled={busy || !usernameChanged}
                  >
                    Save
                  </Button>
                </InputGroup>
              </Form.Group>
            </Form>
            {pendingEmail ? (
              <Form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.trim()) confirmEmail();
                }}
              >
                <Form.Group className='mb-3' controlId='settings-email-code'>
                  <Form.Label>
                    Verification code sent to {pendingEmail}
                  </Form.Label>
                  <InputGroup>
                    <Form.Control
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      disabled={busy}
                      autoComplete='one-time-code'
                      inputMode='numeric'
                    />
                    <Button
                      type='submit'
                      variant='primary'
                      disabled={busy || !code.trim()}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant='outline-secondary'
                      onClick={cancelEmailChange}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </InputGroup>
                  <Form.Text>
                    Didn&apos;t get it?{' '}
                    <Button
                      variant='link'
                      className='p-0 align-baseline'
                      onClick={() => sendEmailCode(pendingEmail)}
                      disabled={busy}
                    >
                      Send a new code
                    </Button>
                  </Form.Text>
                </Form.Group>
              </Form>
            ) : (
              <Form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (emailChanged) sendEmailCode(newEmail);
                }}
              >
                <Form.Group className='mb-3' controlId='settings-email'>
                  <Form.Label>Email</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type='email'
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      disabled={busy}
                    />
                    <Button
                      type='submit'
                      variant='primary'
                      disabled={busy || !emailChanged}
                    >
                      Change
                    </Button>
                  </InputGroup>
                  <Form.Text>
                    You sign in with this email. We&apos;ll send a code to the
                    new address to confirm it.
                  </Form.Text>
                </Form.Group>
              </Form>
            )}
            {status && (
              <p className={`mb-0 text-${status.variant}`}>{status.text}</p>
            )}
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
