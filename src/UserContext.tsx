import { useState, useCallback } from 'react';
import { SQSClient } from '@aws-sdk/client-sqs';
import { AuthUser, fetchAuthSession } from '@aws-amplify/auth';
import {
  UserContext,
  UserContextType,
  ProgressContext,
  ProgressType,
} from './Context.tsx';
import { appRegion as region } from './stores/appClient';
import {
  useIsOrganizationAdmin,
  useMyMemberships,
  useMyOrganizations,
} from './data/memberships';
import {
  setCurrentAnnoCountAction,
  setCurrentTaskTagAction,
  setIsAnnotatePathAction,
  setJobsCompletedAction,
  setSessionTestsResultsAction,
  setUnannotatedJobsAction,
  useCurrentAnnoCount,
  useCurrentTaskTag,
  useIsAnnotatePath,
  useJobsCompleted,
  useSessionTestsResults,
  useUnannotatedJobs,
} from './stores/taskStore';

export function User({
  user,
  cognitoGroups,
  children,
}: {
  user: AuthUser;
  cognitoGroups: string[];
  children: React.ReactNode;
}) {
  // Ephemeral task/UI state now lives in taskStore (TanStack Store) so updates
  // subscribe selectively. These reads keep old UserContext consumers working;
  // new code should use the taskStore hooks directly and skip this provider.
  const jobsCompleted = useJobsCompleted();
  const unannotatedJobs = useUnannotatedJobs();
  const currentTaskTag = useCurrentTaskTag();
  const currentAnnoCount = useCurrentAnnoCount();
  const isAnnotatePath = useIsAnnotatePath();
  const sessionTestsResults = useSessionTestsResults();
  const setJobsCompleted = setJobsCompletedAction;
  const setUnannotatedJobs = setUnannotatedJobsAction;
  const setCurrentTaskTag = setCurrentTaskTagAction;
  const setCurrentAnnoCount = setCurrentAnnoCountAction;
  const setIsAnnotatePath = setIsAnnotatePathAction;
  const setSessionTestsResults = setSessionTestsResultsAction;
  const myMembershipHook = useMyMemberships();
  const myOrganizationHook = useMyOrganizations();
  const isOrganizationAdmin = useIsOrganizationAdmin();

  const getSqsClient = useCallback(async () => {
    const { credentials } = await fetchAuthSession();
    return new SQSClient({ region, credentials });
  }, []);

  return (
    <UserContext.Provider
      value={{
        user,
        cognitoGroups,
        getSqsClient,
        jobsCompleted,
        setJobsCompleted,
        unannotatedJobs,
        setUnannotatedJobs,
        currentTaskTag,
        setCurrentTaskTag,
        currentAnnoCount,
        setCurrentAnnoCount,
        myMembershipHook: myMembershipHook as unknown as UserContextType['myMembershipHook'],
        myOrganizationHook: myOrganizationHook as unknown as UserContextType['myOrganizationHook'],
        isOrganizationAdmin,
        isAnnotatePath,
        setIsAnnotatePath,
        sessionTestsResults,
        setSessionTestsResults,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function Progress({ children }: { children: React.ReactNode }) {
  const [progress, setProgress] = useState<ProgressType>({});
  return (
    <ProgressContext.Provider
      value={{
        progress,
        setProgress,
      }}
    >
      {children}
    </ProgressContext.Provider>
  );
}

// export function Organization({ children }: { children: React.ReactNode }) {
//   const subscriptionFilter = useMemo(
//     () => ({ filter: { organizationId: { eq: project.organizationId } } }),
//     [project.organizationId]
//   );
//   const membershipHook = useOptimisticUpdates<
//     Schema['OrganizationMembership']['type'],
//     'OrganizationMembership'
//   >(
//     'OrganizationMembership',
//     async (nextToken) =>
//       client.models.OrganizationMembership.membershipsByOrganizationId({
//         organizationId: project.organizationId,
//         nextToken,
//       }),
//     subscriptionFilter
//   );

//   return (
//     <OrganizationContext.Provider
//       value={{
//         membershipHook,
//       }}
//     >
//       {children}
//     </OrganizationContext.Provider>
//   );
// }
