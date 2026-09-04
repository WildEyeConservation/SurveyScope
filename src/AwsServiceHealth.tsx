import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { Check, Copy, RefreshCw } from 'lucide-react';
import {
  DeleteMessageBatchCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import {
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  type Cluster,
} from '@aws-sdk/client-ecs';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useSession } from './session';
import {
  appRegion as region,
  backendOutputs as backend,
  client,
} from './stores/appClient';
import type { Schema } from './amplify/client-schema';
import './AwsServiceHealth.css';

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

const formatCount = (value: MaybeNumber): string =>
  value === null || value === undefined ? '—' : value.toLocaleString();

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
  const user = useSession();
  const getSqsClient = user.getSqsClient;

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

  const contextsReady = Boolean(client && user && getSqsClient);

  const fetchEcsStatus = useCallback(async () => {
    setEcsState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const { credentials } = await fetchAuthSession();
      const ecsClient = new ECSClient({
        region,
        credentials,
      });

      const ourQueueUrls = new Set(
        Object.entries(backend.custom ?? {})
          .filter(
            ([key, value]) =>
              /queueurl$/i.test(key) &&
              typeof value === 'string' &&
              value.length > 0
          )
          .map(([, value]) => value as string)
      );

      const listClustersResp = await ecsClient.send(
        new ListClustersCommand({})
      );
      const clusterArns = (listClustersResp.clusterArns ?? []).filter(
        (arn): arn is string => Boolean(arn)
      );
      if (!clusterArns.length) {
        setEcsState({ clusters: [], isLoading: false, error: null });
        return;
      }

      const describeClustersResp = await ecsClient.send(
        new DescribeClustersCommand({ clusters: clusterArns })
      );
      const clusters = describeClustersResp.clusters ?? [];

      const summaryResults = await Promise.all(
        clusters.map(async (cluster): Promise<EcsClusterSummary | null> => {
          if (!cluster.clusterArn) return null;
          const services = await fetchClusterServices(
            ecsClient,
            cluster,
            ourQueueUrls
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
        })
      );
      const summaries = summaryResults.filter(
        (s): s is EcsClusterSummary => s !== null
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
  }, []);

  const systemQueues = useMemo<QueueDescriptor[]>(() => {
    const custom = backend.custom;
    if (!custom) {
      return [];
    }
    return Object.entries(custom)
      .filter(
        ([key, value]) =>
          /queueurl$/i.test(key) && typeof value === 'string' && value.length
      )
      .map(([key, value]) => ({
        id: `system-${key}`,
        label: formatSystemQueueLabel(key),
        url: value,
        scope: 'system' as const,
      }));
  }, []);

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
        selectionSet: [
          'id',
          'name',
          'tag',
          'url',
          'projectId',
          'project.name',
        ],
      });
      if (response?.data) {
        allQueues.push(...(response.data as QueueWithProject[]));
      }
      nextToken = response?.nextToken ?? undefined;
    } while (nextToken);
    return allQueues;
  }, []);

  const buildDlqSummary = useCallback(
    async (arn: string, sqsClient: SQSClient) => {
      const queueName = arn.split(':').pop() ?? arn;
      let url: string | undefined;
      try {
        const urlResult = await sqsClient.send(
          new GetQueueUrlCommand({ QueueName: queueName })
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
          })
        );
        return {
          arn: attributes.Attributes?.QueueArn ?? arn,
          name: queueName,
          url,
          available: parseNumberAttr(
            attributes.Attributes?.ApproximateNumberOfMessages
          ),
          inflight: parseNumberAttr(
            attributes.Attributes?.ApproximateNumberOfMessagesNotVisible
          ),
          delayed: parseNumberAttr(
            attributes.Attributes?.ApproximateNumberOfMessagesDelayed
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
    []
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
          arr.findIndex((d) => d.id === descriptor.id) === idx
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
              })
            );

            let dlqSummary: DlqSummary | undefined;
            const redrivePolicy = attributes.Attributes?.RedrivePolicy;
            if (redrivePolicy) {
              try {
                const parsed = JSON.parse(redrivePolicy);
                if (parsed.deadLetterTargetArn) {
                  dlqSummary = await buildDlqSummary(
                    parsed.deadLetterTargetArn,
                    sqsClient
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
                attributes.Attributes?.ApproximateNumberOfMessages
              ),
              inflight: parseNumberAttr(
                attributes.Attributes?.ApproximateNumberOfMessagesNotVisible
              ),
              delayed: parseNumberAttr(
                attributes.Attributes?.ApproximateNumberOfMessagesDelayed
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
        })
      );

      setRows(queueRows.sort((a, b) => a.label.localeCompare(b.label)));
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

  const groupedRows = useMemo(() => {
    return {
      project: rows.filter((row) => row.scope === 'project'),
      system: rows.filter((row) => row.scope === 'system'),
    };
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
              ? `Moved ${moved} message${moved === 1 ? '' : 's'} from ${row.label
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
    [fetchQueueHealth, getSqsClient, rowsById]
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
              ? `Moved ${moved} message${moved === 1 ? '' : 's'} from ${row.dlq.name
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
    [fetchQueueHealth, getSqsClient, rowsById]
  );

  if (!contextsReady) {
    return (
      <Alert variant='warning' className='mb-0'>
        Unable to load AWS service health because admin data has not been
        initialised.
      </Alert>
    );
  }

  return (
    <div className='aws-service-health' style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section>
        <SectionHeader
          title='Queue Health'
          subtitle='Monitor message backlog and dead-letter queues.'
          onRefresh={fetchQueueHealth}
          refreshing={isRefreshing}
        />
        {fetchError && (
          <Alert variant='danger'>
            Failed to refresh queue metrics: {fetchError}
          </Alert>
        )}
        {feedback && (
          <Alert
            variant={feedback.variant === 'success' ? 'success' : 'danger'}
            onClose={() => setFeedback(null)}
            dismissible
          >
            {feedback.message}
          </Alert>
        )}
        {!rows.length ? (
          <Alert variant='info'>No queues are currently configured.</Alert>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {groupedRows.system.length > 0 && (
              <QueueTable
                title='System Queues'
                rows={groupedRows.system}
                actionState={actionState}
                onDrain={handleDrainToDlq}
                onReplay={handleReplayFromDlq}
              />
            )}
            {groupedRows.project.length > 0 && (
              <QueueTable
                title='Project Queues'
                rows={groupedRows.project}
                actionState={actionState}
                onDrain={handleDrainToDlq}
                onReplay={handleReplayFromDlq}
                showProject
              />
            )}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          title='ECS Services'
          subtitle='Clusters and services currently running in ECS.'
          onRefresh={fetchEcsStatus}
          refreshing={ecsState.isLoading}
        />
        {ecsState.error && (
          <Alert variant='danger' className='mb-3'>
            {ecsState.error}
          </Alert>
        )}

        {ecsState.isLoading && !ecsState.clusters.length ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: 32,
            }}
          >
            <Spinner animation='border' />
          </div>
        ) : ecsState.clusters.length === 0 ? (
          <Alert variant='info'>No ECS clusters found.</Alert>
        ) : (
          <div className='ss-card' style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className='ss-data-table'>
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Desired</th>
                    <th style={{ textAlign: 'right' }}>Running</th>
                    <th style={{ textAlign: 'right' }}>Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {ecsState.clusters.flatMap((cluster) =>
                    cluster.services.map((service) => (
                      <tr key={service.serviceArn ?? `${cluster.clusterArn}-${service.name}`}>
                        <td>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <span style={{ fontWeight: 500 }}>
                              {shortName(cluster.name)}
                            </span>
                            <CopyButton
                              value={cluster.name}
                              title='Copy full cluster name'
                            />
                          </div>
                        </td>
                        <td>{service.status || '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {service.desiredCount ?? '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {service.runningCount ?? '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {service.pendingCount ?? '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  onRefresh,
  refreshing,
}: {
  title: string;
  subtitle: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 12,
        marginBottom: 12,
        flexWrap: 'wrap',
      }}
    >
      <div>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
        <div style={{ fontSize: 12, color: 'var(--ss-text-dim)' }}>
          {subtitle}
        </div>
      </div>
      <Button
        variant='link'
        size='sm'
        style={{
          padding: 0,
          color: 'var(--ss-text-muted)',
          display: 'flex',
          alignItems: 'center',
        }}
        onClick={onRefresh}
        disabled={refreshing}
        title='Refresh'
      >
        <RefreshCw size={14} className={refreshing ? 'spinning' : undefined} />
      </Button>
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
    <Button
      variant='link'
      size='sm'
      onClick={handleCopy}
      title={title}
      style={{
        padding: '0 4px',
        color: copied ? 'var(--ss-accent)' : 'var(--ss-text-muted)',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  );
}

function QueueTable({
  title,
  rows,
  actionState,
  onDrain,
  onReplay,
  showProject,
}: {
  title: string;
  rows: QueueHealthRow[];
  actionState: Record<string, 'drain' | 'replay' | undefined>;
  onDrain: (id: string) => void;
  onReplay: (id: string) => void;
  showProject?: boolean;
}) {
  return (
    <div>
      <h4
        style={{
          margin: 0,
          marginBottom: 8,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--ss-text)',
        }}
      >
        {title}
      </h4>
      <div className='ss-card' style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className='ss-data-table'>
            <thead>
              <tr>
                <th>Queue</th>
                {showProject && <th>Project</th>}
                <th style={{ textAlign: 'right' }}>Messages</th>
                <th style={{ textAlign: 'right' }}>In Flight</th>
                <th style={{ textAlign: 'right' }}>Delayed</th>
                <th>DLQ</th>
                <th style={{ textAlign: 'right' }}>DLQ Msgs</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const currentAction = actionState[row.id];
                const canDrain = !!row.dlq && !!row.arn;
                const canReplay =
                  !!row.dlq && !!row.arn && (row.dlq.available ?? 0) > 0;

                return (
                  <tr key={row.id}>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>{row.label}</span>
                        <CopyButton value={row.url} title='Copy queue URL' />
                      </div>
                      {row.error && (
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--ss-danger, #dc3545)',
                            marginTop: 2,
                          }}
                        >
                          {row.error}
                        </div>
                      )}
                    </td>
                    {showProject && (
                      <td>
                        {row.projectName ? (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <span style={{ fontSize: 13 }}>
                              {row.projectName}
                            </span>
                            <CopyButton
                              value={row.projectId}
                              title='Copy project ID'
                            />
                          </div>
                        ) : (
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--ss-text-dim)',
                            }}
                          >
                            —
                          </span>
                        )}
                      </td>
                    )}
                    <td style={{ textAlign: 'right' }}>
                      {formatCount(row.available)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {formatCount(row.inflight)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {formatCount(row.delayed)}
                    </td>
                    <td>
                      {row.dlq ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <span style={{ fontSize: 13 }}>
                            {shortName(row.dlq.name)}
                          </span>
                          <CopyButton
                            value={row.dlq.name}
                            title='Copy full DLQ name'
                          />
                        </div>
                      ) : (
                        <span
                          style={{
                            fontSize: 12,
                            color: 'var(--ss-text-dim)',
                          }}
                        >
                          None
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {row.dlq ? formatCount(row.dlq.available) : '—'}
                    </td>
                    <td>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          gap: 8,
                        }}
                      >
                        <Button
                          size='sm'
                          variant='outline-warning'
                          disabled={!canDrain || currentAction === 'replay'}
                          onClick={() => onDrain(row.id)}
                        >
                          {currentAction === 'drain' ? (
                            <Spinner animation='border' size='sm' />
                          ) : (
                            'Drain'
                          )}
                        </Button>
                        <Button
                          size='sm'
                          variant='outline-success'
                          disabled={!canReplay || currentAction === 'drain'}
                          onClick={() => onReplay(row.id)}
                        >
                          {currentAction === 'replay' ? (
                            <Spinner animation='border' size='sm' />
                          ) : (
                            'Replay'
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
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
      })
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
      })
    );

    const successIds = new Set(
      (sendResponse.Successful ?? []).map((s) => s.Id)
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
        })
      );
      moved += deleteEntries.length;
    }

    if ((sendResponse.Failed?.length ?? 0) > 0) {
      console.warn(
        `Encountered ${sendResponse.Failed?.length} failures while moving messages from ${sourceUrl} to ${destinationUrl}`
      );
    }
  }

  return moved;
}

async function fetchClusterServices(
  ecsClient: ECSClient,
  cluster: Cluster,
  ourQueueUrls: Set<string>
): Promise<EcsClusterSummary['services']> {
  if (!cluster.clusterArn) {
    return [];
  }
  const listServicesResp = await ecsClient.send(
    new ListServicesCommand({
      cluster: cluster.clusterArn,
    })
  );
  const serviceArns = listServicesResp.serviceArns ?? [];
  if (!serviceArns.length) {
    return [];
  }
  const describeServicesResp = await ecsClient.send(
    new DescribeServicesCommand({
      cluster: cluster.clusterArn,
      services: serviceArns,
    })
  );
  const services = describeServicesResp.services ?? [];

  const matches = await Promise.all(
    services.map(async (service) => {
      if (!service.taskDefinition) return null;
      try {
        const td = await ecsClient.send(
          new DescribeTaskDefinitionCommand({
            taskDefinition: service.taskDefinition,
          })
        );
        const containers = td.taskDefinition?.containerDefinitions ?? [];
        const usesOurQueue = containers.some((container) =>
          (container.environment ?? []).some(
            (envVar) => envVar.value && ourQueueUrls.has(envVar.value)
          )
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
    })
  );

  return matches.filter(
    (s): s is NonNullable<(typeof matches)[number]> => s !== null
  );
}

function extractName(arn: string): string {
  if (!arn) return 'Unknown';
  const parts = arn.split('/');
  return parts[parts.length - 1] || arn;
}
