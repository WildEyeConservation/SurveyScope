import { Store } from '@tanstack/store';
import { useSelector } from '@tanstack/react-store';

export type AnnoPoints = { [key: string]: { x: number; y: number }[] };

export type SessionTestResult = {
  id: string;
  locationId: string;
  annotationSetId: string;
};

type TaskState = {
  jobsCompleted: number;
  unannotatedJobs: number;
  currentTaskTag: string;
  currentAnnoCount: AnnoPoints;
  sessionTestsResults: SessionTestResult[];
  isAnnotatePath: boolean;
};

export const taskStore = new Store<TaskState>({
  jobsCompleted: 0,
  unannotatedJobs: 0,
  currentTaskTag: '',
  currentAnnoCount: {},
  sessionTestsResults: [],
  isAnnotatePath: false,
});

function setKey<K extends keyof TaskState>(
  key: K,
  value: React.SetStateAction<TaskState[K]>
) {
  taskStore.setState((prev) => ({
    ...prev,
    [key]:
      typeof value === 'function'
        ? (value as (p: TaskState[K]) => TaskState[K])(prev[key])
        : value,
  }));
}

export const setJobsCompletedAction = (
  v: React.SetStateAction<number>
) => setKey('jobsCompleted', v);
export const setUnannotatedJobsAction = (
  v: React.SetStateAction<number>
) => setKey('unannotatedJobs', v);
export const setCurrentTaskTagAction = (
  v: React.SetStateAction<string>
) => setKey('currentTaskTag', v);
export const setCurrentAnnoCountAction = (
  v: React.SetStateAction<AnnoPoints>
) => setKey('currentAnnoCount', v);
export const setSessionTestsResultsAction = (
  v: React.SetStateAction<SessionTestResult[]>
) => setKey('sessionTestsResults', v);
export const setIsAnnotatePathAction = (
  v: React.SetStateAction<boolean>
) => setKey('isAnnotatePath', v);

// Selective hooks: components subscribe to one slice only, so a per-annotation
// currentAnnoCount update does not re-render navigation or the surveys list.
export function useJobsCompleted() {
  return useSelector(taskStore, (s) => s.jobsCompleted);
}
export function useUnannotatedJobs() {
  return useSelector(taskStore, (s) => s.unannotatedJobs);
}
export function useCurrentTaskTag() {
  return useSelector(taskStore, (s) => s.currentTaskTag);
}
export function useCurrentAnnoCount() {
  return useSelector(taskStore, (s) => s.currentAnnoCount);
}
export function useSessionTestsResults() {
  return useSelector(taskStore, (s) => s.sessionTestsResults);
}
export function useIsAnnotatePath() {
  return useSelector(taskStore, (s) => s.isAnnotatePath);
}

export function getTaskState(): TaskState {
  return taskStore.state;
}
