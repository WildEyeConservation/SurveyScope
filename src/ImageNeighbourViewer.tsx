import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Row,
  Spinner,
  Table,
} from 'react-bootstrap';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { client } from './stores/appClient';
import {
  makeProjection,
  createImageMap,
  addImageTiles,
  fitPxBounds,
} from './annotator/imageTiles';
import { array2Matrix, makeTransform } from './utils';
import { inv } from 'mathjs';
import type { ImageNeighbourType, ImageType } from './schemaTypes';

type ImageDisplayData = {
  image: ImageType;
  cameraName: string | null;
  sourceKey: string | null;
  pixelPolygon: [number, number][];
};

type ComparisonResult = {
  imageA: ImageDisplayData;
  imageB: ImageDisplayData;
  neighbours: {
    forward: ImageNeighbourType | null;
    reverse: ImageNeighbourType | null;
  };
};

type TransformSummary = {
  toA?: (coords: [number, number]) => [number, number];
  toB?: (coords: [number, number]) => [number, number];
  toASource?: 'forward' | 'reverse';
  toBSource?: 'forward' | 'reverse';
};

const neighbourSelectionSet = [
  'image1Id',
  'image2Id',
  'homography',
  'updatedAt',
  'createdAt',
] as const;

const imageSelectionSet = [
  'id',
  'projectId',
  'timestamp',
  'width',
  'height',
  'cameraId',
  'cameraSerial',
  'camera.name',
] as const;

const imageFileSelectionSet = ['id', 'type', 'key'] as const;

function buildImageDisplayData(
  image: ImageType,
  sourceKey: string | null
): ImageDisplayData {
  const width = Number(image.width ?? 0);
  const height = Number(image.height ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height) {
    throw new Error(`Image ${image.id} is missing valid dimensions.`);
  }

  const pixelPolygon: [number, number][] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];

  const cameraName = (() => {
    const cameraData = image.camera;
    if (
      cameraData &&
      typeof cameraData === 'object' &&
      'name' in cameraData &&
      typeof (cameraData as { name?: string | null }).name === 'string'
    ) {
      const raw = (cameraData as { name?: string | null }).name ?? '';
      const trimmed = raw.trim();
      if (trimmed.length) {
        return trimmed;
      }
    }
    if (typeof image.cameraSerial === 'string' && image.cameraSerial.trim().length) {
      return image.cameraSerial.trim();
    }
    if (typeof image.cameraId === 'string' && image.cameraId.trim().length) {
      return image.cameraId.trim();
    }
    return null;
  })();

  return {
    image,
    cameraName,
    sourceKey,
    pixelPolygon,
  };
}

function projectPolygon(
  sourcePolygon: [number, number][],
  transform: ((coords: [number, number]) => [number, number]) | undefined
): [number, number][] | null {
  if (!transform) {
    return null;
  }
  try {
    const projected = sourcePolygon.map((point) => {
      const [x, y] = transform(point);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error('Transform produced invalid coordinates.');
      }
      return [x, y] as [number, number];
    });
    return projected;
  } catch (error) {
    console.error('Failed to project polygon', error);
    return null;
  }
}

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else {
    const numericValue = typeof value === 'string' ? Number(value) : value;
    if (typeof numericValue === 'number' && Number.isFinite(numericValue)) {
      const isSeconds = numericValue > 0 && numericValue < 1e12;
      const millis = isSeconds ? numericValue * 1000 : numericValue;
      date = new Date(millis);
    } else {
      date = new Date(value as any);
    }
  }
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return timestampFormatter.format(date);
}

export default function ImageNeighbourViewer() {
  const [imageIdA, setImageIdA] = useState('');
  const [imageIdB, setImageIdB] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);

  const loadComparison = useCallback(
    async (idA: string, idB: string) => {
      if (!idA || !idB) {
        setError('Please provide both image IDs.');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const [imageAData, imageBData] = await Promise.all([
          (async () => {
            const response = await client.models.Image.get(
              { id: idA },
              { selectionSet: imageSelectionSet }
            );
            if (!response?.data) {
              throw new Error(`Image ${idA} was not found.`);
            }

            const filesResp =
              await client.models.ImageFile.imagesByimageId(
                { imageId: idA },
                {
                  limit: 25,
                  selectionSet: imageFileSelectionSet,
                }
              );
            const files = filesResp?.data ?? [];
            const jpegFile =
              files.find((file: any) =>
                (file.type ?? '').toLowerCase().includes('jpeg')
              ) || files[0];
            return buildImageDisplayData(
              response.data as ImageType,
              jpegFile?.key ?? null
            );
          })(),
          (async () => {
            const response = await client.models.Image.get(
              { id: idB },
              { selectionSet: imageSelectionSet }
            );
            if (!response?.data) {
              throw new Error(`Image ${idB} was not found.`);
            }

            const filesResp =
              await client.models.ImageFile.imagesByimageId(
                { imageId: idB },
                {
                  limit: 25,
                  selectionSet: imageFileSelectionSet,
                }
              );
            const files = filesResp?.data ?? [];
            const jpegFile =
              files.find((file: any) =>
                (file.type ?? '').toLowerCase().includes('jpeg')
              ) || files[0];
            return buildImageDisplayData(
              response.data as ImageType,
              jpegFile?.key ?? null
            );
          })(),
        ]);

        const [forwardResp, reverseResp] = await Promise.all([
          client.models.ImageNeighbour.get(
            { image1Id: idA, image2Id: idB },
            { selectionSet: neighbourSelectionSet }
          ),
          client.models.ImageNeighbour.get(
            { image1Id: idB, image2Id: idA },
            { selectionSet: neighbourSelectionSet }
          ),
        ]);

        setComparison({
          imageA: imageAData,
          imageB: imageBData,
          neighbours: {
            forward: forwardResp?.data ?? null,
            reverse: reverseResp?.data ?? null,
          },
        });
      } catch (err: any) {
        console.error(err);
        setComparison(null);
        setError(
          err?.message ?? 'Unable to load the requested images or neighbours.'
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const transformSummary: TransformSummary = useMemo(() => {
    if (!comparison) return {};

    const { forward, reverse } = comparison.neighbours;
    const forwardMatrix = forward?.homography
      ? array2Matrix(forward.homography)
      : null;
    const reverseMatrix = reverse?.homography
      ? array2Matrix(reverse.homography)
      : null;

    const summary: TransformSummary = {};

    if (forwardMatrix) {
      try {
        summary.toB = makeTransform(forwardMatrix as any);
        summary.toBSource = 'forward';
      } catch (err) {
        console.error('Failed to build forward transform', err);
      }
      try {
        summary.toA = makeTransform(inv(forwardMatrix as any) as any);
        summary.toASource = 'forward';
      } catch (err) {
        console.error('Failed to build inverse forward transform', err);
      }
    }

    if (!summary.toB && reverseMatrix) {
      try {
        summary.toB = makeTransform(inv(reverseMatrix as any) as any);
        summary.toBSource = 'reverse';
      } catch (err) {
        console.error('Failed to invert reverse transform', err);
      }
    }

    if (!summary.toA && reverseMatrix) {
      try {
        summary.toA = makeTransform(reverseMatrix as any);
        summary.toASource = 'reverse';
      } catch (err) {
        console.error('Failed to build reverse transform', err);
      }
    }

    return summary;
  }, [comparison]);

  const overlayOnA = useMemo(() => {
    if (!comparison?.imageA || !comparison?.imageB) return null;
    return projectPolygon(
      comparison.imageB.pixelPolygon,
      transformSummary.toA
    );
  }, [comparison, transformSummary.toA]);

  const overlayOnB = useMemo(() => {
    if (!comparison?.imageA || !comparison?.imageB) return null;
    return projectPolygon(
      comparison.imageA.pixelPolygon,
      transformSummary.toB
    );
  }, [comparison, transformSummary.toB]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    loadComparison(imageIdA.trim(), imageIdB.trim());
  };

  return (
    <div className='w-100 p-3'>
      <Card className='w-100'>
        <Card.Header>
          <Card.Title className='mb-0'>Image Neighbour Viewer</Card.Title>
        </Card.Header>
        <Card.Body>
          <Form onSubmit={handleSubmit}>
            <Row className='g-3 align-items-end'>
              <Col md={5}>
                <Form.Group controlId='imageA'>
                  <Form.Label>Image ID A</Form.Label>
                  <Form.Control
                    value={imageIdA}
                    onChange={(e) => setImageIdA(e.target.value)}
                    placeholder='e.g. 123e4567-e89b-12d3-a456-426614174000'
                  />
                </Form.Group>
              </Col>
              <Col md={5}>
                <Form.Group controlId='imageB'>
                  <Form.Label>Image ID B</Form.Label>
                  <Form.Control
                    value={imageIdB}
                    onChange={(e) => setImageIdB(e.target.value)}
                    placeholder='e.g. 123e4567-e89b-12d3-a456-426614174001'
                  />
                </Form.Group>
              </Col>
              <Col md={2} className='d-grid'>
                <Button
                  variant='primary'
                  type='submit'
                  disabled={loading || !imageIdA || !imageIdB}
                >
                  {loading ? (
                    <>
                      <Spinner animation='border' size='sm' className='me-2' />
                      Loading
                    </>
                  ) : (
                    'Load pair'
                  )}
                </Button>
              </Col>
            </Row>
          </Form>
          {error && (
            <Alert variant='danger' className='mt-3 mb-0'>
              {error}
            </Alert>
          )}
        </Card.Body>
      </Card>

      {comparison && (
        <div className='d-flex flex-column gap-3 mt-3'>
          {!comparison.neighbours.forward && !comparison.neighbours.reverse && (
            <Alert variant='warning'>
              No ImageNeighbour records were found for this pair. The images are
              shown below without homography overlays.
            </Alert>
          )}
          {!comparison.neighbours.forward?.homography &&
            !comparison.neighbours.reverse?.homography &&
            (comparison.neighbours.forward || comparison.neighbours.reverse) && (
              <Alert variant='info'>
                One or more neighbour records were found, but no homography was
                stored for them.
              </Alert>
            )}
          <Row className='g-3'>
            <Col xs={12} xl={6}>
              <ImagePanel
                title='Image A'
                data={comparison.imageA}
                overlay={overlayOnA}
                overlayColor='#ffc107'
                overlayDescription={
                  overlayOnA
                    ? `Projected Image B using ${
                        transformSummary.toASource === 'reverse'
                          ? 'reverse'
                          : 'forward'
                      } record`
                    : undefined
                }
              />
            </Col>
            <Col xs={12} xl={6}>
              <ImagePanel
                title='Image B'
                data={comparison.imageB}
                overlay={overlayOnB}
                overlayColor='#0dcaf0'
                overlayDescription={
                  overlayOnB
                    ? `Projected Image A using ${
                        transformSummary.toBSource === 'reverse'
                          ? 'reverse'
                          : 'forward'
                      } record`
                    : undefined
                }
              />
            </Col>
          </Row>
          <NeighbourTable
            forward={comparison.neighbours.forward}
            reverse={comparison.neighbours.reverse}
          />
        </div>
      )}
    </div>
  );
}

function ImagePanel({
  title,
  data,
  overlay,
  overlayColor,
  overlayDescription,
}: {
  title: string;
  data: ImageDisplayData;
  overlay?: [number, number][] | null;
  overlayColor: string;
  overlayDescription?: string;
}) {
  const [rotation, setRotation] = useState(0);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pointerStateRef = useRef<{
    dragging: boolean;
    pointerId: number | null;
    last: { x: number; y: number } | null;
  }>({ dragging: false, pointerId: null, last: null });
  const rotateLeft = () =>
    setRotation((prev) => {
      const next = prev - 90;
      return next <= -270 ? next + 360 : next;
    });
  const rotateRight = () =>
    setRotation((prev) => {
      const next = prev + 90;
      return next >= 270 ? next - 360 : next;
    });
  const resetRotation = () => setRotation(0);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    const pointerState = pointerStateRef.current;

    if (rotation === 0) {
      map.dragPan.enable();
      pointerState.dragging = false;
      pointerState.pointerId = null;
      pointerState.last = null;
      return;
    }

    map.dragPan.disable();

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      pointerState.dragging = true;
      pointerState.pointerId = event.pointerId;
      pointerState.last = { x: event.clientX, y: event.clientY };
      try {
        container.setPointerCapture(event.pointerId);
      } catch (_) {}
      event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (
        !pointerState.dragging ||
        pointerState.pointerId !== event.pointerId ||
        !pointerState.last
      ) {
        return;
      }
      event.preventDefault();
      const dx = event.clientX - pointerState.last.x;
      const dy = event.clientY - pointerState.last.y;
      pointerState.last = { x: event.clientX, y: event.clientY };

      const angleRad = (-rotation * Math.PI) / 180;
      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      const adjX = dx * cos - dy * sin;
      const adjY = dx * sin + dy * cos;

      map.panBy([-adjX, -adjY], { duration: 0 });
    };

    const endDrag = (event: PointerEvent) => {
      if (
        pointerState.dragging &&
        pointerState.pointerId === event.pointerId
      ) {
        pointerState.dragging = false;
        pointerState.pointerId = null;
        pointerState.last = null;
        try {
          container.releasePointerCapture(event.pointerId);
        } catch (_) {}
        event.preventDefault();
      }
    };

    container.addEventListener('pointerdown', handlePointerDown, {
      passive: false,
    });
    container.addEventListener('pointermove', handlePointerMove, {
      passive: false,
    });
    container.addEventListener('pointerup', endDrag, { passive: false });
    container.addEventListener('pointerleave', endDrag, { passive: false });
    container.addEventListener('pointercancel', endDrag, { passive: false });

    return () => {
      pointerState.dragging = false;
      pointerState.pointerId = null;
      pointerState.last = null;
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', endDrag);
      container.removeEventListener('pointerleave', endDrag);
      container.removeEventListener('pointercancel', endDrag);
      map.dragPan.enable();
    };
  }, [rotation]);
  const width = Number(data.image.width ?? 0);
  const height = Number(data.image.height ?? 0);
  const timestampLabel = formatDate(
    data.image.timestamp as string | number | Date | null | undefined
  );
  const cameraName = data.cameraName;

  return (
    <Card className='w-100 h-100'>
      <Card.Header>
        <Card.Title className='mb-0'>{title}</Card.Title>
      </Card.Header>
      <Card.Body
        className='p-0'
        style={{ height: '520px', padding: '16px', overflow: 'hidden' }}
      >
        <div
          className='w-100 h-100 position-relative rounded'
          style={{ overflow: 'hidden' }}
        >
          <div
            className='w-100 h-100'
            style={{
              transform: `rotate(${rotation}deg)`,
              transformOrigin: 'center center',
            }}
          >
            <NeighbourMap
              key={data.image.id}
              data={data}
              overlay={overlay ?? null}
              overlayColor={overlayColor}
              overlayDescription={overlayDescription}
              onMapReady={(instance) => {
                mapRef.current = instance;
              }}
            />
          </div>
        </div>
      </Card.Body>
      <Card.Footer className='small text-muted d-flex flex-column gap-1'>
        <div>
          <strong>ID:</strong> {data.image.id}
        </div>
        <div>
          <strong>Size:</strong> {width.toLocaleString()} ×{' '}
          {height.toLocaleString()} px
        </div>
        {timestampLabel && (
          <div>
            <strong>Timestamp:</strong> {timestampLabel}
          </div>
        )}
        {cameraName && (
          <div>
            <strong>Camera:</strong> {cameraName}
          </div>
        )}
        {!data.sourceKey && (
          <div>
            <Badge bg='warning' text='dark'>
              No JPEG tiles found for this image – showing overlays only.
            </Badge>
          </div>
        )}
        <div className='mt-2 d-flex flex-column gap-2'>
          <div className='d-flex align-items-center justify-content-between'>
            <strong className='me-2 mb-0'>Rotation</strong>
            <span>{rotation}°</span>
          </div>
          <div className='d-flex gap-2'>
            <Button
              variant='outline-secondary'
              size='sm'
              onClick={rotateLeft}
            >
              −90°
            </Button>
            <Button
              variant='outline-secondary'
              size='sm'
              onClick={rotateRight}
            >
              +90°
            </Button>
            <Button
              variant='outline-secondary'
              size='sm'
              onClick={resetRotation}
              disabled={rotation === 0}
            >
              Reset
            </Button>
          </div>
        </div>
      </Card.Footer>
    </Card>
  );
}

function NeighbourTable({
  forward,
  reverse,
}: {
  forward: ImageNeighbourType | null;
  reverse: ImageNeighbourType | null;
}) {
  if (!forward && !reverse) {
    return null;
  }

  const records = [
    forward && { id: 'forward', label: 'Image A → Image B', record: forward },
    reverse && { id: 'reverse', label: 'Image B → Image A', record: reverse },
  ].filter(Boolean) as { id: string; label: string; record: ImageNeighbourType }[];

  const handleCopy = async (values?: number[] | null) => {
    if (!values?.length) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(values));
    } catch (error) {
      console.error('Failed to copy homography', error);
    }
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title className='mb-0'>Neighbour records</Card.Title>
      </Card.Header>
      <Table responsive className='mb-0'>
        <thead>
          <tr>
            <th scope='col'>Direction</th>
            <th scope='col'>Has homography</th>
            <th scope='col'>Updated</th>
            <th scope='col'>Created</th>
            <th scope='col' className='text-end'>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map(({ id, label, record }) => {
            const hasHomography = Boolean(
              record.homography && record.homography.length === 9
            );
            return (
              <tr key={id}>
                <td>{label}</td>
                <td>
                  {hasHomography ? (
                    <Badge bg='success'>Yes</Badge>
                  ) : (
                    <Badge bg='secondary'>No</Badge>
                  )}
                </td>
                <td>
                  {formatDate(record.updatedAt) ?? '—'}
                </td>
                <td>
                  {formatDate(record.createdAt) ?? '—'}
                </td>
                <td className='text-end'>
                  <Button
                    size='sm'
                    variant='outline-secondary'
                    disabled={!hasHomography}
                    onClick={() => handleCopy(record.homography)}
                  >
                    Copy homography
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}


function NeighbourMap({
  data,
  overlay,
  overlayColor,
  overlayDescription,
  onMapReady,
}: {
  data: ImageDisplayData;
  overlay: [number, number][] | null;
  overlayColor: string;
  overlayDescription?: string;
  onMapReady: (map: maplibregl.Map | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const width = Number(data.image.width ?? 0);
  const height = Number(data.image.height ?? 0);

  useEffect(() => {
    if (!containerRef.current || !data.sourceKey || !width || !height) return;
    const projection = makeProjection(width, height);
    const map = createImageMap(containerRef.current, projection);

    const toRing = (polygon: [number, number][]) =>
      [...polygon, polygon[0]].map(([x, y]) => projection.px2lngLat(x, y));

    map.on('load', () => {
      addImageTiles(map, data.sourceKey!, { width, height }, projection);

      map.addSource('image-bounds', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [toRing(data.pixelPolygon)] },
          properties: {},
        },
      });
      map.addLayer({
        id: 'image-bounds-line',
        type: 'line',
        source: 'image-bounds',
        paint: {
          'line-color': '#198754',
          'line-width': 1,
          'line-dasharray': [6, 4],
        },
      });

      if (overlay) {
        map.addSource('projected-overlap', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [toRing(overlay)] },
            properties: {},
          },
        });
        map.addLayer({
          id: 'projected-overlap-fill',
          type: 'fill',
          source: 'projected-overlap',
          paint: { 'fill-color': overlayColor, 'fill-opacity': 0.15 },
        });
        map.addLayer({
          id: 'projected-overlap-line',
          type: 'line',
          source: 'projected-overlap',
          paint: { 'line-color': overlayColor, 'line-width': 2 },
        });

        if (overlayDescription) {
          const popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
          });
          map.on('mousemove', 'projected-overlap-fill', (e) => {
            popup
              .setLngLat(e.lngLat)
              .setText(overlayDescription)
              .addTo(map);
          });
          map.on('mouseleave', 'projected-overlap-fill', () => popup.remove());
        }
      }

      fitPxBounds(map, projection, 0, 0, width, height);
      onMapReady(map);
    });

    return () => {
      onMapReady(null);
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.sourceKey, data.image.id, overlay, overlayColor, overlayDescription]);

  if (!data.sourceKey) {
    return (
      <div className='w-100 h-100 d-flex align-items-center justify-content-center text-muted'>
        No image file available
      </div>
    );
  }
  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
