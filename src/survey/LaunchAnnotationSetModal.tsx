import { Alert, Button, Form } from 'react-bootstrap';
import { Modal, Body, Header, Footer, Title } from '../Modal';
import { useState, useContext } from 'react';
import { Tabs, Tab } from '../Tabs';
import { Schema } from '../amplify/client-schema';
import { GlobalContext } from '../Context';
import SpeciesLabelling from './SpeciesLabelling';
import FalseNegatives from './FalseNegatives';
import QCReview from './QCReview';
import InfoTagsLaunch from './InfoTagsLaunch';
import HomographyLaunch from './HomographyLaunch';
import IndividualId from './IndividualId';
import type { WorkflowType } from '../workflowRegistry';

type LaunchHandlerType = {
  execute: (
    onProgress: (msg: string) => void,
    onLaunchConfirmed: () => void
  ) => Promise<void>;
} | null;

export default function LaunchAnnotationSetModal({
  show,
  project,
  annotationSet,
  onOptimisticStatus,
}: {
  show: boolean;
  project: Schema['Project']['type'];
  annotationSet: Schema['AnnotationSet']['type'];
  onOptimisticStatus?: (
    projectId: string,
    status: Schema['Project']['type']['status']
  ) => void;
}) {
  const [taskType, setTaskType] = useState<WorkflowType>('species-labelling');
  const [launching, setLaunching] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [launchError, setLaunchError] = useState<string>('');
  const [launchDisabled, setLaunchDisabled] = useState<boolean>(false);
  const [speciesLaunchHandler, setSpeciesLaunchHandler] = useState<LaunchHandlerType>(null);
  const [falseNegativesLaunchHandler, setFalseNegativesLaunchHandler] = useState<LaunchHandlerType>(null);
  const [qcLaunchHandler, setQCLaunchHandler] = useState<LaunchHandlerType>(null);
  const [infoTagsLaunchHandler, setInfoTagsLaunchHandler] = useState<LaunchHandlerType>(null);
  const [homographyLaunchHandler, setHomographyLaunchHandler] = useState<LaunchHandlerType>(null);
  const [individualIdLaunchHandler, setIndividualIdLaunchHandler] = useState<LaunchHandlerType>(null);

  const { showModal } = useContext(GlobalContext)! as any;

  // Task type for each tab, in render order.
  const tabTaskTypes: WorkflowType[] = [
    'species-labelling',
    'false-negatives',
    'qc-review',
    'info-tags',
    'homographies',
    'individual-id',
  ];

  function onClose() {
    setTaskType('species-labelling');
    setProgressMessage('');
    setLaunchError('');
    showModal(null);
  }

  async function handleSubmit() {
    const originalStatus = project.status ?? 'active';
    setLaunching(true);
    setLaunchError('');

    // Set optimistic status immediately so the project is blocked for the
    // user even before the modal closes, preventing rapid re-launches.
    onOptimisticStatus?.(project.id, 'launching');

    try {
      switch (taskType) {
        case 'species-labelling':
          if (speciesLaunchHandler) {
            setProgressMessage('Initializing launch...');
            await speciesLaunchHandler.execute(setProgressMessage, () => {});
          }
          break;
        case 'false-negatives':
          if (falseNegativesLaunchHandler) {
            setProgressMessage('Initializing launch...');
            await falseNegativesLaunchHandler.execute(setProgressMessage, () => {});
          }
          break;
        case 'qc-review':
          if (qcLaunchHandler) {
            setProgressMessage('Initializing launch...');
            await qcLaunchHandler.execute(setProgressMessage, () => {});
          }
          break;
        case 'info-tags':
          if (infoTagsLaunchHandler) {
            setProgressMessage('Initializing launch...');
            await infoTagsLaunchHandler.execute(setProgressMessage, () => {});
          }
          break;
        case 'homographies':
          if (homographyLaunchHandler) {
            setProgressMessage('Initializing launch...');
            await homographyLaunchHandler.execute(setProgressMessage, () => {});
          }
          break;
        case 'individual-id':
          if (individualIdLaunchHandler) {
            setProgressMessage('Initializing launch...');
            await individualIdLaunchHandler.execute(setProgressMessage, () => {});
          }
          break;
      }
    } catch (error) {
      // Keep the modal open on failure: closing it silently made a failed
      // launch look like it had been accepted.
      console.error('Launch error', error);
      onOptimisticStatus?.(project.id, originalStatus);
      setProgressMessage('');
      setLaunchError(
        error instanceof Error ? error.message : 'Failed to launch the task'
      );
      setLaunching(false);
      return;
    }
    setLaunching(false);
    onClose();
  }

  return (
    <Modal show={show} strict={true} size='lg' disabled={launching}>
      <Header>
        <Title>Launch for Manual Annotation</Title>
      </Header>
      <Body>
        <Form>
          <Tabs
            onTabChange={(tab) => {
              if (launching) return;
              const next = tabTaskTypes[tab];
              if (next) setTaskType(next);
            }}
            disableSwitching={launching}
          >
            <Tab label='Species Labelling'>
              <SpeciesLabelling
                project={project}
                annotationSet={annotationSet}
                launching={launching}
                setLaunchDisabled={setLaunchDisabled}
                setSpeciesLaunchHandler={setSpeciesLaunchHandler as any}
              />
            </Tab>
            <Tab label='False Negatives'>
              <FalseNegatives
                project={project}
                annotationSet={annotationSet}
                launching={launching}
                setLaunchDisabled={setLaunchDisabled}
                setFalseNegativesLaunchHandler={setFalseNegativesLaunchHandler as any}
              />
            </Tab>
            <Tab label='Review'>
              <QCReview
                project={project}
                annotationSet={annotationSet}
                launching={launching}
                setLaunchDisabled={setLaunchDisabled}
                setQCLaunchHandler={setQCLaunchHandler as any}
              />
            </Tab>
            <Tab label='Info Tags'>
              <InfoTagsLaunch
                project={project}
                annotationSet={annotationSet}
                launching={launching}
                setLaunchDisabled={setLaunchDisabled}
                setInfoTagsLaunchHandler={setInfoTagsLaunchHandler as any}
              />
            </Tab>
            <Tab label='Homographies'>
              <HomographyLaunch
                project={project}
                annotationSet={annotationSet}
                launching={launching}
                setLaunchDisabled={setLaunchDisabled}
                setHomographyLaunchHandler={setHomographyLaunchHandler as any}
              />
            </Tab>
            <Tab label='ChainLinker'>
              <IndividualId
                project={project}
                annotationSet={annotationSet}
                launching={launching}
                setLaunchDisabled={setLaunchDisabled}
                setIndividualIdLaunchHandler={
                  setIndividualIdLaunchHandler as any
                }
              />
            </Tab>
          </Tabs>
        </Form>
        {launchError && (
          <Alert variant='danger' className='mt-3 mb-0'>
            {launchError}
          </Alert>
        )}
        {progressMessage && (
          <div className='mt-3 text-center text-muted d-flex justify-content-center align-items-center gap-2'>
            <span role='status' aria-live='polite'>
              <span className='spinner-border spinner-border-sm me-2' />
              {progressMessage}
            </span>
          </div>
        )}
        <Footer>
          <Button
            variant='primary'
            disabled={
              launchDisabled ||
              launching ||
              (taskType === 'species-labelling' && !speciesLaunchHandler) ||
              (taskType === 'false-negatives' && !falseNegativesLaunchHandler) ||
              (taskType === 'qc-review' && !qcLaunchHandler) ||
              (taskType === 'info-tags' && !infoTagsLaunchHandler) ||
              (taskType === 'homographies' && !homographyLaunchHandler) ||
              (taskType === 'individual-id' && !individualIdLaunchHandler)
            }
            onClick={handleSubmit}
          >
            Launch
          </Button>
          <Button variant='dark' disabled={launching} onClick={onClose}>
            Close
          </Button>
        </Footer>
      </Body>
    </Modal>
  );
}
