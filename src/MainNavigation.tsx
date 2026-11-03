import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { Menu } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { GlobalContext, UserContext } from './Context.tsx';
import { ProgressIndicators } from './ProgressIndicators.jsx';
import UploadProgress from './upload/UploadProgress.tsx';
import Notifications from './user/Notifications.tsx';
import Settings from './user/Settings.tsx';
import { verifyToken } from './utils/jwt.ts';

export default function MainNavigation({ signOut }: { signOut: () => void }) {
  const {
    cognitoGroups,
    myOrganizationHook,
    isOrganizationAdmin,
    myMembershipHook: myProjectsHook,
    isAnnotatePath,
    setIsAnnotatePath,
    user,
  } = useContext(UserContext)!;
  const queryClient = useQueryClient();

  const { client } = useContext(GlobalContext)!;
  const [, setCheckingToken] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  const myAdminProjects = myProjectsHook.data?.filter(
    (project) => project.isAdmin,
  );

  const belongsToOrganization = myOrganizationHook.data.length > 0;

  useEffect(() => {
    setIsAnnotatePath(
      /^\/surveys\/[^/]+\/annotate$/.test(location.pathname) ||
        /^\/surveys\/[^/]+\/qc-review\/[^/]+$/.test(location.pathname) ||
        /^\/surveys\/[^/]+\/info-tags\/[^/]+$/.test(location.pathname) ||
        /^\/surveys\/[^/]+\/homography\/[^/]+$/.test(location.pathname),
    );
  }, [location.pathname]);

  useEffect(() => {
    if (
      belongsToOrganization &&
      (location.pathname === '' ||
        location.pathname === '/' ||
        location.pathname === '/SSRegisterOrganization' ||
        location.pathname === '/surveys' ||
        location.pathname === '/jobs')
    ) {
      navigate(
        myAdminProjects?.length > 0 || isOrganizationAdmin
          ? '/surveys'
          : '/jobs',
      );
    }
  }, [isOrganizationAdmin, myAdminProjects.length, belongsToOrganization]);

  useEffect(() => {
    async function checkToken() {
      setCheckingToken(true);
      try {
        const token = localStorage.getItem('jwt');
        if (token) {
          localStorage.removeItem('jwt');

          const { data: secret } = await client.mutations.getJwtSecret();
          if (!secret) {
            console.error('Error getting JWT secret');
            return;
          }

          const payload = (await verifyToken(token, secret)) as {
            type: string;
            surveyId: string;
            annotationSetId: string;
            exp: number;
          };

          if (payload.exp < Date.now() / 1000) {
            alert('Results link expired');
            return;
          }

          if (payload.type === 'jolly') {
            const { data: jollyResultsMembership } =
              await client.models.JollyResultsMembership.get({
                surveyId: payload.surveyId,
                annotationSetId: payload.annotationSetId,
                userId: user.userId,
              });

            if (!jollyResultsMembership) {
              const { data: surveyProject } = await client.models.Project.get({
                id: payload.surveyId,
              });
              await client.models.JollyResultsMembership.create({
                surveyId: payload.surveyId,
                annotationSetId: payload.annotationSetId,
                userId: user.userId,
                group: surveyProject?.organizationId,
              });
            }

            queryClient.invalidateQueries({
              queryKey: ['JollyResultsMembership'],
            });

            navigate(`/jolly/${payload.surveyId}/${payload.annotationSetId}`);
          }
        }
      } catch (error) {
        console.error(error);
        localStorage.removeItem('jwt');
      } finally {
        setCheckingToken(false);
      }
    }

    checkToken();
  }, []);

  useEffect(() => {
    if (isOrganizationAdmin && location.pathname === '/jobs') {
      navigate('/surveys');
    }
  }, [isOrganizationAdmin]);

  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div
      className='App flex flex-col'
      style={{ height: '100dvh', overflow: 'hidden' }}
    >
      <nav className='sticky top-0 z-[1020] flex flex-wrap items-center justify-between bg-secondary px-4 py-2 text-white lg:flex-nowrap lg:justify-start'>
        <div
          className='me-2 flex flex-row flex-nowrap items-center py-[0.3125rem] text-xl whitespace-nowrap'
          onClick={() => {
            if (!isAnnotatePath) {
              navigate(
                isOrganizationAdmin
                  ? '/surveys'
                  : belongsToOrganization
                    ? '/jobs'
                    : '/',
              );
            }
          }}
          style={{ cursor: isAnnotatePath ? 'default' : 'pointer' }}
        >
          <img
            src='/Logo.png'
            alt='Logo'
            style={{ height: '32px', marginRight: '4px' }}
          />
          <h1 style={{ marginBottom: '0px', fontSize: '24px' }}>SurveyScope</h1>
        </div>
        <button
          type='button'
          aria-controls='responsive-navbar-nav'
          aria-expanded={navOpen}
          aria-label='Toggle navigation'
          className='border border-white/10 px-3 py-1 text-white/75 lg:hidden'
          onClick={() => setNavOpen((o) => !o)}
        >
          <Menu className='size-7' />
        </button>
        <div
          id='responsive-navbar-nav'
          className={cn(
            'w-full grow basis-full items-center lg:flex lg:basis-auto',
            navOpen ? 'block' : 'hidden',
          )}
        >
          {!isAnnotatePath && (
            <div className='flex flex-col lg:flex-row'>
              {belongsToOrganization && (
                <>
                  {(myAdminProjects?.length > 0 || isOrganizationAdmin) && (
                    <NavItem to={`surveys`}>Surveys</NavItem>
                  )}
                  <NavItem to={`jobs`}>Jobs</NavItem>
                </>
              )}
              <NavItem to={'workflow-statistics'}>Workflow Statistics</NavItem>
              {isOrganizationAdmin && (
                <>
                  <NavItem to={`permissions`}>Permissions</NavItem>
                  <NavItem to={`testing`}>User Testing</NavItem>
                </>
              )}
              {cognitoGroups.includes('sysadmin') && (
                <>
                  <NavItem to={`SSAdmin`}>Admin</NavItem>
                  <NavItem to={`chain-share-admin`}>Chain Shares</NavItem>
                </>
              )}
              {/* Shared Results hidden for now.
              <OverlayTrigger
                placement='bottom'
                overlay={<Tooltip id='shared-results-tooltip'>Under maintenance</Tooltip>}
              >
                <div className='inline-block'>
                  <Nav.Link
                    as={NavLink}
                    eventKey={`shared-results`}
                    to={`shared-results`}
                    className='px-2'
                    disabled={true}
                    style={{ pointerEvents: 'none' }}
                  >
                    Shared Results
                  </NavItem>
                </div>
              </OverlayTrigger>
              */}
              {(cognitoGroups.includes('sysadmin') ||
                cognitoGroups.some((g) => g.startsWith('chainshare-'))) && (
                <NavItem to={`shared-chains`}>Shared Chains</NavItem>
              )}
            </div>
          )}
          <div className='mt-2 flex grow flex-col items-center justify-end gap-4 lg:mt-0 lg:flex-row lg:gap-0'>
            <UploadProgress />
            <ProgressIndicators />
            <Settings signOut={signOut} />
            <Notifications />
          </div>
        </div>
      </nav>
      <div className='mx-auto flex h-full w-full justify-center overflow-y-auto px-3'>
        {(!belongsToOrganization &&
          location.pathname === '/SSRegisterOrganization') ||
        belongsToOrganization ||
        location.pathname === '/workflow-statistics' ||
        location.pathname.startsWith('/jolly') ||
        location.pathname.startsWith('/shared-results') ||
        location.pathname.startsWith('/shared-chains') ||
        (cognitoGroups.includes('sysadmin') &&
          (location.pathname === '/SSAdmin' ||
            location.pathname.startsWith('/chain-share-admin'))) ? (
          <Outlet />
        ) : (
          <Card
            className='w-full'
            style={{
              maxWidth: '960px',
              marginTop: '12px',
              marginBottom: '12px',
              height: 'fit-content',
            }}
          >
            <CardHeader>
              <CardTitle className='mb-0'>
                <h4 className='mb-0'>Welcome</h4>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p>You are not currently a member of any organisation.</p>
              <p className='mb-0'>
                Please visit the{' '}
                <a href='https://wildeyeconservation.org/surveyscope-registration/'>
                  Wildeye Conservation website
                </a>{' '}
                to register your organisation.
              </p>
              {/* <Card.Text>
                Please take note of the following:
                <ul>
                  <li>
                    If you are trying to join an organisation, please contact
                    your administrator to be invited to their organisation.
                    <br />
                    You will receive the invite in your notifications drawer.
                  </li>
                  <li>
                    If you have requested for an organisation to be created you
                    will automatically gain access to the rest of SurveyScope
                    once we've approved your request.
                    <br />
                    If your request is denied, you will receive an email from
                    us.
                  </li>
                </ul>
              </Card.Text> 
              <Card.Text>
                If your organisation is not registered, please register an
                organisation below.
              </Card.Text>
              <Button
                variant='primary'
                disabled={checkingToken}
                onClick={() => navigate('/SSRegisterOrganization')}
              >
                Register Organisation
              </Button>*/}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex-auto px-2 py-2 text-center no-underline transition-colors hover:text-white',
          isActive ? 'text-white' : 'text-white/75',
        )
      }
    >
      {children}
    </NavLink>
  );
}
