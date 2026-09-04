import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { SQSClient } from '@aws-sdk/client-sqs';
import { AuthUser, fetchAuthSession } from '@aws-amplify/auth';
import type { Schema } from './amplify/client-schema';
import { useUsers } from './apiInterface.tsx';
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
import { appRegion as region, client } from './stores/appClient';
import { useOptimisticUpdates, useQueues } from './useOptimisticUpdates.tsx';
import { useQuery } from '@tanstack/react-query';
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
  const { myMembershipHook } = useContext(UserContext)!;
  const subscriptionFilter = useMemo(
    () => ({
      filter: { projectId: { eq: currentPM?.projectId } },
    }),
    [currentPM?.projectId]
  );
  //const [currentProject, setCurrentProject] = useState<Schema['Project']['type'] | undefined>(undefined)
  const categoriesHook = useOptimisticUpdates<
    Schema['Category']['type'],
    'Category'
  >(
    'Category',
    async (nextToken) =>
      client.models.Category.list({
        filter: { projectId: { eq: currentPM?.projectId } },
        nextToken,
        limit: 10000,
      }),
    subscriptionFilter
  );
  const [currentCategory, setCurrentCategory] = useState<
    Schema['Category']['type'] | undefined
  >(categoriesHook.data?.[0]);
  // useEffect(() => {
  // if (currentPM) {
  //   client.models.Project.get({ id: currentPM.projectId }).then(p =>
  //     setCurrentProject(p['data']!));
  // } else {
  //   setCurrentProject(undefined);
  // }
  // }, [currentPM])

  const projectQuery = useQuery({
    queryKey: ['project', currentPM?.projectId],
    queryFn: () => client.models.Project.get({ id: currentPM?.projectId }),
  });

  const currentProject = projectQuery.data?.data;

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
          currentPM: myMembershipHook.data.find(
            (m) => m.projectId == currentProject.id
          )!,
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
  //const { items: myMemberships } = useObserveQuery('UserProjectMembership', { filter: { userId: { eq: user!.username } } });
  // const { data: myMemberships } = useOptimisticUpdates(
  //   'UserProjectMembership',
  //   async () => client.models.UserProjectMembership.list({ filter: { userId: { eq: user!.username } } }),
  //   { filter: { userId: { eq: user!.username } } })
  const subscriptionFilter = useMemo(
    () => ({
      filter: { userId: { eq: user.username } },
    }),
    [user.username]
  );

  // const myMembershipHook = useOptimisticMembership(
  //   async (nextToken) => client.models.UserProjectMembership.list({ filter: { userId: { eq: user!.username } },nextToken}),
  //   subscriptionFilter)

  const myMembershipHook = useOptimisticUpdates<
    Schema['UserProjectMembership']['type'],
    'UserProjectMembership'
  >(
    'UserProjectMembership',
    async (nextToken) =>
      client.models.UserProjectMembership.list({
        filter: { userId: { eq: user!.username } },
        nextToken,
      }),
    subscriptionFilter,
    {
      compositeKey: (m) =>
        m.userId && m.projectId ? `${m.userId}:${m.projectId}` : m.id,
    }
  );

  const allOrganizationHook = useOptimisticUpdates<
    Schema['OrganizationMembership']['type'],
    'OrganizationMembership'
  >(
    'OrganizationMembership',
    async (nextToken) =>
      client.models.OrganizationMembership.list({
        filter: { userId: { eq: user!.username } },
        nextToken,
      }),
    subscriptionFilter,
    {
      compositeKey: (membership) =>
        `${membership.organizationId}:${membership.userId}`,
    }
  );

  // Filter memberships to only include organisations the user has active cognito groups for
  const activeCognitoOrgIds = useMemo(
    () => new Set(cognitoGroups.filter((g) => g !== 'sysadmin' && g !== 'orgadmin')),
    [cognitoGroups]
  );

  const isSysadmin = cognitoGroups.includes('sysadmin');

  const myOrganizationHook = useMemo(
    () => ({
      ...allOrganizationHook,
      // Sysadmin users can access all organisations regardless of active cognito groups
      data: isSysadmin
        ? allOrganizationHook.data ?? []
        : allOrganizationHook.data?.filter((m) => activeCognitoOrgIds.has(m.organizationId)) ?? [],
    }),
    [allOrganizationHook, activeCognitoOrgIds, isSysadmin]
  );

  const isOrganizationAdmin = myOrganizationHook.data?.some(
    (membership) => membership.isAdmin
  );

  // useEffect(() => {
  //   const sub = client.models.UserProjectMembership.observeQuery({ filter: { userId: { eq: user!.username } } }).subscribe({
  //     next: async ({ items }) => {
  //       setMyMemberships(items);
  //     },
  //   });
  //   return () => sub.unsubscribe();
  // }, [user.username]);
  //const [credentials, setCredentials] = useState<any>(undefined);
  // useEffect(() => {
  //   const setup = async () => {

  //     const credentials = Auth.essentialCredentials(await Auth.currentCredentials())
  //     setCredentials(credentials);
  //     setLambdaClient(new LambdaClient({ region, credentials }));
  //     setS3Client(new S3Client({ region, credentials }));
  //     setCognitoClient(new CognitoIdentityProviderClient({region:cognitoRegion, credentials}))
  //     setSqsClient(new SQSClient({region, credentials}))
  //   }
  //   setup()
  // },[user])

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
  const { users: allUsers } = useUsers();
  // const subscriptionFilter = useMemo(() => (
  //   { projectId: { eq: project.id } }), [project.id]);
  const subscriptionFilter = useMemo(
    () => ({ filter: { projectId: { eq: project.id } } }),
    [project.id]
  );
  //const {items: projectMemberships} = useObserveQuery('UserProjectMembership',{ filter: { projectId: { eq: project.id } } });
  // const projectMembershipHook = useOptimisticMembership(
  //   async (nextToken) => client.models.UserProjectMembership.list({ filter: subscriptionFilter,nextToken }),
  //   subscriptionFilter)
  const projectMembershipHook = useOptimisticUpdates<
    Schema['UserProjectMembership']['type'],
    'UserProjectMembership'
  >(
    'UserProjectMembership',
    async (nextToken) =>
      client.models.UserProjectMembership.list({
        filter: subscriptionFilter.filter,
        nextToken,
      }),
    subscriptionFilter
  );
  const imageSetsHook = useOptimisticUpdates<
    Schema['ImageSet']['type'],
    'ImageSet'
  >(
    'ImageSet',
    async (nextToken) =>
      client.models.ImageSet.list({
        filter: subscriptionFilter.filter,
        nextToken,
      }),
    subscriptionFilter
  );
  const locationSetsHook = useOptimisticUpdates<
    Schema['LocationSet']['type'],
    'LocationSet'
  >(
    'LocationSet',
    async (nextToken) =>
      client.models.LocationSet.list({
        filter: subscriptionFilter.filter,
        nextToken,
      }),
    subscriptionFilter
  );
  const annotationSetsHook = useOptimisticUpdates<
    Schema['AnnotationSet']['type'],
    'AnnotationSet'
  >(
    'AnnotationSet',
    async (nextToken) =>
      client.models.AnnotationSet.list({
        filter: subscriptionFilter.filter,
        nextToken,
      }),
    subscriptionFilter
  );
  const queuesHook = useQueues();

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
      {allUsers &&
        projectMembershipHook &&
        imageSetsHook &&
        locationSetsHook &&
        annotationSetsHook &&
        queuesHook &&
        children}
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
