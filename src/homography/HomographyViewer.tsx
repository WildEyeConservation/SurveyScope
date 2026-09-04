import { useState, useCallback, useMemo, useEffect } from 'react';
import { Form, Button, Alert, Spinner, Badge, Card } from 'react-bootstrap';
import { matrix, inv } from 'mathjs';
import type { Matrix } from 'mathjs';
import { useSession } from '../session';
import { client } from '../stores/appClient';
import { MapLibrePairViewer } from './MapLibrePairViewer';
import { makeTransform, fetchAllPaginatedResults } from '../utils';
import type { ImageType } from '../schemaTypes';

type CameraOption = { id: string; name: string };

type ProjectPair = {
  image1Id: string;
  image2Id: string;
  camera1Id: string | null;
  camera2Id: string | null;
  hasHomography: boolean;
};

type LoadedPair = {
  images: [ImageType, ImageType];
  homography: Matrix;
  source: 'manual' | 'random-from-project';
  rec: {
    image1Id: string;
    image2Id: string;
    homographySource?: string | null;
    skipped?: boolean | null;
  };
  reversedDirection: boolean;
};

export default function HomographyViewer() {
  const { cognitoGroups } = useSession();
  const isSysadmin = cognitoGroups.includes('sysadmin');

  const [image1IdInput, setImage1IdInput] = useState('');
  const [image2IdInput, setImage2IdInput] = useState('');

  const [projectIdInput, setProjectIdInput] = useState('');
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraOption[] | null>(null);
  const [camerasLoading, setCamerasLoading] = useState(false);
  const [cameraAId, setCameraAId] = useState('');
  const [cameraBId, setCameraBId] = useState('');

  // Cached list of (image1Id, image2Id, camera1Id, camera2Id, hasHomography)
  // for the currently loaded project — populated lazily the first time
  // "Random Pair" is clicked, since fetching all images + neighbours is heavy.
  const [projectPairs, setProjectPairs] = useState<ProjectPair[] | null>(null);
  const [projectPairsLoading, setProjectPairsLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pair, setPair] = useState<LoadedPair | null>(null);

  // Wipe stale project-scoped state if the project ID changes after a previous load.
  useEffect(() => {
    if (loadedProjectId && projectIdInput.trim() !== loadedProjectId) {
      setCameras(null);
      setLoadedProjectId(null);
      setCameraAId('');
      setCameraBId('');
      setProjectPairs(null);
    }
  }, [projectIdInput, loadedProjectId]);

  const handleLoadCameras = useCallback(async () => {
    const projectId = projectIdInput.trim();
    if (!projectId) return;
    setCamerasLoading(true);
    setError(null);
    try {
      const { data } = await client.models.Camera.camerasByProjectId(
        { projectId },
        { selectionSet: ['id', 'name'], limit: 1000 }
      );
      const list: CameraOption[] = (data ?? [])
        .filter((c: { id?: string | null; name?: string | null }) => !!c?.id && !!c?.name)
        .map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (list.length === 0) {
        throw new Error(`No cameras found for project ${projectId}`);
      }
      setCameras(list);
      setLoadedProjectId(projectId);
      setCameraAId('');
      setCameraBId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCameras(null);
      setLoadedProjectId(null);
    } finally {
      setCamerasLoading(false);
    }
  }, [projectIdInput]);

  const fetchPair = useCallback(
    async (id1: string, id2: string, source: LoadedPair['source']) => {
      const [img1Resp, img2Resp] = await Promise.all([
        client.models.Image.get({ id: id1 }),
        client.models.Image.get({ id: id2 }),
      ]);
      if (!img1Resp?.data) throw new Error(`Image ${id1} not found`);
      if (!img2Resp?.data) throw new Error(`Image ${id2} not found`);

      const fwd = await client.models.ImageNeighbour.get({
        image1Id: id1,
        image2Id: id2,
      });
      const rev = fwd?.data
        ? null
        : await client.models.ImageNeighbour.get({
            image1Id: id2,
            image2Id: id1,
          });

      const rec = fwd?.data ?? rev?.data;
      if (!rec) throw new Error('No ImageNeighbour record for this pair');
      if (!rec.homography || rec.homography.length !== 9) {
        throw new Error('Pair exists but has no stored homography');
      }

      const flat = rec.homography.filter(
        (v: unknown): v is number => typeof v === 'number'
      );
      if (flat.length !== 9) throw new Error('Stored homography is malformed');

      let H = matrix([
        [flat[0], flat[1], flat[2]],
        [flat[3], flat[4], flat[5]],
        [flat[6], flat[7], flat[8]],
      ]) as Matrix;

      // The DB always stores H in the recorded image1→image2 direction. If the
      // user typed the pair in the other order, invert so id1→id2 still holds.
      const reversedDirection = !fwd?.data;
      if (reversedDirection) H = inv(H) as Matrix;

      setPair({
        images: [img1Resp.data as ImageType, img2Resp.data as ImageType],
        homography: H,
        source,
        rec: {
          image1Id: rec.image1Id,
          image2Id: rec.image2Id,
          homographySource: rec.homographySource ?? null,
          skipped: rec.skipped ?? null,
        },
        reversedDirection,
      });
    },
    []
  );

  const handleLoadManual = useCallback(async () => {
    const id1 = image1IdInput.trim();
    const id2 = image2IdInput.trim();
    if (!id1 || !id2) return;
    setLoading(true);
    setError(null);
    setPair(null);
    try {
      await fetchPair(id1, id2, 'manual');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [image1IdInput, image2IdInput, fetchPair]);

  const fetchProjectPairs = useCallback(
    async (projectId: string): Promise<ProjectPair[]> => {
      // We can't rely on the cameraPairKey GSI here because pairs created by
      // ad-hoc container runs bypass the bucketing lambda and leave that key
      // null. Instead, walk every image's hasMany relations and dedupe.
      const rawImages = (await fetchAllPaginatedResults(
        client.models.Image.imagesByProjectId,
        {
          projectId,
          selectionSet: [
            'id',
            'cameraId',
            'leftNeighbours.image1Id',
            'leftNeighbours.image2Id',
            'leftNeighbours.homography',
            'rightNeighbours.image1Id',
            'rightNeighbours.image2Id',
            'rightNeighbours.homography',
          ],
          limit: 1000,
        }
      )) as Array<{
        id: string;
        cameraId?: string | null;
        leftNeighbours?: Array<{
          image1Id: string;
          image2Id: string;
          homography?: (number | null)[] | null;
        }> | null;
        rightNeighbours?: Array<{
          image1Id: string;
          image2Id: string;
          homography?: (number | null)[] | null;
        }> | null;
      }>;

      const imageCamera = new Map<string, string | null>();
      for (const img of rawImages) imageCamera.set(img.id, img.cameraId ?? null);

      const seen = new Map<string, ProjectPair>();
      const ingest = (n: {
        image1Id: string;
        image2Id: string;
        homography?: (number | null)[] | null;
      }) => {
        const key = `${n.image1Id}#${n.image2Id}`;
        if (seen.has(key)) return;
        seen.set(key, {
          image1Id: n.image1Id,
          image2Id: n.image2Id,
          camera1Id: imageCamera.get(n.image1Id) ?? null,
          camera2Id: imageCamera.get(n.image2Id) ?? null,
          hasHomography: !!n.homography && n.homography.length === 9,
        });
      };
      for (const img of rawImages) {
        for (const n of img.leftNeighbours ?? []) ingest(n);
        for (const n of img.rightNeighbours ?? []) ingest(n);
      }
      return Array.from(seen.values());
    },
    []
  );

  const handleLoadRandomPair = useCallback(async () => {
    const camA = cameraAId;
    const camB = cameraBId;
    if (!camA || !camB || !loadedProjectId) return;
    setLoading(true);
    setError(null);
    setPair(null);
    try {
      let pairs = projectPairs;
      if (!pairs) {
        setProjectPairsLoading(true);
        pairs = await fetchProjectPairs(loadedProjectId);
        setProjectPairs(pairs);
        setProjectPairsLoading(false);
      }

      // For same-camera mode (camA === camB) both endpoints must be that camera.
      // For cross-camera mode the unordered pair of camera IDs must equal {camA, camB}.
      const sameCamera = camA === camB;
      const candidates = pairs.filter((p) => {
        if (!p.hasHomography) return false;
        if (!p.camera1Id || !p.camera2Id) return false;
        if (sameCamera) return p.camera1Id === camA && p.camera2Id === camA;
        return (
          (p.camera1Id === camA && p.camera2Id === camB) ||
          (p.camera1Id === camB && p.camera2Id === camA)
        );
      });

      if (candidates.length === 0) {
        throw new Error(
          sameCamera
            ? `No pairs with a stored homography found within this camera`
            : `No pairs with a stored homography found between the two selected cameras`
        );
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      setImage1IdInput(pick.image1Id);
      setImage2IdInput(pick.image2Id);
      await fetchPair(pick.image1Id, pick.image2Id, 'random-from-project');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProjectPairsLoading(false);
    } finally {
      setLoading(false);
    }
  }, [
    cameraAId,
    cameraBId,
    loadedProjectId,
    projectPairs,
    fetchProjectPairs,
    fetchPair,
  ]);

  const previewTransforms = useMemo(() => {
    if (!pair) return null;
    try {
      const fwd = makeTransform(pair.homography);
      const back = makeTransform(inv(pair.homography));
      return [fwd, back] as [
        (c: [number, number]) => [number, number],
        (c: [number, number]) => [number, number],
      ];
    } catch {
      return null;
    }
  }, [pair]);

  // Empty, stable refs so MapLibrePairViewer doesn't think points have changed.
  const emptyPoints = useMemo(
    () => [[], []] as [never[], never[]],
    []
  );
  const noopSetter = useCallback(() => {}, []);
  const noopAction = useCallback(() => {}, []);

  if (!isSysadmin) {
    return (
      <Card
        className='w-100'
        style={{
          maxWidth: '720px',
          marginTop: '12px',
          marginBottom: '12px',
          height: 'fit-content',
        }}
      >
        <Card.Header>
          <Card.Title className='mb-0'>
            <h4 className='mb-0'>Restricted</h4>
          </Card.Title>
        </Card.Header>
        <Card.Body>
          <Card.Text>
            The homography sanity-check viewer is only available to system
            administrators.
          </Card.Text>
        </Card.Body>
      </Card>
    );
  }

  return (
    <div className='p-3 d-flex flex-column gap-3' style={{ height: '100vh' }}>
      <div>
        <h4 className='mb-1'>Homography Sanity Check</h4>
        <p className='small mb-0' style={{ opacity: 0.75 }}>
          Loads a stored ImageNeighbour homography and renders it across both
          images via the same preview transform the manual workbench uses. Hover
          / click an image to verify the correspondence visually.
        </p>
      </div>

      <Form
        onSubmit={(e) => {
          e.preventDefault();
          handleLoadManual();
        }}
      >
        <div className='d-flex flex-wrap gap-3 align-items-end'>
          <Form.Group>
            <Form.Label className='small mb-1'>Image 1 ID</Form.Label>
            <Form.Control
              size='sm'
              value={image1IdInput}
              onChange={(e) => setImage1IdInput(e.target.value)}
              placeholder='uuid'
              style={{ width: '300px' }}
              spellCheck={false}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label className='small mb-1'>Image 2 ID</Form.Label>
            <Form.Control
              size='sm'
              value={image2IdInput}
              onChange={(e) => setImage2IdInput(e.target.value)}
              placeholder='uuid'
              style={{ width: '300px' }}
              spellCheck={false}
            />
          </Form.Group>
          <Button
            size='sm'
            type='submit'
            variant='primary'
            disabled={loading || !image1IdInput.trim() || !image2IdInput.trim()}
          >
            Load Pair
          </Button>

          <div className='border-start mx-2' style={{ height: '2.25rem' }} />

          <Form.Group>
            <Form.Label className='small mb-1'>Project ID</Form.Label>
            <div className='d-flex gap-2'>
              <Form.Control
                size='sm'
                value={projectIdInput}
                onChange={(e) => setProjectIdInput(e.target.value)}
                placeholder='uuid'
                style={{ width: '260px' }}
                spellCheck={false}
              />
              <Button
                size='sm'
                type='button'
                variant='outline-secondary'
                disabled={camerasLoading || !projectIdInput.trim()}
                onClick={handleLoadCameras}
              >
                {camerasLoading ? 'Loading…' : 'Load Cameras'}
              </Button>
            </div>
          </Form.Group>
          <Form.Group>
            <Form.Label className='small mb-1'>Camera A</Form.Label>
            <Form.Select
              size='sm'
              value={cameraAId}
              onChange={(e) => setCameraAId(e.target.value)}
              disabled={!cameras}
              style={{ width: '220px' }}
            >
              <option value=''>
                {cameras ? 'Select a camera…' : 'Load cameras first'}
              </option>
              {cameras?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label className='small mb-1'>Camera B</Form.Label>
            <Form.Select
              size='sm'
              value={cameraBId}
              onChange={(e) => setCameraBId(e.target.value)}
              disabled={!cameras}
              style={{ width: '220px' }}
            >
              <option value=''>
                {cameras ? 'Select a camera…' : 'Load cameras first'}
              </option>
              {cameras?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          <Button
            size='sm'
            type='button'
            variant='outline-primary'
            disabled={loading || projectPairsLoading || !cameraAId || !cameraBId}
            onClick={handleLoadRandomPair}
          >
            {projectPairsLoading
              ? 'Fetching project pairs…'
              : cameraAId && cameraBId && cameraAId === cameraBId
              ? 'Random Same-Camera Pair'
              : 'Random Cross-Camera Pair'}
          </Button>
        </div>
      </Form>

      {loading && (
        <div className='d-flex align-items-center gap-2'>
          <Spinner animation='border' size='sm' />
          <span className='small'>Loading pair…</span>
        </div>
      )}

      {error && (
        <Alert variant='danger' className='py-2 px-3 small mb-0'>
          {error}
        </Alert>
      )}

      {pair && (
        <>
          <div className='d-flex flex-wrap gap-2 align-items-center small' style={{ opacity: 0.85 }}>
            <Badge bg='secondary'>
              Source: {pair.rec.homographySource ?? 'unknown'}
            </Badge>
            <Badge bg={pair.reversedDirection ? 'warning' : 'info'}>
              {pair.reversedDirection
                ? 'DB direction reversed (H inverted for display)'
                : 'DB direction matches input'}
            </Badge>
            {pair.rec.skipped ? <Badge bg='danger'>skipped</Badge> : null}
            <span className='ms-2 mono'>
              DB record: {pair.rec.image1Id} → {pair.rec.image2Id}
            </span>
          </div>
          <div className='flex-grow-1' style={{ minHeight: 0 }}>
            <MapLibrePairViewer
              key={`maplibre-viewer-${pair.images[0].id}::${pair.images[1].id}`}
              images={pair.images}
              points={emptyPoints}
              setPoints={[noopSetter, noopSetter]}
              previewTransforms={previewTransforms}
              onAction={noopAction}
            />
          </div>
        </>
      )}
    </div>
  );
}
