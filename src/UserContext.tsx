import { useState, useEffect, useContext, useCallback } from 'react';
import { SQSClient } from '@aws-sdk/client-sqs';
import { AuthUser, fetchAuthSession } from '@aws-amplify/auth';
import type { Schema } from './amplify/client-schema';
import {
  ProjectContext,
  ProjectContextType,
  UserContext,
  UserContextType,
  ManagementContext,
  ManagementContextType,
  ProgressContext,
  ProgressType,
} from './Context.tsx';
import { appRegion as region } from './stores/appClient';
import {
  useIsOrganizationAdmin,
  useMyMemberships,
  useMyOrganizations,
} from './data/memberships';
import { useCategories, useProject } from './data/project';
import {
  useAnnotationSets,
  useImageSets,
  useLocationSets,
  useProjectMemberships,
  useQueues,
} from './data/projectSets';
import { useAllUsers } from './data/users';
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

export function Project({
  children,
  currentPM,
}: {
  children: React.ReactNode;
  currentPM: Schema['UserProjectMembership']['type'];
}) {
  const [expandLegend, setExpandLegend] = useState<boolean>(
    () =>
      localStorage.getItem(`legendCollapsed-${currentPM.projectId}`) !== 'true'
  );
  const categoriesHook = useCategories(currentPM.projectId);
  const [currentCategory, setCurrentCategory] = useState<
    Schema['Category']['type'] | undefined
  >(categoriesHook.data?.[0]);
  const { data: currentProject } = useProject(currentPM.projectId);

  useEffect(() => {
    setExpandLegend(
      localStorage.getItem(`legendCollapsed-${currentPM.projectId}`) !== 'true'
    );
  }, [currentPM.projectId]);

  useEffect(() => {
    if (!currentCategory) {
      setCurrentCategory(categoriesHook.data?.[0]);
    }
  }, [categoriesHook.data]);

  return (
    currentProject && (
      <ProjectContext.Provider
        value={{
          project: currentProject,
          categoriesHook: categoriesHook as unknown as ProjectContextType['categoriesHook'],
          currentPM,
          currentCategory,
          setCurrentCategory,
          expandLegend,
          setExpandLegend,
        }}
      >
        {currentProject && children}
      </ProjectContext.Provider>
    )
  );
}

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

export function Management({ children }: { children: React.ReactNode }) {
  const { project } = useContext(ProjectContext)!;
  const { users: allUsers } = useAllUsers();
  const projectMembershipHook = useProjectMemberships(project.id);
  const imageSetsHook = useImageSets(project.id);
  const locationSetsHook = useLocationSets(project.id);
  const annotationSetsHook = useAnnotationSets(project.id);
  const queuesHook = useQueues(project.id);

  return (
    <ManagementContext.Provider
      value={{
        allUsers,
        projectMembershipHook: projectMembershipHook as unknown as ManagementContextType['projectMembershipHook'],
        imageSetsHook: imageSetsHook as unknown as ManagementContextType['imageSetsHook'],
        locationSetsHook: locationSetsHook as unknown as ManagementContextType['locationSetsHook'],
        annotationSetsHook: annotationSetsHook as unknown as ManagementContextType['annotationSetsHook'],
        queuesHook: queuesHook as unknown as ManagementContextType['queuesHook'],
      }}
    >
      {children}
    </ManagementContext.Provider>
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
