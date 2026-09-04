import ReactDOM from 'react-dom/client';
import AppWithAuthenticator from './App.tsx';
import './index.css';
import { QueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Progress } from './progress';
import AnnotationQueuePage from './AnnotationQueuePage';
import UserStats from './UserStats';
import WorkflowStatistics from './WorkflowStatistics';
import { LocationLoader } from './LocationLoader';
import { ImageLoader } from './ImageLoader';
import { Review } from './Review';
import RegisterOrganization from './RegisterOrganization';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import ErrorPage from './error-page';
import ProjectView from './ProjectView';
import Jobs from './user/Jobs.tsx';
import Surveys from './survey/Surveys.tsx';
import Permissions from './Permissions.tsx';
import Testing from './Testing/Testing';
import { IndividualIdPairTaskPage, IndividualIdTaskPage } from './individual-id';
import {
  ChainReviewTaskPage,
  ChainViewerPage,
  SharedChainViewerPage,
} from './chain-viewer';
import HomographyTask from './homography/HomographyTask';
import HomographyViewer from './homography/HomographyViewer';
import HomographyEditPage from './homography/HomographyEditPage';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import Admin from './Admin';
import JollyResults from './JollyResults';
import SharedResults from './SharedResults.tsx';
import SharedChains from './SharedChains.tsx';
import ChainShareAdminLayout from './chain-viewer/admin/ChainShareAdminLayout.tsx';
import ManageShares from './chain-viewer/admin/ManageShares.tsx';
import ChainShareResults from './chain-viewer/admin/ChainShareResults.tsx';
import DisagreementExplorer from './chain-viewer/admin/DisagreementExplorer.tsx';
import ImageNeighbourViewer from './ImageNeighbourViewer';
import QCReviewTask from './QCReviewTask';
import InfoTagTask from './InfoTagTask';
import { lazy, Suspense } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const devModules = (import.meta as any).glob('./DevActions.tsx') as Record<string, () => Promise<{ DevActions: React.FC }>>;
const DevActions = devModules['./DevActions.tsx']
  ? lazy(() =>
      devModules['./DevActions.tsx']().then((m) => ({ default: m.DevActions }))
    )
  : null;

const persister = createSyncStoragePersister({
  storage: window.localStorage,
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
    },
  },
});

// Define global for browser environment
window.global = window;

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Progress>
        {/* The provider restores the persisted cache before children mount, so
            queries do not start fetching ahead of hydration on reload. */}
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister }}
        >
          <ReactQueryDevtools initialIsOpen={false} />
          <AppWithAuthenticator />
        </PersistQueryClientProvider>
      </Progress>
    ),
    errorElement: <ErrorPage />,
    children: [
      {
        path: 'jobs',
        element: <Jobs />,
      },
      {
        path: 'jolly/:surveyId/:annotationSetId',
        element: <JollyResults />,
      },
      {
        path: 'shared-results',
        element: <SharedResults />,
      },
      {
        path: 'shared-chains',
        element: <SharedChains />,
      },
      {
        path: 'shared-chains/:shareId',
        element: <SharedChainViewerPage />,
      },
      {
        path: 'chain-share-admin',
        element: <ChainShareAdminLayout />,
        children: [
          { index: true, element: <Navigate to='shares' replace /> },
          { path: 'shares', element: <ManageShares /> },
          { path: 'results', element: <ChainShareResults /> },
          { path: 'disagreements', element: <DisagreementExplorer /> },
        ],
      },
      {
        path: 'image-neighbour-viewer',
        element: <ImageNeighbourViewer />,
      },
      {
        path: 'homography-viewer',
        element: <HomographyViewer />,
      },
      {
        path: 'surveys/:surveyId',
        element: <ProjectView />,
        children: [
          {
            path: 'annotate',
            element: <AnnotationQueuePage />,
          },
          {
            path: 'review',
            element: <Review />,
          },
          {
            // Transect/category are claimed on the Jobs page and passed via
            // navigation state (not the URL). Direct navigation bounces to
            // /jobs.
            path: 'individual-id',
            element: <IndividualIdTaskPage />,
          },
          {
            // Single-pair workspace driven entirely by query params
            // (image1Id, image2Id, categoryId, annotationSetId, optional
            // prevHref/nextHref). Bookmarkable / shareable.
            path: 'individual-id-pair',
            element: <IndividualIdPairTaskPage />,
          },
          {
            path: 'homography/:queueId',
            element: <HomographyTask />,
          },
          {
            // Standalone single-pair homography editor. Required query params
            // (image1Id, image2Id); optional annotationSetId, backHref.
            // Linked from the Individual-ID toolbar for ad-hoc fixes.
            path: 'homography-edit',
            element: <HomographyEditPage />,
          },
          {
            path: 'location/:locationId/:annotationSetId',
            element: <LocationLoader />,
          },
          {
            path: 'image/:imageId/:annotationSetId',
            element: <ImageLoader />,
          },
          {
            path: 'qc-review/:queueId',
            element: <QCReviewTask />,
          },
          {
            path: 'info-tags/:queueId',
            element: <InfoTagTask />,
          },
        ],
      },
      {
        path: 'surveys/:surveyId/set/:annotationSetId',
        element: <ProjectView />,
        children: [
          {
            path: 'review',
            element: <Review showAnnotationSetDropdown={false} />,
          },
          {
            path: 'chain-viewer',
            element: <ChainViewerPage />,
          },
          {
            path: 'chain-review/:primaryId',
            element: <ChainReviewTaskPage />,
          },
        ],
      },
      {
        path: 'surveys',
        element: <Surveys />,
      },
      {
        path: 'SSRegisterOrganization',
        element: <RegisterOrganization />,
      },
      {
        path: 'permissions',
        element: <Permissions />,
      },
      {
        path: 'annotation-statistics',
        element: <UserStats />,
      },
      {
        // The screen itself also checks the sysadmin group, so reaching this
        // path directly shows a notice rather than an empty report.
        path: 'workflow-statistics',
        element: <WorkflowStatistics />,
      },
      {
        path: 'SSAdmin',
        element: <Admin />,
      },
      {
        path: 'testing',
        element: <Testing />,
      },
      ...(DevActions
        ? [
            {
              path: 'dev-actions',
              element: (
                <Suspense fallback={null}>
                  <DevActions />
                </Suspense>
              ),
            },
          ]
        : []),
    ],
  },
]);

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<RouterProvider router={router} />);
} else {
  console.error('Root element not found');
}
