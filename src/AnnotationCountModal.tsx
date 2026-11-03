import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Body, Footer, Header, Modal, Title } from './Modal';

import { GlobalContext } from './Context';
import { loadRows } from './rowChunks';
import { fetchAllPaginatedResults } from './utils';

interface AnnotationRow {
  id: string;
  objectId: string | null;
  source: string | null;
  categoryId: string | null;
}

interface CountRow {
  name: string;
  color: string | null;
  count: number;
  fn: number;
}

interface Props {
  show: boolean;
  handleClose: () => void;
  setId: string;
  projectId: string;
}

const AnnotationCountModal: React.FC<Props> = ({
  show,
  handleClose,
  setId,
  projectId,
}) => {
  const { client } = useContext(GlobalContext)!;
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([]);
  const [categories, setCategories] = useState<
    Map<string, { name: string; color: string | null }>
  >(new Map());
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    if (!setId || !show) return;
    const controller = new AbortController();
    const { signal } = controller;
    setLoading(true);
    setLoaded(0);
    // Categories load by survey: a set can use another set's category.
    Promise.all([
      loadRows(
        client,
        'annotationsByAnnotationSetId',
        setId,
        ['categoryId', 'objectId', 'source'],
        { signal, onProgress: setLoaded },
      ),
      loadRows(client, 'categoriesByProjectId', projectId, ['name'], {
        signal,
      }),
      fetchAllPaginatedResults(client.models.Category.categoriesByProjectId, {
        projectId,
        selectionSet: ['id', 'color'] as const,
        signal,
      }).catch(() => []),
    ])
      .then(([rows, names, colours]) => {
        if (signal.aborted) return;
        const colourById = new Map(colours.map((c) => [c.id, c.color]));
        setCategories(
          new Map(
            names.map((c) => [
              c.id,
              {
                name: c.name ?? 'Unknown',
                color: colourById.get(c.id) ?? null,
              },
            ]),
          ),
        );
        setAnnotations(
          rows.map((a) => ({
            id: a.id,
            objectId: a.objectId,
            source: a.source,
            categoryId: a.categoryId,
          })),
        );
      })
      .catch((err) => {
        if (!signal.aborted) console.error('Failed to load annotations', err);
      })
      .finally(() => {
        if (!signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [client, setId, projectId, show]);

  const rows = useMemo(() => {
    const byLabel = new Map<string, CountRow>();
    for (const a of annotations) {
      if (primaryOnly && a.objectId !== a.id) continue;
      const category = categories.get(a.categoryId ?? '');
      const key = category?.name ?? 'Unknown';
      const row = byLabel.get(key) ?? {
        name: category?.name ?? 'Unknown',
        color: category?.color ?? null,
        count: 0,
        fn: 0,
      };
      row.count++;
      if (a.source?.includes('false-negative')) row.fn++;
      byLabel.set(key, row);
    }
    return [...byLabel.values()].sort((a, b) => b.count - a.count);
  }, [annotations, categories, primaryOnly]);

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const hasFalseNegatives = annotations.some((a) =>
    a.source?.includes('false-negative'),
  );

  const columns = useMemo<DataColumn<CountRow>[]>(
    () => [
      {
        id: 'swatch',
        header: '',
        enableSorting: false,
        meta: { className: 'w-8' },
        cell: ({ row }) => (
          <span
            className='block size-2.5'
            style={{ backgroundColor: row.original.color || '#adb5bd' }}
          />
        ),
      },
      {
        accessorKey: 'name',
        header: 'Label',
        meta: { className: 'max-w-40 truncate' },
      },
      {
        id: 'bar',
        header: '',
        enableSorting: false,
        meta: { className: 'w-1/2' },
        cell: ({ row }) => (
          <div className='h-2 bg-white/10'>
            <div
              className='h-full'
              style={{
                width: `${total ? (row.original.count / total) * 100 : 0}%`,
                backgroundColor: row.original.color || '#adb5bd',
              }}
            />
          </div>
        ),
      },
      {
        accessorKey: 'count',
        header: 'Count',
        meta: { className: 'w-24 text-right tabular-nums' },
        cell: ({ row }) => row.original.count.toLocaleString(),
      },
      ...(hasFalseNegatives
        ? [
            {
              accessorKey: 'fn',
              header: 'False negatives',
              meta: { className: 'w-36 text-right tabular-nums' },
              cell: ({ row }) => row.original.fn.toLocaleString(),
            } satisfies DataColumn<CountRow>,
          ]
        : []),
    ],
    [total, hasFalseNegatives],
  );

  return (
    <Modal show={show} onHide={handleClose} size='lg'>
      <Header>
        <Title>Annotation Set Details</Title>
      </Header>
      <Body>
        <div className='flex flex-col gap-3 p-4'>
          {loading ? (
            <div className='flex items-center gap-2 text-muted-foreground'>
              <Spinner animation='border' size='sm' />
              Loading annotations
              {loaded > 0 && ` · ${loaded.toLocaleString()} loaded`}...
            </div>
          ) : (
            <>
              <div className='flex flex-wrap items-center gap-4'>
                <span className='text-3xl font-bold tabular-nums'>
                  {total.toLocaleString()}
                </span>
                <span className='text-xs leading-tight text-muted-foreground'>
                  {primaryOnly ? 'primary annotations' : 'annotations'}
                  <br />
                  {rows.length} label{rows.length === 1 ? '' : 's'}
                </span>
                <div
                  role='radiogroup'
                  aria-label='Annotations to count'
                  className='ml-auto inline-flex border border-white/30'
                >
                  {[
                    { value: false, label: 'All annotations' },
                    {
                      value: true,
                      label: 'Primary only',
                      title: 'Counts each individual animal once',
                    },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type='button'
                      role='radio'
                      aria-checked={primaryOnly === option.value}
                      title={option.title}
                      onClick={() => setPrimaryOnly(option.value)}
                      className={cn(
                        'px-3 py-1.5 text-base leading-normal transition-colors',
                        primaryOnly === option.value
                          ? 'bg-primary text-white'
                          : 'hover:bg-white/10',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <DataTable
                storageKey='annotation-counts'
                columns={columns}
                data={rows}
                getRowId={(row) => row.name}
                initialSorting={[{ id: 'count', desc: true }]}
                emptyMessage='No annotations yet.'
              />
            </>
          )}
        </div>
      </Body>
      <Footer>
        <Button variant='ghost' className='mr-auto' onClick={handleClose}>
          Close
        </Button>
      </Footer>
    </Modal>
  );
};

export default AnnotationCountModal;
