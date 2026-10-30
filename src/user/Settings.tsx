import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormText, Label } from '@/components/ui/label';
import {
  confirmUserAttribute,
  fetchUserAttributes,
  updateUserAttribute,
} from 'aws-amplify/auth';
import {
  EraserIcon,
  LogOutIcon,
  MailIcon,
  PencilIcon,
  UserIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { isValidEmail, normalizeEmail } from '../../shared/email';
import { Body, Footer, Header, Modal, Title } from '../Modal';

type Status = { variant: 'success' | 'danger'; text: string } | null;

const sectionHeading =
  'mb-4 border-b border-white/10 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground';

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
  const [editing, setEditing] = useState(false);

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
      setStatus({ variant: 'danger', text: errorText(error) }),
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

  const initial = (username || email).charAt(0).toUpperCase();
  const profileOpen = editing || pendingEmail !== null;

  const stopEditing = () => {
    setEditing(false);
    setUsernameDraft(username);
    setEmailDraft(email);
  };

  const closeSettings = () => {
    setShow(false);
    setEditing(false);
  };

  const clearSiteData = () => {
    if (
      !window.confirm(
        'Are you sure you want to clear the site data? Do not proceed if you have unsaved work or busy uploading files.',
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
        className='flex items-center justify-center px-2 text-muted-foreground'
        style={{
          backgroundColor: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
        onClick={() => setShow(true)}
      >
        <UserIcon className='hidden lg:block' />
        <span className='block lg:hidden'>User</span>
      </button>

      <Modal show={show} onHide={closeSettings} size='lg' centered>
        <Header>
          <Title>Settings</Title>
        </Header>
        <Body>
          <div className='flex flex-col gap-6 p-4'>
            <div className='flex items-center gap-3'>
              <div className='flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-xl text-white'>
                {initial || <UserIcon className='size-6' />}
              </div>
              <div className='min-w-0 flex-1'>
                <div className='truncate text-lg leading-tight'>
                  {username || 'Your account'}
                </div>
                <div className='truncate text-sm text-muted-foreground'>
                  {email}
                </div>
              </div>
              {!pendingEmail && (
                <Button
                  variant='outline-light'
                  className='w-32'
                  onClick={editing ? stopEditing : () => setEditing(true)}
                  disabled={busy}
                >
                  {editing ? (
                    <>
                      <XIcon className='size-4' />
                      Cancel
                    </>
                  ) : (
                    <>
                      <PencilIcon className='size-4' />
                      Edit profile
                    </>
                  )}
                </Button>
              )}
            </div>

            {status && (
              <Alert
                variant={status.variant}
                onClose={() => setStatus(null)}
                className='mb-0'
              >
                {status.text}
              </Alert>
            )}

            {profileOpen && (
              <section>
                <h3 className={sectionHeading}>Edit profile</h3>
                <div className='flex flex-col gap-5'>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (usernameChanged) saveUsername();
                    }}
                  >
                    <Label htmlFor='settings-username'>Username</Label>
                    <div className='flex gap-2'>
                      <Input
                        id='settings-username'
                        value={usernameDraft}
                        onChange={(e) => setUsernameDraft(e.target.value)}
                        disabled={busy}
                        maxLength={128}
                      />
                      <Button
                        type='submit'
                        variant='primary'
                        className='w-24'
                        disabled={busy || !usernameChanged}
                      >
                        Save
                      </Button>
                    </div>
                  </form>

                  {pendingEmail ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (code.trim()) confirmEmail();
                      }}
                    >
                      <Label htmlFor='settings-email-code'>
                        Verify your new email
                      </Label>
                      <p className='mb-2 flex items-center gap-2 text-sm text-muted-foreground'>
                        <MailIcon className='size-4 shrink-0' />
                        <span>
                          Enter the code we sent to{' '}
                          <span className='text-foreground'>
                            {pendingEmail}
                          </span>
                        </span>
                      </p>
                      <div className='flex gap-2'>
                        <Input
                          id='settings-email-code'
                          value={code}
                          onChange={(e) => setCode(e.target.value)}
                          disabled={busy}
                          autoComplete='one-time-code'
                          inputMode='numeric'
                          placeholder='Verification code'
                        />
                        <Button
                          type='submit'
                          variant='primary'
                          className='w-24'
                          disabled={busy || !code.trim()}
                        >
                          Confirm
                        </Button>
                        <Button
                          type='button'
                          variant='outline-light'
                          onClick={cancelEmailChange}
                          disabled={busy}
                        >
                          Cancel
                        </Button>
                      </div>
                      <FormText>
                        Didn&apos;t get it?{' '}
                        <Button
                          type='button'
                          variant='link'
                          className='p-0 align-baseline text-[length:inherit]'
                          onClick={() => sendEmailCode(pendingEmail)}
                          disabled={busy}
                        >
                          Send a new code
                        </Button>
                      </FormText>
                    </form>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (emailChanged) sendEmailCode(newEmail);
                      }}
                    >
                      <Label htmlFor='settings-email'>Email</Label>
                      <div className='flex gap-2'>
                        <Input
                          id='settings-email'
                          type='email'
                          value={emailDraft}
                          onChange={(e) => setEmailDraft(e.target.value)}
                          disabled={busy}
                        />
                        <Button
                          type='submit'
                          variant='primary'
                          className='w-24'
                          disabled={busy || !emailChanged}
                        >
                          Change
                        </Button>
                      </div>
                      {emailChanged && (
                        <FormText>
                          We&apos;ll send a code to the new address to confirm
                          it. You keep signing in with your current email until
                          then.
                        </FormText>
                      )}
                    </form>
                  )}
                </div>
              </section>
            )}

            <section>
              <h3 className={sectionHeading}>This device</h3>
              <div className='divide-y divide-white/10'>
                <div className='flex items-center justify-between gap-4 py-3 first:pt-0'>
                  <div>
                    <div>Clear cache</div>
                    <div className='text-sm text-muted-foreground'>
                      Removes data stored in this browser and reloads. Unsaved
                      work and uploads in progress are lost.
                    </div>
                  </div>
                  <Button
                    variant='outline-warning'
                    className='w-32'
                    onClick={clearSiteData}
                  >
                    <EraserIcon className='size-4' />
                    Clear
                  </Button>
                </div>
                <div className='flex items-center justify-between gap-4 py-3 first:pt-0'>
                  <div>
                    <div>Sign out</div>
                    <div className='text-sm text-muted-foreground'>
                      Sign out of SurveyScope on this browser.
                    </div>
                  </div>
                  <Button
                    variant='outline-danger'
                    className='w-32'
                    onClick={signOut}
                  >
                    <LogOutIcon className='size-4' />
                    Sign out
                  </Button>
                </div>
              </div>
            </section>
          </div>
        </Body>
        <Footer>
          <Button variant='dark' onClick={closeSettings}>
            Close
          </Button>
        </Footer>
      </Modal>
    </>
  );
}
