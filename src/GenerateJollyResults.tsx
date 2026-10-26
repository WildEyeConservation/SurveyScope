import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { GlobalContext } from './Context.tsx';
import { useContext, useEffect, useMemo, useState } from 'react';
import Select from 'react-select';
import { fetchAllPaginatedResults } from './utils.tsx';
import { useNavigate } from 'react-router-dom';
import { readJollyStatus } from './storage/workflowFiles';

interface LaunchResponse {
  jobId: string;
  statusKey: string;
  reused?: boolean;
}

interface JollyJobStatus {
  jobId: string;
  status: string;
  phase: string;
  progress?: Record<string, number | string>;
  validation?: {
    excludedImages?: number;
    annotationsForExcludedImages?: number;
  };
  warnings?: string[];
  error?: string | null;
}

const terminalStatuses = new Set([
  'COMPLETED',
  'FAILED',
  'ROLLBACK_FAILED',
]);

function parseLaunchResponse(value: unknown): LaunchResponse {
  const parsed =
    typeof value === 'string' ? JSON.parse(value) : value;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as LaunchResponse).jobId !== 'string' ||
    typeof (parsed as LaunchResponse).statusKey !== 'string'
  ) {
    throw new Error('The server returned an invalid job response');
  }
  return parsed as LaunchResponse;
}

export default function GenerateJollyResults({
  surveyId,
  annotationSetId,
}: {
  surveyId: string;
  annotationSetId: string;
}) {
  const { client, modalToShow, showModal } =
    useContext(GlobalContext)!;
  const navigate = useNavigate();
  const [categoryOptions, setCategoryOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [selectedCategories, setSelectedCategories] = useState<
    { label: string; value: string }[]
  >([]);
  const [launching, setLaunching] = useState(false);
  const [activeJob, setActiveJob] =
    useState<LaunchResponse | null>(null);
  const [jobStatus, setJobStatus] =
    useState<JollyJobStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [pollWarning, setPollWarning] = useState('');
  const isOpen = modalToShow === 'generateJollyResults';

  useEffect(() => {
    let mounted = true;
    const fetchCategories = async () => {
      const categories = await fetchAllPaginatedResults(
        client.models.Category.categoriesByAnnotationSetId,
        { annotationSetId }
      );
      if (mounted) {
        setCategoryOptions(
          categories.map((category) => ({
            label: category.name,
            value: category.id,
          }))
        );
      }
    };
    void fetchCategories();
    return () => {
      mounted = false;
    };
  }, [annotationSetId, client]);

  // Polling is bound to the dialog being open. Closing it stops the poller and
  // suppresses the redirect, so a job finishing in the background can never yank
  // the user off whatever page they moved on to. `activeJob` is deliberately
  // kept, so reopening the dialog resumes tracking the same job without
  // relaunching it.
  useEffect(() => {
    if (!activeJob || !isOpen) return;
    let cancelled = false;
    let pollInFlight = false;
    let consecutiveFailures = 0;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled || pollInFlight) return;
      if (Date.now() - startedAt > 2 * 60 * 60 * 1000) {
        setActiveJob(null);
        setErrorMessage(
          'Status polling timed out. The job may still be running; click Generate again to reconnect to it.'
        );
        return;
      }
      pollInFlight = true;
      try {
        const status = await readJollyStatus<JollyJobStatus>(
          surveyId,
          annotationSetId,
          activeJob.jobId
        );
        if (cancelled) return;
        if (status.jobId !== activeJob.jobId) {
          throw new Error('The status artifact belongs to another job');
        }
        consecutiveFailures = 0;
        setPollWarning('');
        setJobStatus(status);
        if (!terminalStatuses.has(status.status)) return;

        setActiveJob(null);
        if (status.status === 'COMPLETED') {
          showModal(null);
          navigate(`/jolly/${surveyId}/${annotationSetId}`);
        } else {
          setErrorMessage(
            status.error ??
              'The results job failed. Check the worker logs for details.'
          );
        }
      } catch (error) {
        if (cancelled) return;
        console.warn('Unable to poll Jolly Results status', error);
        consecutiveFailures += 1;
        // The first status artifact takes a moment to appear, so tolerate a few
        // misses before telling the user we have lost contact.
        if (consecutiveFailures >= 10) {
          setPollWarning(
            'Cannot read the job status right now. The job is still running; this dialog will reconnect automatically.'
          );
        }
      } finally {
        pollInFlight = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    isOpen,
    activeJob,
    annotationSetId,
    navigate,
    showModal,
    surveyId,
  ]);

  const progressText = useMemo(() => {
    if (!jobStatus) {
      return activeJob?.reused
        ? 'Reconnected to the active results job'
        : 'Starting results job';
    }
    const details = Object.entries(jobStatus.progress ?? {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    const phase = jobStatus.phase.replace(/_/g, ' ');
    return details ? `${phase} (${details})` : phase;
  }, [activeJob?.reused, jobStatus]);

  async function generateJollyResults() {
    if (selectedCategories.length === 0) {
      setErrorMessage('Please select at least one label.');
      return;
    }
    setLaunching(true);
    setErrorMessage('');
    setPollWarning('');
    setJobStatus(null);
    try {
      const response = await client.mutations.generateSurveyResults({
        surveyId,
        annotationSetId,
        categoryIds: selectedCategories.map(
          (category) => category.value
        ),
      });
      if (response.errors?.length) {
        throw new Error(
          response.errors.map((error) => error.message).join('; ')
        );
      }
      setActiveJob(parseLaunchResponse(response.data));
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Unable to start the results job'
      );
    } finally {
      setLaunching(false);
    }
  }

  const running = launching || activeJob !== null;

  return (
    <Dialog
      open={modalToShow === 'generateJollyResults'}
      onOpenChange={(o) => !o && showModal(null)}
    >
      <DialogContent
        size='lg'
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Generate Jolly Results</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form>
            <div>
              <Label htmlFor='categories' className='mb-1'>
                Labels
              </Label>
              <span
                className='text-muted-foreground block mb-2'
                style={{ fontSize: '14px' }}
              >
                Select the labels to include in the Jolly results.
              </span>
              <Select
                isMulti
                isDisabled={running}
                options={categoryOptions}
                value={selectedCategories}
                onChange={(value) =>
                  setSelectedCategories([...value])
                }
                className='text-black'
              />
            </div>
          </form>

          {running && (
            <div className='mt-6'>
              <div className='flex items-center gap-2 mb-2'>
                <Spinner animation='border' size='sm' />
                <span>{progressText}</span>
              </div>
              <Progress animated value={100} />
            </div>
          )}

          {pollWarning && (
            <Alert variant='warning' className='mt-4 mb-0'>
              {pollWarning}
            </Alert>
          )}

          {jobStatus?.warnings?.length ? (
            <Alert variant='warning' className='mt-4 mb-0'>
              {jobStatus.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </Alert>
          ) : null}

          {errorMessage && (
            <Alert variant='danger' className='mt-4 mb-0'>
              {errorMessage}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant='primary'
            disabled={running}
            onClick={() => void generateJollyResults()}
          >
            {launching ? 'Starting...' : 'Generate'}
          </Button>
          <Button
            variant='dark'
            onClick={() => showModal(null)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
