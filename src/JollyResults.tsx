import { useState, useEffect, useContext, useMemo } from 'react';
import { Combobox } from '@/components/ui/combobox';
import { useParams } from 'react-router-dom';
import { GlobalContext, UserContext } from './Context.tsx';
import { fetchAllPaginatedResults } from './utils.tsx';
import MyTable from './Table.tsx';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import DensityMap from './DensityMap.tsx';
import exportFromJSON from 'export-from-json';
import { useUsers } from './apiInterface';
import { X } from 'lucide-react';
import { createToken, verifyToken } from './utils/jwt';
import { DateTime } from 'luxon';
import { useOptimisticUpdates } from './useOptimisticUpdates.tsx';
import { Schema } from './amplify/client-schema';
// @ts-ignore
import * as jStat from 'jstat';
import { useNavigate } from 'react-router-dom';

export default function JollyResults() {
  const { surveyId, annotationSetId } = useParams() as {
    surveyId: string;
    annotationSetId: string;
  };
  const { client } = useContext(GlobalContext)!;
  const { myMembershipHook: myProjectsHook, user: authUser } =
    useContext(UserContext)!;
  const [loading, setLoading] = useState(false);
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
    DateTime.now().plus({ days: 1 }).toMillis()
  );
  const [isCopying, setIsCopying] = useState(false);
  const [moreInfo, setMoreInfo] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tableHoveredStratumId, setTableHoveredStratumId] = useState<
    string | null
  >(null);
  const [mapHoveredStratumId, setMapHoveredStratumId] = useState<
    string | null
  >(null);
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
    [surveyId, annotationSetId]
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
    subscriptionFilter
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
      secret
    );

    const { data: surveyProject } = await client.models.Project.get({ id: surveyId });
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

  async function removeResultsMembership(userId: string) {
    await client.models.JollyResultsMembership.delete({
      surveyId,
      annotationSetId,
      userId,
    });
    setResultsMemberships(
      resultsMemberships.filter((m) => m.userId !== userId)
    );
  }

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
        }
      );

      annotations.push(...annotationsForCategory);
    }

    //count false negatives per category by reducing annotations into a map of categoryId to count
    const falseNegatives = annotations.reduce((acc, annotation) => {
      const categoryId = annotation.categoryId;
      if (annotation.source.includes('false-negative')) {
        if (!acc[categoryId]) {
          acc[categoryId] = 0;
        }
        acc[categoryId]++;
      }
      return acc;
    }, {} as { [categoryId: string]: number });

    //add false negatives to results
    const resultsWithFalseNegatives = results.map((r) => ({
      ...r,
      falseNegatives: falseNegatives[r.categoryId] ?? 0,
    }));

    const filteredResults = categoryIds.length
      ? resultsWithFalseNegatives.filter((r) =>
        categoryIds.includes(r.categoryId)
      )
      : resultsWithFalseNegatives;

    exportFromJSON({
      data: filteredResults.map((r) => ({
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
          }
        );
        if (mounted) {
          const filtered = data.filter(
            (r) => r.annotationSetId === annotationSetId
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
            }
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
            }
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
            (r) => r.categoryId
          );

          const filterOptions = catOptions.filter((c) =>
            resultCategories.includes(c.value)
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
            if (exp != null) setTokenExpiry(DateTime.fromMillis(exp * 1000).toJSDate());
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
    0
  );
  const totalVariance = filteredResults.reduce(
    (sum, r) => sum + Number(r.variance),
    0
  );
  const totalSamples = filteredResults.reduce(
    (sum, r) => sum + Number(r.numSamples),
    0
  );
  const totalStdError = Math.sqrt(totalVariance);
  const tValue = getTValue(totalSamples);
  const totalLower95 = totalEstimate - tValue * totalStdError;
  const totalUpper95 = totalEstimate + tValue * totalStdError;

  const rowId = (r: { stratumId: string; categoryId: string }) =>
    `${r.stratumId}-${r.categoryId}`;
  const rowStratumIds = new Map(
    filteredResults.map((r) => [rowId(r), r.stratumId])
  );
  const highlightedRowIds = new Set(
    filteredResults
      .filter((r) => r.stratumId === mapHoveredStratumId)
      .map(rowId)
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
      <div className='flex flex-row gap-2 w-full h-full'>
        <div className='flex flex-col gap-2' style={{ width: '300px' }}>
          <Card>
            <CardHeader>
              <CardTitle>
                <h4 className='mb-0'>Information</h4>
              </CardTitle>
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
              <CardTitle>
                <h4 className='mb-0'>Filter</h4>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Combobox
                multiple
                placeholder='Select labels'
                options={categoryOptions}
                value={selectedCategories}
                onChange={(value) => setSelectedCategories(value)}
                name='Labels'
              />
            </CardContent>
          </Card>
          <Card className='grow overflow-auto'>
            <CardHeader>
              <CardTitle>
                <h4 className='mb-0'>Sharing</h4>
              </CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col justify-between'>
              {isProjectAdmin && (
                <div className='flex flex-col gap-4'>
                  <div>
                    <Button
                      variant='link'
                      className='p-0 mb-1'
                      onClick={() => setMoreInfo(!moreInfo)}
                    >
                      {moreInfo ? 'Less Info' : 'Click for more info...'}
                    </Button>
                    {moreInfo && (
                      <span
                        className='text-muted-foreground block mb-2 mt-0'
                        style={{ fontSize: '14px' }}
                      >
                        After copying the link, it will remain valid until the
                        expiration date. Any user who clicks the link will be
                        required to sign in. These users will be granted access
                        to this results page. You can revoke access by removing
                        them from the list below. You must wait for the link to
                        expire before creating a new one. As a safety measure,
                        choose the shortest expiration date possible.
                      </span>
                    )}
                    <Label className='mb-0 block'>
                      Expiration Date:
                    </Label>
                    {tokenExpiry && (
                      <span
                        className='text-muted-foreground block mb-2 mt-0'
                        style={{ fontSize: '14px' }}
                      >
                        Link still valid until{' '}
                        {new Date(tokenExpiry).toLocaleDateString()}
                      </span>
                    )}
                    <Input
                      type='date'
                      disabled={true}
                      placeholder='Expiration'
                      value={DateTime.fromMillis(expiration).toFormat(
                        'yyyy-MM-dd'
                      )}
                      onChange={(e) =>
                        setExpiration(
                          DateTime.fromFormat(
                            e.target.value,
                            'yyyy-MM-dd'
                          ).toMillis()
                        )
                      }
                      min={DateTime.now().toFormat('yyyy-MM-dd')}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className='inline-block w-full'>
                          <Button
                            variant='outline-primary'
                            className='mt-2 w-full'
                            onClick={handleShare}
                            disabled={true}
                            style={{ pointerEvents: 'none' }}
                          >
                            {isCopying ? 'Copying...' : 'Copy Link'}
                          </Button>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent id='copy-link-tooltip' side='top'>
                        Under maintenance
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div>
                    <Label className='m-0'>Shared with:</Label>
                    {resultsMemberships.length > 0 ? (
                      resultsMemberships.map((m) => (
                        <div
                          className='mb-2 w-full flex justify-between items-center'
                          style={{
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            padding: '0px 0px 0px 8px',
                            fontSize: '14px',
                            overflow: 'hidden',
                          }}
                          key={m.userId}
                        >
                          <span className='m-0'>
                            {users?.find((u) => u.id === m.userId)?.name ||
                              'New User'}
                          </span>
                          <Button
                            variant='danger'
                            size='sm'
                            onClick={() => removeResultsMembership(m.userId)}
                          >
                            <X />
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p
                        className='mb-0 text-muted-foreground'
                        style={{ fontSize: '14px' }}
                      >
                        No one has been shared with yet.
                      </p>
                    )}
                  </div>
                </div>
              )}
              <Button onClick={exportResultsAsCSV} disabled={exporting}>
                {exporting
                  ? 'Exporting, Please wait...'
                  : 'Export Results as CSV'}
              </Button>
            </CardContent>
          </Card>
        </div>
        <div className='flex flex-col gap-2 grow'>
          <Card className='grow'>
            <CardHeader>
              <CardTitle>
                <h4 className='mb-0'>Density Map</h4>
              </CardTitle>
            </CardHeader>
            <CardContent className='p-0 overflow-hidden'>
              <div style={{ height: 'clamp(400px, 55vh, 650px)' }}>
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
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='flex justify-between items-center gap-2'>
              <CardTitle className='mb-0 w-full' style={{ maxWidth: '300px' }}>
                <h4 className='mb-0'>Jolly Results</h4>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MyTable
                tableHeadings={tableHeadings}
                tableData={tableData}
                pagination={false}
                emptyMessage='No Jolly results found.'
                onRowHover={(id) =>
                  setTableHoveredStratumId(
                    id ? rowStratumIds.get(id) ?? null : null
                  )
                }
                highlightedRowIds={highlightedRowIds}
              />
              <div className='mt-4 p-2 border-t'>
                <h5>Totals</h5>
                <div className='flex flex-wrap gap-6'>
                  <div>
                    <strong>Estimate:</strong> {Math.round(totalEstimate)}
                  </div>
                  <div>
                    <strong>Variance:</strong> {totalVariance.toFixed(2)}
                  </div>
                  <div>
                    <strong>Std Error:</strong> {totalStdError.toFixed(2)}
                  </div>
                  <div>
                    <strong>t Value (n={totalSamples}):</strong>{' '}
                    {tValue.toFixed(3)}
                  </div>
                  <div>
                    <strong>Lower 95:</strong> {Math.round(totalLower95)}
                  </div>
                  <div>
                    <strong>Upper 95:</strong> {Math.round(totalUpper95)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
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
