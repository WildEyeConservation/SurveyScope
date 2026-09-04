import { createContext, useContext, useEffect } from 'react';
import { useCurrentMembership } from './memberships';
import { useCategories, useProject } from './project';
import {
  resetAnnotatorUi,
  setCurrentCategoryAction,
  useCurrentCategory,
} from '../stores/annotatorUiStore';

const ProjectIdContext = createContext<string | undefined>(undefined);

export function ProjectScope({
  projectId,
  children,
}: {
  projectId: string | undefined;
  children: React.ReactNode;
}) {
  const { data: currentPM } = useCurrentMembership(projectId);
  const { data: project } = useProject(projectId);
  const categoriesHook = useCategories(projectId);
  const currentCategory = useCurrentCategory();

  useEffect(() => {
    if (projectId) resetAnnotatorUi(projectId);
  }, [projectId]);

  // Preserve the annotator's default while keeping category data opt-in for
  // every other consumer below this lightweight project-id scope.
  useEffect(() => {
    if (!currentCategory) {
      setCurrentCategoryAction(categoriesHook.data[0]);
    }
  }, [categoriesHook.data, currentCategory]);

  if (!projectId || !currentPM || !project) return null;

  return (
    <ProjectIdContext.Provider value={projectId}>
      {children}
    </ProjectIdContext.Provider>
  );
}

export function useProjectId(): string {
  const projectId = useContext(ProjectIdContext);
  if (!projectId) {
    throw new Error('useProjectId must be used inside ProjectScope');
  }
  return projectId;
}

export function useCurrentProject() {
  const { data: project } = useProject(useProjectId());
  if (!project) {
    throw new Error('ProjectScope rendered without a loaded project');
  }
  return project;
}

export function useCurrentMembershipRow() {
  const { data: currentPM } = useCurrentMembership(useProjectId());
  if (!currentPM) {
    throw new Error('ProjectScope rendered without a loaded membership');
  }
  return currentPM;
}
