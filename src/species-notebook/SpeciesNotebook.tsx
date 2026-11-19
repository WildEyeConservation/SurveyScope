import { useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { UserContext } from '../Context';
import { SpeciesPalette } from './SpeciesPalette';
import { isSpeciesSearchShortcut, speciesShortcutLabel } from './shortcut';
import { notebook, useNotebookState } from './store';

const SHORTCUT = speciesShortcutLabel(
  typeof navigator === 'undefined'
    ? ''
    : navigator.platform || navigator.userAgent,
);

function useSurveyIdFromRoute() {
  const { pathname } = useLocation();
  return matchPath({ path: '/surveys/:surveyId/*' }, pathname)?.params.surveyId;
}

// Survives remounts, so a different sign-in on the same tab is noticed.
let cachedFor: string | undefined;

export default function SpeciesNotebook() {
  const userId = useContext(UserContext)?.user?.userId;
  const queryClient = useQueryClient();
  const [readyFor, setReadyFor] = useState<string | undefined>();
  const surveyId = useSurveyIdFromRoute();
  const { label } = useNotebookState();
  const projectId = label?.projectId ?? surveyId;

  useEffect(() => {
    if (cachedFor !== userId) {
      queryClient.removeQueries({ queryKey: ['species-notebook'] });
      notebook.closePalette();
      cachedFor = userId;
    }
    setReadyFor(userId);
  }, [userId, queryClient]);

  useEffect(() => {
    if (!surveyId) {
      notebook.closePalette();
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSpeciesSearchShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) notebook.togglePalette();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [surveyId]);

  if (!userId || readyFor !== userId) return null;
  if (!surveyId)
    return projectId ? <SpeciesPalette projectId={projectId} /> : null;
  return (
    <>
      <button
        type='button'
        onClick={() => notebook.openPalette()}
        title={`Species Notebook (${SHORTCUT})`}
        className='me-3 flex items-center gap-1.5 px-2 py-1 text-sm whitespace-nowrap text-white/75 hover:text-white'
      >
        <Search className='size-4' />
        Species Notebook
        <kbd className='border border-white/30 px-1 font-sans text-[11px] leading-4'>
          {SHORTCUT}
        </kbd>
      </button>
      <SpeciesPalette projectId={label?.projectId ?? surveyId} />
    </>
  );
}
