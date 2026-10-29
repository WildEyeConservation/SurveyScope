import { Button } from 'react-bootstrap';
import { Modal, Body, Header, Footer, Title } from './Modal';
import { useNavigate } from 'react-router-dom';
import { fetchAllPaginatedResults } from './utils.tsx';
import { loadRows } from './rowChunks';
import { loadProjectImages } from './projectImages';
import exportFromJSON from 'export-from-json';
import { neutraliseCsvRows } from '../shared/csv';
import { GlobalContext } from './Context.tsx';
import { useContext, useState, useEffect, useMemo } from 'react';
import { useUsers } from './apiInterface';
import GenerateJollyResults from './GenerateJollyResults.tsx';
import { Spinner } from 'react-bootstrap';
import {
  fetchAllInfoTagsForSet,
  formatInfoTagsForCsv,
} from './infoTags';
import {
  createStratumAssigner,
  isOnEffort,
  type BoundaryStatus,
  type LatLngRing,
} from '../shared/boundaryStatus';
import {
  hasDistanceInputs,
  perpendicularDistance,
} from '../shared/distanceSampling';

const NO_IMAGE = {
  originalPath: null,
  timestamp: null,
  latitude: null,
  longitude: null,
  transectId: null,
  boundaryStatus: null,
  altitude_agl: null,
  width: null,
  height: null,
  cameraId: null,
};

const formatDistance = (distance: number | null) =>
  distance === null ? '' : Math.round(distance * 100) / 100;

function flatToRing(coordinates: (number | null)[] | null | undefined) {
  const flat = (coordinates ?? []).filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n)
  );
  const ring: LatLngRing = [];
  for (let i = 0; i + 1 < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
  return ring.length >= 3 ? ring : null;
}

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
  const { client, showModal } = useContext(GlobalContext)!;
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
  }, [client, surveyId, annotationSet.id]);

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

    let fetched = 0;
    const [annotationSetsResult, images, categories] = await Promise.all([
      Promise.all(
        annotationSets.map((annotationSet) =>
          loadRows(
            client,
            'annotationsByAnnotationSetId',
            annotationSet.id,
            [
              'y',
              'x',
              'categoryId',
              'imageId',
              'owner',
              'source',
              'obscured',
              'objectId',
              'reviewCatId',
              'reviewedBy',
              'infoTaggedBy',
            ],
            {
              onProgress: (count) => {
                fetched = count;
                setExportStatus(`Fetching annotations... (${fetched} fetched)`);
              },
            }
          )
        )
      ),
      loadProjectImages(client, surveyId, [
        'originalPath',
        'timestamp',
        'latitude',
        'longitude',
        'transectId',
        'boundaryStatus',
        'altitude_agl',
        'width',
        'height',
        'cameraId',
      ]),
      loadRows(client, 'categoriesByProjectId', surveyId, ['name']),
    ]);
    const imageById = new Map(images.map((image) => [image.id, image]));

    const categoryMap = categories.reduce((acc, category) => {
      acc[category.id] = category.name ?? '';
      return acc;
    }, {} as Record<string, string>);

    setExportStatus('Fetching strata...');
    const strata = (
      await fetchAllPaginatedResults(client.models.Stratum.strataByProjectId, {
        projectId: surveyId,
        selectionSet: ['name', 'coordinates', 'offEffort'],
        limit: 1000,
      })
    ).filter((stratum) => !stratum.offEffort);
    // Matches the Jolly calculation: by position, not by transect.
    const assignStratum = createStratumAssigner(
      strata.map((stratum) => flatToRing(stratum.coordinates))
    );
    const stratumName = (image: {
      latitude?: number | null;
      longitude?: number | null;
      boundaryStatus?: string | null;
    }) => {
      if (!isOnEffort(image.boundaryStatus as BoundaryStatus | null)) return 'None';
      if (
        typeof image.latitude !== 'number' ||
        typeof image.longitude !== 'number'
      ) {
        return 'Unknown';
      }
      const index = assignStratum(image.latitude, image.longitude);
      return index === null ? 'Unknown' : strata[index].name || 'Unknown';
    };

    setExportStatus('Fetching cameras...');
    const cameras = await fetchAllPaginatedResults(
      client.models.Camera.camerasByProjectId,
      {
        projectId: surveyId,
        selectionSet: [
          'id',
          'focalLengthMm',
          'sensorWidthMm',
          'tiltDegrees',
        ] as const,
      }
    );
    const cameraById = new Map(cameras.map((camera) => [camera.id, camera]));

    const infoTagsBySet = await Promise.all(
      annotationSets.map((set) =>
        fetchAllInfoTagsForSet(client, set.id, (count) => {
          setExportStatus(`Fetching info tags... (${count} fetched)`);
        })
      )
    );

    let i = 0;
    let a = 0;

    for (const rows of annotationSetsResult) {
      a += rows.length;
      const annotations = rows.map((anno) => ({
        ...anno,
        image: imageById.get(anno.imageId ?? '') ?? NO_IMAGE,
      }));

      const fileName = `SurveyScope-${survey.name}-${annotationSets[i].name}`;
      const exportType = exportFromJSON.types.csv;
      const distanceInputs = annotations.map((anno) => ({
        y: anno.y,
        imageWidth: anno.image.width,
        imageHeight: anno.image.height,
        altitudeAgl: anno.image.altitude_agl,
        camera: cameraById.get(anno.image.cameraId ?? ''),
      }));
      const includeDistance = distanceInputs.every(hasDistanceInputs);
      exportFromJSON({
        data: neutraliseCsvRows(annotations.map((anno, index) => {
          return {
            category: categoryMap[anno.categoryId ?? ''] || 'Unknown',
            image: anno.image.originalPath || 'Unknown',
            transect: anno.image.transectId || 'Unknown',
            stratum: stratumName(anno.image),
            surveyArea: anno.image.boundaryStatus ?? 'inside',
            timestamp: anno.image.timestamp,
            latitude: anno.image.latitude,
            longitude: anno.image.longitude,
            obscured: anno.obscured ?? false,
            annotator: userMap[anno.owner ?? ''] || 'Unknown',
            isPrimary: anno.objectId === anno.id,
            x: anno.x,
            y: anno.y,
            ...(includeDistance
              ? {
                  perpendicularDistanceM: formatDistance(
                    perpendicularDistance(distanceInputs[index])
                  ),
                }
              : {}),
            source: anno.source,
            infoTags: formatInfoTagsForCsv(
              infoTagsBySet[i].get(anno.id) ?? []
            ),
            infoTaggedBy: userMap[anno.infoTaggedBy ?? ''],
            reviewedBy: userMap[anno.reviewedBy ?? ''],
            reviewedCategory: categoryMap[anno.reviewCatId ?? ''],
          };
        })),
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
