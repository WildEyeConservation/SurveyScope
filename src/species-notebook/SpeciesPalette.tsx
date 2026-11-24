import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { GlobalContext } from '../Context';
import { useCanExplore } from '../useCanExplore';
import {
  examplesQuery,
  otherLabelsQuery,
  surveyCategoriesQuery,
} from './data';
import { ExamplePager } from './ExamplePager';
import { openExample, useOrganizationId } from './hooks';
import { buildPaletteRows, type PaletteRow } from './paletteRows';
import { stopKeys } from './shortcut';
import { notebook, useNotebookState } from './store';
import type { LabelRef, NotebookExample } from './types';
import { viewerScale } from './viewerZoom';

function Row({
  row,
  active,
  onSelect,
}: {
  row: PaletteRow;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type='button'
      tabIndex={-1}
      onClick={onSelect}
      aria-selected={active}
      role='option'
      className={cn(
        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm',
        active
          ? 'bg-primary/20 shadow-[inset_3px_0_0_var(--color-primary)]'
          : 'hover:bg-white/10',
        !row.inSurvey && 'opacity-60',
      )}
    >
      <span
        className='size-2.5 flex-none rounded-full border border-white/60'
        style={{ backgroundColor: row.color ?? 'transparent' }}
      />
      <span className='min-w-0 truncate'>{row.name}</span>
    </button>
  );
}

type LastSearch = { query: string; activeName: string | null };
const lastSearchKey = (projectId: string) =>
  `species-notebook:last-search:${projectId}`;

function readLastSearch(projectId: string): LastSearch {
  try {
    const saved = JSON.parse(
      localStorage.getItem(lastSearchKey(projectId)) ?? 'null',
    );
    if (saved && typeof saved.query === 'string') {
      return {
        query: saved.query,
        activeName:
          typeof saved.activeName === 'string' ? saved.activeName : null,
      };
    }
  } catch {
    // Search persistence is best-effort.
  }
  return { query: '', activeName: null };
}

function saveLastSearch(projectId: string, search: LastSearch) {
  try {
    localStorage.setItem(lastSearchKey(projectId), JSON.stringify(search));
  } catch {
    // Search persistence is best-effort.
  }
}

export function SpeciesPalette({ projectId }: { projectId: string }) {
  const { client } = useContext(GlobalContext)!;
  const { paletteOpen, label: openedOn } = useNotebookState();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [current, setCurrent] = useState<NotebookExample | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (paletteOpen) {
      setScale(viewerScale());
      const last = readLastSearch(projectId);
      setQuery(openedOn ? '' : last.query);
      setActiveName(openedOn?.name ?? last.activeName);
      requestAnimationFrame(() => inputRef.current?.select());
      return;
    }
    setCurrent(null);
  }, [paletteOpen, openedOn, projectId]);
  useEffect(() => {
    if (paletteOpen) saveLastSearch(projectId, { query, activeName });
  }, [paletteOpen, projectId, query, activeName]);

  const categories = useQuery({
    ...surveyCategoriesQuery(client, projectId),
    enabled: paletteOpen,
  });
  const organizationId = useOrganizationId(paletteOpen ? projectId : undefined);
  const canExplore = useCanExplore();
  const showOpen = canExplore(projectId, organizationId);
  const others = useQuery({
    ...otherLabelsQuery(client, projectId),
    enabled: paletteOpen && query.trim().length > 0,
  });
  const otherNames = others.data;
  const { present, absent } = useMemo(
    () =>
      buildPaletteRows({
        surveyCategories: categories.data ?? [],
        otherNames,
        query,
      }),
    [categories.data, otherNames, query],
  );
  const rows = useMemo(() => [...present, ...absent], [present, absent]);
  const active = rows.find((row) => row.name === activeName) ?? rows[0];
  const activeLabel: LabelRef | null = active
    ? { projectId, name: active.name, color: active.color }
    : null;

  const activeIndex = active ? rows.indexOf(active) : -1;
  useEffect(() => {
    if (!paletteOpen || activeIndex < 0) return;
    for (const row of [rows[activeIndex + 1], rows[activeIndex - 1]]) {
      if (!row?.inSurvey || row.categoryIds.length === 0) continue;
      void queryClient.prefetchQuery(
        examplesQuery(client, projectId, row.name),
      );
    }
  }, [paletteOpen, rows, activeIndex, projectId, queryClient, client]);

  const move = (delta: number) => {
    if (rows.length === 0) return;
    const index = Math.max(0, rows.indexOf(active!));
    const next = rows[(index + delta + rows.length) % rows.length];
    setActiveName(next.name);
  };

  const onListKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
    event.preventDefault();
    move(event.key === 'ArrowDown' ? 1 : -1);
    return true;
  };

  const onViewerKey = (event: React.KeyboardEvent) => {
    // Dialogs opened from the viewer, such as relabelling, bubble here too.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (onListKey(event)) {
      viewerRef.current?.focus({ preventScroll: true });
    } else if (
      event.key.length === 1 &&
      !' +-='.includes(event.key) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      inputRef.current?.focus();
    }
  };

  return (
    <Dialog
      open={paletteOpen}
      onOpenChange={(open) => !open && notebook.closePalette()}
    >
      <DialogContent
        size='xl'
        className='max-h-[calc(100dvh-2rem)] overflow-hidden'
        onKeyDown={stopKeys}
        onKeyUp={stopKeys}
      >
        <DialogHeader closeButton>
          <DialogTitle>Species Notebook</DialogTitle>
        </DialogHeader>
        <div className='flex h-[min(72dvh,680px)] min-h-0 gap-4 p-4'>
          <div className='flex w-[220px] flex-none flex-col gap-2.5'>
            <div className='relative'>
              <Search className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#6c757d]' />
              <Input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveName(null);
                }}
                onKeyDown={(e) => {
                  if (onListKey(e)) return;
                  if (e.key === 'Enter' && activeLabel) {
                    e.preventDefault();
                    viewerRef.current?.focus();
                  }
                }}
                placeholder='Find a species…'
                aria-label='Find a species'
                className='pl-9'
              />
            </div>
            <div
              role='listbox'
              aria-label='Labels'
              onKeyDown={onListKey}
              className='min-h-0 flex-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.25)_transparent] overflow-y-auto bg-black/15 py-1'
            >
              {categories.isLoading && (
                <div className='px-3 py-2 text-sm text-muted-foreground'>
                  Loading labels…
                </div>
              )}
              {present.map((row) => (
                <Row
                  key={row.name}
                  row={row}
                  active={row === active}
                  onSelect={() => setActiveName(row.name)}
                />
              ))}
              {absent.length > 0 && (
                <div className='px-2.5 pt-2 pb-1 text-xs text-muted-foreground'>
                  Not in this survey
                </div>
              )}
              {absent.map((row) => (
                <Row
                  key={row.name}
                  row={row}
                  active={row === active}
                  onSelect={() => setActiveName(row.name)}
                />
              ))}
              {categories.isSuccess && rows.length === 0 && (
                <div className='px-3 py-2 text-sm text-muted-foreground'>
                  {others.isLoading && others.fetchStatus !== 'idle'
                    ? 'Searching…'
                    : 'No matching labels.'}
                </div>
              )}
            </div>
          </div>
          <div className='flex min-w-0 flex-1 flex-col'>
            {activeLabel ? (
              <ExamplePager
                label={activeLabel}
                scale={scale}
                onScale={setScale}
                viewerRef={viewerRef}
                onCurrent={setCurrent}
                onViewerKey={onViewerKey}
              />
            ) : (
              <div className='text-sm text-muted-foreground'>
                Type a species name.
              </div>
            )}
          </div>
        </div>
        <DialogFooter className='justify-start'>
          <Button variant='ghost' onClick={() => notebook.closePalette()}>
            Close
          </Button>
          {showOpen && (
            <Button
              className='ml-auto'
              disabled={!activeLabel || !current?.explore}
              title={
                current && !current.explore
                  ? 'Only admins of that survey can open it in Explore'
                  : undefined
              }
              onClick={() => current && openExample(current)}
            >
              Open in Explore
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
