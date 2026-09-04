import React, { useEffect, useState } from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import { Modal, Body, Header, Footer, Title } from './Modal';
import { client } from './stores/appClient';
import { Tab, Tabs } from './Tabs';
import { Schema } from './amplify/client-schema';
import LabelEditor from './survey/LabelEditor';
import { useQuery } from '@tanstack/react-query';

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
  const [newName, setNewName] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveLabels, setSaveLabels] = useState<
    ((
      annotationSetId: string,
      projectId: string,
      group: string
    ) => Promise<void>) | null
  >(null);
  const [saveInfoTags, setSaveInfoTags] = useState<
    ((
      annotationSetId: string,
      projectId: string,
      group: string
    ) => Promise<void>) | null
  >(null);

  const { data: fetchedCategories, isFetching: categoriesLoading } = useQuery({
    queryKey: ['annotation-set-categories', annotationSet.id],
    enabled: show,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await client.models.Category.categoriesByAnnotationSetId(
        { annotationSetId: annotationSet.id }
      );
      return data ?? [];
    },
  });
  const { data: fetchedInfoTags, isFetching: infoTagsLoading } = useQuery({
    queryKey: ['annotation-set-info-tags', annotationSet.id],
    enabled: show,
    staleTime: 0,
    queryFn: async () => {
      const { data } =
        await client.models.InfoTag.infoTagsByAnnotationSetId({
          annotationSetId: annotationSet.id,
        });
      return data ?? [];
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
          project.group || project.organizationId
        );
      }
      if (saveInfoTags) {
        await saveInfoTags(
          annotationSet.id,
          project.id,
          project.group || project.organizationId
        );
      }
      setStatusMessage('');
      setSelectedSets?.([]);
      handleClose();
    } catch (err) {
      console.error('Failed to save annotation set edits', err);
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to save changes'
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
          <Tab label='Labels'>
            <Form className='d-flex flex-column gap-2 p-3'>
              <Form.Group controlId='annotationSetName'>
                <Form.Label>Name</Form.Label>
                <Form.Control
                  type='text'
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder='Enter new name'
                />
              </Form.Group>
              {categoriesLoading || !fetchedCategories ? (
                <div className='d-flex align-items-center gap-2 py-3'>
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
                />
              )}
            </Form>
          </Tab>
          <Tab label='Info Tags'>
            <Form className='d-flex flex-column gap-2 p-3'>
              {infoTagsLoading || !fetchedInfoTags ? (
                <div className='d-flex align-items-center gap-2 py-3'>
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
                />
              )}
            </Form>
          </Tab>
        </Tabs>
        <Footer>
          {errorMessage ? (
            <span className='text-danger me-auto' style={{ fontSize: 12 }}>
              {errorMessage}
            </span>
          ) : statusMessage ? (
            <span className='text-muted me-auto d-flex align-items-center gap-2' style={{ fontSize: 12 }}>
              <Spinner size='sm' />
              {statusMessage}
            </span>
          ) : null}
          <Button
            variant='primary'
            disabled={isSaving || categoriesLoading || infoTagsLoading}
            onClick={handleSave}
          >
            {isSaving ? (
              <span className='d-flex align-items-center gap-2'>
                <Spinner size='sm' />
                Saving...
              </span>
            ) : (
              'Save Changes'
            )}
          </Button>
          <Button
            variant='dark'
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
        </Footer>
      </Body>
    </Modal>
  );
};

export default EditAnnotationSetModal;
