import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Eye, Plus, Settings2 } from 'lucide-react';
import { useContext, useEffect, useRef, useState } from 'react';
import { GlobalContext, TestingContext } from '../Context';
import MyTable from '../Table';
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
  const [selectedLocationPools, setSelectedLocationPools] = useState<{
    [surveyId: string]: Option[];
  }>({});
  const originalSelectedLocationPools = useRef<{
    [surveyId: string]: Option[];
  }>({});

  async function handlePoolsChange(surveyId: string, pools: Option[]) {
    setSelectedLocationPools((prev) => ({
      ...prev,
      [surveyId]: pools,
    }));

    await Promise.all([
      ...originalSelectedLocationPools.current[surveyId]
        .filter((pool) => !pools.some((p) => p.value === pool.value))
        .map((pool) =>
          client.models.TestPresetProject.delete({
            testPresetId: pool.value,
            projectId: surveyId,
          }),
        ),
      ...pools
        .filter(
          (pool) =>
            !originalSelectedLocationPools.current[surveyId].some(
              (p) => p.value === pool.value,
            ),
        )
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

  const tableData = surveys
    .filter((survey) => !survey.hidden)
    .map((survey) => {
      const isDisabled = [
        'addLocationsToPoolModal',
        'editLocationPoolModal',
        'configModal',
      ].includes(modalToShow || '');
      const hasPreset = !!surveyPreset(survey.id);

      return {
        id: survey.id,
        rowData: [
          survey.name,
          <Combobox
            multiple
            value={selectedLocationPools[survey.id] ?? []}
            options={locationPools.map((pool) => ({
              label: pool.name,
              value: pool.id,
            }))}
            onChange={(options) => handlePoolsChange(survey.id, options)}
            placeholder='Select location pools'
            name='Assigned location pools'
          />,
          <Button
            variant='success'
            className='w-full'
            onClick={() => {
              setSelectedSurvey({
                label: survey.name,
                value: survey.id,
              });
              showModal('addLocationsToPoolModal');
            }}
            disabled={isDisabled || !hasPreset}
          >
            <Plus />
          </Button>,
          <Button
            variant='info'
            className='w-full'
            onClick={() => {
              setSelectedSurvey({
                label: survey.name,
                value: survey.id,
              });
              showModal('editLocationPoolModal');
            }}
            disabled={isDisabled || !hasPreset}
          >
            <Eye />
          </Button>,
          <Button
            variant='primary'
            className='w-full'
            onClick={() => {
              setSelectedSurvey({
                label: survey.name,
                value: survey.id,
              });
              showModal('configModal');
            }}
            disabled={isDisabled}
          >
            <Settings2 />
          </Button>,
        ],
      };
    });

  useEffect(() => {
    if (!modalToShow && selectedSurvey) {
      setSelectedSurvey(null);
    }
  }, [modalToShow]);

  return (
    <div className='mt-4 flex w-full flex-col gap-2'>
      <h5 className='mb-0'>Surveys</h5>
      <MyTable
        tableHeadings={[
          { content: 'Name', style: { width: '40%' }, sort: true },
          { content: 'Assigned Location Pools' },
          { content: 'Add Locations', style: { width: '120px' } },
          { content: 'Edit Locations', style: { width: '120px' } },
          {
            content: 'Configuration',
            style: { width: '120px' },
          },
        ]}
        tableData={tableData}
        pagination={true}
        itemsPerPage={5}
        emptyMessage='No surveys found'
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
