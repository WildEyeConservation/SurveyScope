import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  ChangeEvent,
} from 'react';
import Form from 'react-bootstrap/Form';
import Spinner from 'react-bootstrap/Spinner';
import { client } from './stores/appClient';
import { fetchAllPaginatedResults } from './utils';
import LabeledToggleSwitch from './LabeledToggleSwitch';
import type { TiledLaunchRequest } from './types/LaunchTask';
import Papa from 'papaparse';

type Nullable<T> = T | null;

export interface TileConfigurationProps {
  name: string;
  projectId: string;
  existingLocationSetId?: string;
  setHandleCreateTask?: React.Dispatch<
    React.SetStateAction<(() => Promise<TiledLaunchRequest>) | null>
  >;
  setLaunchDisabled: React.Dispatch<React.SetStateAction<boolean>>;
  disabled?: boolean;
}

export type ImageData = {
  timestamp: Nullable<number>;
  width: number;
  height: number;
  id: string;
  transectId: Nullable<string>;
  latitude: Nullable<number>;
  longitude: Nullable<number>;
  originalPath: string;
};

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function vincentyDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const a = 6378137;
  const b = 6356752.314245;
  const f = 1 / 298.257223563;

  const L = toRad(lon2 - lon1);
  const U1 = Math.atan((1 - f) * Math.tan(toRad(lat1)));
  const U2 = Math.atan((1 - f) * Math.tan(toRad(lat2)));

  const sinU1 = Math.sin(U1),
    cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2),
    cosU2 = Math.cos(U2);

  let λ = L;
  let λP,
    iterLimit = 100;
  let cosSqAlpha, sinSigma, cos2SigmaM, cosSigma, sigma;

  do {
    const sinλ = Math.sin(λ),
      cosλ = Math.cos(λ);
    sinSigma = Math.sqrt(
      cosU2 * sinλ * (cosU2 * sinλ) +
      (cosU1 * sinU2 - sinU1 * cosU2 * cosλ) *
      (cosU1 * sinU2 - sinU1 * cosU2 * cosλ)
    );

    if (sinSigma === 0) return 0;

    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosλ;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinλ) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;

    if (isNaN(cos2SigmaM)) cos2SigmaM = 0;

    const C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    λP = λ;
    λ =
      L +
      (1 - C) *
      f *
      sinAlpha *
      (sigma +
        C *
        sinSigma *
        (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(λ - λP) > 1e-12 && --iterLimit > 0);

  if (iterLimit === 0) return NaN;

  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b);
  const A =
    1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
      (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
        (B / 6) *
        cos2SigmaM *
        (-3 + 4 * sinSigma * sinSigma) *
        (-3 + 4 * cos2SigmaM * cos2SigmaM)));

  const s = b * A * (sigma - deltaSigma);

  return s / 1000;
}

function calculateTileSizeAbsoluteOverlap(
  effectiveSize: number,
  tileCount: number,
  overlap: number
) {
  return Math.ceil((effectiveSize + (tileCount - 1) * overlap) / tileCount);
}

function calculateTileSizePercentageOverlap(
  effectiveSize: number,
  tileCount: number,
  overlap: number
) {
  return Math.ceil(
    effectiveSize / (tileCount - (overlap / 100) * (tileCount - 1))
  );
}

function calculateTileCountAbsoluteOverlap(
  effectiveSize: number,
  tileSize: number,
  overlap: number
) {
  return Math.ceil((effectiveSize - tileSize) / (tileSize - overlap)) + 1;
}

function calculateTileCountPercentageOverlap(
  effectiveSize: number,
  tileSize: number,
  overlap: number
) {
  return Math.ceil(
    (effectiveSize - tileSize) / (tileSize * (1 - overlap / 100)) + 1
  );
}

export default function TileConfiguration({
  name,
  projectId,
  existingLocationSetId,
  setHandleCreateTask,
  setLaunchDisabled,
  disabled = false,
}: TileConfigurationProps) {
  const [minX, setMinX] = useState<number>(0);
  const [maxX, setMaxX] = useState<number>(0);
  const [minY, setMinY] = useState<number>(0);
  const [maxY, setMaxY] = useState<number>(0);
  const [specifyTileDimensions, setSpecifyTileDimensions] =
    useState<boolean>(false);
  const [specifyBorderPercentage, setSpecifyBorderPercentage] =
    useState<boolean>(false);
  const [specifyBorders, setSpecifyBorders] = useState<boolean>(false);
  const [imageWidth, setImageWidth] = useState<number | undefined>(undefined);
  const [imageHeight, setImageHeight] = useState<number | undefined>(undefined);
  const [specifyOverlapInPercentage, setSpecifyOverlapInPercentage] =
    useState<boolean>(false);
  const [minOverlap, setMinOverlap] = useState<number>(0);
  const [minSidelap, setMinSidelap] = useState<number>(0);
  const [minOverlapPercentage, setMinOverlapPercentage] = useState<number>(0);
  const [minSidelapPercentage, setMinSidelapPercentage] = useState<number>(0);
  const [allImages, setAllImages] = useState<ImageData[]>([]);
  const [width, setWidth] = useState<number>(1024);
  const [height, setHeight] = useState<number>(1024);
  const [horizontalTiles, setHorizontalTiles] = useState<number>(3);
  const [verticalTiles, setVerticalTiles] = useState<number>(5);
  const effectiveImageWidth = maxX - minX;
  const effectiveImageHeight = maxY - minY;
  const [loadingImages, setLoadingImages] = useState<boolean>(false);
  const [imagesLoaded, setImagesLoaded] = useState<number>(0);
  // Dev only: global subset and per-transect subsetting
  const [subsetN, setSubsetN] = useState<number>(1);
  // Dev-only: CSV filter for image IDs
  const [csvFilterIds, setCsvFilterIds] = useState<string[]>([]);
  const [csvParseError, setCsvParseError] = useState<string | null>(null);

  // Dev-only: per-transect subsetting based on geo + timestamps
  const hasDevGeoTransect = useMemo(() => {
    if (process.env.NODE_ENV !== 'development') return false;
    if (!allImages || allImages.length === 0) return false;
    return allImages.every(
      (img) =>
        img != null &&
        img.timestamp != null &&
        img.transectId != null &&
        img.latitude != null &&
        img.longitude != null
    );
  }, [allImages]);

  const transectGroupStats = useMemo(() => {
    if (!hasDevGeoTransect) return [] as any[];

    const groups: Record<string, any[]> = {};
    for (const img of allImages) {
      const tId = String(img.transectId);
      if (!groups[tId]) groups[tId] = [];
      groups[tId].push(img);
    }

    const results = Object.entries(groups).map(([transectId, imgs]) => {
      const sorted = (imgs as any[])
        .slice()
        .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const distanceKm = vincentyDistanceKm(
        first.latitude as number,
        first.longitude as number,
        last.latitude as number,
        last.longitude as number
      );
      const timeSeconds = Math.abs(
        (last.timestamp as number) - (first.timestamp as number)
      );
      const speedKmh = timeSeconds > 0 ? distanceKm / (timeSeconds / 3600) : 0;
      return {
        transectId,
        images: sorted,
        imageCount: sorted.length,
        distanceKm,
        speedKmh,
      };
    });
    return results;
  }, [hasDevGeoTransect, allImages]);

  const [transectSubsetSteps, setTransectSubsetSteps] = useState<
    Record<string, number>
  >({});
  const [transectSubsetOffsets, setTransectSubsetOffsets] = useState<
    Record<string, number>
  >({});
  const [showTransectId, setShowTransectId] = useState<boolean>(false);

  useEffect(() => {
    if (!hasDevGeoTransect) return;

    setTransectSubsetSteps((prev) => {
      const next = { ...prev };
      for (const g of transectGroupStats as any[]) {
        if (next[g.transectId] == null) next[g.transectId] = 1;
      }
      return next;
    });
    setTransectSubsetOffsets((prev) => {
      const next = { ...prev };
      for (const g of transectGroupStats as any[]) {
        if (next[g.transectId] == null) next[g.transectId] = 0;
      }
      return next;
    });
  }, [hasDevGeoTransect, transectGroupStats]);

  const expectedCounts = useMemo(() => {
    if (!hasDevGeoTransect)
      return { per: {} as Record<string, number>, total: 0 };
    const per: Record<string, number> = {};
    let total = 0;
    for (const g of transectGroupStats as any[]) {
      const step = Math.max(
        1,
        Number(transectSubsetSteps[g.transectId] ?? 1) || 1
      );
      const offset = Math.max(
        0,
        Number(transectSubsetOffsets[g.transectId] ?? 0) || 0
      );
      const available = Math.max(0, (g.imageCount as number) - offset);
      const count = Math.floor(available / step);
      per[g.transectId] = count;
      total += count;
    }
    return { per, total };
  }, [
    hasDevGeoTransect,
    transectGroupStats,
    transectSubsetSteps,
    transectSubsetOffsets,
  ]);

  const csvMatchStats = useMemo(() => {
    if (!csvFilterIds.length) {
      return { matched: 0, missing: 0 };
    }
    const available = new Set(allImages.map((img) => img.id));
    let matched = 0;
    for (const id of csvFilterIds) {
      if (available.has(id)) matched += 1;
    }
    return { matched, missing: csvFilterIds.length - matched };
  }, [allImages, csvFilterIds]);

  function getSidelapPixels() {
    if (horizontalTiles <= 1) return 0;
    return Math.floor(
      (horizontalTiles * width - effectiveImageWidth) / (horizontalTiles - 1)
    );
  }

  function getOverlapPixels() {
    if (verticalTiles <= 1) return 0;
    return Math.floor(
      (verticalTiles * height - effectiveImageHeight) / (verticalTiles - 1)
    );
  }

  function getSidelapPercent() {
    if (horizontalTiles <= 1) return 0;
    return (getSidelapPixels() / width) * 100;
  }

  function getOverlapPercent() {
    if (verticalTiles <= 1) return 0;
    return (getOverlapPixels() / height) * 100;
  }

  useEffect(() => {
    if (!specifyOverlapInPercentage) {
      if (!specifyTileDimensions) {
        setWidth(
          calculateTileSizeAbsoluteOverlap(
            effectiveImageWidth,
            horizontalTiles,
            minSidelap
          )
        );
      } else {
        setHorizontalTiles(
          calculateTileCountAbsoluteOverlap(
            effectiveImageWidth,
            width,
            minSidelap
          )
        );
      }
      setMinSidelapPercentage((minSidelap / width) * 100);
    }
  }, [
    minSidelap,
    specifyTileDimensions,
    horizontalTiles,
    effectiveImageWidth,
    width,
  ]);

  useEffect(() => {
    if (!specifyOverlapInPercentage) {
      if (!specifyTileDimensions) {
        setHeight(
          calculateTileSizeAbsoluteOverlap(
            effectiveImageHeight,
            verticalTiles,
            minOverlap
          )
        );
      } else {
        setVerticalTiles(
          calculateTileCountAbsoluteOverlap(
            effectiveImageHeight,
            height,
            minOverlap
          )
        );
      }
      setMinOverlapPercentage((minOverlap / height) * 100);
    }
  }, [
    minOverlap,
    specifyTileDimensions,
    verticalTiles,
    effectiveImageHeight,
    height,
  ]);

  useEffect(() => {
    if (specifyOverlapInPercentage) {
      if (!specifyTileDimensions) {
        setWidth(
          calculateTileSizePercentageOverlap(
            effectiveImageWidth,
            horizontalTiles,
            minSidelapPercentage
          )
        );
      } else {
        setHorizontalTiles(
          calculateTileCountPercentageOverlap(
            effectiveImageWidth,
            width,
            minSidelapPercentage
          )
        );
      }
      setMinSidelap(Math.ceil((minSidelapPercentage * width) / 100));
    }
  }, [
    minSidelapPercentage,
    specifyTileDimensions,
    horizontalTiles,
    effectiveImageWidth,
    width,
  ]);

  useEffect(() => {
    if (specifyOverlapInPercentage) {
      if (!specifyTileDimensions) {
        setHeight(
          calculateTileSizePercentageOverlap(
            effectiveImageHeight,
            verticalTiles,
            minOverlapPercentage
          )
        );
      } else {
        setVerticalTiles(
          calculateTileCountPercentageOverlap(
            effectiveImageHeight,
            height,
            minOverlapPercentage
          )
        );
      }
      setMinOverlap(Math.ceil((minOverlapPercentage * height) / 100));
    }
  }, [
    minOverlapPercentage,
    specifyTileDimensions,
    verticalTiles,
    effectiveImageHeight,
    height,
  ]);

  useEffect(() => {
    async function getAllImages() {
      setLoadingImages(true);
      setImagesLoaded(0);
      const all = await fetchAllPaginatedResults(
        (client as any).models.Image.imagesByProjectId,
        {
          projectId,
          selectionSet: [
            'width',
            'height',
            'id',
            'timestamp',
            'originalPath',
            'transectId',
            'latitude',
            'longitude',
          ],
          limit: 10000,
        } as any,
        (count) => setImagesLoaded(count)
      );
      const imagesArr: ImageData[] = (all as any[]).map((img: any) => ({
        timestamp: (img?.timestamp ?? null) as Nullable<number>,
        width: img.width as number,
        height: img.height as number,
        id: img.id as string,
        originalPath: (img?.originalPath ?? '') as string,
        transectId: (img?.transectId ?? null) as Nullable<string>,
        latitude: (img?.latitude ?? null) as Nullable<number>,
        longitude: (img?.longitude ?? null) as Nullable<number>,
      }));
      setAllImages(imagesArr);

      if (imagesArr.length === 0) {
        setLoadingImages(false);
        return;
      }
      const firstWidth = imagesArr[0].width;
      const firstHeight = imagesArr[0].height;
      const allMatch = imagesArr.every(
        (img) =>
          (img.width === firstWidth && img.height === firstHeight) ||
          (img.width === firstHeight && img.height === firstWidth)
      );
      if (!allMatch) {
        console.log('Inconsistent image sizes detected');
        setImageWidth(undefined);
        setImageHeight(undefined);
        setMaxX(undefined as unknown as number);
        setMaxY(undefined as unknown as number);
      } else {
        setImageWidth(firstWidth);
        setImageHeight(firstHeight);
        setMinX(0);
        setMinY(0);
        setMaxX(firstWidth);
        setMaxY(firstHeight);
      }

      setLoadingImages(false);
    }

    if (projectId) {
      getAllImages();
    }
  }, [projectId]);

  useEffect(() => {
    if (loadingImages) {
      setLaunchDisabled(true);
    } else {
      setLaunchDisabled(false);
    }
  }, [loadingImages, setLaunchDisabled]);

  const handleCsvUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setCsvParseError(null);
      Papa.parse<any>(file, {
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors && results.errors.length > 0) {
            setCsvParseError(
              results.errors[0]?.message ?? 'Failed to parse CSV'
            );
            setCsvFilterIds([]);
            return;
          }
          const ids = new Set<string>();
          for (const row of results.data as any[]) {
            if (row == null) continue;
            if (Array.isArray(row)) {
              row.forEach((cell) => {
                if (
                  typeof cell === 'string' ||
                  typeof cell === 'number'
                ) {
                  const id = String(cell).trim();
                  if (id) ids.add(id);
                }
              });
            } else if (typeof row === 'object') {
              Object.values(row as Record<string, unknown>).forEach(
                (cell) => {
                  if (
                    typeof cell === 'string' ||
                    typeof cell === 'number'
                  ) {
                    const id = String(cell).trim();
                    if (id) ids.add(id);
                  }
                }
              );
            } else if (
              typeof row === 'string' ||
              typeof row === 'number'
            ) {
              const id = String(row).trim();
              if (id) ids.add(id);
            }
          }
          setCsvFilterIds(Array.from(ids));
        },
        error: (error) => {
          setCsvParseError(error.message ?? 'Failed to parse CSV');
          setCsvFilterIds([]);
        },
      });
      // Allow re-uploading the same file
      event.target.value = '';
    },
    []
  );

  const handleClearCsv = useCallback(() => {
    setCsvFilterIds([]);
    setCsvParseError(null);
  }, []);

  const getImagesToUse = useCallback(() => {
    let imagesToUse = allImages;
    if (process.env.NODE_ENV === 'development') {
      if (hasDevGeoTransect) {
        const selected: typeof allImages = [];
        for (const g of transectGroupStats as any[]) {
          const stepRaw = transectSubsetSteps[g.transectId];
          const step = Math.max(1, Number(stepRaw) || 1);
          const offsetRaw = transectSubsetOffsets[g.transectId];
          const offset = Math.max(0, Number(offsetRaw) || 0);
          const subset = (g.images as any[]).filter(
            (_: any, idx: number) => {
              const pos = idx + 1;
              if (pos <= offset) return false;
              return (pos - offset) % step === 0;
            }
          );
          selected.push(...subset);
        }
        imagesToUse = selected;
      } else if (subsetN > 1) {
        const sortedImages = [...allImages].sort((a, b) => {
          if (a.timestamp != null && b.timestamp != null) {
            return (a.timestamp as number) - (b.timestamp as number);
          } else if (a.timestamp != null) {
            return -1;
          } else if (b.timestamp != null) {
            return 1;
          }
          return 0;
        });
        imagesToUse = sortedImages.filter(
          (_, idx) => (idx + 1) % subsetN === 0
        );
      }
      if (csvFilterIds.length > 0) {
        const idSet = new Set(csvFilterIds);
        imagesToUse = imagesToUse.filter((img) => idSet.has(img.id));
      }
    }
    return imagesToUse;
  }, [
    allImages,
    csvFilterIds,
    hasDevGeoTransect,
    subsetN,
    transectGroupStats,
    transectSubsetOffsets,
    transectSubsetSteps,
  ]);

  const expectedImagesToUse = useMemo(() => {
    if (loadingImages) return 0;
    return getImagesToUse().length;
  }, [getImagesToUse, loadingImages]);

  const expectedTiles = useMemo(() => {
    return expectedImagesToUse * horizontalTiles * verticalTiles;
  }, [expectedImagesToUse, horizontalTiles, verticalTiles]);

  const buildTiledRequest = useCallback(() => {
    const imagesToUse = getImagesToUse();

    const description = JSON.stringify({
      mode: 'tiled',
      global: true,
      width,
      height,
      horizontalTiles,
      verticalTiles,
      specifyTileDimensions,
      specifyOverlapInPercentage,
      minSidelap,
      minOverlap,
      minSidelapPercentage,
      minOverlapPercentage,
      specifyBorders,
      specifyBorderPercentage,
      minX,
      minY,
      maxX,
      maxY,
      subsetN,
      csvFilterCount:
        process.env.NODE_ENV === 'development' && csvFilterIds.length > 0
          ? csvFilterIds.length
          : undefined,
      dev: hasDevGeoTransect
        ? {
          transectSubsetSteps,
          transectSubsetOffsets,
        }
        : undefined,
    });

    return {
      name,
      description,
      horizontalTiles,
      verticalTiles,
      width,
      height,
      minX,
      minY,
      maxX,
      maxY,
      locationCount: imagesToUse.length * horizontalTiles * verticalTiles,
      images: imagesToUse.map((img) => ({
        id: img.id,
        width: img.width,
        height: img.height,
      })),
      existingLocationSetId,
    } as TiledLaunchRequest;
  }, [
    getImagesToUse,
    hasDevGeoTransect,
    height,
    horizontalTiles,
    maxX,
    maxY,
    minX,
    minY,
    name,
    csvFilterIds.length,
    verticalTiles,
    width,
    existingLocationSetId,
    minOverlap,
    minOverlapPercentage,
    minSidelap,
    minSidelapPercentage,
    specifyBorderPercentage,
    specifyBorders,
    specifyOverlapInPercentage,
    specifyTileDimensions,
    subsetN,
    transectSubsetOffsets,
    transectSubsetSteps,
  ]);

  useEffect(() => {
    if (setHandleCreateTask) {
      setHandleCreateTask(() => () => Promise.resolve(buildTiledRequest()));
    }
  }, [setHandleCreateTask, buildTiledRequest]);

  return (
    <>
      <Form.Group className='d-flex flex-column gap-3 mt-2'>
        {process.env.NODE_ENV === 'development' && (
          <Form.Group
            className='p-2 border border-dark mb-2 shadow-sm'
            style={{ backgroundColor: '#697582' }}
          >
            {hasDevGeoTransect ? (
              <>
                <div className='d-flex align-items-center justify-content-between mb-2'>
                  <Form.Label className='mb-0'>
                    Per-transect subset steps
                  </Form.Label>
                  <Form.Check
                    type='checkbox'
                    label='Show Transect ID'
                    checked={showTransectId}
                    onChange={(e) => setShowTransectId(e.target.checked)}
                    className='text-white'
                    style={{ fontSize: '12px' }}
                  />
                </div>
                <span
                  className='d-block text-muted mb-2'
                  style={{ fontSize: '12px' }}
                >
                  Computed distance (vincenty) and speed are based on the first
                  and last image of each transect. Steps use 1-based indexing.
                </span>
                {transectGroupStats.map((g: any) => (
                  <div
                    key={g.transectId}
                    className='d-flex align-items-center justify-content-between mb-2'
                  >
                    <div
                      className='me-3 text-white'
                      style={{ fontSize: '14px' }}
                    >
                      Transect{showTransectId ? ` ${g.transectId}` : ''}:{' '}
                      {g.imageCount} images - {g.distanceKm.toFixed(2)} km -{' '}
                      {g.speedKmh.toFixed(2)} km/h
                    </div>
                    <div className='d-flex align-items-center gap-2'>
                      <div className='d-flex align-items-center'>
                        <span
                          className='me-2 text-white'
                          style={{ fontSize: '12px' }}
                        >
                          Step
                        </span>
                        <Form.Control
                          type='number'
                          style={{ maxWidth: 100 }}
                          value={transectSubsetSteps[g.transectId] ?? 1}
                          onChange={(e) =>
                            setTransectSubsetSteps((prev) => ({
                              ...prev,
                              [g.transectId]: Number(
                                (e.target as HTMLInputElement).value
                              ),
                            }))
                          }
                        />
                      </div>
                      <div className='d-flex align-items-center'>
                        <span
                          className='me-2 text-white'
                          style={{ fontSize: '12px' }}
                        >
                          Offset
                        </span>
                        <Form.Control
                          type='number'
                          style={{ maxWidth: 100 }}
                          value={transectSubsetOffsets[g.transectId] ?? 0}
                          onChange={(e) =>
                            setTransectSubsetOffsets((prev) => ({
                              ...prev,
                              [g.transectId]: Number(
                                (e.target as HTMLInputElement).value
                              ),
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <div
                  className='mt-2 text-white border-top border-dark pt-2'
                  style={{ fontSize: '12px' }}
                >
                  {transectGroupStats.map((g: any) => (
                    <div key={`exp-${g.transectId}`}>
                      Transect{showTransectId ? ` ${g.transectId}` : ''}{' '}
                      expected images: {expectedCounts.per[g.transectId] ?? 0}
                    </div>
                  ))}
                  <div className='fw-bold'>
                    Total expected images: {expectedCounts.total}
                  </div>
                </div>
              </>
            ) : (
              <>
                <Form.Label className='mb-0'>Image Subset Step (n)</Form.Label>
                <span
                  className='d-block text-muted mb-2'
                  style={{ fontSize: '12px' }}
                >
                  1-based indexing
                </span>
                <Form.Control
                  type='number'
                  value={subsetN}
                  disabled={loadingImages}
                  onChange={({ target: { value } }) =>
                    setSubsetN(Number(value))
                  }
                />
              </>
            )}
            <div className='mt-3 p-2 border-top border-dark text-white'>
              <Form.Label className='mb-1 text-white'>
                Limit tiling to CSV image IDs (dev only)
              </Form.Label>
              <span
                className='d-block text-muted mb-2'
                style={{ fontSize: '12px' }}
              >
                Upload a CSV with image IDs in any column. Parsed IDs:{' '}
                {csvFilterIds.length} | matched: {csvMatchStats.matched} |
                missing: {csvMatchStats.missing}
              </span>
              <Form.Control
                type='file'
                accept='.csv,text/csv'
                size='sm'
                onChange={handleCsvUpload}
                disabled={loadingImages}
              />
              {csvParseError && (
                <div
                  className='text-warning mt-1'
                  style={{ fontSize: '12px' }}
                >
                  {csvParseError}
                </div>
              )}
              {csvFilterIds.length > 0 && (
                <button
                  type='button'
                  className='btn btn-sm btn-light mt-2'
                  onClick={handleClearCsv}
                >
                  Clear CSV filter
                </button>
              )}
            </div>
          </Form.Group>
        )}
      </Form.Group>
      <Form.Group
        className='border border-dark shadow-sm p-2'
        style={{ backgroundColor: '#697582' }}
      >
        {loadingImages ? (
          <div className='d-flex justify-content-center align-items-center text-white'>
            <Spinner animation='border' size='sm' className='me-2' /> Scanning
            images... ({imagesLoaded} images scanned)
          </div>
        ) : (
          <Form.Label className='text-center' style={{ fontSize: 'smaller' }}>
            Detected image dimensions : {imageWidth}x{imageHeight}
          </Form.Label>
        )}
        {!loadingImages && (
          <div
            className='text-center text-white'
            style={{ fontSize: 'smaller' }}
          >
            Expected tiles: {expectedTiles}
          </div>
        )}
        <Form.Group className='mb-3 mt-3'>
          <LabeledToggleSwitch
            leftLabel='Specify number of tiles'
            rightLabel='Specify tile dimensions'
            checked={specifyTileDimensions}
            onChange={(checked) => {
              setSpecifyTileDimensions(checked);
            }}
            disabled={loadingImages || disabled}
          />

          <div className='row'>
            <InputBox
              label='Horizontal Tiles'
              enabled={!specifyTileDimensions && !loadingImages && !disabled}
              getter={() => horizontalTiles}
              setter={(x) => setHorizontalTiles(x)}
            />
            <InputBox
              label='Vertical Tiles'
              enabled={!specifyTileDimensions && !loadingImages && !disabled}
              getter={() => verticalTiles}
              setter={(x) => setVerticalTiles(x)}
            />
            <InputBox
              label='Width'
              enabled={specifyTileDimensions && !loadingImages && !disabled}
              getter={() => width}
              setter={(x) => setWidth(x)}
            />
            <InputBox
              label='Height'
              enabled={specifyTileDimensions && !loadingImages && !disabled}
              getter={() => height}
              setter={(x) => setHeight(x)}
            />
          </div>
        </Form.Group>
        <Form.Group className='mb-3 mt-3'>
          <LabeledToggleSwitch
            leftLabel='Specify overlap (px)'
            rightLabel='Specify overlap (%)'
            checked={specifyOverlapInPercentage}
            onChange={(checked) => {
              setSpecifyOverlapInPercentage(checked);
            }}
            disabled={loadingImages || disabled}
          />
          <div className='row'>
            <InputBox
              label='Minimum sidelap (px)'
              enabled={
                !specifyOverlapInPercentage && !loadingImages && !disabled
              }
              getter={() => minSidelap}
              setter={(x) => setMinSidelap(x)}
            />
            <InputBox
              label='Minimum overlap (px)'
              enabled={
                !specifyOverlapInPercentage && !loadingImages && !disabled
              }
              getter={() => minOverlap}
              setter={(x) => setMinOverlap(x)}
            />
            <InputBox
              label='Minimum sidelap (%)'
              enabled={
                specifyOverlapInPercentage && !loadingImages && !disabled
              }
              getter={() => minSidelapPercentage}
              setter={(x) => setMinSidelapPercentage(x)}
            />
            <InputBox
              label='Minimum overlap (%)'
              enabled={
                specifyOverlapInPercentage && !loadingImages && !disabled
              }
              getter={() => minOverlapPercentage}
              setter={(x) => setMinOverlapPercentage(x)}
            />
          </div>
          <div className='row'>
            <InputBox
              label='Actual sidelap (px)'
              enabled={false}
              getter={() => getSidelapPixels()}
            />
            <InputBox
              label='Actual overlap (px)'
              enabled={false}
              getter={() => getOverlapPixels()}
            />
            <InputBox
              label='Actual sidelap (%)'
              enabled={false}
              getter={() => getSidelapPercent().toFixed(2)}
            />
            <InputBox
              label='Actual overlap (%)'
              enabled={false}
              getter={() => getOverlapPercent().toFixed(2)}
            />
          </div>
        </Form.Group>
        <Form.Group className='mb-3 mt-3'>
          <LabeledToggleSwitch
            leftLabel='Process Entire Image'
            rightLabel='Specify Processing Borders'
            checked={specifyBorders}
            onChange={(checked) => {
              setSpecifyBorders(checked);
              setMinX(0);
              setMaxX(imageWidth as number);
              setMinY(0);
              setMaxY(imageHeight as number);
            }}
            disabled={loadingImages || disabled}
          />
          {specifyBorders && (
            <>
              <LabeledToggleSwitch
                leftLabel='Specify Borders (px)'
                rightLabel='Specify Borders (%)'
                checked={specifyBorderPercentage}
                onChange={(checked) => {
                  setSpecifyBorderPercentage(checked);
                }}
                disabled={loadingImages || disabled}
              />
              <div className='row'>
                <InputBox
                  label='Minimum X (px)'
                  enabled={
                    !specifyBorderPercentage && !loadingImages && !disabled
                  }
                  getter={() => minX}
                  setter={(x) => setMinX(x)}
                />
                <InputBox
                  label='Minimum Y (px)'
                  enabled={
                    !specifyBorderPercentage && !loadingImages && !disabled
                  }
                  getter={() => minY}
                  setter={(x) => setMinY(x)}
                />
                <InputBox
                  label='Minimum X (%)'
                  enabled={
                    specifyBorderPercentage && !loadingImages && !disabled
                  }
                  getter={() =>
                    Math.round((minX / (imageWidth as number)) * 100)
                  }
                  setter={(x) =>
                    setMinX(Math.round(((imageWidth as number) * x) / 100))
                  }
                />
                <InputBox
                  label='Minimum Y (%)'
                  enabled={
                    specifyBorderPercentage && !loadingImages && !disabled
                  }
                  getter={() =>
                    Math.round((minY / (imageHeight as number)) * 100)
                  }
                  setter={(x) =>
                    setMinY(Math.round(((imageHeight as number) * x) / 100))
                  }
                />
              </div>
              <div className='row'>
                <InputBox
                  label='Maximum X (px)'
                  enabled={
                    !specifyBorderPercentage && !loadingImages && !disabled
                  }
                  getter={() => maxX}
                  setter={(x) => setMaxX(x)}
                />
                <InputBox
                  label='Maximum Y (px)'
                  enabled={
                    !specifyBorderPercentage && !loadingImages && !disabled
                  }
                  getter={() => maxY}
                  setter={(x) => setMaxY(x)}
                />
                <InputBox
                  label='Maximum X (%)'
                  enabled={
                    specifyBorderPercentage && !loadingImages && !disabled
                  }
                  getter={() =>
                    Math.round((maxX / (imageWidth as number)) * 100)
                  }
                  setter={(x) =>
                    setMaxX(Math.round(((imageWidth as number) * x) / 100))
                  }
                />
                <InputBox
                  label='Maximum Y (%)'
                  enabled={
                    specifyBorderPercentage && !loadingImages && !disabled
                  }
                  getter={() =>
                    Math.round((maxY / (imageHeight as number)) * 100)
                  }
                  setter={(x) =>
                    setMaxY(Math.round(((imageHeight as number) * x) / 100))
                  }
                />
              </div>
            </>
          )}
        </Form.Group>
      </Form.Group>
    </>
  );
}

function InputBox({
  label,
  enabled,
  getter,
  setter,
}: {
  label: string;
  enabled: boolean;
  getter: () => number | string;
  setter?: (x: number) => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [tempValue, setTempValue] = useState<string>('');

  const current = getter();

  return (
    <div className='col-md-3'>
      <Form.Group>
        <Form.Label>{label}</Form.Label>
        <Form.Control
          type='number'
          value={isFocused ? tempValue : (current as any) ?? ''}
          onFocus={() => {
            setIsFocused(true);
            setTempValue(current == null ? '' : String(current));
          }}
          onChange={(e) => {
            const value = (e.target as HTMLInputElement).value;
            setTempValue(value);
            if (!enabled || !setter) return;
            if (value === '') return;
            const parsed = Number(value);
            if (!Number.isNaN(parsed)) {
              setter(parsed);
            }
          }}
          onBlur={() => {
            setIsFocused(false);
            setTempValue('');
          }}
          disabled={!enabled}
        />
      </Form.Group>
    </div>
  );
}
