export function graphqlOperation(query: string, variables: any) {
  return { query, variables };
}

import { useQueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useRef, useState } from 'react';

import './App.css';

import { configure } from 'react-hotkeys';
// import { withAuthenticator } from "@aws-amplify/ui-react";
import { Button as PrimaryButton } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Button as AmplifyButton,
  Authenticator,
  Heading,
  Link,
  Text,
  useAuthenticator,
  View,
} from '@aws-amplify/ui-react';
import { AuthUser, fetchAuthSession } from 'aws-amplify/auth';
import { BrowserView, MobileView } from 'react-device-detect';
import MainNavigation from './MainNavigation.tsx';
import { User } from './UserContext.js';
//import { ErrorHandler } from './ErrorHandler';
//import {TaskProgressHandler} from './TaskProgressHandler';
import ClientLogger from './ClientLogger.tsx';
import { loadCognitoGroups, useCognitoGroups } from './cognitoGroups';
import { GlobalContext } from './Context';
import UploadManager from './upload/UploadManager.tsx';

configure({ ignoreRepeatedEventsWhenKeyHeldDown: false });

/**
 *
 * The root component for the ESS frontend map. Renders the Navbar and the router that selects which of the other pages
 * to render based on th current URL.
 * @component
 *
 */
interface AppProps {
  signOut?: () => void;
  user?: AuthUser;
}

function App({ signOut = () => {}, user }: AppProps) {
  const [session, setSession] = useState<any>();
  const cognitoGroups = useCognitoGroups();
  const queryClient = useQueryClient();
  const { client } = useContext(GlobalContext);
  const previousGroups = useRef(cognitoGroups);
  const [continueOnMobile, setContinueOnMobile] = useState(false);
  // const [userAttributes, setUserAttributes] = useState<any>(null);

  // useEffect(() => {
  //   // fetchUserAttributes().then((attributes) => setUserAttributes(attributes));
  // }, [user]);

  // let handleSelect = async function (key: string | null) {
  //   if (key == "addFiles") {
  //     setDirHandle(await (window as any).showDirectoryPicker());
  //   }
  //   setModalToShow(key);
  // };

  useEffect(() => {
    window.addEventListener('beforeunload', alertUser);
    return () => {
      window.removeEventListener('beforeunload', alertUser);
    };
  }, []);
  const alertUser = (e: BeforeUnloadEvent) => {
    alert(
      'If you use refresh to load new data it may result in some of your work being lost.',
    );
    e.preventDefault();
    e.returnValue = '';
  };

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      fetchAuthSession({ forceRefresh: true }).catch((err) => {
        console.error('Token refresh on tab focus failed', err);
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    const refreshWithRetry = async (attempt = 0): Promise<void> => {
      try {
        await fetchAuthSession({ forceRefresh: true });
      } catch (err) {
        if (attempt < 3) {
          const backoffMs = 2000 * 2 ** attempt;
          await new Promise((r) => setTimeout(r, backoffMs));
          return refreshWithRetry(attempt + 1);
        }
        console.error('Periodic token refresh failed after retries', err);
      }
    };
    const intervalMs = 45 * 60 * 1000;
    const id = setInterval(refreshWithRetry, intervalMs);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    loadCognitoGroups().then(setSession);
    client.mutations
      .syncOrganizationGroups()
      .then(({ data }) => (data ? loadCognitoGroups(true) : undefined))
      .catch((err) => console.error('Failed to sync organisation groups', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Cached lists were fetched under the old groups, so refetch them.
  useEffect(() => {
    if (previousGroups.current === cognitoGroups) return;
    previousGroups.current = cognitoGroups;
    if (session) queryClient.invalidateQueries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cognitoGroups]);

  return session ? (
    continueOnMobile ? (
      <User user={user! as any} cognitoGroups={cognitoGroups}>
        {user?.userId && <ClientLogger userId={user.userId} />}
        <UploadManager />
        <MainNavigation signOut={signOut} />
      </User>
    ) : (
      <>
        <BrowserView>
          <User user={user! as any} cognitoGroups={cognitoGroups}>
            {user?.userId && <ClientLogger userId={user.userId} />}
            <UploadManager />
            <MainNavigation signOut={signOut} />
          </User>
        </BrowserView>
        <MobileView>
          <Logo />
          <div
            className='flex flex-col items-center justify-center p-4 text-center'
            style={{
              height: 'calc(100vh - 64px)',
            }}
          >
            <h1>This application is primarly designed for desktop use.</h1>
            <p>Are you sure you want to continue?</p>
            <PrimaryButton onClick={() => setContinueOnMobile(true)}>
              Continue
            </PrimaryButton>
          </div>
        </MobileView>
      </>
    )
  ) : null;
}

export default function AppWithAuthenticator() {
  const components = {
    Header() {
      return <Logo />;
    },
    SignIn: {
      Footer() {
        const { toForgotPassword } = useAuthenticator();

        return (
          <View textAlign='center'>
            <AmplifyButton
              fontWeight='bold'
              onClick={toForgotPassword}
              size='small'
              variation='link'
            >
              Reset Password
            </AmplifyButton>
            <Heading level={6} marginTop='medium'>
              Want to get started?
            </Heading>
            <Text marginTop='small'>
              To join an existing organisation, please have your administrator
              reach out to us.
            </Text>
            <Text marginTop='small'>
              If you would like to register a brand new organisation, please do
              so through our{' '}
              <Link
                href='https://wildeyeconservation.org/surveyscope-registration/'
                isExternal
              >
                website
              </Link>
            </Text>
          </View>
        );
      },
    },
  };

  useEffect(() => {
    //read query param "t"
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('t');

    if (token) {
      //save token to local storage
      localStorage.setItem('jwt', token);
    }
  }, []);

  return (
    <TooltipProvider>
      <Authenticator components={components} variation='modal' hideSignUp>
        {({ signOut, user }) => <App signOut={signOut} user={user} />}
      </Authenticator>
      <Toaster />
    </TooltipProvider>
  );
}

function Logo() {
  return (
    <div className='flex w-full flex-col items-center justify-center bg-secondary p-4'>
      <div className='flex flex-row flex-nowrap items-center'>
        <img
          src='/Logo.png'
          alt='Logo'
          style={{ height: '32px', marginRight: '4px' }}
        />
        <h1 style={{ marginBottom: '0px', fontSize: '24px' }}>SurveyScope</h1>
      </div>
    </div>
  );
}
