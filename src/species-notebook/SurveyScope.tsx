import { useQuery } from '@tanstack/react-query';
import { useContext, useMemo, useState, type ReactNode } from 'react';
import {
  GlobalContext,
  ManagementContext,
  ProjectContext,
  UserContext,
  type ManagementContextType,
  type ProjectContextType,
  type UserContextType,
} from '../Context';
import type { CategoryType } from '../schemaTypes';
import { surveyCategoriesQuery } from './data';

const noop = () => {};

export type ViewerContexts = {
  userValue: UserContextType;
  management: ManagementContextType;
};

export function SurveyScope({
  projectId,
  contexts,
  children,
}: {
  projectId: string;
  contexts: ViewerContexts;
  children: ReactNode;
}) {
  const { client } = useContext(GlobalContext)!;
  const { userValue, management } = contexts;
  // Same key and fetch as the survey provider, so this is usually cached.
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => client.models.Project.get({ id: projectId }),
  });
  const categories = useQuery(surveyCategoriesQuery(projectId));
  const [currentCategory, setCurrentCategory] = useState<CategoryType>();
  const survey = project.data?.data;
  const value = useMemo<ProjectContextType | null>(() => {
    if (!survey || !categories.data) return null;
    const currentPM = userValue.myMembershipHook.data.find(
      (m) => m.projectId === survey.id,
    );
    return {
      project: survey,
      currentPM: currentPM ?? ({} as ProjectContextType['currentPM']),
      categoriesHook: {
        data: categories.data as unknown as CategoryType[],
        create: () => '',
        update: noop,
        delete: noop,
      },
      currentCategory,
      setCurrentCategory,
      expandLegend: false,
      setExpandLegend: noop,
    };
  }, [survey, categories.data, currentCategory, userValue]);
  if (!value) return null;
  return (
    <UserContext.Provider value={userValue}>
      <ProjectContext.Provider value={value}>
        <ManagementContext.Provider value={management}>
          {children}
        </ManagementContext.Provider>
      </ProjectContext.Provider>
    </UserContext.Provider>
  );
}
