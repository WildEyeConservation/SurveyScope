import { Button } from 'react-bootstrap';
import { Modal, Body, Header, Footer, Title } from './Modal';
import { useNavigate } from 'react-router-dom';
import { fetchAllPaginatedResults } from './utils.tsx';
import exportFromJSON from 'export-from-json';
import { client } from './stores/appClient';
import { showModalAction as showModal } from './stores/modalStore';
import { useState, useEffect, useMemo } from 'react';
import { useUsers } from './apiInterface';
import GenerateJollyResults from './GenerateJollyResults.tsx';
import { Spinner } from 'react-bootstrap';
import {
  fetchAllInfoTagsForSet,
  formatInfoTagsForCsv,
} from './infoTags';

export default function AnnotationSetResults({
  show,
  onClose,
  surveyId,
  annotationSet,
}: {
  show: boolean;
  onClose: () => void;
  surveyId: string;
  annotationSet: { id: string; name: string };
}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const { users } = useUsers();

  const userMap = useMemo(() => {
    return users.reduce((acc, user) => {
      acc[user.id] = user.name ?? '';
      return acc;
    }, {} as Record<string, string>);
  }, [users]);

  const [jollyResultsExists, setJollyResultsExists] = useState(false);

  useEffect(() => {
    if (!surveyId || !annotationSet.id) return;
    setLoading(true);

    let mounted = true;
    (async () => {
      try {
        const data = await fetchAllPaginatedResults(
          client.models.JollyResult.jollyResultsBySurveyId,
          { surveyId, selectionSet: ['annotationSetId'] }
        );
        if (mounted) {
          setJollyResultsExists(
            data.some((r) => r.annotationSetId === annotationSet.id)
          );
        }
      } catch (error) {
        console.error('Error checking Jolly results:', error);
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [surveyId, annotationSet.id]);

  async function exportData(annotationSets: { id: string; name: string }[]) {
    setExportStatus('Exporting data...');

    const { data: survey } = await client.models.Project.get(
      {
        id: surveyId,
      },
      { selectionSet: ['name'] }
    );

    if (!survey) {
      console.error('Survey not found');
      return;
    }

    const annotationSetsResult = await Promise.all(
      annotationSets.map(async (annotationSet) => {
        return await fetchAllPaginatedResults(
          client.models.Annotation.annotationsByAnnotationSetId,
          {
            setId: annotationSet.id,

            selectionSet: [
              'y',
              'x',
              'category.name',
              'owner',
              'source',
              'obscured',
              'id',
              'objectId',
              'reviewCatId',
              'reviewedBy',
              'infoTaggedBy',
              'image.originalPath',
              'image.timestamp',
              'image.latitude',
              'image.longitude',
              'image.transectId',
            ] as const,
            limit: 10000,
          },
          (stepsCompleted) => {
            setExportStatus(`Fetching annotations... (${stepsCompleted} fetched)`);
          }
        );
      })
    );

    const categories = await fetchAllPaginatedResults(
      client.models.Category.categoriesByProjectId,
      {
        projectId: surveyId,
        selectionSet: ['id', 'name'],
        limit: 100,
      },
      (stepsCompleted) => {
        setExportStatus(`Fetching labels... (${stepsCompleted} fetched)`);
      }
    );

    const categoryMap = categories.reduce((acc, category) => {
      acc[category.id] = category.name;
      return acc;
    }, {} as Record<string, string>);

    const infoTagsBySet = await Promise.all(
      annotationSets.map((set) =>
        fetchAllInfoTagsForSet(client, set.id, (count) => {
          setExportStatus(`Fetching info tags... (${count} fetched)`);
        })
      )
    );

    let i = 0;
    let a = 0;

    for (const annotations of annotationSetsResult) {
      a += annotations.length;

      const fileName = `SurveyScope-${survey.name}-${annotationSets[i].name}`;
      const exportType = exportFromJSON.types.csv;
      exportFromJSON({
        data: annotations.map((anno) => {
          return {
            category: anno.category?.name || 'Unknown',
            image: anno.image.originalPath || 'Unknown',
            transect: anno.image.transectId || 'Unknown',
            timestamp: anno.image.timestamp,
            latitude: anno.image.latitude,
            longitude: anno.image.longitude,
            obscured: anno.obscured ?? false,
            annotator: userMap[anno.owner ?? ''] || 'Unknown',
            isPrimary: anno.objectId === anno.id,
            x: anno.x,
            y: anno.y,
            source: anno.source,
            infoTags: formatInfoTagsForCsv(
              infoTagsBySet[i].get(anno.id) ?? []
            ),
            infoTaggedBy: userMap[anno.infoTaggedBy ?? ''],
            reviewedBy: userMap[anno.reviewedBy ?? ''],
            reviewedCategory: categoryMap[anno.reviewCatId ?? ''],
          };
        }),
        fileName,
        exportType,
      });

      i++;
    }


    setExportStatus(`Exported ${a} annotations`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setExportStatus('');
  }

  async function generateSurveyResults() {
    setLoading(true);
    showModal('generateJollyResults');
    setLoading(false);
  }

  async function viewSurveyResults(annotationSetId: string) {
    onClose();
    navigate(`/jolly/${surveyId}/${annotationSetId}`);
  }

  return (
    <>
      <Modal show={show} onHide={onClose} strict={true} size='lg'>
        <Header>
          <Title>{annotationSet.name} Results</Title>
        </Header>
        <Body>
          <div className='d-flex flex-column gap-4 p-3'>
            <div>
              <h5 className='mb-0'>Explore</h5>
              <span className='text-muted' style={{ fontSize: '14px' }}>
                Explore your annotation set by searching for all sightings of a
                specific species. Can be used to find and correct
                errors, and reannotate unknown sightings.
              </span>
              <Button
                className='d-block mt-1'
                variant='primary'
                onClick={() =>
                  navigate(
                    `/surveys/${surveyId}/set/${annotationSet.id}/review`
                  )
                }
              >
                Explore
              </Button>
            </div>
            <div>
              <h5 className='mb-0'>CSV File</h5>
              <span className='text-muted' style={{ fontSize: '14px' }}>
                Download a CSV file of your annotation set.
              </span>
              {exportStatus && <p className='text-muted' style={{ fontSize: '14px' }}><Spinner animation='border' size='sm' /> {exportStatus}</p>}
              <Button
                className='d-block mt-1'
                variant='primary'
                disabled={users.length === 0}
                onClick={() => {
                  exportData([annotationSet]);
                }}
              >
                Download
              </Button>
            </div>
            <div>
              <h5 className='mb-0'>Chain Viewer</h5>
              <span className='text-muted' style={{ fontSize: '14px' }}>
                Inspect linked-individual chains: every primary annotation
                and all its linked sightings across neighbour images.
              </span>
              <Button
                className='d-block mt-1'
                variant='primary'
                onClick={() =>
                  navigate(
                    `/surveys/${surveyId}/set/${annotationSet.id}/chain-viewer`
                  )
                }
              >
                Open Chain Viewer
              </Button>
            </div>
            <div>
              <h5 className='mb-0'>Jolly II</h5>
              <span className='text-muted' style={{ fontSize: '14px' }}>
                Generate and view the Jolly results for this annotation set.
              </span>
              <div className='d-flex flex-row gap-2'>
                <Button
                  className='d-block mt-1'
                  variant='primary'
                  disabled={loading}
                  onClick={() => {
                    if (
                      jollyResultsExists &&
                      !window.confirm(
                        'Jolly results already exist for this annotation set. Recalculating will overwrite existing results. Continue?'
                      )
                    ) {
                      return;
                    }
                    generateSurveyResults();
                  }}
                >
                  Generate Results
                </Button>
                <Button
                  className='d-block mt-1'
                  variant='primary'
                  disabled={loading || !jollyResultsExists}
                  onClick={() => {
                    viewSurveyResults(annotationSet.id);
                  }}
                >
                  View Results
                </Button>
              </div>
            </div>
          </div>
        </Body>
        <Footer>
          <Button variant='dark' onClick={onClose} disabled={loading}>
            Close
          </Button>
        </Footer>
      </Modal>
      <GenerateJollyResults
        surveyId={surveyId}
        annotationSetId={annotationSet.id}
      />
    </>
  );
}
