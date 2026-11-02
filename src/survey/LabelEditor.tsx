import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQueryClient } from '@tanstack/react-query';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import pLimit from 'p-limit';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
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
  const grid = '64px minmax(0, 1fr) minmax(110px, 180px) 36px';
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

  return (
    <div className='flex flex-col gap-2'>
      <div>
        <div className='text-sm'>{title}</div>
        <div className='text-xs text-muted-foreground'>{description}</div>
      </div>
      <div className='border border-dark bg-white/[0.07] text-sm'>
        <div
          className='grid items-center gap-3 border-b border-dark bg-dark px-3 py-2 text-[11px] font-semibold tracking-wider text-white/85 uppercase'
          style={{ gridTemplateColumns: grid }}
        >
          <span>Colour</span>
          <span>Name</span>
          <span>Shortcut</span>
          <span />
        </div>
        {labels.map((label) => (
          <div key={label.id} className='border-b border-white/[0.08]'>
            <div
              className='grid items-center gap-3 px-3 py-2'
              style={{ gridTemplateColumns: grid }}
            >
              <input
                type='color'
                aria-label={`Colour of ${label.name || noun}`}
                value={label.color}
                onChange={(event) =>
                  setLabels(
                    labels.map((l) =>
                      l.id === label.id
                        ? { ...l, color: event.target.value }
                        : l,
                    ),
                  )
                }
                className='size-[38px] cursor-pointer border border-white/30 bg-transparent p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0.5'
              />
              <div className='relative'>
                <Input
                  type='text'
                  aria-label={`${noun} name`}
                  placeholder={`${noun[0].toUpperCase()}${noun.slice(1)} name`}
                  value={label.name}
                  className={usageOf(label.id) > 0 ? 'pr-36' : undefined}
                  onChange={(e) =>
                    setLabels(
                      labels.map((l) =>
                        l.id === label.id ? { ...l, name: e.target.value } : l,
                      ),
                    )
                  }
                />
                {usageOf(label.id) > 0 && (
                  <span className='pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[#6c757d] tabular-nums'>
                    {plural(usageOf(label.id), 'annotation')}
                  </span>
                )}
              </div>
              <Input
                type='text'
                aria-label={`Shortcut for ${label.name || noun}`}
                placeholder='Press a key'
                value={
                  isRecording && activeRowId === label.id
                    ? formatShortcutKey(Array.from(keys).join('+'))
                    : formatShortcutKey(label.shortcutKey)
                }
                onFocus={() => {
                  setActiveRowId(label.id);
                  start();
                }}
                onBlur={() => {
                  recordShortcut(label.id);
                  if (activeRowId === label.id) setActiveRowId(null);
                }}
                onChange={() => {}}
              />
              <button
                type='button'
                aria-label={`Remove ${label.name || noun}`}
                title={`Remove ${noun}`}
                className='flex size-8 items-center justify-center text-muted-foreground hover:text-danger'
                disabled={
                  isEditing &&
                  !usage &&
                  defaultLabels.some((l) => l.id === label.id)
                }
                onClick={() =>
                  usageOf(label.id) > 0
                    ? setConfirmDeleteId(label.id)
                    : setLabels(labels.filter((l) => l.id !== label.id))
                }
              >
                <Trash2Icon className='size-4' />
              </button>
            </div>
            {confirmDeleteId === label.id && (
              <div className='flex flex-wrap items-center gap-3 border-t border-danger/40 bg-danger/15 px-3 py-2'>
                <span className='flex-1'>
                  {modelName === 'Category'
                    ? `${plural(usageOf(label.id), 'annotation')} use ${label.name}. Removing it leaves them without a label.`
                    : `Removing ${label.name} untags ${plural(usageOf(label.id), 'annotation')}.`}
                </span>
                <Button
                  variant='ghost'
                  onClick={() => setConfirmDeleteId(null)}
                >
                  Keep
                </Button>
                <Button
                  variant='danger'
                  onClick={() => {
                    setConfirmDeleteId(null);
                    setLabels(labels.filter((l) => l.id !== label.id));
                  }}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
        ))}
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
