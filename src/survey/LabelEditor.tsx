import { Form, Button } from 'react-bootstrap';
import { useRecordHotkeys } from 'react-hotkeys-hook';
import MyTable from '../Table';
import { useState, useEffect, useCallback, useRef } from 'react';
import { client } from '../stores/appClient';
import { useQueryClient } from '@tanstack/react-query';
import pLimit from 'p-limit';
import { fetchAllPaginatedResults } from '../utils';
import { formatShortcutKey } from '../utils/hotkeys';

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
}: {
  defaultLabels?: Label[];
  importLabels?: Label[];
  setHandleSave: React.Dispatch<
    React.SetStateAction<
      ((annotationSetId: string, projectId: string, group: string) => Promise<void>) | null
    >
  >;
  isEditing?: boolean;
  onStatusChange?: (status: string) => void;
  modelName?: 'Category' | 'InfoTag';
  title?: string;
  description?: string;
}) {
  const [keys, { start, stop, isRecording }] = useRecordHotkeys();
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [labels, setLabels] = useState<Label[]>(defaultLabels);
  const defaultLabelsRef = useRef<Label[]>(defaultLabels);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);
  const queryClient = useQueryClient();

  useEffect(() => {
    defaultLabelsRef.current = defaultLabels;
  }, [defaultLabels]);

  const handleSave = useCallback(
    async (annotationSetId: string, projectId: string, group: string) => {
      const filteredLabels = labels.filter(
        (l) => l.name !== '' && l.shortcutKey !== ''
      );

      onStatusChangeRef.current?.(
        modelName === 'Category' ? 'Updating labels...' : 'Updating info tags...'
      );
      const model = client.models[modelName] as EditableLabelModel;

      if (isEditing) {
        const currentDefaultLabels: Label[] = defaultLabelsRef.current;
        const filteredLabelIds = new Set<string>(filteredLabels.map((l: Label) => l.id));
        const defaultLabelIds = new Set<string>(currentDefaultLabels.map((l: Label) => l.id));
        const labelsToDelete = currentDefaultLabels.filter(
          (l) => !filteredLabelIds.has(l.id)
        );

        // Remove dependent links before their tag.
        if (modelName === 'InfoTag') {
          await Promise.all(
            labelsToDelete.map(async (l) => {
              const links = await fetchAllPaginatedResults(
                client.models.AnnotationInfoTag
                  .annotationInfoTagsByInfoTagId,
                {
                  infoTagId: l.id,
                  selectionSet: ['annotationId', 'infoTagId'] as const,
                  limit: 1000,
                }
              );
              const limit = pLimit(10);
              await Promise.all(
                links.map((link) =>
                  limit(() =>
                    client.models.AnnotationInfoTag.delete({
                      annotationId: link.annotationId,
                      infoTagId: link.infoTagId,
                    })
                  )
                )
              );
            })
          );
        }

        await Promise.all([
          // labels to delete
          ...labelsToDelete.map((l) => model.delete({ id: l.id })),
          // labels to create
          ...filteredLabels
            .filter((l) => !defaultLabelIds.has(l.id))
            .map((l) => model.create({
              projectId,
              name: l.name,
              shortcutKey: l.shortcutKey,
              color: l.color,
              annotationSetId,
              group,
            })),
          // labels to update
          ...filteredLabels
            .filter((l) => defaultLabelIds.has(l.id))
            .map((l) => model.update({
              id: l.id,
              name: l.name,
              shortcutKey: l.shortcutKey,
              color: l.color,
            })),
        ]);
      } else {
        await Promise.all(
          filteredLabels.map((l) => model.create({
            name: l.name,
            shortcutKey: l.shortcutKey,
            color: l.color,
            annotationSetId,
            projectId,
            group,
          }))
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
    [labels, isEditing, modelName, queryClient]
  );

  useEffect(() => {
    setHandleSave(() => handleSave);
  }, [handleSave, setHandleSave]);

  useEffect(() => {
    if (importLabels.length > 0) {
      setLabels(importLabels);
    }
  }, [importLabels]);

  return (
    <Form.Group>
      <Form.Label className='mb-0'>{title}</Form.Label>
      <span
        className='text-muted d-block mb-1'
        style={{ fontSize: 12, lineHeight: 1.2 }}
      >
        {description}
      </span>
      <MyTable
        tableHeadings={[
          { content: 'Name', style: { width: '25%' } },
          { content: 'Shortcut Key', style: { width: '25%' } },
          { content: 'Color', style: { width: '25%' } },
          {
            content: `Remove ${modelName === 'Category' ? 'Label' : 'Info Tag'}`,
            style: { width: '25%' },
          },
        ]}
        tableData={labels.map((label) => ({
          id: label.id,
          rowData: [
            <Form.Control
              type='text'
              placeholder='Enter label name'
              value={label.name}
              onChange={(e) =>
                setLabels(
                  labels.map((l) =>
                    l.id === label.id ? { ...l, name: e.target.value } : l
                  )
                )
              }
            />,
            <Form.Control
              type='text'
              placeholder='Record shortcut key'
              value={
                isRecording && activeRowId === label.id
                  ? formatShortcutKey(Array.from(keys).join('+'))
                  : formatShortcutKey(label.shortcutKey)
              }
              onFocus={start}
              onBlur={() => {
                stop();
                const newShortcutKey = Array.from(keys).join('+');
                if (newShortcutKey === ' ' || newShortcutKey.toLowerCase() === 'space') {
                  alert(
                    `Spacebar is reserved and cannot be used as a ${title.toLowerCase()} shortcut.`
                  );
                  return;
                }
                if (newShortcutKey === 'equal' || newShortcutKey === 'shift+equal' || newShortcutKey === 'add') {
                  alert(
                    `"+" and "=" are reserved and cannot be used as a ${title.toLowerCase()} shortcut.`
                  );
                  return;
                }
                if (
                  labels.some(
                    (l) => l.id !== label.id && l.shortcutKey === newShortcutKey
                  )
                ) {
                  alert(
                    `This shortcut key is already in use by another ${modelName === 'Category' ? 'label' : 'info tag'}.`
                  );
                  return;
                }
                setLabels(
                  labels.map((l) =>
                    l.id === label.id
                      ? {
                        ...l,
                        shortcutKey: newShortcutKey,
                      }
                      : l
                  )
                );
              }}
              onFocusCapture={() => setActiveRowId(label.id)}
              onBlurCapture={() => {
                if (activeRowId === label.id) {
                  setActiveRowId(null);
                }
              }}
              onChange={() => { }}
            />,
            <Form.Control
              type='color'
              id='exampleColorInput'
              size='sm'
              value={label.color}
              title='Label color'
              onChange={(event) => {
                setLabels(
                  labels.map((l) =>
                    l.id === label.id ? { ...l, color: event.target.value } : l
                  )
                );
              }}
            />,
            <Button
              variant='danger'
              size='sm'
              onClick={() => {
                setLabels(labels.filter((l) => l.id !== label.id));
              }}
            >
              Remove
            </Button>,
          ],
        }))}
      />
      <Button
        variant='info'
        size='sm'
        onClick={() => {
          if (labels.some((l) => l.name === '' || l.shortcutKey === '')) {
            alert(
              `Please complete the current ${modelName === 'Category' ? 'label' : 'info tag'} before adding another`
            );
            return;
          }
          setLabels([
            ...labels,
            {
              id: crypto.randomUUID(),
              name: '',
              shortcutKey: '',
              color: '#000000',
            },
          ]);
        }}
      >
        +
      </Button>
    </Form.Group>
  );
}
