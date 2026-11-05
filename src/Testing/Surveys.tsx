import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Eye, Plus, SearchIcon, SearchX, Settings2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useContext, useEffect, useRef, useState } from 'react';
import { GlobalContext, TestingContext } from '../Context';
import AddLocationsModal from './AddLocationsModal';
import ConfigModal from './ConfigModal';
import EditLocationsModal from './EditLocationsModal';

interface Option {
  label: string;
  value: string;
}

export default function Surveys() {
  const {
    organizationId,
    organizationProjects: surveys,
    organizationTestPresets: locationPools,
  } = useContext(TestingContext)!;
  const { client, modalToShow, showModal } = useContext(GlobalContext)!;

  const [selectedSurvey, setSelectedSurvey] = useState<Option | null>(null);
  const [search, setSearch] = useState('');
  const [selectedLocationPools, setSelectedLocationPools] = useState<{
    [surveyId: string]: Option[];
  }>({});
  const originalSelectedLocationPools = useRef<{
    [surveyId: string]: Option[];
  }>({});

  async function handlePoolsChange(surveyId: string, chosen: Option[]) {
    // The survey's own tests aren't in the picker; keep them assigned.
    const original = originalSelectedLocationPools.current[surveyId] ?? [];
    const own = original.find((p) => p.value === surveyPreset(surveyId)?.id);
    const pools = own ? [own, ...chosen] : chosen;
    setSelectedLocationPools((prev) => ({
      ...prev,
      [surveyId]: pools,
    }));

    await Promise.all([
      ...original
        .filter((pool) => !pools.some((p) => p.value === pool.value))
        .map((pool) =>
          client.models.TestPresetProject.delete({
            testPresetId: pool.value,
            projectId: surveyId,
          }),
        ),
      ...pools
        .filter((pool) => !original.some((p) => p.value === pool.value))
        .map((pool) =>
          client.models.TestPresetProject.create({
            testPresetId: pool.value,
            projectId: surveyId,
            group: organizationId,
          }),
        ),
    ]);

    originalSelectedLocationPools.current[surveyId] = pools;
  }

  useEffect(() => {
    let cancelled = false;

    async function getSelectedLocationPools() {
      if (locationPools.length === 0) return;

      await Promise.all(
        surveys.map(async (survey) => {
          if (survey.hidden) return;
          const { data: selectedLocationPools } =
            await client.models.TestPresetProject.testPresetsByProjectId({
              projectId: survey.id,
            });
          if (cancelled) return;

          setSelectedLocationPools((prev) => {
            originalSelectedLocationPools.current = {
              ...prev,
              [survey.id]: selectedLocationPools.flatMap((pool) => {
                const preset = locationPools.find(
                  (p) => p.id === pool.testPresetId,
                );
                return preset
                  ? [{ label: preset.name, value: pool.testPresetId }]
                  : [];
              }),
            };
            return originalSelectedLocationPools.current;
          });
        }),
      );
    }

    getSelectedLocationPools();
    return () => {
      cancelled = true;
    };
  }, [surveys, locationPools]);

  const surveyPreset = (surveyId: string) =>
    locationPools.find((pool) => pool.ownerProjectId === surveyId);
  const selectedPreset = selectedSurvey && surveyPreset(selectedSurvey.value);

  type SurveyRow = (typeof surveys)[number];
  const isDisabled = [
    'addLocationsToPoolModal',
    'editLocationPoolModal',
    'configModal',
  ].includes(modalToShow || '');
  const open = (survey: SurveyRow, modal: string) => {
    setSelectedSurvey({ label: survey.name, value: survey.id });
    showModal(modal);
  };

  const query = search.trim().toLowerCase();
  const visibleSurveys = surveys.filter(
    (survey) =>
      !survey.hidden && (!query || survey.name.toLowerCase().includes(query)),
  );

  const actionColumn = (
    id: string,
    header: string,
    cell: (survey: SurveyRow) => React.ReactNode,
  ): DataColumn<SurveyRow> => ({
    id,
    header,
    enableSorting: false,
    cell: ({ row }) => cell(row.original),
    meta: { className: 'w-[120px] text-center' },
  });

  const columns: DataColumn<SurveyRow>[] = [
    {
      id: 'name',
      header: 'Name',
      accessorFn: (survey) => survey.name,
      meta: { style: { width: '30%' } },
    },
    {
      id: 'createdAt',
      header: 'Created',
      accessorFn: (survey) => survey.createdAt ?? '',
      cell: ({ row }) =>
        row.original.createdAt
          ? DateTime.fromISO(row.original.createdAt).toLocaleString(
              DateTime.DATE_MED,
            )
          : '',
      meta: { className: 'whitespace-nowrap' },
    },
    {
      id: 'pools',
      header: 'Use tests from other surveys',
      enableSorting: false,
      cell: ({ row: { original: survey } }) => (
        <Combobox
          multiple
          value={(selectedLocationPools[survey.id] ?? []).filter(
            (pool) => pool.value !== surveyPreset(survey.id)?.id,
          )}
          options={locationPools
            .filter((pool) => pool.ownerProjectId !== survey.id)
            .map((pool) => ({
              label: pool.name,
              value: pool.id,
            }))}
          onChange={(options) => handlePoolsChange(survey.id, options)}
          placeholder='Select surveys'
          name='Assigned location pools'
        />
      ),
    },
    actionColumn('add', 'Add Locations', (survey) => (
      <Button
        variant='success'
        className='w-full'
        onClick={() => open(survey, 'addLocationsToPoolModal')}
        disabled={isDisabled || !surveyPreset(survey.id)}
      >
        <Plus />
      </Button>
    )),
    actionColumn('edit', 'Edit Locations', (survey) => (
      <Button
        variant='info'
        className='w-full'
        onClick={() => open(survey, 'editLocationPoolModal')}
        disabled={isDisabled || !surveyPreset(survey.id)}
      >
        <Eye />
      </Button>
    )),
    actionColumn('config', 'Configuration', (survey) => (
      <Button
        variant='primary'
        className='w-full'
        onClick={() => open(survey, 'configModal')}
        disabled={isDisabled}
      >
        <Settings2 />
      </Button>
    )),
  ];

  useEffect(() => {
    if (!modalToShow && selectedSurvey) {
      setSelectedSurvey(null);
    }
  }, [modalToShow]);

  return (
    <div className='mt-4 flex w-full flex-col gap-4'>
      <h5 className='mb-0'>Surveys</h5>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative min-w-72 flex-1'>
          <SearchIcon className='pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-[#6c757d]' />
          <Input
            type='search'
            aria-label='Search surveys'
            placeholder='Survey name…'
            className='pl-9'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <DataTable
        storageKey='testing-surveys'
        columns={columns}
        data={visibleSurveys}
        getRowId={(survey) => survey.id}
        initialSorting={[{ id: 'createdAt', desc: true }]}
        pageSize={5}
        emptyIcon={search ? SearchX : undefined}
        emptyMessage={
          search ? 'No surveys match these filters' : 'No surveys found'
        }
      />
      {selectedSurvey && (
        <ConfigModal
          show={modalToShow === 'configModal'}
          survey={{ id: selectedSurvey.value, name: selectedSurvey.label }}
        />
      )}
      {selectedSurvey && selectedPreset && (
        <EditLocationsModal
          key={selectedSurvey.value}
          show={modalToShow === 'editLocationPoolModal'}
          preset={{ id: selectedPreset.id, name: selectedPreset.name }}
          surveyId={selectedSurvey.value}
        />
      )}
      {selectedSurvey && selectedPreset && (
        <AddLocationsModal
          show={modalToShow === 'addLocationsToPoolModal'}
          preset={{ id: selectedPreset.id, name: selectedPreset.name }}
          surveyId={selectedSurvey.value}
        />
      )}
    </div>
  );
}
