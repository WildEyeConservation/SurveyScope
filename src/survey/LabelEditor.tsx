import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQueryClient } from '@tanstack/react-query';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import pLimit from 'p-limit';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRecordHotkeys } from 'react-hotkeys-hook';
import { GlobalContext } from '../Context';
import { fetchAllPaginatedResults } from '../utils';
import { formatShortcutKey } from '../utils/hotkeys';
import { plural } from './launchLabel';

interface Label {
  id: string;
  name: string;
  shortcutKey: string;
  color: string;
}

type LabelRow = Label & {
  usage: number;
  shortcutText: string;
  removeDisabled: boolean;
  onColor: (color: string) => void;
  onName: (name: string) => void;
  onShortcutFocus: () => void;
  onShortcutBlur: () => void;
  onRemove: () => void;
};

type EditableLabelModel = {
  create: (input: {
    projectId: string;
    annotationSetId: string;
    name: string;
    shortcutKey: string;
    color: string;
    group: string;
  }) => Promise<unknown>;
  update: (input: {
    id: string;
    name: string;
    shortcutKey: string;
    color: string;
  }) => Promise<unknown>;
  delete: (input: { id: string }) => Promise<unknown>;
};

export default function LabelEditor({
  defaultLabels = [],
  importLabels = [],
  setHandleSave,
  isEditing = false,
  onStatusChange,
  modelName = 'Category',
  title = 'Labels',
  description = 'Set up the labels based on the species you expect to encounter.',
  usage,
  onCountChange,
}: {
  defaultLabels?: Label[];
  importLabels?: Label[];
  setHandleSave: React.Dispatch<
    React.SetStateAction<
      | ((
          annotationSetId: string,
          projectId: string,
          group: string,
        ) => Promise<void>)
      | null
    >
  >;
  isEditing?: boolean;
  onStatusChange?: (status: string) => void;
  modelName?: 'Category' | 'InfoTag';
  title?: string;
  description?: string;
  // Annotations per saved label id; undefined while loading.
  usage?: Map<string, number>;
  onCountChange?: (count: number) => void;
}) {
  const [keys, { start, stop, isRecording }] = useRecordHotkeys();
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Label[]>(defaultLabels);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const { client } = useContext(GlobalContext)!;
  const defaultLabelsRef = useRef<Label[]>(defaultLabels);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);
  const queryClient = useQueryClient();

  useEffect(() => {
    defaultLabelsRef.current = defaultLabels;
  }, [defaultLabels]);

  const handleSave = useCallback(
    async (annotationSetId: string, projectId: string, group: string) => {
      const filteredLabels = labels.filter(
        (l) => l.name !== '' && l.shortcutKey !== '',
      );

      onStatusChangeRef.current?.(
        modelName === 'Category'
          ? 'Updating labels...'
          : 'Updating info tags...',
      );
      const model = client.models[modelName] as EditableLabelModel;

      if (isEditing) {
        const currentDefaultLabels: Label[] = defaultLabelsRef.current;
        const filteredLabelIds = new Set<string>(
          filteredLabels.map((l: Label) => l.id),
        );
        const defaultLabelIds = new Set<string>(
          currentDefaultLabels.map((l: Label) => l.id),
        );
        const labelsToDelete = currentDefaultLabels.filter(
          (l) => !filteredLabelIds.has(l.id),
        );

        // Remove dependent links before their tag.
        if (modelName === 'InfoTag') {
          await Promise.all(
            labelsToDelete.map(async (l) => {
              const links = await fetchAllPaginatedResults(
                client.models.AnnotationInfoTag.annotationInfoTagsByInfoTagId,
                {
                  infoTagId: l.id,
                  selectionSet: ['annotationId', 'infoTagId'] as const,
                  limit: 1000,
                },
              );
              const limit = pLimit(10);
              await Promise.all(
                links.map((link) =>
                  limit(() =>
                    client.models.AnnotationInfoTag.delete({
                      annotationId: link.annotationId,
                      infoTagId: link.infoTagId,
                    }),
                  ),
                ),
              );
            }),
          );
        }

        await Promise.all([
          // labels to delete
          ...labelsToDelete.map((l) => model.delete({ id: l.id })),
          // labels to create
          ...filteredLabels
            .filter((l) => !defaultLabelIds.has(l.id))
            .map((l) =>
              model.create({
                projectId,
                name: l.name,
                shortcutKey: l.shortcutKey,
                color: l.color,
                annotationSetId,
                group,
              }),
            ),
          // labels to update
          ...filteredLabels
            .filter((l) => defaultLabelIds.has(l.id))
            .map((l) =>
              model.update({
                id: l.id,
                name: l.name,
                shortcutKey: l.shortcutKey,
                color: l.color,
              }),
            ),
        ]);
      } else {
        await Promise.all(
          filteredLabels.map((l) =>
            model.create({
              name: l.name,
              shortcutKey: l.shortcutKey,
              color: l.color,
              annotationSetId,
              projectId,
              group,
            }),
          ),
        );
      }

      if (modelName === 'Category') {
        onStatusChangeRef.current?.('Refreshing project...');
        await Promise.all([
          client.models.Project.update({ id: projectId, status: 'active' }),
          client.mutations.updateProjectMemberships({ projectId }),
        ]);
      }

      // Ensure any persisted/react-query caches for categories are refreshed
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [modelName] }),
        queryClient.invalidateQueries({
          queryKey: [
            modelName === 'Category'
              ? 'annotation-set-categories'
              : 'annotation-set-info-tags',
            annotationSetId,
          ],
        }),
      ]);
    },
    [client, labels, isEditing, modelName, queryClient],
  );

  useEffect(() => {
    setHandleSave(() => handleSave);
  }, [handleSave, setHandleSave]);

  useEffect(() => {
    if (importLabels.length > 0) {
      setLabels(importLabels);
    }
  }, [importLabels]);

  useEffect(() => {
    onCountChange?.(labels.length);
  }, [labels.length, onCountChange]);

  const noun = modelName === 'Category' ? 'label' : 'info tag';

  const incomplete = labels.some((l) => l.name === '' || l.shortcutKey === '');
  const usageOf = (id: string) => usage?.get(id) ?? 0;

  const recordShortcut = (labelId: string) => {
    stop();
    const newShortcutKey = Array.from(keys).join('+');
    if (!newShortcutKey) return;
    if (newShortcutKey === ' ' || newShortcutKey.toLowerCase() === 'space') {
      setShortcutError('Space is reserved and cannot be a shortcut.');
      return;
    }
    if (['equal', 'shift+equal', 'add'].includes(newShortcutKey)) {
      setShortcutError('"+" and "=" are reserved and cannot be shortcuts.');
      return;
    }
    const clash = labels.find(
      (l) => l.id !== labelId && l.shortcutKey === newShortcutKey,
    );
    if (clash) {
      setShortcutError(
        `${formatShortcutKey(newShortcutKey)} is already used by ${clash.name || `another ${noun}`}.`,
      );
      return;
    }
    setShortcutError(null);
    setLabels(
      labels.map((l) =>
        l.id === labelId ? { ...l, shortcutKey: newShortcutKey } : l,
      ),
    );
  };

  const rows: LabelRow[] = labels.map((label) => ({
    ...label,
    usage: usageOf(label.id),
    shortcutText:
      isRecording && activeRowId === label.id
        ? formatShortcutKey(Array.from(keys).join('+'))
        : formatShortcutKey(label.shortcutKey),
    removeDisabled:
      isEditing && !usage && defaultLabels.some((l) => l.id === label.id),
    onColor: (color) =>
      setLabels(labels.map((l) => (l.id === label.id ? { ...l, color } : l))),
    onName: (name) =>
      setLabels(labels.map((l) => (l.id === label.id ? { ...l, name } : l))),
    onShortcutFocus: () => {
      setActiveRowId(label.id);
      start();
    },
    onShortcutBlur: () => {
      recordShortcut(label.id);
      if (activeRowId === label.id) setActiveRowId(null);
    },
    onRemove: () =>
      usageOf(label.id) > 0
        ? setConfirmDeleteId(label.id)
        : setLabels(labels.filter((l) => l.id !== label.id)),
  }));

  const columns = useMemo<DataColumn<LabelRow>[]>(
    () => [
      {
        id: 'color',
        header: 'Colour',
        enableSorting: false,
        meta: { className: 'w-20' },
        cell: ({ row }) => (
          <input
            type='color'
            aria-label={`Colour of ${row.original.name || noun}`}
            value={row.original.color}
            onChange={(event) => row.original.onColor(event.target.value)}
            className='size-[38px] cursor-pointer border border-white/30 bg-transparent p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0.5'
          />
        ),
      },
      {
        id: 'name',
        header: 'Name',
        enableSorting: false,
        cell: ({ row }) => (
          <div className='relative'>
            <Input
              type='text'
              aria-label={`${noun} name`}
              placeholder={`${noun[0].toUpperCase()}${noun.slice(1)} name`}
              value={row.original.name}
              className={row.original.usage > 0 ? 'pr-36' : undefined}
              onChange={(e) => row.original.onName(e.target.value)}
            />
            {row.original.usage > 0 && (
              <span className='pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[#6c757d] tabular-nums'>
                {plural(row.original.usage, 'annotation')}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'shortcut',
        header: 'Shortcut',
        enableSorting: false,
        meta: { className: 'w-48' },
        cell: ({ row }) => (
          <Input
            type='text'
            aria-label={`Shortcut for ${row.original.name || noun}`}
            placeholder='Press a key'
            value={row.original.shortcutText}
            onFocus={row.original.onShortcutFocus}
            onBlur={row.original.onShortcutBlur}
            onChange={() => {}}
          />
        ),
      },
      {
        id: 'remove',
        header: '',
        enableSorting: false,
        meta: { className: 'w-12 text-center' },
        cell: ({ row }) => (
          <button
            type='button'
            aria-label={`Remove ${row.original.name || noun}`}
            title={`Remove ${noun}`}
            className='mx-auto flex size-8 items-center justify-center text-muted-foreground hover:text-danger'
            disabled={row.original.removeDisabled}
            onClick={row.original.onRemove}
          >
            <Trash2Icon className='size-4' />
          </button>
        ),
      },
    ],
    [noun],
  );

  return (
    <div className='flex flex-col gap-2'>
      <div>
        <div className='text-sm'>{title}</div>
        <div className='text-xs text-muted-foreground'>{description}</div>
      </div>
      <DataTable
        storageKey='survey-labels'
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        pageSize={false}
        emptyMessage={`No ${noun}s yet.`}
        renderBelowRow={(row) =>
          confirmDeleteId === row.id && (
            <div className='flex flex-wrap items-center gap-3 border-t border-danger/40 bg-danger/15 px-3 py-2'>
              <span className='flex-1'>
                {modelName === 'Category'
                  ? `${plural(row.usage, 'annotation')} use ${row.name}. Removing it leaves them without a label.`
                  : `Removing ${row.name} untags ${plural(row.usage, 'annotation')}.`}
              </span>
              <Button variant='ghost' onClick={() => setConfirmDeleteId(null)}>
                Keep
              </Button>
              <Button
                variant='danger'
                onClick={() => {
                  setConfirmDeleteId(null);
                  setLabels(labels.filter((l) => l.id !== row.id));
                }}
              >
                Remove
              </Button>
            </div>
          )
        }
      />
      <div className='border border-dark'>
        <button
          type='button'
          disabled={incomplete}
          title={
            incomplete
              ? `Name the current ${noun} and give it a shortcut first`
              : undefined
          }
          className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-50'
          onClick={() =>
            setLabels([
              ...labels,
              {
                id: crypto.randomUUID(),
                name: '',
                shortcutKey: '',
                color: '#000000',
              },
            ])
          }
        >
          <PlusIcon className='size-4' />
          Add {noun}
        </button>
      </div>
      {shortcutError && (
        <div className='text-xs text-danger'>{shortcutError}</div>
      )}
    </div>
  );
}
