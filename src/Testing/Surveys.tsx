import MyTable from '../Table';
import { useState, useContext, useEffect, useRef } from 'react';
import Select from 'react-select';
import { TestingContext } from '../Context';
import { client } from '../stores/appClient';
import { showModalAction as showModal, useModalToShow } from '../stores/modalStore';
import { Button } from 'react-bootstrap';
import { Plus, Settings2, Eye } from 'lucide-react';
import ConfigModal from './ConfigModal';
import EditLocationsModal from './EditLocationsModal';
import AddLocationsModal from './AddLocationsModal';

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
  const modalToShow = useModalToShow();

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
          })
        ),
      ...pools
        .filter(
          (pool) =>
            !originalSelectedLocationPools.current[surveyId].some(
              (p) => p.value === pool.value
            )
        )
        .map((pool) =>
          client.models.TestPresetProject.create({
            testPresetId: pool.value,
            projectId: surveyId,
            group: organizationId,
          })
        ),
    ]);

    originalSelectedLocationPools.current[surveyId] = pools;
  }

  useEffect(() => {
    async function getSelectedLocationPools() {
      if (locationPools.length === 0) return;

      await Promise.all(
        surveys.map(async (survey) => {
          if (survey.hidden) return;
          const { data: selectedLocationPools } =
            await client.models.TestPresetProject.testPresetsByProjectId({
              projectId: survey.id,
            });

          setSelectedLocationPools((prev) => {
            originalSelectedLocationPools.current = {
              ...prev,
              [survey.id]: selectedLocationPools.map((pool) => ({
                label: locationPools.find((p) => p.id === pool.testPresetId)!
                  .name,
                value: pool.testPresetId,
              })),
            };
            return originalSelectedLocationPools.current;
          });
        })
      );
    }

    getSelectedLocationPools();
  }, [surveys, locationPools]);

  const tableData = surveys
    .filter((survey) => !survey.hidden)
    .map((survey) => {
      const isDisabled = [
        'addLocationsToPoolModal',
        'editLocationPoolModal',
        'configModal',
      ].includes(modalToShow || '');

      return {
        id: survey.id,
        rowData: [
          survey.name,
          <Select
            className='text-black'
            isMulti
            value={selectedLocationPools[survey.id]}
            options={locationPools.map((pool) => ({
              label: pool.name,
              value: pool.id,
            }))}
            onChange={(e) => handlePoolsChange(survey.id, e as Option[])}
          />,
          <Button
            variant='success'
            className='w-100'
            onClick={() => {
              setSelectedSurvey({
                label: survey.name,
                value: survey.id,
              });
              showModal('addLocationsToPoolModal');
            }}
            disabled={isDisabled}
          >
            <Plus />
          </Button>,
          <Button
            variant='info'
            className='w-100'
            onClick={() => {
              setSelectedSurvey({
                label: survey.name,
                value: survey.id,
              });
              showModal('editLocationPoolModal');
            }}
            disabled={isDisabled}
          >
            <Eye />
          </Button>,
          <Button
            variant='primary'
            className='w-100'
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
    <div className='d-flex flex-column gap-2 mt-3 w-100'>
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
      {selectedSurvey && (
        <EditLocationsModal
          key={selectedSurvey.value}
          show={modalToShow === 'editLocationPoolModal'}
          preset={{
            id: locationPools.find(
              (pool) => pool.name === selectedSurvey.label
            )!.id,
            name: selectedSurvey.label,
          }}
          surveyId={selectedSurvey.value}
        />
      )}
      {selectedSurvey && (
        <AddLocationsModal
          show={modalToShow === 'addLocationsToPoolModal'}
          preset={{
            id: locationPools.find(
              (pool) => pool.name === selectedSurvey.label
            )!.id,
            name: selectedSurvey.label,
          }}
          surveyId={selectedSurvey.value}
        />
      )}
    </div>
  );
}
