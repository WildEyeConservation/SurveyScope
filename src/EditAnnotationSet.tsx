import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useQuery } from '@tanstack/react-query';
import React, { useContext, useEffect, useState } from 'react';
import { GlobalContext } from './Context';
import { Body, Footer, Header, Modal, Title } from './Modal';
import { Tab, Tabs } from './Tabs';
import { Schema } from './amplify/client-schema';
import { loadRows } from './rowChunks';
import LabelEditor from './survey/LabelEditor';

interface EditAnnotationSetModalProps {
  show: boolean;
  handleClose: () => void;
  annotationSet: { id: string; name: string };
  setAnnotationSet?: (annotationSet: { id: string; name: string }) => void;
  setSelectedSets?: (sets: string[]) => void;
  project: Schema['Project']['type'];
  categories: { name: string }[];
  setEditSurveyTab: (tab: number) => void;
}

const EditAnnotationSetModal: React.FC<EditAnnotationSetModalProps> = ({
  show,
  handleClose,
  annotationSet,
  setSelectedSets,
  setAnnotationSet,
  project,
}) => {
  const { client } = useContext(GlobalContext)!;
  const [newName, setNewName] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveLabels, setSaveLabels] = useState<
    | ((
        annotationSetId: string,
        projectId: string,
        group: string,
      ) => Promise<void>)
    | null
  >(null);
  const [saveInfoTags, setSaveInfoTags] = useState<
    | ((
        annotationSetId: string,
        projectId: string,
        group: string,
      ) => Promise<void>)
    | null
  >(null);

  const { data: fetchedCategories, isFetching: categoriesLoading } = useQuery({
    queryKey: ['annotation-set-categories', annotationSet.id],
    enabled: show,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await client.models.Category.categoriesByAnnotationSetId(
        { annotationSetId: annotationSet.id },
      );
      return data ?? [];
    },
  });
  const { data: fetchedInfoTags, isFetching: infoTagsLoading } = useQuery({
    queryKey: ['annotation-set-info-tags', annotationSet.id],
    enabled: show,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await client.models.InfoTag.infoTagsByAnnotationSetId({
        annotationSetId: annotationSet.id,
      });
      return data ?? [];
    },
  });

  const [labelCount, setLabelCount] = useState<number>();
  const [infoTagCount, setInfoTagCount] = useState<number>();
  const { data: usage } = useQuery({
    queryKey: ['annotation-set-label-usage-v2', annotationSet.id],
    enabled: show,
    staleTime: 0,
    // Holds Maps, which don't survive being saved to localStorage.
    meta: { persist: false },
    queryFn: async () => {
      const [annotations, links] = await Promise.all([
        loadRows(client, 'annotationsByAnnotationSetId', annotationSet.id, [
          'categoryId',
        ]),
        loadRows(
          client,
          'annotationInfoTagsByAnnotationSetId',
          annotationSet.id,
          ['infoTagId'],
        ),
      ]);
      const count = (ids: (string | null)[]) => {
        const counts = new Map<string, number>();
        for (const id of ids) {
          if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        return counts;
      };
      return {
        labels: count(annotations.map((a) => a.categoryId)),
        infoTags: count(links.map((l) => l.infoTagId)),
      };
    },
  });

  const handleSave = async () => {
    if (!annotationSet || newName.trim() === '') return;

    setErrorMessage('');
    setIsSaving(true);
    try {
      const { data: result } = await client.models.AnnotationSet.update({
        id: annotationSet.id,
        name: newName,
      });
      if (setAnnotationSet && result) {
        setAnnotationSet({ id: result.id, name: result.name });
      }
      if (saveLabels) {
        await saveLabels(
          annotationSet.id,
          project.id,
          project.group || project.organizationId,
        );
      }
      if (saveInfoTags) {
        await saveInfoTags(
          annotationSet.id,
          project.id,
          project.group || project.organizationId,
        );
      }
      setStatusMessage('');
      setSelectedSets?.([]);
      handleClose();
    } catch (err) {
      console.error('Failed to save annotation set edits', err);
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to save changes',
      );
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    setNewName(annotationSet.name);
  }, [annotationSet.name]);

  return (
    <Modal show={show} onHide={handleClose} strict={true}>
      <Header>
        <Title>Edit Annotation Set</Title>
      </Header>
      <Body>
        <Tabs>
          <Tab
            label={`Labels (${labelCount ?? fetchedCategories?.length ?? 0})`}
          >
            <form className='flex flex-col gap-2 p-4'>
              <div>
                <Label htmlFor='annotationSetName'>Name</Label>
                <Input
                  id='annotationSetName'
                  type='text'
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder='Enter new name'
                />
              </div>
              {categoriesLoading || !fetchedCategories ? (
                <div className='flex items-center gap-2 py-4'>
                  <Spinner size='sm' />
                  <span>Loading labels...</span>
                </div>
              ) : (
                <LabelEditor
                  key={annotationSet.id}
                  defaultLabels={fetchedCategories.map((category) => ({
                    id: category.id,
                    name: category.name,
                    shortcutKey: category.shortcutKey ?? '',
                    color: category.color ?? '',
                  }))}
                  isEditing
                  setHandleSave={setSaveLabels}
                  onStatusChange={setStatusMessage}
                  usage={usage?.labels}
                  onCountChange={setLabelCount}
                />
              )}
            </form>
          </Tab>
          <Tab
            label={`Info Tags (${infoTagCount ?? fetchedInfoTags?.length ?? 0})`}
          >
            <form className='flex flex-col gap-2 p-4'>
              {infoTagsLoading || !fetchedInfoTags ? (
                <div className='flex items-center gap-2 py-4'>
                  <Spinner size='sm' />
                  <span>Loading info tags...</span>
                </div>
              ) : (
                <LabelEditor
                  key={`info-tags-${annotationSet.id}`}
                  defaultLabels={fetchedInfoTags.map((tag) => ({
                    id: tag.id,
                    name: tag.name,
                    shortcutKey: tag.shortcutKey ?? '',
                    color: tag.color ?? '',
                  }))}
                  isEditing
                  modelName='InfoTag'
                  title='Info Tags'
                  description='Define optional informational tags that can be toggled on annotations.'
                  setHandleSave={setSaveInfoTags}
                  onStatusChange={setStatusMessage}
                  usage={usage?.infoTags}
                  onCountChange={setInfoTagCount}
                />
              )}
            </form>
          </Tab>
        </Tabs>
        <Footer>
          <Button
            variant='ghost'
            className='mr-auto'
            disabled={isSaving}
            onClick={() => {
              handleClose();
              if (setSelectedSets) {
                setSelectedSets([]);
              }
            }}
          >
            Cancel
          </Button>
          {errorMessage ? (
            <span className='text-xs text-danger'>{errorMessage}</span>
          ) : statusMessage ? (
            <span className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Spinner size='sm' />
              {statusMessage}
            </span>
          ) : null}
          <Button
            variant='primary'
            disabled={isSaving || categoriesLoading || infoTagsLoading}
            onClick={handleSave}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </Footer>
      </Body>
    </Modal>
  );
};

export default EditAnnotationSetModal;
