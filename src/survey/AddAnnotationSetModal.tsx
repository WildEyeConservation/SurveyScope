import { Form, Button, Spinner } from 'react-bootstrap';
import { Modal, Body, Header, Footer, Title } from '../Modal';
import { Schema } from '../amplify/client-schema';
import { useState } from 'react';
import { client } from '../stores/appClient';
import LabelEditor from './LabelEditor';

export default function AddAnnotationSetModal({
  show,
  onClose,
  project,
  addAnnotationSet,
  allProjects,
}: {
  show: boolean;
  onClose: () => void;
  project: Schema['Project']['type'];
  addAnnotationSet: (annotationSet: Schema['AnnotationSet']['type']) => void;
  allProjects: Schema['Project']['type'][];
}) {
  const [name, setName] = useState('');
  const [saveLabels, setSaveLabels] = useState<
    ((annotationSetId: string, projectId: string, group: string) => Promise<void>) | null
  >(null);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [selectedAnnotationSet, setSelectedAnnotationSet] =
    useState<string>('');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [importedLabels, setImportedLabels] = useState<
    Schema['Category']['type'][]
  >([]);
  const [loadingLabels, setLoadingLabels] = useState(false);

  async function handleSave() {
    if (!name) {
      alert('Please enter a name for the annotation set');
      return;
    }

    setBusy(true);
    setStatusMessage('Creating annotation set...');

    await client.models.Project.update({
      id: project.id,
      status: 'updating',
    });

    await client.mutations.updateProjectMemberships({
      projectId: project.id,
    });

    const { data: annotationSet } = await client.models.AnnotationSet.create({
      name,
      projectId: project.id,
      group: project.organizationId,
    });

    if (annotationSet) {
      addAnnotationSet(annotationSet);

      if (saveLabels) {
        await saveLabels(annotationSet.id, project.id, project.organizationId);
      }
    }

    onClose();
    setStatusMessage('');
    setBusy(false);
  }

  async function handleAnnotationSetChange(
    e: React.ChangeEvent<HTMLSelectElement>
  ) {
    const annotationSetId = e.target.value;
    setSelectedAnnotationSet(annotationSetId);

    if (!annotationSetId) {
      setImportedLabels([]);
      return;
    }

    setLoadingLabels(true);
    try {
      const { data: categories } =
        await client.models.Category.categoriesByAnnotationSetId({
          annotationSetId,
        });
      setImportedLabels((categories ?? []) as Schema['Category']['type'][]);
    } finally {
      setLoadingLabels(false);
    }
  }

  return (
    <Modal show={show} onHide={onClose} disabled={busy} strict={true}>
      <Header>
        <Title>Add Annotation Set</Title>
      </Header>
      <Body>
        <Form className='d-flex flex-column gap-2 p-3'>
          <Form.Group>
            <Form.Label className='mb-0'>Name</Form.Label>
            <span
              className='text-muted d-block mb-1'
              style={{ fontSize: '12px' }}
            >
              A descriptive name for your annotation set to help you identify
              it.
            </span>
            <Form.Control
              type='text'
              value={name}
              placeholder='Enter a name'
              onChange={(e) => setName(e.target.value)}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className='mb-0'>Load Labels</Form.Label>
            <span
              className='text-muted d-block mb-1'
              style={{ fontSize: '12px' }}
            >
              Load labels from a previous annotation set.
            </span>
            <Form.Select
              value={selectedProject}
              disabled={loadingLabels}
              onChange={(e) => setSelectedProject(e.target.value)}
            >
              <option value=''>Select a survey</option>
              {allProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Form.Select>
            <Form.Select
              className='mt-1'
              disabled={!selectedProject || loadingLabels}
              value={selectedAnnotationSet}
              onChange={handleAnnotationSetChange}
            >
              <option value=''>Select an annotation set</option>
              {allProjects
                .find((p) => p.id === selectedProject)
                ?.annotationSets.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Form.Select>
          </Form.Group>
          <LabelEditor
            defaultLabels={[
              {
                id: crypto.randomUUID(),
                name: 'Unknown',
                shortcutKey: 'u',
                color: '#ff2643',
              },
            ]}
            importLabels={importedLabels as any}
            setHandleSave={setSaveLabels}
            onStatusChange={setStatusMessage}
          />
        </Form>
        <Footer>
          {statusMessage && (
            <span className='text-muted me-auto d-flex align-items-center gap-2' style={{ fontSize: 12 }}>
              <Spinner size='sm' />
              {statusMessage}
            </span>
          )}
          <Button variant='primary' onClick={handleSave} disabled={busy}>
            {busy ? 'Creating...' : 'Create'}
          </Button>
          <Button variant='dark' onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </Footer>
      </Body>
    </Modal>
  );
}
