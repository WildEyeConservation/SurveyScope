import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { useContext, useState, useEffect } from 'react';
import { GlobalContext, TestingContext } from '../Context';
import { fetchAllPaginatedResults } from '../utils';
import MyTable from '../Table';
import { Bar, BarChart, Cell, XAxis, YAxis } from 'recharts';
import { Tab, Tabs } from '../Tabs';
import exportFromJSON from 'export-from-json';
import { useUpdateProgress } from '../useUpdateProgress';
import { Schema } from '../amplify/client-schema';
import { useUsers } from '../apiInterface';
import Select from 'react-select';
// removed modal; pass/fail rules are now inline

const chartConfig = {
  countPercentage: { label: 'Over/Under count' },
} satisfies ChartConfig;

export default function Results() {
  const { client } = useContext(GlobalContext)!;
  const { organizationMembershipsHook, organizationProjects } =
    useContext(TestingContext)!;
  const { users: allUsers } = useUsers();
  const [results, setResults] = useState<Schema['TestResult']['type'][]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [rules, setRules] = useState<{
    accuracyPercent: number;
    ignoreOvercounts: boolean;
  }>({ accuracyPercent: 90, ignoreOvercounts: false });
  const [selectedProject, setSelectedProject] = useState<{
    label: string;
    value: string;
  } | null>(null);
  const [selectedUser, setSelectedUser] = useState<{
    label: string;
    value: string;
  } | null>(null);

  const [setCompilingFiles, setTotalFilesCompiled] = useUpdateProgress({
    taskId: `Compiling files`,
    indeterminateTaskName: `Compiling files`,
    determinateTaskName: 'Compiling files',
    stepFormatter: (count) => `${count} files`,
  });

  useEffect(() => {
    async function setup() {
      setIsLoading(true);

      const results = await fetchAllPaginatedResults(
        client.models.TestResult.testResultsByUserId,
        {
          userId: selectedUser!.value,
          selectionSet: [
            'id',
            'testPreset.name',
            'testAnimals',
            'projectId',
            'totalMissedAnimals',
            'createdAt',
            'categoryCounts.categoryName',
            'categoryCounts.userCount',
            'categoryCounts.testCount',
            'annotationSetId',
            'locationId',
          ],
        }
      );

      setResults(
        results
          .filter((result) => result.projectId === selectedProject?.value)
          .sort(
            (a, b) =>
              new Date(b.createdAt!).getTime() -
              new Date(a.createdAt!).getTime()
          )
      );

      setIsLoading(false);
    }
    if (!isPurging && selectedUser) setup();
  }, [isPurging, selectedUser, selectedProject?.value, client]);

  const headings = [
    { content: 'Date', sort: true },
    { content: 'Pool', sort: true },
    { content: 'Test Animals', sort: true },
    { content: 'Missed Animals', sort: true },
    { content: 'Overcounted Animals', sort: true },
    { content: 'Pass (current rules)', sort: true },
    { content: 'Permalink', sort: false },
  ];

  function passedForResult(result: Schema['TestResult']['type']) {
    const total = result.testAnimals;
    const missed = result.totalMissedAnimals;
    let userCount = total - missed;
    if (rules.ignoreOvercounts && userCount > total) {
      userCount = total;
    }
    const accuracy = rules.accuracyPercent / 100;
    return userCount >= total * accuracy && userCount <= total * (2 - accuracy);
  }

  const tableData = results.map((result) => {
    const createdAt = result.createdAt ?? new Date().toISOString();
    const date = new Date(createdAt);
    const pool = result.testPreset.name;
    let surveyId = selectedProject?.value;

    if (pool !== selectedProject?.label) {
      const project = organizationProjects.find((p) => p.name === pool);
      if (project) {
        surveyId = project.id;
      }
    }

    const missedAnimals =
      result.totalMissedAnimals > 0 ? result.totalMissedAnimals : 0;
    const overcountedAnimalsForRow =
      result.totalMissedAnimals < 0 ? Math.abs(result.totalMissedAnimals) : 0;

    return {
      id: result.id,
      rowData: [
        `${date
          .toISOString()
          .split('T')[0]
          .replace(/-/g, '/')} - ${date.toLocaleTimeString()}`,
        pool,
        result.testAnimals,
        missedAnimals,
        overcountedAnimalsForRow,
        passedForResult(result) ? 'Yes' : 'No',
        <a
          href={`/surveys/${surveyId}/location/${result.locationId}/${result.annotationSetId}`}
          target='_blank'
        >
          Link
        </a>,
      ],
    };
  });

  const passed = results.filter((result) => passedForResult(result)).length;
  const failed = results.length - passed;
  const totalAnimals = results.reduce(
    (acc, result) => acc + result.testAnimals,
    0
  );

  // Calculate Undercounted and Overcounted Animals
  const undercountedAnimals = results.reduce(
    (acc, result) =>
      acc + (result.totalMissedAnimals > 0 ? result.totalMissedAnimals : 0),
    0
  );
  const overcountedAnimals = results.reduce(
    (acc, result) =>
      acc +
      (result.totalMissedAnimals < 0 ? Math.abs(result.totalMissedAnimals) : 0),
    0
  );

  const countsByCategory = results
    .flatMap((result) => result.categoryCounts)
    .reduce(
      (
        acc: Record<
          string,
          { userCount: number; testCount: number; name: string }
        >,
        category
      ) => {
        const key = category.categoryName.toLowerCase();
        if (!acc[key]) {
          acc[key] = {
            userCount: 0,
            testCount: 0,
            name: key,
          };
        }
        acc[key].userCount += category.userCount;
        acc[key].testCount += category.testCount;
        return acc;
      },
      {} as Record<
        string,
        { userCount: number; testCount: number; name: string }
      >
    );

  const accuracyByCategory = Object.entries(countsByCategory)
    .map(([categoryId, counts]) => {
      if (counts.testCount === 0) {
        return null;
      }

      const accuracy = counts.userCount / counts.testCount;
      let countPercentage =
        accuracy > 1
          ? parseFloat(((accuracy - 1) * 100).toFixed(2))
          : parseFloat(((1 - accuracy) * 100).toFixed(2)) * -1;

      if (Object.is(countPercentage, -0)) {
        countPercentage = 0;
      }

      return {
        categoryId,
        name: counts.name,
        countPercentage: countPercentage / 100,
      };
    })
    .filter(
      (
        entry
      ): entry is {
        categoryId: string;
        name: string;
        countPercentage: number;
      } => entry !== null
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const summaryCards = [
    {
      content: [
        `Undercounted animals: ${undercountedAnimals}`,
        `Overcounted animals: ${overcountedAnimals}`,
      ],
    },
    {
      content: [
        `Undercounted rate: ${(
          (undercountedAnimals / totalAnimals) *
          100
        ).toFixed(2)}%`,
        `Overcounted rate: ${(
          (overcountedAnimals / totalAnimals) *
          100
        ).toFixed(2)}%`,
      ],
    },
    {
      content: [
        `Test success rate: ${((passed / results.length) * 100).toFixed(2)}%`,
        `Tests passed and failed: ${passed} - ${failed}`,
      ],
    },
  ];

  function exportResults() {
    setCompilingFiles(0);
    setTotalFilesCompiled(2);

    exportFromJSON({
      data: results.map((result) => ({
        date: result.createdAt,
        preset: result.testPreset.name,
        testAnimals: result.testAnimals,
        missedAnimals: result.totalMissedAnimals,
        passed: passedForResult(result),
      })),
      fileName: `${selectedUser?.label}-test-results`,
      exportType: 'csv',
    });

    setCompilingFiles(1);

    exportFromJSON({
      data: accuracyByCategory.map((category) => ({
        label: category.name,
        overUnderPercentage: category.countPercentage.toFixed(4),
      })),
      fileName: `${selectedUser?.label}-label-accuracy`,
      exportType: 'csv',
    });

    setCompilingFiles(2);
  }

  async function purgeResults() {
    if (!confirm('Are you sure you want to purge all results for this user?')) {
      return;
    }

    setIsPurging(true);

    const results = await fetchAllPaginatedResults(
      client.models.TestResult.testResultsByUserId,
      {
        userId: selectedUser!.value,
        selectionSet: ['id', 'projectId', 'categoryCounts.categoryName'],
      }
    );

    const filteredResults = results.filter(
      (result) => result.projectId === selectedProject?.value
    );

    const deletePromises = filteredResults.flatMap((result) => [
      client.models.TestResult.delete({ id: result.id }),
      ...result.categoryCounts.map(
        (category: Schema['TestResultCategoryCount']['type']) =>
          client.models.TestResultCategoryCount.delete({
            testResultId: result.id,
            categoryName: category.categoryName,
          })
      ),
    ]);

    await Promise.all(deletePromises);

    setIsPurging(false);
  }

  return (
    <div className='flex flex-col gap-2 mt-4 w-full'>
      <div>
        <label className='mb-2'>Select Survey</label>
        <Select
          className='text-black'
          value={selectedProject}
          options={organizationProjects
            .filter((p) => !p.hidden)
            .map((p) => ({
              label: `${p.name}`,
              value: p.id,
            }))}
          onChange={(e) => {
            setSelectedProject(e);
            setSelectedUser(null);
            setResults([]);
          }}
          styles={{
            valueContainer: (base) => ({
              ...base,
              overflowY: 'auto',
            }),
          }}
        />
      </div>
      <div>
        <label className='mb-2'>Select user</label>
        <Select
          className='mb-4 text-black'
          value={selectedUser}
          options={organizationMembershipsHook.data?.map((m) => ({
            label: allUsers.find((user) => user.id === m.userId)?.name || '',
            value: m.userId,
          }))}
          onChange={(e) => {
            setSelectedUser(e);
          }}
          styles={{
            valueContainer: (base) => ({
              ...base,
              overflowY: 'auto',
            }),
          }}
        />
      </div>
      {selectedProject && selectedUser && (
        <>
          <div className='overflow-x-auto overflow-y-visible'>
            {results.length === 0 ? (
              <p className='mt-2'>
                {isLoading ? 'Loading...' : 'No test results'}
              </p>
            ) : (
              <Tabs defaultTab={0}>
                <Tab label='All Results'>
                  <div className='flex flex-col mb-1'>
                    <p className='mt-2 mb-1'>Rules</p>
                    <div>
                      <label className='mb-1'>Pass rate (%)</label>
                      <Input
                        type='number'
                        min={1}
                        max={100}
                        className='text-black'
                        value={rules.accuracyPercent}
                        onChange={(e) =>
                          setRules({
                            ...rules,
                            accuracyPercent: parseInt(e.target.value || '0'),
                          })
                        }
                        style={{ width: 160 }}
                      />
                    </div>
                    <div className='mt-2 flex items-center gap-2'>
                      <Checkbox
                        id='ignore-overcounts'
                        checked={rules.ignoreOvercounts}
                        onCheckedChange={(c) =>
                          setRules({
                            ...rules,
                            ignoreOvercounts: c === true,
                          })
                        }
                      />
                      <Label htmlFor='ignore-overcounts' className='mb-0'>
                        Ignore overcounts
                      </Label>
                    </div>
                  </div>
                  <p className='my-2'>Summary</p>
                  <div className='flex gap-4 mb-4'>
                    {summaryCards.map((card, index) => (
                      <SummaryCard key={index} content={card.content} />
                    ))}
                  </div>
                  <p className='mb-2'>All Results</p>
                  <MyTable
                    tableHeadings={headings}
                    tableData={tableData}
                    pagination={true}
                    itemsPerPage={5}
                  />
                </Tab>
                <Tab label='Label Accuracy'>
                  <p
                    className='text-center mb-0 mt-4'
                    style={{ fontSize: '1.5rem' }}
                  >
                    Over/Under Count Percentage By Label
                  </p>
                  <ChartContainer
                    config={chartConfig}
                    className='aspect-auto h-[400px] w-full [&_.recharts-cartesian-axis-tick_text]:fill-white!'
                  >
                    <BarChart
                      data={accuracyByCategory}
                      margin={{ top: 20, right: 20, bottom: 20, left: 0 }}
                    >
                      <XAxis
                        dataKey='name'
                        interval={0}
                        angle={45}
                        textAnchor='start'
                        height={80}
                        stroke='#FFFFFF'
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis stroke='#FFFFFF' tick={{ fontSize: 12 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey='countPercentage' radius={4}>
                        {accuracyByCategory.map((entry) => (
                          <Cell
                            key={entry.categoryId}
                            fill={
                              entry.countPercentage < 0 ? '#DF691A' : '#5bc0de'
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </Tab>
              </Tabs>
            )}
          </div>
          {results.length > 0 && (
            <div className='flex gap-2 justify-end mt-2'>
              <Button
                variant='danger'
                onClick={purgeResults}
                disabled={isPurging}
              >
                Purge Results
              </Button>
              <Button variant='primary' onClick={exportResults}>
                Export Results
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ content }: { content: (string | JSX.Element)[] }) {
  return (
    <div className=' p-4 bg-dark text-white flex flex-col gap-1'>
      {content.map((item, index) => (
        <p key={index} className='mb-0'>
          {item}
        </p>
      ))}
    </div>
  );
}

// Rules modal removed in favor of inline controls
