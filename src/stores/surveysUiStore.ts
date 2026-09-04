import { Store } from '@tanstack/store';
import { useSelector } from '@tanstack/react-store';

export type SurveysSortBy =
  | 'createdAt'
  | 'createdAt-reverse'
  | 'name'
  | 'name-reverse'
  | 'activeJobs';

type SurveysUiState = {
  search: string;
  sortBy: string;
  organizationFilter: string;
  compactMode: boolean;
};

const KEYS = {
  SEARCH: 'surveysSearch',
  SORT_BY: 'surveysSortBy',
  COMPACT_MODE: 'surveysCompactMode',
  ORGANIZATION_FILTER: 'surveysOrganizationFilter',
} as const;

function readInitial(): SurveysUiState {
  if (typeof window === 'undefined') {
    return { search: '', sortBy: 'createdAt', organizationFilter: '', compactMode: false };
  }
  const search = localStorage.getItem(KEYS.SEARCH) ?? '';
  const sortBy = localStorage.getItem(KEYS.SORT_BY) || 'createdAt';
  const organizationFilter = localStorage.getItem(KEYS.ORGANIZATION_FILTER) ?? '';
  const compactMode = localStorage.getItem(KEYS.COMPACT_MODE) === 'true';
  return { search, sortBy, organizationFilter, compactMode };
}

export const surveysUiStore = new Store<SurveysUiState>(readInitial());

// Persist slices back to localStorage. Versioned key namespace lives in KEYS
// above so a future schema change can bump keys instead of shipping stale UI.
if (typeof window !== 'undefined') {
  let prev = surveysUiStore.state;
  surveysUiStore.subscribe((state) => {
    if (state.search !== prev.search) {
      localStorage.setItem(KEYS.SEARCH, state.search);
    }
    if (state.sortBy !== prev.sortBy) {
      localStorage.setItem(KEYS.SORT_BY, state.sortBy);
    }
    if (state.organizationFilter !== prev.organizationFilter) {
      localStorage.setItem(KEYS.ORGANIZATION_FILTER, state.organizationFilter);
    }
    if (state.compactMode !== prev.compactMode) {
      localStorage.setItem(KEYS.COMPACT_MODE, String(state.compactMode));
    }
    prev = state;
  });
}

function setPatch(patch: Partial<SurveysUiState>) {
  surveysUiStore.setState((prev) => ({ ...prev, ...patch }));
}

function setFromAction<T>(key: keyof SurveysUiState) {
  return (value: React.SetStateAction<T>) => {
    surveysUiStore.setState((prev) => ({
      ...prev,
      [key]:
        typeof value === 'function'
          ? (value as (p: T) => T)(prev[key] as T)
          : value,
    }));
  };
}

export const setSurveysSearch = (v: React.SetStateAction<string>) =>
  setFromAction<string>('search')(v);
export const setSurveysSortBy = (v: React.SetStateAction<string>) =>
  setFromAction<string>('sortBy')(v);
export const setSurveysOrganizationFilter = (
  v: React.SetStateAction<string>
) => setFromAction<string>('organizationFilter')(v);
export const setSurveysCompactMode = (v: React.SetStateAction<boolean>) =>
  setFromAction<boolean>('compactMode')(v);

export function useSurveysSearch() {
  return useSelector(surveysUiStore, (s) => s.search);
}
export function useSurveysSortBy() {
  return useSelector(surveysUiStore, (s) => s.sortBy);
}
export function useSurveysOrganizationFilter() {
  return useSelector(surveysUiStore, (s) => s.organizationFilter);
}
export function useSurveysCompactMode() {
  return useSelector(surveysUiStore, (s) => s.compactMode);
}

// One-shot read for non-React callers (loaders, event handlers).
export function getSurveysUiState(): SurveysUiState {
  return surveysUiStore.state;
}

export function setSurveysUiPatch(patch: Partial<SurveysUiState>) {
  setPatch(patch);
}
