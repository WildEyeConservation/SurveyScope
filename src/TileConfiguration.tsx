import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { ChevronRightIcon } from 'lucide-react';
import Papa from 'papaparse';
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useSurveyImages } from './survey/surveyImages';
import TileImagePreviewModal from './TileImagePreviewModal';
import type { TiledLaunchRequest } from './types/LaunchTask';

type Nullable<T> = T | null;

export type TileSettings = {
  specifyTileDimensions: boolean;
  specifyOverlapInPercentage: boolean;
  horizontalTiles: number;
  verticalTiles: number;
  width: number;
  height: number;
  minSidelap: number;
  minOverlap: number;
  minSidelapPercentage: number;
  minOverlapPercentage: number;
};

export interface TileConfigurationProps {
  name: string;
  projectId: string;
  existingLocationSetId?: string;
  initial?: Partial<TileSettings>;
  setHandleCreateTask?: React.Dispatch<
    React.SetStateAction<(() => Promise<TiledLaunchRequest>) | null>
  >;
  setLaunchDisabled: React.Dispatch<React.SetStateAction<boolean>>;
  onExpectedTilesChange?: (count: number) => void;
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
  lon2: number,
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
          (cosU1 * sinU2 - sinU1 * cosU2 * cosλ),
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
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
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

// Tile size or count along one axis of the image, from whichever the user set.
function tileAxis(
  imageSize: number,
  bySize: boolean,
  count: number,
  size: number,
  overlap: number,
  inPercent: boolean,
) {
  if (bySize) {
    const step = inPercent ? size * (1 - overlap / 100) : size - overlap;
    const tiles =
      size >= imageSize ? 1 : Math.ceil((imageSize - size) / step) + 1;
    return { tiles, size, valid: step > 0 && size > 0 };
  }
  const tileSize = inPercent
    ? Math.ceil(imageSize / (count - (overlap / 100) * (count - 1)))
    : Math.ceil((imageSize + (count - 1) * overlap) / count);
  return {
    tiles: count,
    size: tileSize,
    valid:
      count >= 1 &&
      tileSize > 0 &&
      (inPercent ? overlap < 100 : overlap < tileSize),
  };
}

export default function TileConfiguration({
  name,
  projectId,
  existingLocationSetId,
  initial,
  setHandleCreateTask,
  setLaunchDisabled,
  onExpectedTilesChange,
  disabled = false,
}: TileConfigurationProps) {
  const surveyImages = useSurveyImages();
  const [bySize, setBySize] = useState(initial?.specifyTileDimensions ?? false);
  const [inPercent, setInPercent] = useState(
    initial?.specifyOverlapInPercentage ?? false,
  );
  const [horizontalTiles, setHorizontalTiles] = useState(
    initial?.horizontalTiles ?? 3,
  );
  const [verticalTiles, setVerticalTiles] = useState(
    initial?.verticalTiles ?? 5,
  );
  const [tileWidth, setTileWidth] = useState(initial?.width ?? 1024);
  const [tileHeight, setTileHeight] = useState(initial?.height ?? 1024);
  const [sidelap, setSidelap] = useState(
    (inPercent ? initial?.minSidelapPercentage : initial?.minSidelap) ?? 0,
  );
  const [overlap, setOverlap] = useState(
    (inPercent ? initial?.minOverlapPercentage : initial?.minOverlap) ?? 0,
  );
  const [imageWidth, setImageWidth] = useState<number | undefined>();
  const [imageHeight, setImageHeight] = useState<number | undefined>();
  const [mixedSizes, setMixedSizes] = useState(false);
  const [allImages, setAllImages] = useState<ImageData[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState(0);
  const isDev = process.env.NODE_ENV === 'development';
  const [devOpen, setDevOpen] = useState(false);
  const [subsetN, setSubsetN] = useState(1);
  const [csvFilterIds, setCsvFilterIds] = useState<string[]>([]);
  const [csvParseError, setCsvParseError] = useState<string | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<{
    bySize: boolean;
    inPercent: boolean;
    horizontalTiles: number;
    verticalTiles: number;
    tileWidth: number;
    tileHeight: number;
    sidelap: number;
    overlap: number;
  } | null>(null);

  const across = tileAxis(
    imageWidth ?? 0,
    bySize,
    horizontalTiles,
    tileWidth,
    sidelap,
    inPercent,
  );
  const down = tileAxis(
    imageHeight ?? 0,
    bySize,
    verticalTiles,
    tileHeight,
    overlap,
    inPercent,
  );
  const settingsValid =
    !!imageWidth && !!imageHeight && across.valid && down.valid;
  const sidelapPx = inPercent
    ? Math.ceil((sidelap * across.size) / 100)
    : sidelap;
  const overlapPx = inPercent
    ? Math.ceil((overlap * down.size) / 100)
    : overlap;

  const switchMode = (nextBySize: boolean) => {
    if (nextBySize === bySize) return;
    if (nextBySize) {
      setTileWidth(across.size);
      setTileHeight(down.size);
    } else {
      setHorizontalTiles(across.tiles);
      setVerticalTiles(down.tiles);
    }
    setBySize(nextBySize);
  };

  const switchUnit = (nextInPercent: boolean) => {
    if (nextInPercent === inPercent) return;
    const round = (value: number) => Math.round(value * 100) / 100;
    if (nextInPercent) {
      setSidelap(round((sidelapPx / across.size) * 100 || 0));
      setOverlap(round((overlapPx / down.size) * 100 || 0));
    } else {
      setSidelap(sidelapPx);
      setOverlap(overlapPx);
    }
    setInPercent(nextInPercent);
  };

  // Dev-only: per-transect subsetting based on geo + timestamps
  const hasDevGeoTransect = useMemo(() => {
    if (!isDev || allImages.length === 0) return false;
    return allImages.every(
      (img) =>
        img.timestamp != null &&
        img.transectId != null &&
        img.latitude != null &&
        img.longitude != null,
    );
  }, [allImages, isDev]);

  const transectGroupStats = useMemo(() => {
    if (!hasDevGeoTransect) return [];
    const groups: Record<string, ImageData[]> = {};
    for (const img of allImages) {
      (groups[String(img.transectId)] ??= []).push(img);
    }
    return Object.entries(groups).map(([transectId, imgs]) => {
      const sorted = imgs
        .slice()
        .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const distanceKm = vincentyDistanceKm(
        first.latitude as number,
        first.longitude as number,
        last.latitude as number,
        last.longitude as number,
      );
      const timeSeconds = Math.abs(
        (last.timestamp as number) - (first.timestamp as number),
      );
      return {
        transectId,
        images: sorted,
        distanceKm,
        speedKmh: timeSeconds > 0 ? distanceKm / (timeSeconds / 3600) : 0,
      };
    });
  }, [hasDevGeoTransect, allImages]);

  const [transectSubsetSteps, setTransectSubsetSteps] = useState<
    Record<string, number>
  >({});
  const [transectSubsetOffsets, setTransectSubsetOffsets] = useState<
    Record<string, number>
  >({});

  const csvMatchStats = useMemo(() => {
    if (!csvFilterIds.length) return { matched: 0, missing: 0 };
    const available = new Set(allImages.map((img) => img.id));
    const matched = csvFilterIds.filter((id) => available.has(id)).length;
    return { matched, missing: csvFilterIds.length - matched };
  }, [allImages, csvFilterIds]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function getAllImages() {
      setLoadingImages(true);
      setImagesLoaded(0);
      const all = await surveyImages.load({
        signal,
        onProgress: setImagesLoaded,
      });
      if (signal.aborted) return;
      const imagesArr: ImageData[] = all.map((img) => ({
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

      if (imagesArr.length > 0) {
        const firstWidth = imagesArr[0].width;
        const firstHeight = imagesArr[0].height;
        const allMatch = imagesArr.every(
          (img) =>
            (img.width === firstWidth && img.height === firstHeight) ||
            (img.width === firstHeight && img.height === firstWidth),
        );
        setMixedSizes(!allMatch);
        setImageWidth(allMatch ? firstWidth : undefined);
        setImageHeight(allMatch ? firstHeight : undefined);
      }
      setLoadingImages(false);
    }

    if (projectId) {
      getAllImages().catch((err) => {
        if (!signal.aborted) console.error('Failed to load images', err);
      });
    }
    return () => controller.abort();
  }, [projectId, surveyImages]);

  useEffect(() => {
    setLaunchDisabled(loadingImages || !settingsValid);
  }, [loadingImages, settingsValid, setLaunchDisabled]);

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
              results.errors[0]?.message ?? 'Failed to parse CSV',
            );
            setCsvFilterIds([]);
            return;
          }
          const ids = new Set<string>();
          const add = (cell: unknown) => {
            if (typeof cell === 'string' || typeof cell === 'number') {
              const id = String(cell).trim();
              if (id) ids.add(id);
            }
          };
          for (const row of results.data as any[]) {
            if (row == null) continue;
            if (Array.isArray(row)) row.forEach(add);
            else if (typeof row === 'object') Object.values(row).forEach(add);
            else add(row);
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
    [],
  );

  const getImagesToUse = useCallback(() => {
    let imagesToUse = allImages;
    if (isDev) {
      if (hasDevGeoTransect) {
        imagesToUse = transectGroupStats.flatMap((g) => {
          const step = Math.max(1, transectSubsetSteps[g.transectId] || 1);
          const offset = Math.max(0, transectSubsetOffsets[g.transectId] || 0);
          return g.images.filter((_, idx) => {
            const pos = idx + 1;
            return pos > offset && (pos - offset) % step === 0;
          });
        });
      } else if (subsetN > 1) {
        const sortedImages = [...allImages].sort((a, b) => {
          if (a.timestamp != null && b.timestamp != null) {
            return a.timestamp - b.timestamp;
          }
          return a.timestamp != null ? -1 : b.timestamp != null ? 1 : 0;
        });
        imagesToUse = sortedImages.filter(
          (_, idx) => (idx + 1) % subsetN === 0,
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
    isDev,
    subsetN,
    transectGroupStats,
    transectSubsetOffsets,
    transectSubsetSteps,
  ]);

  const imagesToUseCount = useMemo(
    () => (loadingImages ? 0 : getImagesToUse().length),
    [getImagesToUse, loadingImages],
  );
  const tilesPerImage = across.tiles * down.tiles;
  const expectedTiles = imagesToUseCount * tilesPerImage;

  useEffect(() => {
    onExpectedTilesChange?.(settingsValid ? expectedTiles : 0);
  }, [expectedTiles, settingsValid, onExpectedTilesChange]);

  const buildTiledRequest = useCallback(() => {
    const imagesToUse = getImagesToUse();
    const maxX = imageWidth ?? 0;
    const maxY = imageHeight ?? 0;
    const description = JSON.stringify({
      mode: 'tiled',
      global: true,
      width: across.size,
      height: down.size,
      horizontalTiles: across.tiles,
      verticalTiles: down.tiles,
      specifyTileDimensions: bySize,
      specifyOverlapInPercentage: inPercent,
      minSidelap: sidelapPx,
      minOverlap: overlapPx,
      minSidelapPercentage: inPercent
        ? sidelap
        : (sidelapPx / across.size) * 100,
      minOverlapPercentage: inPercent ? overlap : (overlapPx / down.size) * 100,
      specifyBorders: false,
      specifyBorderPercentage: false,
      minX: 0,
      minY: 0,
      maxX,
      maxY,
      subsetN,
      csvFilterCount:
        isDev && csvFilterIds.length > 0 ? csvFilterIds.length : undefined,
      dev: hasDevGeoTransect
        ? { transectSubsetSteps, transectSubsetOffsets }
        : undefined,
    });

    return {
      name,
      description,
      horizontalTiles: across.tiles,
      verticalTiles: down.tiles,
      width: across.size,
      height: down.size,
      minX: 0,
      minY: 0,
      maxX,
      maxY,
      locationCount: imagesToUse.length * across.tiles * down.tiles,
      images: imagesToUse.map((img) => ({
        id: img.id,
        width: img.width,
        height: img.height,
      })),
      existingLocationSetId,
    } as TiledLaunchRequest;
  }, [
    getImagesToUse,
    imageWidth,
    imageHeight,
    across.size,
    across.tiles,
    down.size,
    down.tiles,
    bySize,
    inPercent,
    sidelap,
    overlap,
    sidelapPx,
    overlapPx,
    subsetN,
    isDev,
    csvFilterIds.length,
    hasDevGeoTransect,
    transectSubsetSteps,
    transectSubsetOffsets,
    name,
    existingLocationSetId,
  ]);

  useEffect(() => {
    if (setHandleCreateTask) {
      setHandleCreateTask(() => () => Promise.resolve(buildTiledRequest()));
    }
  }, [setHandleCreateTask, buildTiledRequest]);

  const locked = loadingImages || disabled;
  const unit = inPercent ? '%' : 'px';

  const fields = (
    <>
      <Segmented
        label='Set tiles by'
        options={['Number of tiles', 'Tile size']}
        value={bySize ? 1 : 0}
        onChange={(index) => switchMode(index === 1)}
        disabled={locked}
      />
      <div className='grid grid-cols-2 gap-3'>
        {bySize ? (
          <>
            <NumberField
              label='Width'
              unit='px'
              value={tileWidth}
              onChange={setTileWidth}
              disabled={locked}
            />
            <NumberField
              label='Height'
              unit='px'
              value={tileHeight}
              onChange={setTileHeight}
              disabled={locked}
            />
          </>
        ) : (
          <>
            <NumberField
              label='Across'
              value={horizontalTiles}
              onChange={(v) => setHorizontalTiles(Math.round(v))}
              disabled={locked}
              min={1}
            />
            <NumberField
              label='Down'
              value={verticalTiles}
              onChange={(v) => setVerticalTiles(Math.round(v))}
              disabled={locked}
              min={1}
            />
          </>
        )}
      </div>
      <div className='-mt-1 text-xs text-muted-foreground'>
        {bySize ? (
          <>
            That is{' '}
            <strong className='text-foreground'>
              {across.tiles} × {down.tiles}
            </strong>{' '}
            tiles per image
          </>
        ) : (
          <>
            Each tile is{' '}
            <strong className='text-foreground'>
              {across.size.toLocaleString()} × {down.size.toLocaleString()} px
            </strong>
          </>
        )}
      </div>
      <Segmented
        label='Overlap unit'
        options={['Overlap in px', 'Overlap in %']}
        value={inPercent ? 1 : 0}
        onChange={(index) => switchUnit(index === 1)}
        disabled={locked}
      />
      <div className='grid grid-cols-2 gap-3'>
        <NumberField
          label='Between columns'
          unit={unit}
          value={sidelap}
          onChange={setSidelap}
          disabled={locked}
          min={0}
        />
        <NumberField
          label='Between rows'
          unit={unit}
          value={overlap}
          onChange={setOverlap}
          disabled={locked}
          min={0}
        />
      </div>
      {!settingsValid && (
        <div className='text-xs text-danger'>
          Overlap must be smaller than the tiles.
        </div>
      )}
    </>
  );

  const openTilePreview = () => {
    setPreviewSnapshot({
      bySize,
      inPercent,
      horizontalTiles,
      verticalTiles,
      tileWidth,
      tileHeight,
      sidelap,
      overlap,
    });
  };

  const cancelTilePreview = () => {
    if (previewSnapshot) {
      setBySize(previewSnapshot.bySize);
      setInPercent(previewSnapshot.inPercent);
      setHorizontalTiles(previewSnapshot.horizontalTiles);
      setVerticalTiles(previewSnapshot.verticalTiles);
      setTileWidth(previewSnapshot.tileWidth);
      setTileHeight(previewSnapshot.tileHeight);
      setSidelap(previewSnapshot.sidelap);
      setOverlap(previewSnapshot.overlap);
    }
    setPreviewSnapshot(null);
  };

  return (
    <div className='flex flex-col gap-3'>
      <div className='border border-white/15 bg-white/[0.07] p-4'>
        {loadingImages ? (
          <div className='flex items-center gap-2 text-muted-foreground'>
            <Spinner animation='border' size='sm' />
            Scanning images
            {imagesLoaded > 0 && ` · ${imagesLoaded.toLocaleString()} scanned`}
            ...
          </div>
        ) : mixedSizes ? (
          <div className='text-sm text-warning'>
            This survey's images are not all the same size, so they cannot be
            tiled with one layout.
          </div>
        ) : !imageWidth || !imageHeight ? (
          <div className='text-sm text-muted-foreground italic'>
            No images to tile yet.
          </div>
        ) : (
          <div className='flex flex-wrap gap-6'>
            <div className='flex min-w-72 flex-1 flex-col gap-3'>{fields}</div>
            <div className='flex flex-col items-center gap-2 self-center'>
              <TilePreview
                imageWidth={imageWidth}
                imageHeight={imageHeight}
                across={across}
                down={down}
                sidelapPx={sidelapPx}
                overlapPx={overlapPx}
                valid={settingsValid}
              />
              <Button
                variant='outline-light'
                size='sm'
                onClick={openTilePreview}
                disabled={locked}
              >
                Preview a tile
              </Button>
            </div>
            <TileImagePreviewModal
              show={previewSnapshot !== null}
              projectId={projectId}
              tiledLocationSetId={existingLocationSetId}
              fallbackImageIds={allImages.map((img) => img.id)}
              baselineLandscape={imageWidth >= imageHeight}
              layout={
                settingsValid
                  ? {
                      width: across.size,
                      height: down.size,
                      across: across.tiles,
                      down: down.tiles,
                    }
                  : null
              }
              controls={<div className='flex flex-col gap-3'>{fields}</div>}
              onCancel={cancelTilePreview}
              onApply={() => setPreviewSnapshot(null)}
            />
          </div>
        )}
        {!loadingImages && settingsValid && (
          <div className='mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-sm'>
            <span className='text-muted-foreground'>
              {imagesToUseCount.toLocaleString()} image
              {imagesToUseCount === 1 ? '' : 's'} of{' '}
              {imageWidth?.toLocaleString()} × {imageHeight?.toLocaleString()}{' '}
              px × {tilesPerImage} tiles
            </span>
            <strong>{expectedTiles.toLocaleString()} tiles</strong>
          </div>
        )}
      </div>

      {isDev && !loadingImages && (
        <div className='border border-dashed border-white/25'>
          <button
            type='button'
            onClick={() => setDevOpen((open) => !open)}
            className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground'
          >
            <ChevronRightIcon
              className={cn(
                'size-4 transition-transform',
                devOpen && 'rotate-90',
              )}
            />
            Developer options
            <span className='ml-auto text-xs'>dev builds only</span>
          </button>
          {devOpen && (
            <div className='flex flex-col gap-4 border-t border-dashed border-white/25 p-3'>
              {hasDevGeoTransect ? (
                <DevTransectTable
                  groups={transectGroupStats}
                  steps={transectSubsetSteps}
                  offsets={transectSubsetOffsets}
                  onStep={(id, value) =>
                    setTransectSubsetSteps((prev) => ({ ...prev, [id]: value }))
                  }
                  onOffset={(id, value) =>
                    setTransectSubsetOffsets((prev) => ({
                      ...prev,
                      [id]: value,
                    }))
                  }
                  disabled={disabled}
                />
              ) : (
                <div className='max-w-60'>
                  <NumberField
                    label='Keep every nth image'
                    value={subsetN}
                    onChange={(v) => setSubsetN(Math.round(v))}
                    disabled={disabled}
                    min={1}
                  />
                </div>
              )}
              <div className='flex flex-col gap-1.5'>
                <span className='text-sm'>Limit to image IDs from a CSV</span>
                <div className='flex items-center gap-3'>
                  <Input
                    type='file'
                    accept='.csv,text/csv'
                    className='max-w-sm'
                    onChange={handleCsvUpload}
                    disabled={disabled}
                  />
                  {csvFilterIds.length > 0 && (
                    <Button
                      variant='link'
                      size='sm'
                      className='p-0'
                      onClick={() => {
                        setCsvFilterIds([]);
                        setCsvParseError(null);
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                {csvFilterIds.length > 0 && (
                  <span className='text-xs text-muted-foreground'>
                    {csvFilterIds.length.toLocaleString()} IDs ·{' '}
                    {csvMatchStats.matched.toLocaleString()} matched ·{' '}
                    {csvMatchStats.missing.toLocaleString()} missing
                  </span>
                )}
                {csvParseError && (
                  <span className='text-xs text-warning'>{csvParseError}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: string[];
  value: number;
  onChange: (index: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role='radiogroup'
      aria-label={label}
      className='inline-flex w-fit border border-white/30'
    >
      {options.map((option, index) => (
        <button
          key={option}
          type='button'
          role='radio'
          aria-checked={value === index}
          disabled={disabled}
          onClick={() => onChange(index)}
          className={cn(
            'px-3 py-1.5 text-base leading-normal transition-colors disabled:opacity-60',
            value === index ? 'bg-primary text-white' : 'hover:bg-white/10',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function NumberField({
  label,
  unit,
  value,
  onChange,
  disabled,
  min,
}: {
  label: string;
  unit?: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
}) {
  // A draft lets the field be cleared while typing without snapping back.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className='mb-0 flex flex-col gap-1'>
      <span className='text-sm'>{label}</span>
      <span className='relative'>
        <Input
          type='number'
          min={min}
          className={cn(unit && 'pr-8')}
          value={draft ?? value}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            const parsed = Number(e.target.value);
            if (e.target.value !== '' && Number.isFinite(parsed)) {
              onChange(min !== undefined ? Math.max(min, parsed) : parsed);
            }
          }}
          onBlur={() => setDraft(null)}
        />
        {unit && (
          <span className='pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-[#6c757d]'>
            {unit}
          </span>
        )}
      </span>
    </label>
  );
}

function TilePreview({
  imageWidth,
  imageHeight,
  across,
  down,
  sidelapPx,
  overlapPx,
  valid,
}: {
  imageWidth: number;
  imageHeight: number;
  across: { tiles: number; size: number };
  down: { tiles: number; size: number };
  sidelapPx: number;
  overlapPx: number;
  valid: boolean;
}) {
  const maxSide = 200;
  const scale = maxSide / Math.max(imageWidth, imageHeight);
  const w = imageWidth * scale;
  const h = imageHeight * scale;
  // Too many lines to draw cleanly turn into a solid block.
  const drawable = valid && across.tiles <= 40 && down.tiles <= 40;
  // Each seam runs from where the next tile starts to where this one ends.
  const seams = (tiles: number, size: number, overlapPx: number, max: number) =>
    Array.from({ length: Math.max(tiles - 1, 0) }, (_, i) => {
      const start = Math.min(max, (i + 1) * (size - overlapPx));
      return [start * scale, Math.min(max, start + overlapPx) * scale];
    });
  const seamLine = {
    stroke: '#DF6919',
    strokeWidth: 1.2,
  };
  const dotted = { ...seamLine, strokeDasharray: '2 2' };
  return (
    <div className='flex flex-col items-center gap-1.5 self-center'>
      <svg
        width={w + 2}
        height={h + 2}
        viewBox={`-1 -1 ${w + 2} ${h + 2}`}
        aria-label='Tile layout on one image'
      >
        <rect
          width={w}
          height={h}
          fill='rgba(255,255,255,0.08)'
          stroke='#fff'
          strokeWidth={1.5}
        />
        {drawable &&
          seams(across.tiles, across.size, sidelapPx, imageWidth).map(
            ([x1, x2]) =>
              x2 > x1 ? (
                <g key={`x${x1}`}>
                  <rect
                    x={x1}
                    width={x2 - x1}
                    height={h}
                    fill='rgba(223,105,25,0.25)'
                  />
                  <line x1={x1} x2={x1} y2={h} {...dotted} />
                  <line x1={x2} x2={x2} y2={h} {...dotted} />
                </g>
              ) : (
                <line key={`x${x1}`} x1={x1} x2={x1} y2={h} {...seamLine} />
              ),
          )}
        {drawable &&
          seams(down.tiles, down.size, overlapPx, imageHeight).map(
            ([y1, y2]) =>
              y2 > y1 ? (
                <g key={`y${y1}`}>
                  <rect
                    y={y1}
                    width={w}
                    height={y2 - y1}
                    fill='rgba(223,105,25,0.25)'
                  />
                  <line y1={y1} y2={y1} x2={w} {...dotted} />
                  <line y1={y2} y2={y2} x2={w} {...dotted} />
                </g>
              ) : (
                <line key={`y${y1}`} y1={y1} y2={y1} x2={w} {...seamLine} />
              ),
          )}
      </svg>
      <span className='text-xs text-muted-foreground'>
        {valid
          ? `One image, ${(across.tiles * down.tiles).toLocaleString()} tiles`
          : 'Check the settings'}
      </span>
    </div>
  );
}

type TransectRow = {
  transectId: string;
  label: string;
  number: number;
  images: number;
  distanceKm: number;
  speedKmh: number;
  step: number;
  offset: number;
  kept: number;
  disabled?: boolean;
  onStep: (value: number) => void;
  onOffset: (value: number) => void;
};

const transectColumns: DataColumn<TransectRow>[] = [
  {
    accessorKey: 'number',
    header: 'Transect',
    meta: { className: 'max-w-40 truncate' },
    cell: ({ row }) => (
      <span title={row.original.transectId}>{row.original.label}</span>
    ),
  },
  {
    accessorKey: 'images',
    header: 'Images',
    meta: { className: 'text-right tabular-nums' },
    cell: ({ row }) => row.original.images.toLocaleString(),
  },
  {
    accessorKey: 'distanceKm',
    header: 'km',
    meta: { className: 'text-right tabular-nums' },
    cell: ({ row }) => row.original.distanceKm.toFixed(1),
  },
  {
    accessorKey: 'speedKmh',
    header: 'km/h',
    meta: { className: 'text-right tabular-nums' },
    cell: ({ row }) => row.original.speedKmh.toFixed(0),
  },
  {
    id: 'step',
    header: 'Every nth',
    enableSorting: false,
    meta: { className: 'w-28' },
    cell: ({ row }) => (
      <Input
        type='number'
        min={1}
        aria-label={`Every nth image of transect ${row.original.number}`}
        value={row.original.step}
        disabled={row.original.disabled}
        onChange={(e) => row.original.onStep(Number(e.target.value))}
      />
    ),
  },
  {
    id: 'offset',
    header: 'Skip first',
    enableSorting: false,
    meta: { className: 'w-28' },
    cell: ({ row }) => (
      <Input
        type='number'
        min={0}
        aria-label={`Images to skip on transect ${row.original.number}`}
        value={row.original.offset}
        disabled={row.original.disabled}
        onChange={(e) => row.original.onOffset(Number(e.target.value))}
      />
    ),
  },
  {
    accessorKey: 'kept',
    header: 'Kept',
    meta: { className: 'text-right tabular-nums' },
    cell: ({ row }) => row.original.kept.toLocaleString(),
  },
];

function DevTransectTable({
  groups,
  steps,
  offsets,
  onStep,
  onOffset,
  disabled,
}: {
  groups: {
    transectId: string;
    images: ImageData[];
    distanceKm: number;
    speedKmh: number;
  }[];
  steps: Record<string, number>;
  offsets: Record<string, number>;
  onStep: (transectId: string, value: number) => void;
  onOffset: (transectId: string, value: number) => void;
  disabled?: boolean;
}) {
  const kept = (g: (typeof groups)[number]) => {
    const step = Math.max(1, steps[g.transectId] || 1);
    const offset = Math.max(0, offsets[g.transectId] || 0);
    return Math.floor(Math.max(0, g.images.length - offset) / step);
  };
  const total = groups.reduce((sum, g) => sum + kept(g), 0);
  const rows: TransectRow[] = groups.map((g, index) => ({
    transectId: g.transectId,
    label: `Transect ${index + 1}`,
    number: index + 1,
    images: g.images.length,
    distanceKm: g.distanceKm,
    speedKmh: g.speedKmh,
    step: steps[g.transectId] ?? 1,
    offset: offsets[g.transectId] ?? 0,
    kept: kept(g),
    disabled,
    onStep: (value) => onStep(g.transectId, value),
    onOffset: (value) => onOffset(g.transectId, value),
  }));
  return (
    <div className='flex flex-col gap-1.5'>
      <span className='text-sm'>Subset by transect</span>
      <span className='text-xs text-muted-foreground'>
        Keep every nth image after skipping the first few. Distance and speed
        use each transect's first and last image.
      </span>
      <DataTable
        storageKey='tile-configuration'
        columns={transectColumns}
        data={rows}
        getRowId={(row) => row.transectId}
        minWidth={640}
        className='text-[13px]'
        footer={[
          'Total',
          <div key='images' className='text-right'>
            {groups
              .reduce((sum, g) => sum + g.images.length, 0)
              .toLocaleString()}
          </div>,
          '',
          '',
          '',
          '',
          <div key='kept' className='text-right'>
            {total.toLocaleString()}
          </div>,
        ]}
      />
    </div>
  );
}
