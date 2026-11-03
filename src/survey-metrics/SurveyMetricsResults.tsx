import SharedTable, { type DataColumn } from '@/components/DataTable';
import { Alert, type AlertVariant } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import {
  HOMOGRAPHY_BUCKETS,
  UNSCORED,
  type AnnotationSummary,
  type ChainLinkSummary,
  type ChainStateCounts,
  type ConfidenceCoverage,
  type Counts,
  type DetectionSummary,
  type HomographyBucket,
  type HomographyCounts,
  type HomographySummary,
  type ObservationSummary,
  type ProcessedBySummary,
  type SetHomographySummary,
} from './collectors';
import { DETECTORS, detectorLabel } from './loaders';
import type {
  OverviewResult,
  SetLaunchesResult,
  StatId,
  StatOutcome,
  StatResults,
  SurveyReport,
} from './report';
import { STATS } from './report';
import type { QueueRow } from './types';

type Cell = ReactNode;

const BUCKET_LABELS: Record<HomographyBucket, string> = {
  homography: 'Usable homography',
  malformed: 'Malformed homography',
  skipped: 'Skipped',
  failed: 'Registration failed',
  suggestedPointsOnly: 'Suggested points only',
  processedNoHomography: 'Processed, no homography',
  unprocessed: 'Unprocessed',
};

const count = (value: number | null | undefined) =>
  value === null || value === undefined ? 'N/A' : value.toLocaleString();

const percent = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined
    ? 'N/A'
    : `${(value * 100).toFixed(digits)}%`;

const bandRange = (label: string, width: number) =>
  label === UNSCORED
    ? label
    : `${label}–${Math.min(Number(label) + width, 1).toFixed(2)}`;

const share = (part: number, whole: number) =>
  whole > 0 ? percent(part / whole) : 'N/A';

function date(value: string | null | undefined): string {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

type Row = { id: string; cells: Cell[] };
type SortRow = { getValue: (columnId: string) => unknown };

const NUMERIC = /^-?[\d,]+(\.\d+)?%?$/;

function sortValue(cell: Cell): string | number {
  if (typeof cell === 'number') return cell;
  if (typeof cell !== 'string') return '';
  return NUMERIC.test(cell) ? Number(cell.replace(/[,%]/g, '')) : cell;
}

function DataTable({
  head,
  rows,
  numericFrom = 1,
}: {
  head: string[];
  rows: Cell[][];
  numericFrom?: number;
}) {
  const columns: DataColumn<Row>[] = head.map((title, index) => ({
    id: String(index),
    header: title,
    accessorFn: (row) => sortValue(row.cells[index]),
    cell: ({ row }) => row.original.cells[index],
    sortingFn: (a: SortRow, b: SortRow) => {
      const x = a.getValue(String(index));
      const y = b.getValue(String(index));
      return typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true });
    },
    meta: {
      className:
        index >= numericFrom ? 'text-right tabular-nums whitespace-nowrap' : '',
    },
  }));
  return (
    <SharedTable
      storageKey='survey-metrics'
      columns={columns}
      data={rows.map((cells, index) => ({ id: String(index), cells }))}
      getRowId={(row) => row.id}
      pageSize={rows.length > 25 ? 25 : false}
    />
  );
}

function Facts({ items }: { items: [string, Cell][] }) {
  return (
    <div className='grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2'>
      {items.map(([label, value]) => (
        <div
          key={label}
          className='border border-white/10 bg-black/10 px-3 py-2'
        >
          <div className='text-xs text-muted-foreground'>{label}</div>
          <div className='text-lg font-semibold [overflow-wrap:anywhere] tabular-nums'>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function Subheading({ children }: { children: ReactNode }) {
  return (
    <h6 className='mt-2 mb-0 text-sm font-semibold tracking-wide text-muted-foreground uppercase'>
      {children}
    </h6>
  );
}

function countsRows(
  counts: Counts,
  label: (key: string) => string = (key) => key,
): Cell[][] {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => [label(key), count(value), share(value, total)]);
}

function bucketRows(counts: HomographyCounts): Cell[][] {
  const total = HOMOGRAPHY_BUCKETS.reduce((sum, key) => sum + counts[key], 0);
  return HOMOGRAPHY_BUCKETS.map((key) => [
    BUCKET_LABELS[key],
    count(counts[key]),
    share(counts[key], total),
  ]);
}

function stateRows(sets: [string, ChainStateCounts][]): Cell[][] {
  return sets.map(([label, states]) => [
    label,
    count(states.primary),
    count(states.secondary),
    count(states.unlinked),
  ]);
}

function QueueTable({ queues }: { queues: QueueRow[] }) {
  return (
    <DataTable
      head={[
        'Queue',
        'Tag',
        'Confidence threshold',
        'Launched',
        'Observed',
        'Requeues',
        'Last observation',
      ]}
      numericFrom={2}
      rows={queues.map((queue) => [
        queue.name,
        queue.tag ?? '',
        queue.confidenceThreshold ?? 'N/A',
        count(queue.launchedCount),
        count(queue.observedCount),
        count(queue.requeuesCompleted),
        date(queue.lastObservationAt),
      ])}
    />
  );
}

function Overview({ data }: { data: OverviewResult }) {
  return (
    <>
      <Facts
        items={[
          ['Survey', data.project.name],
          ['Status', data.project.status ?? 'N/A'],
          ['Created', date(data.project.createdAt)],
          ['Survey id', <code>{data.project.id}</code>],
        ]}
      />
      <Subheading>Image sets</Subheading>
      <DataTable
        head={['Name', 'Images']}
        rows={data.imageSets.map((set) => [set.name, count(set.imageCount)])}
      />
      <Subheading>Annotation sets</Subheading>
      <DataTable
        head={['Name', 'Created']}
        numericFrom={2}
        rows={data.annotationSets.map((set) => [set.name, date(set.createdAt)])}
      />
      <Subheading>Location sets</Subheading>
      <DataTable
        head={['Name', 'Description', 'Created', 'Locations']}
        numericFrom={3}
        rows={data.locationSets.map((set) => [
          set.name,
          set.description ?? '',
          date(set.createdAt),
          count(set.locationCount),
        ])}
      />
      <Subheading>Queues</Subheading>
      <QueueTable queues={data.queues} />
    </>
  );
}

function ScannedSources() {
  return (
    <div className='text-sm text-muted-foreground'>
      Covers location sources starting with{' '}
      {DETECTORS.map((detector) => detector.prefix).join(', ')}.
    </div>
  );
}

function DetectionModels({ data }: { data: ProcessedBySummary }) {
  return (
    <>
      <Facts
        items={[['Images in survey (stored counter)', count(data.totalImages)]]}
      />
      <DataTable
        head={['Model', 'Images processed', 'Share of survey']}
        rows={data.sources.map((source) => [
          detectorLabel(source.source),
          count(source.images),
          percent(source.share),
        ])}
      />
    </>
  );
}

function DetectorOutput({ data }: { data: DetectionSummary }) {
  return (
    <>
      <Facts items={[['Images in survey', count(data.totalImages)]]} />
      <ScannedSources />
      <DataTable
        head={[
          'Model',
          'Detections',
          'Images with detections',
          'Images marked empty',
          'Images not processed',
          'Empty-marker rows',
          'Marker and detection',
        ]}
        rows={data.sources.map((source) => [
          detectorLabel(source.source),
          count(source.detectionRows),
          count(source.imagesWithDetections),
          count(source.imagesWithoutDetections),
          count(source.imagesNotProcessed),
          count(source.markerRows),
          count(source.imagesWithBothMarkerAndDetection),
        ])}
      />
      {data.sources.map((source) => (
        <div key={source.source} className='flex flex-col gap-3'>
          <Subheading>
            {detectorLabel(source.source)} confidence (bands of{' '}
            {source.bandWidth})
          </Subheading>
          <DataTable
            head={['Confidence band', 'Detections', 'Share']}
            rows={Object.entries(source.confidence)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([band, value]) => [
                bandRange(band, source.bandWidth),
                count(value),
                share(value, source.detectionRows),
              ])}
          />
        </div>
      ))}
    </>
  );
}

function Homographies({ data }: { data: HomographySummary }) {
  const registration = data.registration;
  return (
    <>
      <Facts
        items={[
          ['Image pairs', count(data.pairs)],
          ['Coverage (usable / not skipped)', percent(data.coverage)],
          [
            'Pairs with a registration timestamp',
            percent(data.registrationTimestampShare),
          ],
          ['Images', count(data.graph.images)],
          ['Images without any pair', count(data.graph.imagesWithoutPairs)],
          ['Pairs pointing outside the survey', count(data.pairsOutsideSurvey)],
        ]}
      />
      <Subheading>Registration outcome</Subheading>
      <DataTable
        head={['Outcome', 'Pairs', 'Share']}
        rows={bucketRows(data.counts)}
      />
      <Subheading>Homography source</Subheading>
      <DataTable
        head={['Source', 'Pairs', 'Share']}
        rows={countsRows(data.bySource)}
      />
      <Subheading>Camera pairs</Subheading>
      <DataTable
        head={[
          'Camera pair',
          'Pairs',
          'Usable',
          'Coverage',
          'Failed',
          'Unprocessed',
          'Skipped',
        ]}
        rows={Object.entries(data.byCameraPair).map(([pair, counts]) => {
          const total = HOMOGRAPHY_BUCKETS.reduce(
            (sum, key) => sum + counts[key],
            0,
          );
          return [
            pair,
            count(total),
            count(counts.homography),
            share(counts.homography, total - counts.skipped),
            count(counts.failed),
            count(counts.unprocessed),
            count(counts.skipped),
          ];
        })}
      />
      <Subheading>Pair graph</Subheading>
      <Facts
        items={[
          ['Chains (ignoring homographies)', count(data.graph.chains)],
          ['Components linked by homographies', count(data.graph.components)],
          [
            'Largest linked component (images)',
            count(data.graph.largestComponent),
          ],
        ]}
      />
      {registration && (
        <>
          <Subheading>Registration counters</Subheading>
          <Facts
            items={[
              ['Pairs created', count(registration.pairsCreated)],
              ['Pairs processed', count(registration.pairsProcessed)],
              ['Pending', count(registration.pendingCount)],
              ['Cleanup state', registration.cleanupState ?? 'N/A'],
              ['Last kickoff', date(registration.lastKickoffAt)],
              ['Last change', date(registration.lastChangeAt)],
              [
                'Counter matches pairs read',
                registration.countersMatchPairs ? 'Yes' : 'No',
              ],
              ['Bucket successes', count(registration.bucketSuccessTotal)],
            ]}
          />
        </>
      )}
    </>
  );
}

function SetLaunches({ data }: { data: SetLaunchesResult }) {
  return (
    <>
      <Subheading>Location sets launched</Subheading>
      <DataTable
        head={['Location set', 'Launched']}
        numericFrom={2}
        rows={data.locationSets.map((set) => [set.name, date(set.launchedAt)])}
      />
      <Subheading>Queues</Subheading>
      <QueueTable queues={data.queues} />
    </>
  );
}

function Annotations({
  data,
  userName,
}: {
  data: AnnotationSummary;
  userName: (owner: string) => string;
}) {
  return (
    <>
      <Facts
        items={[
          ['Annotations', count(data.total)],
          ['Images annotated', count(data.imagesAnnotated)],
          ['Primary', count(data.byState.primary)],
          ['Secondary', count(data.byState.secondary)],
          ['Unlinked', count(data.byState.unlinked)],
          ['Obscured', count(data.obscured)],
          ['Out of view', count(data.outOfView)],
          ['Reviewed', count(data.reviewed)],
          ['Info tagged', count(data.infoTagged)],
          ['First created', date(data.firstCreatedAt)],
          ['Last created', date(data.lastCreatedAt)],
        ]}
      />
      <Subheading>Source</Subheading>
      <DataTable
        head={['Source', 'Annotations', 'Share']}
        rows={countsRows(data.bySource)}
      />
      <Subheading>Category</Subheading>
      <DataTable
        head={['Category', 'Annotations', 'Primary']}
        rows={data.byCategory.map((category) => [
          category.name,
          count(category.count),
          count(category.primary),
        ])}
      />
      <Subheading>Annotator</Subheading>
      <DataTable
        head={['Annotator', 'Annotations', 'Share']}
        rows={countsRows(data.byOwner, userName)}
      />
    </>
  );
}

function Observations({
  data,
  userName,
}: {
  data: ObservationSummary;
  userName: (owner: string) => string;
}) {
  return (
    <>
      <Facts
        items={[
          ['Observations', count(data.total)],
          ['Locations observed', count(data.locationsObserved)],
          ['First', date(data.firstCreatedAt)],
          ['Last', date(data.lastCreatedAt)],
        ]}
      />
      <Subheading>Source</Subheading>
      <DataTable
        head={['Source', 'Observations', 'Share']}
        rows={countsRows(data.bySource)}
      />
      <Subheading>Reviewer</Subheading>
      <DataTable
        head={['Reviewer', 'Observations', 'Share']}
        rows={countsRows(data.byOwner, userName)}
      />
    </>
  );
}

function ConfidenceCoverageView({ data }: { data: ConfidenceCoverage }) {
  return (
    <>
      <Facts
        items={[
          [
            'Observed locations that are not model detections',
            count(data.observedOutsideDetections),
          ],
        ]}
      />
      {data.sources.map((source) => (
        <div key={source.source} className='flex flex-col gap-3'>
          <Subheading>
            {detectorLabel(source.source)} (bands of {source.bandWidth})
          </Subheading>
          <Facts
            items={[
              ['Detections', count(source.totals.locations)],
              [
                'Observed',
                share(source.totals.observed, source.totals.locations),
              ],
              [
                'Holding an annotation',
                share(source.totals.annotated, source.totals.locations),
              ],
              [
                'Lowest band observed',
                source.lowestObservedBand
                  ? bandRange(source.lowestObservedBand, source.bandWidth)
                  : 'None',
              ],
            ]}
          />
          <DataTable
            head={[
              'Confidence band',
              'Detections',
              'Observed',
              'Observed share',
              'Annotated',
              'Annotated share',
              'Observed and annotated',
            ]}
            rows={source.labels
              .filter((label) => source.bands[label].locations > 0)
              .map((label) => {
                const band = source.bands[label];
                return [
                  bandRange(label, source.bandWidth),
                  count(band.locations),
                  count(band.observed),
                  share(band.observed, band.locations),
                  count(band.annotated),
                  share(band.annotated, band.locations),
                  count(band.observedAndAnnotated),
                ];
              })}
          />
        </div>
      ))}
      {data.sources.length === 0 && (
        <div className='text-sm text-muted-foreground'>
          No model detections in this survey.
        </div>
      )}
      <ScannedSources />
    </>
  );
}

function SetHomographies({ data }: { data: SetHomographySummary }) {
  return (
    <>
      <Facts
        items={[
          ['Images annotated', count(data.annotatedImages)],
          [
            'Pairs touching an annotated image',
            count(data.pairsWithAnnotations),
          ],
          ['Coverage (usable / not skipped)', percent(data.coverage)],
        ]}
      />
      <DataTable
        head={['Outcome', 'Pairs', 'Share']}
        rows={bucketRows(data.counts)}
      />
    </>
  );
}

const RECOMMENDATIONS: Record<
  ChainLinkSummary['verdict']['recommendation'],
  { label: string; variant: AlertVariant }
> = {
  'run-chain-linker': { label: 'Run Chain Linker', variant: 'warning' },
  skip: { label: 'No chain linking needed', variant: 'success' },
  'investigate-coverage': { label: 'Investigate coverage', variant: 'warning' },
  unknown: { label: 'Not enough data', variant: 'secondary' },
};

function ChainLinking({ data }: { data: ChainLinkSummary }) {
  const recommendation = RECOMMENDATIONS[data.verdict.recommendation];
  return (
    <>
      <Alert variant={recommendation.variant} className='mb-0'>
        <strong>{recommendation.label}.</strong> {data.verdict.reason}
      </Alert>
      <Facts
        items={[
          ['Overlap annotations', count(data.overlapAnnotations)],
          ['Linked to earlier image', count(data.linked)],
          ['Duplicated (unlinked match)', count(data.duplicated)],
          ['Nothing nearby in earlier image', count(data.absentFromEarlier)],
          ['Duplication rate', percent(data.duplicationRate)],
          ['Absent rate', percent(data.absentRate)],
          ['Match radius (px)', data.matchRadius],
        ]}
      />
      <Subheading>Pairs</Subheading>
      <DataTable
        head={['Outcome', 'Pairs']}
        rows={[
          ['Assessed', count(data.pairsAssessed)],
          [
            'No annotations in the overlap',
            count(data.pairsNoOverlapAnnotations),
          ],
          ['No usable homography', count(data.pairsNoHomography)],
          ['Skipped', count(data.pairsSkipped)],
          ['Missing image size', count(data.pairsMissingImageMetadata)],
          ['Cannot order the two images', count(data.pairsUnordered)],
        ]}
      />
      <Subheading>Annotations by chain state</Subheading>
      <DataTable
        head={['Annotations', 'Primary', 'Secondary', 'Unlinked']}
        rows={stateRows([
          ['Whole set', data.setByState],
          ['In an overlap', data.overlapByState],
          ['Outside every overlap', data.nonOverlapByState],
          ['Overlap, nothing nearby in earlier image', data.absentByState],
        ])}
      />
    </>
  );
}

function StatBody({
  outcome,
  userName,
}: {
  outcome: StatOutcome;
  userName: (owner: string) => string;
}) {
  const data = outcome.data as StatResults[StatId];
  switch (outcome.id) {
    case 'overview':
      return <Overview data={data as StatResults['overview']} />;
    case 'detectionModels':
      return <DetectionModels data={data as StatResults['detectionModels']} />;
    case 'detectorOutput':
      return <DetectorOutput data={data as StatResults['detectorOutput']} />;
    case 'homographies':
      return <Homographies data={data as StatResults['homographies']} />;
    case 'setLaunches':
      return <SetLaunches data={data as StatResults['setLaunches']} />;
    case 'annotations':
      return (
        <Annotations
          data={data as StatResults['annotations']}
          userName={userName}
        />
      );
    case 'observations':
      return (
        <Observations
          data={data as StatResults['observations']}
          userName={userName}
        />
      );
    case 'confidenceCoverage':
      return (
        <ConfidenceCoverageView
          data={data as StatResults['confidenceCoverage']}
        />
      );
    case 'setHomographies':
      return <SetHomographies data={data as StatResults['setHomographies']} />;
    case 'chainLinking':
      return <ChainLinking data={data as StatResults['chainLinking']} />;
  }
}

export default function SurveyMetricsResults({
  report,
  userName,
  summary,
}: {
  report: SurveyReport;
  userName: (owner: string) => string;
  summary: string;
}) {
  const outcomes = STATS.flatMap((stat) => {
    const outcome = report.stats[stat.id] as StatOutcome | undefined;
    return outcome ? [outcome] : [];
  });
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='mr-2 text-sm text-muted-foreground'>{summary}.</span>
        {outcomes.length > 1 &&
          outcomes.map((outcome) => (
            <a
              key={outcome.id}
              href={`#survey-metric-result-${outcome.id}`}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-sm no-underline transition-colors hover:bg-white/10',
                outcome.status === 'error'
                  ? 'border-danger/70 text-danger'
                  : 'border-white/30 text-foreground',
              )}
            >
              {outcome.label}
            </a>
          ))}
      </div>
      {outcomes.map((outcome) => (
        <Card
          key={outcome.id}
          id={`survey-metric-result-${outcome.id}`}
          className='scroll-mt-4'
        >
          <CardHeader className='py-3'>
            <div className='font-semibold'>{outcome.label}</div>
          </CardHeader>
          <CardContent className='flex flex-col gap-3'>
            {outcome.status === 'error' ? (
              <Alert variant='danger' className='mb-0'>
                {outcome.error}
              </Alert>
            ) : (
              <StatBody outcome={outcome} userName={userName} />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
