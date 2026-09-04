import { Store } from '@tanstack/store';
import { useSelector } from '@tanstack/react-store';
import type { Schema } from '../amplify/client-schema';

type AnnotatorUiState = {
  currentCategory: Schema['Category']['type'] | undefined;
  expandLegend: boolean;
};

export const annotatorUiStore = new Store<AnnotatorUiState>({
  currentCategory: undefined,
  expandLegend: true,
});

function setKey<K extends keyof AnnotatorUiState>(
  key: K,
  value: React.SetStateAction<AnnotatorUiState[K]>
) {
  annotatorUiStore.setState((prev) => ({
    ...prev,
    [key]:
      typeof value === 'function'
        ? (value as (p: AnnotatorUiState[K]) => AnnotatorUiState[K])(prev[key])
        : value,
  }));
}

export const setCurrentCategoryAction = (
  value: React.SetStateAction<AnnotatorUiState['currentCategory']>
) => setKey('currentCategory', value);

export const setExpandLegendAction = (
  value: React.SetStateAction<boolean>
) => setKey('expandLegend', value);

export function resetAnnotatorUi(projectId: string) {
  annotatorUiStore.setState(() => ({
    currentCategory: undefined,
    expandLegend:
      localStorage.getItem(`legendCollapsed-${projectId}`) !== 'true',
  }));
}

export function useCurrentCategory() {
  return useSelector(annotatorUiStore, (state) => state.currentCategory);
}

export function useExpandLegend() {
  return useSelector(annotatorUiStore, (state) => state.expandLegend);
}
