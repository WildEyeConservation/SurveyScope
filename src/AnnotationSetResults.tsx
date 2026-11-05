import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import exportFromJSON from 'export-from-json';
import {
  ChartColumnIcon,
  DownloadIcon,
  SearchIcon,
  WaypointsIcon,
} from 'lucide-react';
import {
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  chainsMarkedOutside,
  createStratumAssigner,
  isAnnotationOnEffort,
  isOnEffort,
  type BoundaryStatus,
  type LatLngRing,
} from '../shared/boundaryStatus';
import { neutraliseCsvRows } from '../shared/csv';
import {
  hasDistanceInputs,
  perpendicularDistance,
} from '../shared/distanceSampling';
import { outsideBoundaryFields } from './annotationBoundary';
import { useUsers } from './apiInterface';
import { GlobalContext } from './Context.tsx';
import GenerateJollyResults from './GenerateJollyResults.tsx';
import { fetchAllInfoTagsForSet, formatInfoTagsForCsv } from './infoTags';
import { Body, Footer, Header, Modal, Title } from './Modal';
import { loadProjectImages } from './projectImages';
import { loadRows } from './rowChunks';
import { fetchAllPaginatedResults } from './utils.tsx';

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
    (n): n is number => typeof n === 'number' && Number.isFinite(n),
  );
  const ring: LatLngRing = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    ring.push([flat[i], flat[i + 1]]);
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
  const [exportError, setExportError] = useState('');
  const { users } = useUsers();

  const userMap = useMemo(() => {
    return users.reduce(
      (acc, user) => {
        acc[user.id] = user.name ?? '';
        return acc;
      },
      {} as Record<string, string>,
    );
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
          { surveyId, selectionSet: ['annotationSetId'] },
        );
        if (mounted) {
          setJollyResultsExists(
            data.some((r) => r.annotationSetId === annotationSet.id),
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
      { selectionSet: ['name'] },
    );

    if (!survey) throw new Error('Survey not found');

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
              ...outsideBoundaryFields<'outsideBoundary'>(),
            ],
            {
              onProgress: (count) => {
                fetched = count;
                setExportStatus(`Fetching annotations... (${fetched} fetched)`);
              },
            },
          ),
        ),
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

    const categoryMap = categories.reduce(
      (acc, category) => {
        acc[category.id] = category.name ?? '';
        return acc;
      },
      {} as Record<string, string>,
    );

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
      strata.map((stratum) => flatToRing(stratum.coordinates)),
    );
    const stratumName = (image: {
      latitude?: number | null;
      longitude?: number | null;
      boundaryStatus?: string | null;
    }) => {
      if (!isOnEffort(image.boundaryStatus as BoundaryStatus | null))
        return 'None';
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
      },
    );
    const cameraById = new Map(cameras.map((camera) => [camera.id, camera]));

    const infoTagsBySet = await Promise.all(
      annotationSets.map((set) =>
        fetchAllInfoTagsForSet(client, set.id, (count) => {
          setExportStatus(`Fetching info tags... (${count} fetched)`);
        }),
      ),
    );

    let i = 0;
    let a = 0;

    for (const rows of annotationSetsResult) {
      a += rows.length;
      const markedChains = chainsMarkedOutside(rows);
      const annotations = rows.map((anno) => {
        const image = imageById.get(anno.imageId ?? '') ?? NO_IMAGE;
        const marked = markedChains.has(anno.objectId ?? anno.id);
        return {
          ...anno,
          image,
          onEffort: isAnnotationOnEffort(
            image.boundaryStatus as BoundaryStatus | null,
            marked,
          ),
        };
      });

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
        data: neutraliseCsvRows(
          annotations.map((anno, index) => {
            return {
              category: categoryMap[anno.categoryId ?? ''] || 'Unknown',
              image: anno.image.originalPath || 'Unknown',
              transect: anno.image.transectId || 'Unknown',
              stratum: anno.onEffort ? stratumName(anno.image) : 'None',
              surveyArea: anno.onEffort ? 'inside' : 'outside',
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
                      perpendicularDistance(distanceInputs[index]),
                    ),
                  }
                : {}),
              source: anno.source,
              infoTags: formatInfoTagsForCsv(
                infoTagsBySet[i].get(anno.id) ?? [],
              ),
              infoTaggedBy: userMap[anno.infoTaggedBy ?? ''],
              reviewedBy: userMap[anno.reviewedBy ?? ''],
              reviewedCategory: categoryMap[anno.reviewCatId ?? ''],
            };
          }),
        ),
        fileName,
        exportType,
      });

      i++;
    }

    setExportStatus(`Exported ${a} annotations`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
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

  const exporting = exportStatus !== '';
  const actions: {
    icon: ReactNode;
    title: string;
    detail: ReactNode;
    buttons: ReactNode;
  }[] = [
    {
      icon: <SearchIcon />,
      title: 'Explore',
      detail: 'Go through the annotations freely, outside of a workflow.',
      buttons: (
        <Button
          variant='primary'
          onClick={() =>
            navigate(`/surveys/${surveyId}/set/${annotationSet.id}/review`)
          }
        >
          Explore
        </Button>
      ),
    },
    {
      icon: <DownloadIcon />,
      title: 'CSV export',
      detail: exporting ? (
        <span className='flex items-center gap-2'>
          <Spinner size='sm' />
          {exportStatus}
        </span>
      ) : exportError ? (
        <span className='text-danger'>{exportError}</span>
      ) : (
        'Every annotation with its related data.'
      ),
      buttons: (
        <Button
          variant='primary'
          disabled={users.length === 0 || exporting}
          title={users.length === 0 ? 'Loading users...' : undefined}
          onClick={() => {
            setExportError('');
            exportData([annotationSet]).catch((error) => {
              console.error('CSV export failed', error);
              setExportStatus('');
              setExportError('The export failed. Try again.');
            });
          }}
        >
          {exporting ? 'Exporting...' : 'Download'}
        </Button>
      ),
    },
    {
      icon: <WaypointsIcon />,
      title: 'Chain Viewer',
      detail:
        'Each primary annotation with its linked sightings across neighbouring images.',
      buttons: (
        <Button
          variant='primary'
          onClick={() =>
            navigate(
              `/surveys/${surveyId}/set/${annotationSet.id}/chain-viewer`,
            )
          }
        >
          Open
        </Button>
      ),
    },
    {
      icon: <ChartColumnIcon />,
      title: 'Jolly II',
      detail: loading
        ? 'Checking for results...'
        : jollyResultsExists
          ? 'Population estimates are ready. Regenerate after changing annotations.'
          : 'Population estimates for this annotation set.',
      buttons: jollyResultsExists ? (
        <>
          <Button
            variant='outline-primary'
            disabled={loading}
            onClick={() => {
              if (
                window.confirm(
                  'Regenerating replaces the existing Jolly results for this annotation set. Continue?',
                )
              ) {
                generateSurveyResults();
              }
            }}
          >
            Regenerate
          </Button>
          <Button
            variant='primary'
            disabled={loading}
            onClick={() => viewSurveyResults(annotationSet.id)}
          >
            View
          </Button>
        </>
      ) : (
        <Button
          variant='primary'
          disabled={loading}
          onClick={generateSurveyResults}
        >
          Generate
        </Button>
      ),
    },
  ];

  return (
    <>
      <Modal show={show} onHide={onClose} strict={true} size='lg'>
        <Header>
          <Title>{annotationSet.name} Results</Title>
        </Header>
        <Body>
          <div className='p-4'>
            <div className='divide-y divide-white/10 border border-white/15 bg-white/[0.07]'>
              {actions.map((action) => (
                <div
                  key={action.title}
                  className='flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3'
                >
                  <span className='text-muted-foreground [&_svg]:size-5'>
                    {action.icon}
                  </span>
                  <div className='flex min-w-0 flex-1 flex-col'>
                    <span className='font-semibold'>{action.title}</span>
                    <span className='text-sm text-muted-foreground'>
                      {action.detail}
                    </span>
                  </div>
                  <div className='flex gap-2'>{action.buttons}</div>
                </div>
              ))}
            </div>
          </div>
        </Body>
        <Footer>
          <Button variant='ghost' className='mr-auto' onClick={onClose}>
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
