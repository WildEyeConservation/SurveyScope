import './index.css';

import './maplibreWorker';

import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from 'react-router-dom';
import Admin from './Admin';
import AnnotationQueuePage from './AnnotationQueuePage';
import AppWithAuthenticator from './App.tsx';
import {
  ChainReviewTaskPage,
  ChainViewerPage,
  SharedChainViewerPage,
} from './chain-viewer';
import ChainShareAdminLayout from './chain-viewer/admin/ChainShareAdminLayout.tsx';
import ChainShareResults from './chain-viewer/admin/ChainShareResults.tsx';
import DisagreementExplorer from './chain-viewer/admin/DisagreementExplorer.tsx';
import ManageShares from './chain-viewer/admin/ManageShares.tsx';
import { GlobalContextProvider } from './Context';
import ErrorPage from './error-page';
import HomographyEditPage from './homography/HomographyEditPage';
import HomographyTask from './homography/HomographyTask';
import HomographyViewer from './homography/HomographyViewer';
import { ImageLoader } from './ImageLoader';
import ImageNeighbourViewer from './ImageNeighbourViewer';
import {
  IndividualIdPairTaskPage,
  IndividualIdTaskPage,
} from './individual-id';
import InfoTagTask from './InfoTagTask';
import JollyResults from './JollyResults';
import { LocationLoader } from './LocationLoader';
import Permissions from './Permissions.tsx';
import ProjectView from './ProjectView';
import QCReviewTask from './QCReviewTask';
import RegisterOrganization from './RegisterOrganization';
import { Review } from './Review';
import SharedChains from './SharedChains.tsx';
import SharedResults from './SharedResults.tsx';
import Surveys from './survey/Surveys.tsx';
import Testing from './Testing/Testing';
import Jobs from './user/Jobs.tsx';
import { Progress } from './UserContext';
import UserStats from './UserStats';
import WorkflowStatistics from './WorkflowStatistics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const devModules = (import.meta as any).glob('./DevActions.tsx') as Record<
  string,
  () => Promise<{ DevActions: React.FC }>
>;
const DevActions = devModules['./DevActions.tsx']
  ? lazy(() =>
      devModules['./DevActions.tsx']().then((m) => ({ default: m.DevActions })),
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

persistQueryClient({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryClient: queryClient as any,
  persister,
});

// Define global for browser environment
window.global = window;

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <GlobalContextProvider>
        <Progress>
          <QueryClientProvider client={queryClient}>
            <ReactQueryDevtools initialIsOpen={false} />
            <AppWithAuthenticator />
          </QueryClientProvider>
        </Progress>
      </GlobalContextProvider>
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
