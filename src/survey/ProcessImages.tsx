import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { CheckIcon, RefreshCwIcon } from 'lucide-react';
import { useCallback, useContext, useEffect, useState } from 'react';
import { GlobalContext } from '../Context';
import { Footer } from '../Modal';
import { parseLaunchResponse } from './launchResponse';
import {
  MODELS,
  dispatchBatches,
  findUnprocessedByModel,
  type ModelValue,
  type ScanImage,
} from './processImagesScan';
import { SectionTitle } from './SurveyStructure';

const MODEL_VALUES: ModelValue[] = ['owl-d', 'scoutbotv3', 'elephant', 'mad'];

const BATCH_SIZE = 500;
const DISPATCH_CONCURRENCY = 4;

export default function ProcessImages({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  const { client, backend, showModal } = useContext(GlobalContext)!;
  const [scan, setScan] = useState<{
    total: number;
    unprocessed: Record<string, ScanImage[]>;
  } | null>(null);
  const [imagesLoaded, setImagesLoaded] = useState(0);
  const [projectStatus, setProjectStatus] = useState<string | null>(null);
  const [scanKey, setScanKey] = useState(0);
  const [queueing, setQueueing] = useState<ModelValue | null>(null);
  const [error, setError] = useState<{
    model: ModelValue | null;
    message: string;
  } | null>(null);
  // Images were queued but the survey status update failed.
  const [statusPending, setStatusPending] = useState<ModelValue | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setScan(null);
    setImagesLoaded(0);
    // Only the scan reports errors without a model.
    setError((e) => (e?.model === null ? null : e));
    Promise.all([
      findUnprocessedByModel(client, projectId, MODEL_VALUES, {
        signal,
        onProgress: (count) => {
          if (!signal.aborted) setImagesLoaded(count);
        },
      }),
      client.models.Project.get(
        { id: projectId },
        { selectionSet: ['status'], signal },
      ),
    ])
      .then(([result, { data: project }]) => {
        if (signal.aborted) return;
        setScan(result);
        setProjectStatus(project?.status ?? null);
      })
      .catch((err) => {
        if (signal.aborted) return;
        console.error('Failed to scan images', err);
        setError({
          model: null,
          message: 'The images could not be checked. Refresh to try again.',
        });
      });
    return () => controller.abort();
  }, [client, projectId, scanKey]);

  const findLocationSetByName = useCallback(
    async (name: string) => {
      let nextToken: string | null | undefined = undefined;
      do {
        const res = await client.models.LocationSet.locationSetsByProjectId(
          {
            projectId,
            nextToken,
          } as {
            projectId: string;
            nextToken?: string | null;
          },
          {
            selectionSet: ['id', 'name'],
            limit: 10000,
          },
        );
        const match =
          res.data?.find((ls: { name?: string | null }) => ls?.name === name) ??
          null;
        if (match) {
          return match;
        }
        nextToken = res.nextToken as string | null | undefined;
      } while (nextToken);
      return null;
    },
    [client.models.LocationSet, projectId],
  );

  const dispatchImages = async (
    modelValue: ModelValue,
    images: ScanImage[],
  ) => {
    const config = MODELS[modelValue];
    const locationSetName = `${projectId}_${config.setSuffix}`;
    let locationSet = (await findLocationSetByName(locationSetName)) ?? null;
    if (!locationSet) {
      const { data: createdLocationSet } =
        await client.models.LocationSet.create({
          name: locationSetName,
          projectId: projectId,
          group: organizationId,
        });
      locationSet = createdLocationSet ?? null;
    }
    if (!locationSet?.id) {
      throw new Error('Failed to create location set');
    }
    const setId = locationSet.id;

    // Fetch project to determine organization and legacy handling
    const { data: project } = await client.models.Project.get(
      { id: projectId },
      { selectionSet: ['id', 'organizationId', 'tags'] as const },
    );
    if (!project) throw new Error('Failed to load survey');
    const projRecord = project as Record<string, unknown>;
    const projOrganizationId: string | undefined =
      typeof projRecord['organizationId'] === 'string'
        ? (projRecord['organizationId'] as string)
        : undefined;
    const tagsVal = projRecord['tags'];
    const isLegacyProject: boolean = Array.isArray(tagsVal)
      ? (tagsVal as unknown[]).some((t) => t === 'legacy')
      : false;

    const makeKey = (orig: string): string =>
      !isLegacyProject && projOrganizationId
        ? `${projOrganizationId}/${projectId}/${orig}`
        : orig;

    const bucket = backend.storage.buckets[1].bucket_name;
    const runBatch = (batchStrings: string[]) => {
      const args = { projectId, images: batchStrings, setId, bucket };
      switch (modelValue) {
        case 'scoutbotv3':
          return client.mutations.runScoutbot(
            { ...args, queueUrl: backend.custom.scoutbotTaskQueueUrl },
            { retry: false },
          );
        case 'elephant':
          return client.mutations.runElephantDetector(
            { ...args, queueUrl: backend.custom.elephantDetectorTaskQueueUrl },
            { retry: false },
          );
        case 'mad':
          return client.mutations.runMadDetector(
            { ...args, queueUrl: backend.custom.madDetectorTaskQueueUrl },
            { retry: false },
          );
        case 'owl-d':
          return client.mutations.runOwlDDetector(
            { ...args, queueUrl: backend.custom.owlDDetectorTaskQueueUrl },
            { retry: false },
          );
      }
    };

    const { queued, error: dispatchError } = await dispatchBatches(
      images,
      BATCH_SIZE,
      DISPATCH_CONCURRENCY,
      async (batch) =>
        parseLaunchResponse(
          await runBatch(
            batch.map(
              (image) => `${image.id}---${makeKey(image.originalPath)}`,
            ),
          ),
          `${config.label} dispatch failed`,
        ),
    );
    if (dispatchError) {
      throw new Error(
        `${dispatchError.message}. ${queued} of ${images.length} images were confirmed queued and others may be too; scan again once they finish to process the rest.`,
      );
    }
  };

  const processModel = async (model: ModelValue) => {
    if (!scan) return;
    const config = MODELS[model];
    setQueueing(model);
    setError(null);

    try {
      if (statusPending !== model) {
        await dispatchImages(model, scan.unprocessed[model]);
        setStatusPending(model);
      }

      const { errors } = await client.models.Project.update({
        id: projectId,
        status: config.status,
      });
      if (errors?.length) {
        throw new Error(
          `Images were queued but the survey status update failed: ${errors[0].message}`,
        );
      }
      setStatusPending(null);
      setProjectStatus(config.status);

      client.mutations.updateProjectMemberships({
        projectId: projectId,
      });
    } catch (err) {
      console.error('Failed to process images', err);
      setError({
        model,
        message:
          err instanceof Error
            ? err.message
            : 'Something went wrong, please try again.',
      });
    } finally {
      setQueueing(null);
    }
  };

  const processingModel = MODEL_VALUES.find(
    (model) => MODELS[model].status === projectStatus,
  );
  const busy = !!projectStatus?.startsWith('processing') || !!queueing;
  const otherWork =
    projectStatus?.startsWith('processing') && !processingModel
      ? projectStatus.replace(/^processing-?/, '') || 'processing'
      : null;

  return (
    <>
      <div className='flex flex-col gap-2 p-4'>
        <SectionTitle
          className='border-b-0 pb-0'
          action={
            <Button
              variant='link'
              size='sm'
              className='p-0 text-muted-foreground hover:text-foreground'
              disabled={(!scan && !error) || !!queueing}
              onClick={() => setScanKey((key) => key + 1)}
            >
              <RefreshCwIcon className='size-3.5' />
              Refresh
            </Button>
          }
        >
          Models
        </SectionTitle>
        {otherWork && (
          <div className='border border-warning bg-warning/15 px-4 py-2 text-sm'>
            This survey is busy with {otherWork}. Models can be processed once
            it finishes.
          </div>
        )}
        {error && !error.model && (
          <div className='border border-danger bg-danger/15 px-4 py-2 text-sm'>
            {error.message}
          </div>
        )}
        {!scan && !error ? (
          <div className='flex items-center gap-2 border border-white/15 bg-white/[0.07] px-4 py-3 text-muted-foreground'>
            <Spinner animation='border' size='sm' />
            Checking images
            {imagesLoaded > 0 && ` · ${imagesLoaded.toLocaleString()} loaded`}
            ...
          </div>
        ) : (
          scan && (
            <div className='border border-white/15 bg-white/[0.07]'>
              {MODEL_VALUES.map((model) => {
                const remaining = scan.unprocessed[model].length;
                const processed = scan.total - remaining;
                const percent = scan.total
                  ? Math.floor((processed / scan.total) * 100)
                  : 0;
                const isProcessing = processingModel === model;
                const isQueueing = queueing === model;
                const done = scan.total > 0 && remaining === 0;
                const retry = statusPending === model;
                return (
                  <div
                    key={model}
                    className='flex items-center gap-4 border-b border-white/[0.08] px-4 py-3 last:border-b-0'
                  >
                    <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                      <div className='flex items-center gap-2'>
                        <span className='truncate font-semibold'>
                          {MODELS[model].label}
                        </span>
                        {(isProcessing || (!done && processed > 0)) && (
                          <StatusChip
                            state={isProcessing ? 'processing' : 'partial'}
                          />
                        )}
                      </div>
                      <div className='h-1.5 bg-white/15'>
                        <div
                          className={cn(
                            'h-full transition-[width]',
                            done ? 'bg-success' : 'bg-primary',
                          )}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className='text-xs text-muted-foreground tabular-nums'>
                        {processed.toLocaleString()} of{' '}
                        {scan.total.toLocaleString()} images processed
                        {isProcessing && ' · counts update when you refresh'}
                      </span>
                      {error?.model === model && (
                        <span className='text-xs text-danger'>
                          {error.message}
                        </span>
                      )}
                    </div>
                    <div className='flex min-w-44 shrink-0 justify-end'>
                      {done && !retry ? (
                        <span className='inline-flex items-center gap-1 text-sm text-success'>
                          <CheckIcon className='size-4' />
                          All processed
                        </span>
                      ) : (
                        <Button
                          variant={retry ? 'warning' : 'primary'}
                          disabled={(busy && !retry) || !!queueing}
                          title={
                            busy && !isQueueing
                              ? 'Only one model can process at a time'
                              : undefined
                          }
                          onClick={() => processModel(model)}
                        >
                          {isQueueing ? (
                            <>
                              <Spinner animation='border' size='sm' />
                              Queueing...
                            </>
                          ) : retry ? (
                            'Retry status update'
                          ) : (
                            `Process ${remaining.toLocaleString()} image${
                              remaining === 1 ? '' : 's'
                            }`
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
      <Footer>
        <Button
          variant='ghost'
          className='mr-auto'
          onClick={() => showModal(null)}
          disabled={!!queueing}
        >
          Close
        </Button>
      </Footer>
    </>
  );
}

function StatusChip({ state }: { state: 'processing' | 'partial' }) {
  const { label, className } = {
    processing: {
      label: 'Processing',
      className: 'border-primary text-primary',
    },
    partial: {
      label: 'Partly processed',
      className: 'border-warning text-warning',
    },
  }[state];
  return (
    <span className={cn('border px-1.5 text-[11px] leading-5', className)}>
      {state === 'processing' && (
        <span className='mr-1 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle' />
      )}
      {label}
    </span>
  );
}
