import { cellRows, columnsFromHeadings } from '@/components/cellColumns';
import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { cn } from '@/lib/utils';
import exportFromJSON from 'export-from-json';
import { X } from 'lucide-react';
import { DateTime } from 'luxon';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { neutraliseCsvRows } from '../shared/csv';
import { Schema } from './amplify/client-schema';
import { useUsers } from './apiInterface';
import { GlobalContext, UserContext } from './Context.tsx';
import DensityMap from './DensityMap.tsx';
import { CollapsedSidebar, SidebarCollapseButton } from './SidebarCollapse';
import { Tab, Tabs } from './Tabs';
import { useOptimisticUpdates } from './useOptimisticUpdates.tsx';
import { useSidebarCollapsed } from './useSidebarCollapsed';
import { fetchAllPaginatedResults } from './utils.tsx';
import { createToken, verifyToken } from './utils/jwt';
// @ts-ignore
import * as jStat from 'jstat';
import { useNavigate } from 'react-router-dom';

// New links are off until link creation moves to the backend.
const SHARING_AVAILABLE = false;
const LINK_DURATIONS = [
  { label: '1 day', days: 1 },
  { label: '1 week', days: 7 },
  { label: '4 weeks', days: 28 },
];

export default function JollyResults() {
  const { surveyId, annotationSetId } = useParams() as {
    surveyId: string;
    annotationSetId: string;
  };
  const { client } = useContext(GlobalContext)!;
  const { myMembershipHook: myProjectsHook, user: authUser } =
    useContext(UserContext)!;
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'map' | 'estimates'>('map');
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();
  const [results, setResults] = useState<
    (Schema['JollyResult']['type'] & { stratumName?: string })[]
  >([]);
  const [surveyName, setSurveyName] = useState('');
  const [annotationSetName, setAnnotationSetName] = useState('');
  const [resultsMemberships, setResultsMemberships] = useState<
    Schema['JollyResultsMembership']['type'][]
  >([]);
  const [categoryOptions, setCategoryOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [selectedCategories, setSelectedCategories] = useState<
    { label: string; value: string }[]
  >([]);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [tokenExpiry, setTokenExpiry] = useState<Date | null>(null);
  const [expiration, setExpiration] = useState(
    DateTime.now().plus({ days: 1 }).toMillis(),
  );
  const [isCopying, setIsCopying] = useState(false);
  const [linkDays, setLinkDays] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [tableHoveredStratumId, setTableHoveredStratumId] = useState<
    string | null
  >(null);
  const [mapHoveredStratumId, setMapHoveredStratumId] = useState<string | null>(
    null,
  );
  const { users } = useUsers();
  const adminProjects = myProjectsHook.data?.filter((p) => p.isAdmin);
  const isProjectAdmin = adminProjects?.some((p) => p.projectId === surveyId);
  const navigate = useNavigate();

  const subscriptionFilter = useMemo(
    () => ({
      filter: {
        surveyId: { eq: surveyId },
        annotationSetId: { eq: annotationSetId },
      },
    }),
    [surveyId, annotationSetId],
  );

  const sharedResultsHook = useOptimisticUpdates<
    Schema['JollyResultsMembership']['type'],
    'JollyResultsMembership'
  >(
    'JollyResultsMembership',
    async (_nextToken) => {
      const result = await client.models.JollyResultsMembership.list({
        filter: {
          surveyId: { eq: surveyId },
          annotationSetId: { eq: annotationSetId },
        },
      });
      return { data: result.data, nextToken: result.nextToken ?? undefined };
    },
    subscriptionFilter,
  );

  useEffect(() => {
    if (sharedResultsHook.data) {
      setResultsMemberships(sharedResultsHook.data);
    }
  }, [sharedResultsHook.data]);

  async function handleShare() {
    if (
      expiration < DateTime.now().toMillis() ||
      expiration > DateTime.now().plus({ months: 1 }).toMillis()
    ) {
      alert('Expiration must be in the future and less than 1 month from now');
      return;
    }

    setIsCopying(true);

    //if token is still valid, copy link
    if (tokenExpiry && tokenExpiry > DateTime.now().toJSDate()) {
      handleCopyLink(currentToken!);
      setIsCopying(false);
      return;
    }

    //if token exists and is not valid, delete it
    if (currentToken) {
      await client.models.ResultSharingToken.delete({
        surveyId,
        annotationSetId,
      });
    }

    const payload = {
      type: 'jolly',
      surveyId,
      annotationSetId,
    };

    const { data: secret } = await client.mutations.getJwtSecret();

    if (!secret) {
      alert('Error generating link');
      return;
    }

    const token = await createToken(
      payload,
      DateTime.fromMillis(expiration).toJSDate(),
      secret,
    );

    const { data: surveyProject } = await client.models.Project.get({
      id: surveyId,
    });
    await client.models.ResultSharingToken.create({
      surveyId,
      annotationSetId,
      jwt: token,
      group: surveyProject?.organizationId,
    });

    setCurrentToken(token);
    setTokenExpiry(DateTime.fromMillis(expiration).toJSDate());

    handleCopyLink(token);
    setIsCopying(false);
  }

  async function handleCopyLink(token: string) {
    const windowUrl = new URL(window.location.href);
    const url = `${windowUrl.origin}?t=${token}`;

    // First, attempt to use the native share API if available
    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch (error) {
        console.error(error);
      }
    }
    // Fallback: copy the link to the clipboard
    try {
      await navigator.clipboard.writeText(url);
      console.log('Link copied to clipboard');
    } catch (err) {
      console.error('Failed to copy link to clipboard', err);
    }
  }

  const removeResultsMembership = useCallback(
    async (userId: string) => {
      await client.models.JollyResultsMembership.delete({
        surveyId,
        annotationSetId,
        userId,
      });
      setResultsMemberships((prev) => prev.filter((m) => m.userId !== userId));
    },
    [client, surveyId, annotationSetId],
  );

  // Names live in the rows so they refresh once users have loaded.
  const sharedRows = useMemo(
    () =>
      resultsMemberships.map((m) => ({
        ...m,
        name: users?.find((u) => u.id === m.userId)?.name || 'New user',
      })),
    [resultsMemberships, users],
  );

  const sharedColumns = useMemo<DataColumn<(typeof sharedRows)[number]>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Shared with',
        meta: { className: 'max-w-64 truncate' },
      },
      {
        id: 'remove',
        header: () => resultsMemberships.length,
        enableSorting: false,
        meta: { className: 'w-12 text-right' },
        cell: ({ row }) => (
          <button
            type='button'
            aria-label='Remove access'
            title='Remove access'
            onClick={() => removeResultsMembership(row.original.userId)}
            className='ml-auto flex size-7 flex-none items-center justify-center text-muted-foreground hover:text-danger'
          >
            <X className='size-4' />
          </button>
        ),
      },
    ],
    [resultsMemberships.length, removeResultsMembership],
  );

  async function exportResultsAsCSV() {
    setExporting(true);

    const annotations: Schema['Annotation']['type'][] = [];

    for (const categoryId of categoryOptions.map((c) => c.value)) {
      const annotationsForCategory = await fetchAllPaginatedResults(
        client.models.Annotation.annotationsByCategoryId,
        {
          categoryId,
          selectionSet: ['source'],
          limit: 10000,
        },
      );

      annotations.push(...annotationsForCategory);
    }

    //count false negatives per category by reducing annotations into a map of categoryId to count
    const falseNegatives = annotations.reduce(
      (acc, annotation) => {
        const categoryId = annotation.categoryId;
        if (annotation.source.includes('false-negative')) {
          if (!acc[categoryId]) {
            acc[categoryId] = 0;
          }
          acc[categoryId]++;
        }
        return acc;
      },
      {} as { [categoryId: string]: number },
    );

    //add false negatives to results
    const resultsWithFalseNegatives = results.map((r) => ({
      ...r,
      falseNegatives: falseNegatives[r.categoryId] ?? 0,
    }));

    const filteredResults = categoryIds.length
      ? resultsWithFalseNegatives.filter((r) =>
          categoryIds.includes(r.categoryId),
        )
      : resultsWithFalseNegatives;

    exportFromJSON({
      data: neutraliseCsvRows(
        filteredResults.map((r) => ({
          stratumName: r.stratumName,
          label: categoryOptions.find((c) => c.value === r.categoryId)?.label,
          animals: r.animals,
          areaSurveyed: r.areaSurveyed,
          estimate: r.estimate,
          density: r.density,
          variance: r.variance,
          standardError: r.standardError,
          numSamples: r.numSamples,
          lowerBound95: r.lowerBound95,
          upperBound95: r.upperBound95,
          falseNegatives: r.falseNegatives,
        })),
      ),
      fileName: `${surveyName} - ${annotationSetName} - Jolly Results`,
      exportType: exportFromJSON.types.csv,
    });

    setExporting(false);
  }

  useEffect(() => {
    if (!surveyId || !annotationSetId) return;
    let mounted = true;

    (async () => {
      setLoading(true);
      try {
        const data = await fetchAllPaginatedResults(
          client.models.JollyResult.jollyResultsBySurveyId,
          {
            surveyId,
            selectionSet: [
              'surveyId',
              'stratumId',
              'annotationSetId',
              'categoryId',
              'animals',
              'areaSurveyed',
              'estimate',
              'density',
              'variance',
              'standardError',
              'numSamples',
              'lowerBound95',
              'upperBound95',
            ],
          },
        );
        if (mounted) {
          const filtered = data.filter(
            (r) => r.annotationSetId === annotationSetId,
          );

          if (filtered.length === 0) {
            navigate('/');
            return;
          }

          //fetch stratum name and insert into results
          const stratumNames = await fetchAllPaginatedResults(
            client.models.Stratum.strataByProjectId,
            {
              projectId: surveyId,
              selectionSet: ['id', 'name'],
            },
          );
          const resultsWithStratumName = filtered.map((r) => {
            const stratum = stratumNames.find((s) => s.id === r.stratumId);
            return { ...r, stratumName: stratum?.name };
          });

          const { data: survey } = await client.models.Project.get({
            id: surveyId,
          });
          setSurveyName(survey?.name ?? '');

          const { data: annotationSet } = await client.models.AnnotationSet.get(
            {
              id: annotationSetId,
            },
          );
          setAnnotationSetName(annotationSet?.name ?? '');

          const { data: categories } =
            await client.models.Category.categoriesByAnnotationSetId({
              annotationSetId,
            });

          const catOptions = categories.map((c) => ({
            label: c.name,
            value: c.id,
          }));

          const resultCategories = resultsWithStratumName.map(
            (r) => r.categoryId,
          );

          const filterOptions = catOptions.filter((c) =>
            resultCategories.includes(c.value),
          );

          setCategoryOptions(filterOptions);

          setResults(resultsWithStratumName);

          const { data: sharingLink } =
            await client.models.ResultSharingToken.get({
              surveyId,
              annotationSetId,
            });

          if (sharingLink) {
            const { data: secret } = await client.mutations.getJwtSecret();
            if (!secret) {
              console.error('Error getting JWT secret');
              return;
            }
            setCurrentToken(sharingLink.jwt);
            const { exp } = await verifyToken(sharingLink.jwt, secret);
            if (exp != null)
              setTokenExpiry(DateTime.fromMillis(exp * 1000).toJSDate());
          }
        }
      } catch (error) {
        console.error('Error fetching Jolly results:', error);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [client, surveyId, annotationSetId]);

  if (!surveyId || !annotationSetId) {
    return <p>Missing survey or annotation set id.</p>;
  }

  if (loading) {
    return <p>Loading...</p>;
  }
  // Ensure user has access only after loading completes
  if (
    !isProjectAdmin &&
    !resultsMemberships.some((m) => m.userId === authUser.username)
  ) {
    return <p>You have not been granted access to this survey's results.</p>;
  }

  const tableHeadings = [
    { content: 'Stratum', sort: true },
    { content: 'Label', sort: true },
    { content: 'Animals', sort: true },
    { content: 'Area Surveyed', sort: true },
    { content: 'Estimate', sort: true },
    { content: 'Density', sort: true },
    { content: 'Variance', sort: true },
    { content: 'Std Error', sort: true },
    { content: '# Samples', sort: true },
    { content: 'Lower 95', sort: true },
    { content: 'Upper 95', sort: true },
  ];
  const categoryIds = selectedCategories.map((c) => c.value);
  const filteredResults = categoryIds.length
    ? results.filter((r) => categoryIds.includes(r.categoryId))
    : results;

  // Add totals calculation for multiple strata
  const totalEstimate = filteredResults.reduce(
    (sum, r) => sum + Number(r.estimate),
    0,
  );
  const totalVariance = filteredResults.reduce(
    (sum, r) => sum + Number(r.variance),
    0,
  );
  const totalSamples = filteredResults.reduce(
    (sum, r) => sum + Number(r.numSamples),
    0,
  );
  const totalStdError = Math.sqrt(totalVariance);
  const tValue = getTValue(totalSamples);
  const totalLower95 = totalEstimate - tValue * totalStdError;
  const totalUpper95 = totalEstimate + tValue * totalStdError;

  const rowId = (r: { stratumId: string; categoryId: string }) =>
    `${r.stratumId}-${r.categoryId}`;
  const rowStratumIds = new Map(
    filteredResults.map((r) => [rowId(r), r.stratumId]),
  );
  const highlightedRowIds = new Set(
    filteredResults
      .filter((r) => r.stratumId === mapHoveredStratumId)
      .map(rowId),
  );

  const tableData = filteredResults.map((r) => ({
    id: rowId(r),
    rowData: [
      r.stratumName,
      categoryOptions.find((c) => c.value === r.categoryId)?.label,
      String(r.animals),
      String(r.areaSurveyed.toFixed(2)),
      String(Math.round(r.estimate)),
      String(r.density.toFixed(2)),
      String(r.variance.toFixed(2)),
      String(r.standardError.toFixed(2)),
      String(r.numSamples),
      String(Math.round(r.lowerBound95)),
      String(Math.round(r.upperBound95)),
    ],
  }));

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '1555px',
        marginTop: '16px',
        marginBottom: '16px',
      }}
    >
      <div className='flex h-full w-full flex-row gap-2'>
        {sidebarCollapsed && <CollapsedSidebar onExpand={toggleSidebar} />}
        <div
          className={cn(
            'flex w-[300px] flex-none flex-col gap-2',
            sidebarCollapsed && 'sm:hidden',
          )}
        >
          <Card>
            <CardHeader className='flex flex-row items-center justify-between'>
              <CardTitle className='mb-0'>Information</CardTitle>
              <SidebarCollapseButton onClick={toggleSidebar} />
            </CardHeader>
            <CardContent>
              <p className='mb-0'>
                <strong>Survey:</strong> {surveyName}
              </p>
              <p className='mb-0'>
                <strong>Annotation Set:</strong> {annotationSetName}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='mb-0'>Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <Combobox
                multiple
                placeholder='All labels'
                options={categoryOptions}
                value={selectedCategories}
                onChange={(value) => setSelectedCategories(value)}
                name='Labels'
              />
            </CardContent>
          </Card>
          {isProjectAdmin && (
            <Card className='min-h-0 grow overflow-auto'>
              <CardHeader>
                <CardTitle className='mb-0'>Sharing</CardTitle>
              </CardHeader>
              <CardContent className='flex flex-col gap-4'>
                <span className='text-sm text-muted-foreground'>
                  The link works for the chosen time. People who sign in with it
                  keep access until you remove them.
                </span>
                {tokenExpiry && tokenExpiry > new Date() && (
                  <span className='text-sm'>
                    Current link valid until {tokenExpiry.toLocaleDateString()}
                  </span>
                )}
                <div className='flex flex-col gap-2'>
                  <div
                    role='radiogroup'
                    aria-label='Link valid for'
                    className='flex border border-white/30'
                  >
                    {LINK_DURATIONS.map(({ label, days }) => {
                      const selected = linkDays === days;
                      return (
                        <button
                          key={label}
                          type='button'
                          role='radio'
                          aria-checked={selected}
                          disabled={!SHARING_AVAILABLE}
                          onClick={() => {
                            setLinkDays(days);
                            setExpiration(
                              DateTime.now().plus({ days }).toMillis(),
                            );
                          }}
                          className={cn(
                            'flex-1 px-3 py-1.5 text-base leading-normal transition-colors disabled:opacity-60',
                            selected
                              ? 'bg-primary text-white'
                              : 'enabled:hover:bg-white/10',
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <Button
                    variant='primary'
                    onClick={handleShare}
                    disabled={!SHARING_AVAILABLE || isCopying}
                  >
                    {isCopying ? 'Copying...' : 'Copy link'}
                  </Button>
                  {!SHARING_AVAILABLE && (
                    <span className='text-xs text-muted-foreground'>
                      New links are temporarily unavailable.
                    </span>
                  )}
                </div>
                {resultsMemberships.length > 0 && (
                  <DataTable
                    columns={sharedColumns}
                    data={sharedRows}
                    getRowId={(m) => m.userId}
                    pageSize={false}
                  />
                )}
              </CardContent>
            </Card>
          )}
          <Button
            variant='primary'
            className='mt-auto'
            onClick={exportResultsAsCSV}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : 'Export results as CSV'}
          </Button>
        </div>
        <Card className='min-w-0 grow'>
          <CardContent>
            <Tabs
              keepMounted
              activeTab={tab === 'map' ? 0 : 1}
              onTabChange={(index) => setTab(index === 0 ? 'map' : 'estimates')}
            >
              <Tab label='Density Map'>
                <div className='h-[calc(100vh-170px)] min-h-[420px] pt-4'>
                  <DensityMap
                    surveyId={surveyId}
                    annotationSetId={annotationSetId}
                    categoryIds={
                      selectedCategories.length > 0
                        ? categoryIds
                        : categoryOptions.map((c) => c.value)
                    }
                    primaryOnly
                    dropFalseNegatives
                    highlightedStratumId={tableHoveredStratumId}
                    onStratumHover={setMapHoveredStratumId}
                  />
                </div>
              </Tab>
              <Tab label='Population Estimates'>
                <div className='flex h-[calc(100vh-170px)] min-h-[420px] flex-col gap-3 pt-4'>
                  <div className='flex flex-wrap items-stretch gap-2'>
                    {[
                      ['Estimate', Math.round(totalEstimate).toLocaleString()],
                      ['Lower 95', Math.round(totalLower95).toLocaleString()],
                      ['Upper 95', Math.round(totalUpper95).toLocaleString()],
                      ['Std error', totalStdError.toFixed(2)],
                      ['Variance', totalVariance.toFixed(2)],
                      [`t value (n=${totalSamples})`, tValue.toFixed(3)],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className='flex flex-col justify-center border border-white/15 bg-white/[0.07] px-4 py-2'
                      >
                        <span className='text-[11px] tracking-wider text-muted-foreground uppercase'>
                          {label}
                        </span>
                        <span className='tabular-nums'>{value}</span>
                      </div>
                    ))}
                  </div>
                  <div className='min-h-0 grow overflow-auto [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10'>
                    <DataTable
                      columns={columnsFromHeadings(tableHeadings)}
                      data={cellRows(tableData)}
                      getRowId={(row) => row.id}
                      emptyMessage='No Jolly results found.'
                      onRowHover={(id) =>
                        setTableHoveredStratumId(
                          id ? (rowStratumIds.get(id) ?? null) : null,
                        )
                      }
                      highlightedRowIds={highlightedRowIds}
                    />
                  </div>
                </div>
              </Tab>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Compute critical t-value for 95% CI using jStat
function getTValue(n: number): number {
  const df = n - 1;
  if (df <= 0) return NaN;
  return jStat.studentt.inv(0.975, df);
}
