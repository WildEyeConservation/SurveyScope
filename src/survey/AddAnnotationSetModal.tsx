import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormText, Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { useContext, useState } from 'react';
import { GlobalContext } from '../Context';
import { Body, Footer, Header, Modal, Title } from '../Modal';
import { Schema } from '../amplify/client-schema';
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
  const { client } = useContext(GlobalContext)!;
  const [name, setName] = useState('');
  const [saveLabels, setSaveLabels] = useState<
    | ((
        annotationSetId: string,
        projectId: string,
        group: string,
      ) => Promise<void>)
    | null
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
    if (!name.trim()) return;

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
      name: name.trim(),
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
    e: React.ChangeEvent<HTMLSelectElement>,
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
        <form
          className='flex flex-col gap-4 p-4'
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <div>
            <Label htmlFor='annotation-set-name'>Name</Label>
            <Input
              id='annotation-set-name'
              type='text'
              value={name}
              placeholder='e.g. Elephant count 2026'
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label>Copy labels from another annotation set</Label>
            <div className='grid gap-2 sm:grid-cols-2'>
              <NativeSelect
                aria-label='Survey'
                value={selectedProject}
                disabled={loadingLabels}
                onChange={(e) => {
                  setSelectedProject(e.target.value);
                  setSelectedAnnotationSet('');
                }}
              >
                <option value=''>Survey</option>
                {allProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label='Annotation set'
                disabled={!selectedProject || loadingLabels}
                value={selectedAnnotationSet}
                onChange={handleAnnotationSetChange}
              >
                <option value=''>
                  {loadingLabels ? 'Loading labels…' : 'Annotation set'}
                </option>
                {allProjects
                  .find((p) => p.id === selectedProject)
                  ?.annotationSets.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </NativeSelect>
            </div>
            <FormText>Optional. Replaces the labels below.</FormText>
          </div>
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
        </form>
        <Footer>
          <Button
            variant='ghost'
            className='mr-auto'
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          {statusMessage && (
            <span className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Spinner size='sm' />
              {statusMessage}
            </span>
          )}
          <Button
            variant='primary'
            onClick={handleSave}
            disabled={busy || !name.trim()}
          >
            {busy ? 'Creating...' : 'Create'}
          </Button>
        </Footer>
      </Body>
    </Modal>
  );
}
