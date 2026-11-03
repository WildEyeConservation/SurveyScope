import DataTable, { type DataColumn } from '@/components/DataTable';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  type Cluster,
} from '@aws-sdk/client-ecs';
import {
  DeleteMessageBatchCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { fetchAuthSession } from 'aws-amplify/auth';
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Cog,
  Copy,
  Inbox,
  RefreshCw,
  RotateCcw,
  SearchIcon,
  SearchX,
  Server,
  type LucideIcon,
} from 'lucide-react';
import { DateTime } from 'luxon';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { GlobalContext, UserContext } from './Context';
import type { Schema } from './amplify/client-schema';

type MaybeNumber = number | null;

type DlqSummary = {
  arn: string;
  name: string;
  url?: string;
  available: MaybeNumber;
  inflight: MaybeNumber;
  delayed: MaybeNumber;
};

type EcsClusterSummary = {
  clusterArn: string;
  name: string;
  status?: string;
  runningTasksCount?: number;
  pendingTasksCount?: number;
  activeServicesCount?: number;
  services: {
    serviceArn?: string;
    name?: string;
    status?: string;
    desiredCount?: number;
    runningCount?: number;
    pendingCount?: number;
  }[];
};

type QueueDescriptor = {
  id: string;
  label: string;
  url?: string | null;
  scope: 'project' | 'system';
  projectId?: string | null;
  projectName?: string | null;
};

type QueueHealthRow = {
  id: string;
  label: string;
  url?: string | null;
  arn?: string;
  available: MaybeNumber;
  inflight: MaybeNumber;
  delayed: MaybeNumber;
  dlq?: DlqSummary;
  error?: string | null;
  scope: QueueDescriptor['scope'];
  projectId?: string | null;
  projectName?: string | null;
};

const NUMBER_ATTRIBUTES = [
  'ApproximateNumberOfMessages',
  'ApproximateNumberOfMessagesNotVisible',
  'ApproximateNumberOfMessagesDelayed',
] as const;

const parseNumberAttr = (value?: string): number => {
  const parsed = parseInt(value ?? '0', 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const SHORT_NAME_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/lightglue/i, 'Lightglue'],
  [/stormfly/i, 'Stormfly'],
  [/owl.?d/i, 'OWL-D'],
  [/elephant/i, 'Elephant Detector'],
  [/scoutbot/i, 'Scoutbot'],
  [/mad/i, 'MAD'],
  [/gpu/i, 'Lightglue'],
];

const shortName = (full?: string | null): string => {
  if (!full) return '—';
  for (const [pattern, label] of SHORT_NAME_PATTERNS) {
    if (pattern.test(full)) return label;
  }
  return full;
};

const formatSystemQueueLabel = (key: string): string => {
  const withoutSuffix = key.replace(/QueueUrl$/i, '');
  const spaced = withoutSuffix
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export default function AwsServiceHealth() {
  const user = useContext(UserContext);
  const global = useContext(GlobalContext);

  const client = global?.client;
  const getSqsClient = user?.getSqsClient;

  const [rows, setRows] = useState<QueueHealthRow[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    variant: 'success' | 'danger';
    message: string;
  } | null>(null);
  const [actionState, setActionState] = useState<
    Record<string, 'drain' | 'replay' | undefined>
  >({});
  const [ecsState, setEcsState] = useState<{
    clusters: EcsClusterSummary[];
    isLoading: boolean;
    error: string | null;
  }>({
    clusters: [],
    isLoading: false,
    error: null,
  });

  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [confirming, setConfirming] = useState<{
    row: QueueHealthRow;
    direction: 'drain' | 'replay';
  } | null>(null);
  // Re-render so the "Updated … ago" label stays current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(timer);
  }, []);

  const contextsReady = Boolean(client && user && getSqsClient);

  const fetchEcsStatus = useCallback(async () => {
    if (!global?.region) return;
    setEcsState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const { credentials } = await fetchAuthSession();
      const ecsClient = new ECSClient({
        region: global.region,
        credentials,
      });

      const ourQueueUrls = new Set(
        Object.entries(global?.backend?.custom ?? {})
          .filter(
            ([key, value]) =>
              /queueurl$/i.test(key) &&
              typeof value === 'string' &&
              value.length > 0,
          )
          .map(([, value]) => value as string),
      );

      const listClustersResp = await ecsClient.send(
        new ListClustersCommand({}),
      );
      const clusterArns = (listClustersResp.clusterArns ?? []).filter(
        (arn): arn is string => Boolean(arn),
      );
      if (!clusterArns.length) {
        setEcsState({ clusters: [], isLoading: false, error: null });
        return;
      }

      const describeClustersResp = await ecsClient.send(
        new DescribeClustersCommand({ clusters: clusterArns }),
      );
      const clusters = describeClustersResp.clusters ?? [];

      const summaryResults = await Promise.all(
        clusters.map(async (cluster): Promise<EcsClusterSummary | null> => {
          if (!cluster.clusterArn) return null;
          const services = await fetchClusterServices(
            ecsClient,
            cluster,
            ourQueueUrls,
          );
          if (!services.length) return null;
          return {
            clusterArn: cluster.clusterArn,
            name: extractName(cluster.clusterArn),
            status: cluster.status,
            runningTasksCount: cluster.runningTasksCount,
            pendingTasksCount: cluster.pendingTasksCount,
            activeServicesCount: services.length,
            services,
          };
        }),
      );
      const summaries = summaryResults.filter(
        (s): s is EcsClusterSummary => s !== null,
      );

      setEcsState({ clusters: summaries, isLoading: false, error: null });
    } catch (err) {
      console.error('Failed to fetch ECS status', err);
      setEcsState({
        clusters: [],
        isLoading: false,
        error: err instanceof Error ? err.message : 'Unable to load ECS data.',
      });
    }
  }, [global?.region, global?.backend?.custom]);

  const systemQueues = useMemo<QueueDescriptor[]>(() => {
    const custom = global?.backend?.custom;
    if (!custom) {
      return [];
    }
    return Object.entries(custom)
      .filter(
        ([key, value]) =>
          /queueurl$/i.test(key) && typeof value === 'string' && value.length,
      )
      .map(([key, value]) => ({
        id: `system-${key}`,
        label: formatSystemQueueLabel(key),
        url: value,
        scope: 'system' as const,
      }));
  }, [global?.backend?.custom]);

  type QueueWithProject = Schema['Queue']['type'] & {
    project?: { name?: string | null } | null;
  };

  const listAllQueues = useCallback(async () => {
    if (!client) {
      return [];
    }
    let nextToken: string | undefined;
    const allQueues: QueueWithProject[] = [];
    do {
      const response = await client.models.Queue.list({
        limit: 200,
        nextToken,
        selectionSet: ['id', 'name', 'tag', 'url', 'projectId', 'project.name'],
      });
      if (response?.data) {
        allQueues.push(...(response.data as QueueWithProject[]));
      }
      nextToken = response?.nextToken ?? undefined;
    } while (nextToken);
    return allQueues;
  }, [client]);

  const buildDlqSummary = useCallback(
    async (arn: string, sqsClient: SQSClient) => {
      const queueName = arn.split(':').pop() ?? arn;
      let url: string | undefined;
      try {
        const urlResult = await sqsClient.send(
          new GetQueueUrlCommand({ QueueName: queueName }),
        );
        url = urlResult.QueueUrl;
      } catch (error) {
        console.error('Unable to resolve DLQ URL', { arn, error });
      }

      if (!url) {
        return {
          arn,
          name: queueName,
          available: null,
          inflight: null,
          delayed: null,
        };
      }

      try {
        const attributes = await sqsClient.send(
          new GetQueueAttributesCommand({
            QueueUrl: url,
            AttributeNames: [...NUMBER_ATTRIBUTES, 'QueueArn'],
          }),
        );
        return {
          arn: attributes.Attributes?.QueueArn ?? arn,
          name: queueName,
          url,
          available: parseNumberAttr(
            attributes.Attributes?.ApproximateNumberOfMessages,
          ),
          inflight: parseNumberAttr(
            attributes.Attributes?.ApproximateNumberOfMessagesNotVisible,
          ),
          delayed: parseNumberAttr(
            attributes.Attributes?.ApproximateNumberOfMessagesDelayed,
          ),
        };
      } catch (error) {
        console.error('Unable to describe DLQ attributes', { arn, error });
        return {
          arn,
          name: queueName,
          url,
          available: null,
          inflight: null,
          delayed: null,
        };
      }
    },
    [],
  );

  const fetchQueueHealth = useCallback(async () => {
    if (!contextsReady || !getSqsClient || !client) {
      return;
    }

    setIsRefreshing(true);
    setFetchError(null);

    try {
      const [queues, sqsClient] = await Promise.all([
        listAllQueues(),
        getSqsClient(),
      ]);

      const descriptors: QueueDescriptor[] = [
        ...queues.map((queue) => ({
          id: queue.id,
          label: queue.tag || queue.name,
          url: queue.url,
          scope: 'project' as const,
          projectId: queue.projectId ?? null,
          projectName: queue.project?.name || queue.projectId || null,
        })),
        ...systemQueues,
      ];

      const uniqueDescriptors = descriptors.filter(
        (descriptor, idx, arr) =>
          arr.findIndex((d) => d.id === descriptor.id) === idx,
      );

      if (!uniqueDescriptors.length) {
        setRows([]);
        return;
      }

      const queueRows = await Promise.all(
        uniqueDescriptors.map(async (descriptor): Promise<QueueHealthRow> => {
          if (!descriptor.url) {
            return {
              id: descriptor.id,
              label: descriptor.label,
              url: descriptor.url,
              scope: descriptor.scope,
              projectId: descriptor.projectId,
              projectName: descriptor.projectName,
              available: null,
              inflight: null,
              delayed: null,
              error: 'Queue does not have an SQS URL configured.',
            };
          }

          try {
            const attributes = await sqsClient.send(
              new GetQueueAttributesCommand({
                QueueUrl: descriptor.url,
                AttributeNames: [
                  ...NUMBER_ATTRIBUTES,
                  'RedrivePolicy',
                  'QueueArn',
                ],
              }),
            );

            let dlqSummary: DlqSummary | undefined;
            const redrivePolicy = attributes.Attributes?.RedrivePolicy;
            if (redrivePolicy) {
              try {
                const parsed = JSON.parse(redrivePolicy);
                if (parsed.deadLetterTargetArn) {
                  dlqSummary = await buildDlqSummary(
                    parsed.deadLetterTargetArn,
                    sqsClient,
                  );
                }
              } catch (error) {
                console.error('Unable to parse redrive policy', {
                  queueId: descriptor.id,
                  redrivePolicy,
                  error,
                });
              }
            }

            return {
              id: descriptor.id,
              label: descriptor.label,
              url: descriptor.url,
              arn: attributes.Attributes?.QueueArn ?? undefined,
              available: parseNumberAttr(
                attributes.Attributes?.ApproximateNumberOfMessages,
              ),
              inflight: parseNumberAttr(
                attributes.Attributes?.ApproximateNumberOfMessagesNotVisible,
              ),
              delayed: parseNumberAttr(
                attributes.Attributes?.ApproximateNumberOfMessagesDelayed,
              ),
              dlq: dlqSummary,
              scope: descriptor.scope,
              projectId: descriptor.projectId,
              projectName: descriptor.projectName,
            };
          } catch (error) {
            console.error('Unable to describe queue attributes', {
              queueId: descriptor.id,
              error,
            });
            const message =
              error instanceof Error ? error.message : 'Unknown error';
            return {
              id: descriptor.id,
              label: descriptor.label,
              url: descriptor.url,
              available: null,
              inflight: null,
              delayed: null,
              error: message,
              scope: descriptor.scope,
              projectId: descriptor.projectId,
              projectName: descriptor.projectName,
            };
          }
        }),
      );

      setRows(queueRows.sort((a, b) => a.label.localeCompare(b.label)));
      setLastRefreshed(new Date());
    } catch (error) {
      console.error('Failed to refresh queue health', error);
      const message =
        error instanceof Error ? error.message : 'Unable to refresh queues.';
      setFetchError(message);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    buildDlqSummary,
    client,
    contextsReady,
    getSqsClient,
    listAllQueues,
    systemQueues,
  ]);

  useEffect(() => {
    fetchQueueHealth();
    const interval = setInterval(fetchQueueHealth, 60000);
    return () => clearInterval(interval);
  }, [fetchQueueHealth]);

  useEffect(() => {
    fetchEcsStatus();
    const interval = setInterval(fetchEcsStatus, 120000);
    return () => clearInterval(interval);
  }, [fetchEcsStatus]);

  const rowsById = useMemo(() => {
    return rows.reduce<Record<string, QueueHealthRow>>((acc, row) => {
      acc[row.id] = row;
      return acc;
    }, {});
  }, [rows]);

  const handleDrainToDlq = useCallback(
    async (queueId: string) => {
      const row = rowsById[queueId];
      if (!row?.url || !row.dlq?.url || !getSqsClient) {
        setFeedback({
          variant: 'danger',
          message: 'Queue or DLQ URL is missing.',
        });
        return;
      }

      setActionState((prev) => ({ ...prev, [queueId]: 'drain' }));
      setFeedback(null);
      try {
        const sqsClient = await getSqsClient();
        const moved = await moveMessages({
          sqsClient,
          sourceUrl: row.url,
          destinationUrl: row.dlq.url,
          direction: 'drain',
        });
        setFeedback({
          variant: 'success',
          message:
            moved > 0
              ? `Moved ${moved} message${moved === 1 ? '' : 's'} from ${
                  row.label
                } to ${row.dlq.name}.`
              : `No messages found in ${row.label}.`,
        });
        await fetchQueueHealth();
      } catch (error) {
        console.error('Unable to drain queue', { queueId, error });
        const message =
          error instanceof Error ? error.message : 'Unable to drain queue.';
        setFeedback({ variant: 'danger', message });
      } finally {
        setActionState((prev) => ({ ...prev, [queueId]: undefined }));
      }
    },
    [fetchQueueHealth, getSqsClient, rowsById],
  );

  const handleReplayFromDlq = useCallback(
    async (queueId: string) => {
      const row = rowsById[queueId];
      if (!row?.url || !row.dlq?.url || !getSqsClient) {
        setFeedback({
          variant: 'danger',
          message: 'Queue or DLQ URL is missing.',
        });
        return;
      }

      setActionState((prev) => ({ ...prev, [queueId]: 'replay' }));
      setFeedback(null);
      try {
        const sqsClient = await getSqsClient();
        const moved = await moveMessages({
          sqsClient,
          sourceUrl: row.dlq.url,
          destinationUrl: row.url,
          direction: 'replay',
        });
        setFeedback({
          variant: 'success',
          message:
            moved > 0
              ? `Moved ${moved} message${moved === 1 ? '' : 's'} from ${
                  row.dlq.name
                } back to ${row.label}.`
              : `No messages found in ${row.dlq.name}.`,
        });
        await fetchQueueHealth();
      } catch (error) {
        console.error('Unable to replay DLQ', { queueId, error });
        const message =
          error instanceof Error ? error.message : 'Unable to replay DLQ.';
        setFeedback({ variant: 'danger', message });
      } finally {
        setActionState((prev) => ({ ...prev, [queueId]: undefined }));
      }
    },
    [fetchQueueHealth, getSqsClient, rowsById],
  );

  const totals = useMemo(() => {
    const sum = (
      pick: (row: QueueHealthRow) => MaybeNumber | undefined,
      scope?: QueueDescriptor['scope'],
    ) =>
      rows
        .filter((row) => !scope || row.scope === scope)
        .reduce((total, row) => total + (pick(row) ?? 0), 0);
    const scopeTotals = (scope: QueueDescriptor['scope']) => ({
      queued: sum((row) => row.available, scope),
      inflight: sum((row) => row.inflight, scope),
      queues: rows.filter((row) => row.scope === scope).length,
    });
    const services = ecsState.clusters.flatMap((cluster) => cluster.services);
    return {
      system: scopeTotals('system'),
      survey: scopeTotals('project'),
      deadLetters: sum((row) => row.dlq?.available),
      queuesWithDeadLetters: rows.filter((row) => (row.dlq?.available ?? 0) > 0)
        .length,
      errors: rows.filter((row) => row.error).length,
      services: services.length,
      servicesBusy: services.filter(
        (service) => (service.runningCount ?? 0) > 0,
      ).length,
      servicesUnhealthy: services.filter(
        (service) =>
          (service.runningCount ?? 0) < (service.desiredCount ?? 0) ||
          (service.pendingCount ?? 0) > 0,
      ).length,
    };
  }, [rows, ecsState.clusters]);

  if (!contextsReady) {
    return (
      <Alert variant='warning' className='mb-0'>
        Unable to load AWS service health because admin data has not been
        initialised.
      </Alert>
    );
  }

  const refreshing = isRefreshing || ecsState.isLoading;

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h5 className='mb-0'>AWS Health</h5>
        <div className='flex flex-wrap items-center gap-3'>
          {lastRefreshed && (
            <span className='text-sm text-muted-foreground'>
              Updated {DateTime.fromJSDate(lastRefreshed).toRelative()},
              refreshes every minute
            </span>
          )}
          <Button
            variant='outline-primary'
            disabled={refreshing}
            onClick={() => {
              void fetchQueueHealth();
              void fetchEcsStatus();
            }}
          >
            <RefreshCw size={16} className={cn(refreshing && 'animate-spin')} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <SummaryTile
          icon={Cog}
          label='System messages'
          value={totals.system.queued}
          detail={`${totals.system.inflight.toLocaleString()} in flight across ${totals.system.queues} queues`}
        />
        <SummaryTile
          icon={Inbox}
          label='Survey messages'
          value={totals.survey.queued}
          detail={`${totals.survey.inflight.toLocaleString()} in flight across ${totals.survey.queues} queues`}
        />
        <SummaryTile
          icon={AlertTriangle}
          label='Dead letters'
          value={totals.deadLetters}
          tone={totals.deadLetters > 0 ? 'danger' : undefined}
          detail={
            totals.queuesWithDeadLetters
              ? `In ${totals.queuesWithDeadLetters} queue${
                  totals.queuesWithDeadLetters === 1 ? '' : 's'
                }`
              : 'All clear'
          }
        />
        <SummaryTile
          icon={Server}
          label='ECS services'
          value={totals.services}
          tone={totals.servicesUnhealthy > 0 ? 'warning' : undefined}
          detail={
            totals.servicesUnhealthy
              ? `${totals.servicesUnhealthy} below desired count`
              : `${totals.servicesBusy} with tasks running`
          }
        />
      </div>

      {fetchError && (
        <Alert variant='danger' className='mb-0'>
          Failed to refresh queue metrics: {fetchError}
        </Alert>
      )}
      {feedback && (
        <Alert
          variant={feedback.variant}
          onClose={() => setFeedback(null)}
          className='mb-0'
        >
          {feedback.message}
        </Alert>
      )}

      <QueuesCard
        rows={rows}
        loading={isRefreshing && !rows.length}
        actionState={actionState}
        onDrain={(row) => setConfirming({ row, direction: 'drain' })}
        onReplay={(row) => setConfirming({ row, direction: 'replay' })}
      />

      <ServicesCard
        clusters={ecsState.clusters}
        loading={ecsState.isLoading && !ecsState.clusters.length}
        error={ecsState.error}
      />

      <MoveDialog
        confirming={confirming}
        onClose={() => setConfirming(null)}
        onConfirm={(row, direction) => {
          setConfirming(null);
          void (direction === 'drain'
            ? handleDrainToDlq(row.id)
            : handleReplayFromDlq(row.id));
        }}
      />
    </div>
  );
}

function SummaryTile(props: {
  icon: LucideIcon;
  label: string;
  value: number;
  detail: string;
  tone?: 'danger' | 'warning';
}) {
  const Icon = props.icon;
  return (
    <div
      className={cn(
        'flex flex-col gap-1 border bg-card p-4',
        props.tone === 'danger'
          ? 'border-danger/70'
          : props.tone === 'warning'
            ? 'border-warning/70'
            : 'border-border-subtle',
      )}
    >
      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
        <Icon size={16} />
        {props.label}
      </div>
      <div
        className={cn(
          'text-3xl leading-tight font-medium tabular-nums',
          props.tone === 'danger' && 'text-danger',
          props.tone === 'warning' && 'text-warning',
        )}
      >
        {props.value.toLocaleString()}
      </div>
      <div className='text-sm text-muted-foreground'>{props.detail}</div>
    </div>
  );
}

function CopyButton({
  value,
  title = 'Copy',
}: {
  value?: string | null;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };
  return (
    <button
      type='button'
      onClick={handleCopy}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex shrink-0 items-center p-0.5 transition-colors',
        copied ? 'text-primary' : 'text-muted-foreground hover:text-white',
      )}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

const countCell = (value: MaybeNumber | undefined) =>
  value === null || value === undefined ? (
    <span className='text-muted-foreground'>—</span>
  ) : value === 0 ? (
    <span className='text-muted-foreground'>0</span>
  ) : (
    value.toLocaleString()
  );

const numberMeta = { className: 'text-right tabular-nums whitespace-nowrap' };

const isIdle = (row: QueueHealthRow) =>
  !row.error &&
  row.available === 0 &&
  row.inflight === 0 &&
  row.delayed === 0 &&
  (!row.dlq || row.dlq.available === 0);

type QueueScope = QueueDescriptor['scope'];

function QueuesCard(props: {
  rows: QueueHealthRow[];
  loading: boolean;
  actionState: Record<string, 'drain' | 'replay' | undefined>;
  onDrain: (row: QueueHealthRow) => void;
  onReplay: (row: QueueHealthRow) => void;
}) {
  const [scope, setScope] = useState<QueueScope>('system');
  const [search, setSearch] = useState('');
  // Survey queues are mostly idle; system queues are few enough to show all.
  const [hideIdleByScope, setHideIdleByScope] = useState<
    Record<QueueScope, boolean>
  >({ system: false, project: true });
  const hideIdle = hideIdleByScope[scope];
  const setHideIdle = (value: boolean) =>
    setHideIdleByScope((previous) => ({ ...previous, [scope]: value }));

  const query = search.trim().toLowerCase();
  const visible = props.rows.filter(
    (row) =>
      row.scope === scope &&
      (!hideIdle || !isIdle(row)) &&
      (!query ||
        row.label.toLowerCase().includes(query) ||
        (row.projectName ?? '').toLowerCase().includes(query) ||
        (row.dlq?.name ?? '').toLowerCase().includes(query)),
  );
  const idleCount = props.rows.filter(
    (row) => row.scope === scope && isIdle(row),
  ).length;

  const columns: DataColumn<QueueHealthRow>[] = [
    {
      id: 'queue',
      header: 'Queue',
      accessorFn: (row) => row.label,
      cell: ({ row: { original: row } }) => (
        <div className='min-w-40'>
          <div className='flex items-center gap-1'>
            <span className='font-medium'>{row.label}</span>
            <CopyButton value={row.url} title='Copy queue URL' />
          </div>
          {row.error && <div className='text-sm text-danger'>{row.error}</div>}
        </div>
      ),
    },
    {
      id: 'survey',
      header: 'Survey',
      accessorFn: (row) =>
        row.scope === 'system' ? '' : (row.projectName ?? ''),
      cell: ({ row: { original: row } }) =>
        row.scope === 'system' ? (
          <span className='rounded-full bg-white/15 px-2 py-0.5 text-sm'>
            System
          </span>
        ) : row.projectName ? (
          <span className='flex items-center gap-1'>
            {row.projectName}
            <CopyButton value={row.projectId} title='Copy survey ID' />
          </span>
        ) : (
          <span className='text-muted-foreground'>—</span>
        ),
    },
    {
      id: 'available',
      header: 'Messages',
      accessorFn: (row) => row.available ?? -1,
      cell: ({ row }) => countCell(row.original.available),
      meta: numberMeta,
    },
    {
      id: 'inflight',
      header: 'In flight',
      accessorFn: (row) => row.inflight ?? -1,
      cell: ({ row }) => countCell(row.original.inflight),
      meta: numberMeta,
    },
    {
      id: 'delayed',
      header: 'Delayed',
      accessorFn: (row) => row.delayed ?? -1,
      cell: ({ row }) => countCell(row.original.delayed),
      meta: numberMeta,
    },
    {
      id: 'dlq',
      header: 'Dead letters',
      accessorFn: (row) => row.dlq?.available ?? -1,
      cell: ({ row: { original: row } }) =>
        !row.dlq ? (
          <span className='text-muted-foreground'>No DLQ</span>
        ) : (
          <span className='inline-flex items-center justify-end gap-1'>
            <span
              title={row.dlq.name}
              className={cn(
                (row.dlq.available ?? 0) > 0 &&
                  'rounded-full bg-danger/20 px-2 py-0.5 text-danger',
              )}
            >
              {countCell(row.dlq.available)}
            </span>
            <CopyButton value={row.dlq.name} title='Copy DLQ name' />
          </span>
        ),
      meta: numberMeta,
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: row } }) => {
        const current = props.actionState[row.id];
        const canMove = !!row.dlq && !!row.arn;
        return (
          <div className='flex justify-end gap-2'>
            <Button
              variant='outline-warning'
              title='Move every message in this queue to its DLQ'
              disabled={!canMove || !!current}
              onClick={() => props.onDrain(row)}
            >
              {current === 'drain' ? (
                <Spinner animation='border' size='sm' />
              ) : (
                <ArrowDownToLine size={16} />
              )}
              Drain
            </Button>
            <Button
              variant='outline-success'
              title='Move every message in the DLQ back to this queue'
              disabled={
                !canMove || !!current || (row.dlq?.available ?? 0) === 0
              }
              onClick={() => props.onReplay(row)}
            >
              {current === 'replay' ? (
                <Spinner animation='border' size='sm' />
              ) : (
                <RotateCcw size={16} />
              )}
              Replay
            </Button>
          </div>
        );
      },
      meta: { className: 'w-px' },
    },
  ];

  const filtered = !!query;
  return (
    <Card>
      <CardHeader className='flex flex-wrap items-center justify-between gap-2 py-3'>
        <div className='font-semibold'>Queues</div>
        <div
          role='radiogroup'
          aria-label='Queue type'
          className='inline-flex border border-white/30'
        >
          {(
            [
              ['system', 'System'],
              ['project', 'Survey'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type='button'
              role='radio'
              aria-checked={scope === value}
              onClick={() => setScope(value)}
              className={cn(
                'px-3 py-1.5 text-base leading-normal transition-colors',
                scope === value ? 'bg-primary text-white' : 'hover:bg-white/10',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <div className='relative min-w-72 flex-1'>
            <SearchIcon className='pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-[#6c757d]' />
            <Input
              type='search'
              aria-label='Search queues'
              placeholder='Queue, survey or DLQ name…'
              className='pl-9'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className='flex h-[38px] cursor-pointer items-center gap-2 px-2'>
            <Switch checked={hideIdle} onCheckedChange={setHideIdle} />
            Hide empty queues
            {idleCount > 0 && (
              <span className='text-muted-foreground'>({idleCount})</span>
            )}
          </label>
        </div>
        <DataTable
          key={scope}
          columns={
            scope === 'system'
              ? columns.filter((column) => column.id !== 'survey')
              : columns
          }
          data={visible}
          getRowId={(row) => row.id}
          pageSize={25}
          initialSorting={[{ id: 'dlq', desc: true }]}
          loading={props.loading}
          loadingMessage='Loading queues…'
          emptyIcon={filtered ? SearchX : CheckCircle2}
          emptyMessage={
            filtered
              ? 'No queues match these filters'
              : hideIdle
                ? 'Every queue is empty'
                : 'No queues are configured'
          }
        />
      </CardContent>
    </Card>
  );
}

type ServiceRow = EcsClusterSummary['services'][number] & {
  id: string;
  clusterName: string;
};

function ServicesCard(props: {
  clusters: EcsClusterSummary[];
  loading: boolean;
  error: string | null;
}) {
  const services: ServiceRow[] = props.clusters.flatMap((cluster) =>
    cluster.services.map((service) => ({
      ...service,
      id: service.serviceArn ?? `${cluster.clusterArn}-${service.name}`,
      clusterName: cluster.name,
    })),
  );

  const columns: DataColumn<ServiceRow>[] = [
    {
      id: 'service',
      header: 'Service',
      accessorFn: (row) => shortName(row.clusterName),
      cell: ({ row: { original: row } }) => (
        <span className='flex items-center gap-1'>
          <span className='font-medium'>{shortName(row.clusterName)}</span>
          <CopyButton value={row.clusterName} title='Copy full cluster name' />
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (row) => row.status ?? '',
      cell: ({ row: { original: row } }) => {
        const short = (row.runningCount ?? 0) < (row.desiredCount ?? 0);
        const label = short
          ? 'Scaling up'
          : row.runningCount
            ? 'Running'
            : 'Idle';
        return (
          <span
            title={row.status}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-sm',
              short
                ? 'bg-warning/20 text-warning'
                : row.runningCount
                  ? 'bg-success/20 text-success'
                  : 'bg-white/15',
            )}
          >
            {label}
          </span>
        );
      },
    },
    {
      id: 'desired',
      header: 'Desired',
      accessorFn: (row) => row.desiredCount ?? -1,
      cell: ({ row }) => countCell(row.original.desiredCount ?? null),
      meta: numberMeta,
    },
    {
      id: 'running',
      header: 'Running',
      accessorFn: (row) => row.runningCount ?? -1,
      cell: ({ row }) => countCell(row.original.runningCount ?? null),
      meta: numberMeta,
    },
    {
      id: 'pending',
      header: 'Pending',
      accessorFn: (row) => row.pendingCount ?? -1,
      cell: ({ row }) => countCell(row.original.pendingCount ?? null),
      meta: numberMeta,
    },
  ];

  return (
    <Card>
      <CardHeader className='py-3'>
        <div className='font-semibold'>ECS services</div>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {props.error && (
          <Alert variant='danger' className='mb-0'>
            {props.error}
          </Alert>
        )}
        <DataTable
          columns={columns}
          data={services}
          getRowId={(row) => row.id}
          pageSize={false}
          initialSorting={[{ id: 'service', desc: false }]}
          loading={props.loading}
          loadingMessage='Loading ECS services…'
          emptyIcon={Server}
          emptyMessage='No ECS services found'
        />
      </CardContent>
    </Card>
  );
}

function MoveDialog(props: {
  confirming: { row: QueueHealthRow; direction: 'drain' | 'replay' } | null;
  onClose: () => void;
  onConfirm: (row: QueueHealthRow, direction: 'drain' | 'replay') => void;
}) {
  const row = props.confirming?.row;
  const drain = props.confirming?.direction === 'drain';
  const count = drain ? (row?.available ?? 0) : (row?.dlq?.available ?? 0);
  return (
    <Dialog
      open={!!props.confirming}
      onOpenChange={(o) => !o && props.onClose()}
    >
      <DialogContent>
        <DialogHeader closeButton>
          <DialogTitle>
            {drain ? 'Drain queue to DLQ' : 'Replay dead letters'}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          {drain ? (
            <>
              Move every message in <strong>{row?.label}</strong> (about{' '}
              {count.toLocaleString()}) to its dead-letter queue? Workers stop
              receiving them until they are replayed.
            </>
          ) : (
            <>
              Move every message in the dead-letter queue (about{' '}
              {count.toLocaleString()}) back to <strong>{row?.label}</strong> so
              workers pick them up again?
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant='ghost' className='mr-auto' onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant={drain ? 'warning' : 'success'}
            onClick={() =>
              row && props.onConfirm(row, props.confirming!.direction)
            }
          >
            {drain ? 'Drain' : 'Replay'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function moveMessages({
  sqsClient,
  sourceUrl,
  destinationUrl,
  direction,
}: {
  sqsClient: SQSClient;
  sourceUrl: string;
  destinationUrl: string;
  direction: 'drain' | 'replay';
}) {
  const fifo = destinationUrl.endsWith('.fifo');
  let moved = 0;
  let idlePolls = 0;

  while (idlePolls < 3) {
    const receive = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: sourceUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 2,
        MessageAttributeNames: ['All'],
        AttributeNames: ['All'],
        VisibilityTimeout: 30,
      }),
    );

    const messages = receive.Messages ?? [];
    if (!messages.length) {
      idlePolls += 1;
      continue;
    }
    idlePolls = 0;

    const entries = messages.map((message, index) => {
      const baseId = message.MessageId || `${Date.now()}-${index}`;
      return {
        Id: baseId.slice(0, 80),
        MessageBody: message.Body ?? '',
        MessageAttributes: message.MessageAttributes,
        ...(fifo
          ? {
              MessageGroupId: direction === 'drain' ? 'drain' : 'replay',
              MessageDeduplicationId:
                `${baseId}-${direction}-${Date.now()}`.slice(0, 128),
            }
          : {}),
      };
    });

    const sendResponse = await sqsClient.send(
      new SendMessageBatchCommand({
        QueueUrl: destinationUrl,
        Entries: entries,
      }),
    );

    const successIds = new Set(
      (sendResponse.Successful ?? []).map((s) => s.Id),
    );
    const deleteEntries = messages
      .map((message, index) => ({
        Id: entries[index].Id,
        ReceiptHandle: message.ReceiptHandle!,
      }))
      .filter((entry) => successIds.has(entry.Id));

    if (deleteEntries.length) {
      await sqsClient.send(
        new DeleteMessageBatchCommand({
          QueueUrl: sourceUrl,
          Entries: deleteEntries,
        }),
      );
      moved += deleteEntries.length;
    }

    if ((sendResponse.Failed?.length ?? 0) > 0) {
      console.warn(
        `Encountered ${sendResponse.Failed?.length} failures while moving messages from ${sourceUrl} to ${destinationUrl}`,
      );
    }
  }

  return moved;
}

async function fetchClusterServices(
  ecsClient: ECSClient,
  cluster: Cluster,
  ourQueueUrls: Set<string>,
): Promise<EcsClusterSummary['services']> {
  if (!cluster.clusterArn) {
    return [];
  }
  const listServicesResp = await ecsClient.send(
    new ListServicesCommand({
      cluster: cluster.clusterArn,
    }),
  );
  const serviceArns = listServicesResp.serviceArns ?? [];
  if (!serviceArns.length) {
    return [];
  }
  const describeServicesResp = await ecsClient.send(
    new DescribeServicesCommand({
      cluster: cluster.clusterArn,
      services: serviceArns,
    }),
  );
  const services = describeServicesResp.services ?? [];

  const matches = await Promise.all(
    services.map(async (service) => {
      if (!service.taskDefinition) return null;
      try {
        const td = await ecsClient.send(
          new DescribeTaskDefinitionCommand({
            taskDefinition: service.taskDefinition,
          }),
        );
        const containers = td.taskDefinition?.containerDefinitions ?? [];
        const usesOurQueue = containers.some((container) =>
          (container.environment ?? []).some(
            (envVar) => envVar.value && ourQueueUrls.has(envVar.value),
          ),
        );
        if (!usesOurQueue) return null;
      } catch (err) {
        console.error('Failed to describe task definition', {
          taskDefinition: service.taskDefinition,
          err,
        });
        return null;
      }
      return {
        serviceArn: service.serviceArn,
        name: service.serviceName,
        status: service.status,
        desiredCount: service.desiredCount,
        runningCount: service.runningCount,
        pendingCount: service.pendingCount,
      };
    }),
  );

  return matches.filter(
    (s): s is NonNullable<(typeof matches)[number]> => s !== null,
  );
}

function extractName(arn: string): string {
  if (!arn) return 'Unknown';
  const parts = arn.split('/');
  return parts[parts.length - 1] || arn;
}
