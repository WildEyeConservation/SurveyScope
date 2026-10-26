import { UserIcon } from 'lucide-react';
import { useContext, useState, useEffect, useCallback } from 'react';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { UserContext, GlobalContext } from '../Context';
import { useUsers } from '../apiInterface';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Modal, Header, Title, Body, Footer } from '../Modal';
import { Tabs, Tab } from '../Tabs';

interface MembershipInfo {
  organizationId: string;
  organizationName: string;
  isAdmin: boolean;
  isActive: boolean;
}

export default function Settings({ signOut }: { signOut: () => void }) {
  const [show, setShow] = useState(false);
  const { user, cognitoGroups } = useContext(UserContext)!;
  const { client } = useContext(GlobalContext);
  const { users } = useUsers();

  const [userAttributes, setUserAttributes] = useState<{ name?: string; email?: string }>({});

  useEffect(() => {
    fetchUserAttributes().then((attrs) => {
      setUserAttributes({ name: attrs.name, email: attrs.email });
    });
  }, []);

  const username = users?.find((u) => u.id === user.username)?.name ?? userAttributes.name;
  const email = users?.find((u) => u.id === user.username)?.email ?? userAttributes.email;

  // Active Organisations tab state
  const [memberships, setMemberships] = useState<MembershipInfo[]>([]);
  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string>>(new Set());
  const [maxActive, setMaxActive] = useState(5);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const currentCognitoGroupOrgIds = cognitoGroups.filter(
    (g) => g !== 'sysadmin' && g !== 'orgadmin'
  );

  const fetchMemberships = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.mutations.updateActiveOrganizations({
        activatedOrganizationIds: currentCognitoGroupOrgIds,
      });
      if (result.data) {
        let parsed = result.data;
        while (typeof parsed === 'string') parsed = JSON.parse(parsed);
        if (parsed.success && parsed.memberships) {
          setMemberships(parsed.memberships);
          setSelectedOrgIds(new Set(parsed.activeOrganizationIds));
          setMaxActive(parsed.maxActive);
          setHasChanges(false);
        }
      }
    } catch (err) {
      console.error('Failed to fetch memberships:', err);
      setError('Failed to load organisation memberships');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (show) {
      fetchMemberships();
    }
  }, [show]);

  const allAutoActivated = memberships.length <= maxActive;

  const handleToggle = (orgId: string) => {
    if (allAutoActivated) return;
    setSelectedOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) {
        next.delete(orgId);
      } else {
        if (next.size >= maxActive) return prev;
        next.add(orgId);
      }
      setHasChanges(true);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await client.mutations.updateActiveOrganizations({
        activatedOrganizationIds: Array.from(selectedOrgIds),
      });
      if (result.data) {
        let parsed = result.data;
        while (typeof parsed === 'string') parsed = JSON.parse(parsed);
        if (parsed.success) {
          // Clear all cached data and sign out to refresh cognito tokens
          localStorage.clear();
          sessionStorage.clear();
          if (window.indexedDB && 'databases' in indexedDB) {
            indexedDB.databases().then((databases) => {
              databases.forEach((db) => {
                if (db.name) indexedDB.deleteDatabase(db.name);
              });
            });
          }
          if ('caches' in window) {
            caches.keys().then((names) => {
              names.forEach((name) => caches.delete(name));
            });
          }
          window.location.reload();
        }
      }
    } catch (err) {
      console.error('Failed to update active organisations:', err);
      setError('Failed to update active organisations');
      setSaving(false);
    }
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
        className='text-muted-foreground px-2 flex items-center justify-center'
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
          <Tabs>
            <Tab label='Account'>
              <div className='p-4'>
                <div className='flex flex-col gap-2'>
                  <p className='mb-0'>Username: {username}</p>
                  <p className='mb-0'>Email: {email}</p>
                </div>
                <Button
                  className='w-full mt-4'
                  variant='outline-danger'
                  onClick={signOut}
                >
                  Sign Out
                </Button>
                <Button
                  className='w-full mt-2'
                  variant='outline-warning'
                  onClick={clearSiteData}
                >
                  Clear Cache
                </Button>
              </div>
            </Tab>
            <Tab label='Active Organisations'>
              <div className='p-4'>
                {loading ? (
                  <div className='flex justify-center py-6'>
                    <Spinner animation='border' />
                  </div>
                ) : error ? (
                  <Alert variant='danger'>{error}</Alert>
                ) : (
                  <>
                    <div className='flex justify-between items-center mb-4'>
                      <span className='text-muted-foreground'>
                        {selectedOrgIds.size} / {maxActive} active
                      </span>
                      {allAutoActivated && (
                        <Badge variant='info'>
                          All organisations active ({memberships.length} or fewer)
                        </Badge>
                      )}
                    </div>
                    {memberships.length === 0 ? (
                      <p className='text-muted-foreground'>No organisation memberships found.</p>
                    ) : (
                      <div className='flex flex-col gap-2'>
                        {memberships.map((m) => (
                          <div
                            key={m.organizationId}
                            className='flex items-center justify-between p-2 '
                            style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                          >
                            <div className='flex items-center gap-2'>
                              <Switch
                                checked={
                                  allAutoActivated || selectedOrgIds.has(m.organizationId)
                                }
                                disabled={
                                  allAutoActivated ||
                                  saving ||
                                  (!selectedOrgIds.has(m.organizationId) &&
                                    selectedOrgIds.size >= maxActive)
                                }
                                onCheckedChange={() => handleToggle(m.organizationId)}
                              />
                              <span>{m.organizationName}</span>
                              {m.isAdmin && (
                                <Badge variant='warning' className='text-black'>
                                  Admin
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </Tab>
          </Tabs>
        </Body>
        <Footer>
          <Button variant='dark' onClick={() => setShow(false)}>
            Close
          </Button>
          {hasChanges && !allAutoActivated && (
            <Button
              variant='primary'
              onClick={handleSave}
              disabled={saving || selectedOrgIds.size === 0}
            >
              {saving ? (
                <>
                  <Spinner size='sm' />
                  Saving...
                </>
              ) : (
                'Save & Sign Out'
              )}
            </Button>
          )}
        </Footer>
      </Modal>
    </>
  );
}
