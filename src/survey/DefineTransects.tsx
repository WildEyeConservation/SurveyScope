import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import * as maplibregl from 'maplibre-gl';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { GlobalContext } from '../Context';
import { Footer } from '../Modal';
import { fetchAllPaginatedResults } from '../utils';
import { useSurveyImages } from './surveyImages';

import 'maplibre-gl/dist/maplibre-gl.css';

import {
  CrosshairIcon,
  LassoIcon,
  ListIcon,
  Maximize2Icon,
  MergeIcon,
  Minimize2Icon,
  MinusIcon,
  MousePointer2Icon,
  PlusIcon,
  Redo2Icon,
  ScanIcon,
  Undo2Icon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRenderMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { detectTransects } from '../../amplify/functions/shared/detectTransects';
import {
  createStratumLocator,
  hasStratumShape,
} from '../../shared/strataMetrics';
import { BASE_STYLE, EMPTY_FC } from './surveyMapStyle';

import './surveyMap.css';

import {
  loadSurveyArea,
  recomputeBoundaryStatus,
} from '../utils/shapefileUtils';
import BoundaryRecomputeGate from './BoundaryRecomputeGate';
import { Kbd, MapButton } from './mapControls';
import { LIGHT_THEME, MAP_CONTROLS, MAP_DIVIDER } from './mapTheme';
import { spreadOverlapping } from './spreadOverlapping';
import {
  runSurveySave,
  surveySaveSettled,
  useSurveySaving,
} from './surveySaves';
import {
  assignTransectColours,
  clearJollyResults,
  closedLngLatRing,
  isValidLatLng,
  loadOnEffortImages,
  loadStrata,
  segmentBySavedTransect,
  strataColors,
  type LatLng,
  type SavedStratum,
  type SegmentedImage,
  type SurveyImage,
} from './transectStrata';

// Idle mode leaves image-point clicks available.
const MODE_LASSO = 'lasso';
const MODE_IDLE = 'idle';

const SRC_POINTS = 'tx-points';
const LYR_POINTS = 'tx-points-layer';
const SRC_BOUNDARY = 'tx-boundary';
const LYR_BOUNDARY = 'tx-boundary-line';
const SRC_EXCLUSIONS = 'tx-exclusions';
const LYR_EXCLUSIONS = 'tx-exclusions-line';
const SRC_STRATA = 'tx-strata';
const LYR_STRATA_FILL = 'tx-strata-fill';
const LYR_STRATA_LINE = 'tx-strata-line';

const HISTORY_LIMIT = 50;

function detect(images: SurveyImage[]): SegmentedImage[] {
  const imagesById = new Map(images.map((img) => [img.id, img]));
  return detectTransects(images).map(({ id, transectIndex }) => ({
    ...imagesById.get(id)!,
    transectId: transectIndex,
  }));
}

type DefineTransectsProps = { projectId: string; organizationId: string };

export default function DefineTransects(props: DefineTransectsProps) {
  return (
    <BoundaryRecomputeGate projectId={props.projectId} what='Transects'>
      <DefineTransectsEditor {...props} />
    </BoundaryRecomputeGate>
  );
}

function DefineTransectsEditor({
  projectId,
  organizationId,
}: DefineTransectsProps) {
  const { client, showModal } = useContext(GlobalContext)!;
  const surveyImages = useSurveyImages();
  const [loading, setLoading] = useState(true);
  const [loadedCount, setLoadedCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingImageCount, setSavingImageCount] = useState(0);
  const [savingProgress, setSavingProgress] = useState(0);
  const [justSaved, setJustSaved] = useState(false);
  const [boundary, setBoundary] = useState<LatLng[] | null>(null);
  const [exclusions, setExclusions] = useState<LatLng[][]>([]);
  const [strata, setStrata] = useState<SavedStratum[]>([]);
  const [segmentedImages, setSegmentedImages] = useState<SegmentedImage[]>([]);
  // Null until the transects on screen match what is saved.
  const [savedImages, setSavedImages] = useState<SegmentedImage[] | null>(null);
  const [history, setHistory] = useState<SegmentedImage[][]>([]);
  const [future, setFuture] = useState<SegmentedImage[][]>([]);
  const [selectedTransectIds, setSelectedTransectIds] = useState<Set<number>>(
    new Set(),
  );
  const [pendingLasso, setPendingLasso] = useState<{
    id: string | number;
    enclosedImageIds: Set<string>;
  } | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [lassoActive, setLassoActive] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 768);
  const [fullscreen, setFullscreen] = useState(false);
  const [hasFittedBounds, setHasFittedBounds] = useState(false);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const imagesRef = useRef<SurveyImage[]>([]);
  const imputedIdsRef = useRef<Set<string>>(new Set());
  // Saved transect of every image, so links that no longer apply are cleared.
  const dbTransectIdsRef = useRef<Map<string, string | null>>(new Map());

  const transectIds = useMemo(() => {
    const ids = segmentedImages.map((img) => img.transectId);
    return Array.from(new Set(ids)).sort((a, b) => a - b);
  }, [segmentedImages]);

  const transectImageCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    segmentedImages.forEach((si) => {
      counts[si.transectId] = (counts[si.transectId] || 0) + 1;
    });
    return counts;
  }, [segmentedImages]);

  const transectColour = useMemo(
    () => assignTransectColours(segmentedImages),
    [segmentedImages],
  );
  const colourFor = (tid: number) => transectColour.get(tid) ?? '#808080';

  const transectNumber = useMemo(
    () => new Map(transectIds.map((tid, index) => [tid, index + 1])),
    [transectIds],
  );

  // Same rule as the boundary recompute: the stratum of the earliest image.
  const transectStratum = useMemo(() => {
    const result = new Map<number, string>();
    const shaped = strata.filter((st) => hasStratumShape(st.coords));
    const candidates = shaped.length ? shaped : strata;
    if (candidates.length < 2) return result;
    const locate = createStratumLocator(candidates.map((st) => st.coords));
    const first = new Map<number, SegmentedImage>();
    for (const img of segmentedImages) {
      const current = first.get(img.transectId);
      if (!current || img.timestamp < current.timestamp) {
        first.set(img.transectId, img);
      }
    }
    for (const [tid, img] of first) {
      const index = locate(img);
      if (index !== null) result.set(tid, candidates[index].name);
    }
    return result;
  }, [segmentedImages, strata]);

  const adjustedPositions = useMemo(
    () => spreadOverlapping(segmentedImages),
    [segmentedImages],
  );

  // Refs so the once-registered map handlers always read current values.
  const segmentedImagesRef = useRef(segmentedImages);
  segmentedImagesRef.current = segmentedImages;
  const adjustedPositionsRef = useRef(adjustedPositions);
  adjustedPositionsRef.current = adjustedPositions;
  const lassoActiveRef = useRef(lassoActive);
  lassoActiveRef.current = lassoActive;
  const pendingLassoRef = useRef(pendingLasso);
  pendingLassoRef.current = pendingLasso;

  const commit = useCallback((next: SegmentedImage[]) => {
    setHistory((prev) =>
      [...prev, segmentedImagesRef.current].slice(-HISTORY_LIMIT),
    );
    setFuture([]);
    setSegmentedImages(next);
    setJustSaved(false);
  }, []);

  const undo = () => {
    if (!history.length) return;
    setFuture((prev) => [segmentedImages, ...prev]);
    setSegmentedImages(history[history.length - 1]);
    setHistory((prev) => prev.slice(0, -1));
    setSelectedTransectIds(new Set());
    setJustSaved(false);
  };

  const redo = () => {
    if (!future.length) return;
    setHistory((prev) => [...prev, segmentedImages]);
    setSegmentedImages(future[0]);
    setFuture((prev) => prev.slice(1));
    setSelectedTransectIds(new Set());
    setJustSaved(false);
  };

  const stopLasso = useCallback(() => {
    const pending = pendingLassoRef.current;
    if (pending) {
      try {
        drawRef.current?.removeFeatures([pending.id]);
      } catch {
        /* already gone */
      }
    }
    setPendingLasso(null);
    drawRef.current?.setMode(MODE_IDLE);
    setLassoActive(false);
  }, []);

  const startLasso = () => {
    const draw = drawRef.current;
    if (!draw) return;
    stopLasso();
    draw.setMode(MODE_LASSO);
    setLassoActive(true);
  };

  const splitPending = () => {
    const pending = pendingLasso;
    if (!pending) return;
    // Spreading every image into Math.max overflows the stack on large surveys.
    const newTransectId =
      segmentedImages.reduce((max, si) => Math.max(max, si.transectId), -1) + 1;
    commit(
      segmentedImages.map((si) =>
        pending.enclosedImageIds.has(si.id)
          ? { ...si, transectId: newTransectId }
          : si,
      ),
    );
    setSelectedTransectIds(new Set([newTransectId]));
    stopLasso();
  };

  const mergeSelected = () => {
    if (selectedTransectIds.size < 2) return;
    const target = Math.min(...selectedTransectIds);
    commit(
      segmentedImages.map((si) =>
        selectedTransectIds.has(si.transectId)
          ? { ...si, transectId: target }
          : si,
      ),
    );
    setSelectedTransectIds(new Set([target]));
  };

  const redetect = () => {
    if (!imagesRef.current.length) return;
    stopLasso();
    commit(detect(imagesRef.current));
    setSelectedTransectIds(new Set());
  };

  const toggleTransect = (tid: number, additive: boolean) =>
    setSelectedTransectIds((prev) => {
      if (additive) {
        const next = new Set(prev);
        if (next.has(tid)) next.delete(tid);
        else next.add(tid);
        return next;
      }
      return prev.size === 1 && prev.has(tid) ? new Set() : new Set([tid]);
    });
  const toggleTransectRef = useRef(toggleTransect);
  toggleTransectRef.current = toggleTransect;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        await surveySaveSettled(projectId);
        if (signal.aborted) return;
        const [imageData, area, savedStrata] = await Promise.all([
          loadOnEffortImages(surveyImages.load, signal, setLoadedCount),
          loadSurveyArea(client, projectId, signal),
          loadStrata(client, projectId, signal),
        ]);
        if (signal.aborted) return;
        const { images, imputedIds, dbTransectIds } = imageData;
        dbTransectIdsRef.current = dbTransectIds;
        imputedIdsRef.current = imputedIds;
        imagesRef.current = images;
        setBoundary(area.boundary);
        setExclusions(area.exclusions);
        setStrata(savedStrata);
        if (images.some((img) => img.dbTransectId)) {
          const segmented = segmentBySavedTransect(images).segmented;
          setSegmentedImages(segmented);
          setSavedImages(segmented);
        } else {
          setSegmentedImages(detect(images));
        }
        setLoading(false);
      } catch (err) {
        if (signal.aborted) return;
        console.error('Failed to load transects:', err);
        setLoadError(
          'The survey data could not be loaded. Close and reopen this window to try again.',
        );
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [client, projectId, surveyImages]);

  const handleSubmit = async () => {
    const snapshot = segmentedImages;
    setSaving(true);
    setSaveError(null);
    setSavingImageCount(0);
    setSavingProgress(0);
    try {
      await runSurveySave(projectId, async () => {
        let currentStrata = await loadStrata(client, projectId);
        if (currentStrata.length === 0) {
          if (!boundary) throw new Error('No survey boundary or strata');
          const { data } = await (client.models.Stratum.create as any)({
            projectId,
            name: 'Stratum 1',
            coordinates: boundary.flat(),
            group: organizationId,
          });
          currentStrata = [
            { id: data.id, name: 'Stratum 1', coords: boundary },
          ];
        }
        // The boundary recompute below moves each transect to its stratum.
        const transectMap: Record<number, string> = {};
        for (const tid of transectIds) {
          const { data } = await (client.models.Transect.create as any)({
            projectId,
            stratumId: currentStrata[0].id,
            group: organizationId,
          });
          transectMap[tid] = data.id;
        }

        const dbTransectIds = dbTransectIdsRef.current;
        const imageUpdates: {
          id: string;
          transectId: string | null;
          latitude?: number;
          longitude?: number;
        }[] = [];
        const segmentedIds = new Set<string>();
        for (const img of snapshot) {
          segmentedIds.add(img.id);
          const trId = transectMap[img.transectId];
          if (trId) {
            imageUpdates.push(
              imputedIdsRef.current.has(img.id)
                ? {
                    id: img.id,
                    transectId: trId,
                    latitude: img.latitude,
                    longitude: img.longitude,
                  }
                : { id: img.id, transectId: trId },
            );
          } else if (dbTransectIds.get(img.id)) {
            imageUpdates.push({ id: img.id, transectId: null });
          }
        }
        for (const [id, dbTransectId] of dbTransectIds) {
          if (dbTransectId && !segmentedIds.has(id)) {
            imageUpdates.push({ id, transectId: null });
          }
        }
        setSavingImageCount(imageUpdates.length);
        await Promise.all(
          imageUpdates.map(async (update) => {
            await (client.models.Image.update as any)(update);
            setSavingProgress((p) => p + 1);
          }),
        );
        const savedTransectIds = new Map(dbTransectIds);
        for (const update of imageUpdates) {
          savedTransectIds.set(update.id, update.transectId);
        }
        dbTransectIdsRef.current = savedTransectIds;

        const allTransects = (await fetchAllPaginatedResults(
          client.models.Transect.transectsByProjectId as any,
          { projectId, limit: 10000, selectionSet: ['id'] } as any,
        )) as any[];
        const usedTransectIds = new Set(Object.values(transectMap));
        await Promise.all(
          allTransects
            .map((t) => t.id as string)
            .filter((id) => !usedTransectIds.has(id))
            .map((id) => (client.models.Transect.delete as any)({ id })),
        );

        setStrata(currentStrata);

        await clearJollyResults(client, projectId);
        await recomputeBoundaryStatus(client as any, projectId);
      });
      setSavedImages(snapshot);
      setJustSaved(true);
    } catch (err) {
      console.error('Failed to save transects:', err);
      setSaveError('The transects could not be saved. Please try again.');
    } finally {
      setSaving(false);
      setSavingImageCount(0);
      setSavingProgress(0);
    }
  };

  const pointsFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: segmentedImages.map((img) => {
        const pos = adjustedPositions[img.id] || img;
        return {
          type: 'Feature',
          id: img.id,
          properties: {
            id: img.id,
            tid: img.transectId,
            color: transectColour.get(img.transectId) ?? '#808080',
            selected: selectedTransectIds.has(img.transectId),
            dimmed:
              selectedTransectIds.size > 0 &&
              !selectedTransectIds.has(img.transectId),
          },
          geometry: {
            type: 'Point',
            coordinates: [pos.longitude, pos.latitude],
          },
        };
      }),
    }),
    [segmentedImages, adjustedPositions, selectedTransectIds, transectColour],
  );

  const boundaryFC = useMemo(() => {
    if (!boundary) return EMPTY_FC;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: closedLngLatRing(boundary),
          },
        },
      ],
    };
  }, [boundary]);

  const exclusionsFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: exclusions.map((coords) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: closedLngLatRing(coords) },
      })),
    }),
    [exclusions],
  );

  const strataFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: strata.map((st, i) => ({
        type: 'Feature',
        properties: {
          name: st.name,
          color: strataColors[i % strataColors.length],
        },
        geometry: {
          type: 'Polygon',
          coordinates: [closedLngLatRing(st.coords)],
        },
      })),
    }),
    [strata],
  );

  useEffect(() => {
    if (!mapDivRef.current) return;

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: BASE_STYLE,
      center: [0, 0],
      zoom: 2,
      attributionControl: { compact: true },
      // Box zoom takes shift-clicks, which add transects to the selection.
      boxZoom: false,
    });
    mapRef.current = map;

    const handleLassoFinish = (
      id: string | number,
      feature: ReturnType<TerraDraw['getSnapshotFeature']>,
    ) => {
      const draw = drawRef.current;
      if (!draw || !feature || feature.geometry.type !== 'Polygon') return;

      // Use jittered screen positions for lasso hit testing.
      const screenPolygon = feature.geometry.coordinates[0].map(([lng, lat]) =>
        map.project([lng, lat]),
      );
      const isInsideScreenPolygon = (x: number, y: number) => {
        let inside = false;
        for (
          let i = 0, j = screenPolygon.length - 1;
          i < screenPolygon.length;
          j = i++
        ) {
          const a = screenPolygon[i];
          const b = screenPolygon[j];
          if (
            a.y > y !== b.y > y &&
            x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
          ) {
            inside = !inside;
          }
        }
        return inside;
      };

      const enclosed = segmentedImagesRef.current.filter((img) => {
        const pos = adjustedPositionsRef.current[img.id] || img;
        const screenPoint = map.project([pos.longitude, pos.latitude]);
        return isInsideScreenPolygon(screenPoint.x, screenPoint.y);
      });

      draw.setMode(MODE_IDLE);
      setLassoActive(false);

      if (!enclosed.length) {
        try {
          draw.removeFeatures([id]);
        } catch {
          /* ignore */
        }
        return;
      }
      setPendingLasso({
        id,
        enclosedImageIds: new Set(enclosed.map((img) => img.id)),
      });
    };

    map.on('load', () => {
      map.addSource(SRC_STRATA, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_BOUNDARY, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_EXCLUSIONS, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_POINTS, {
        type: 'geojson',
        data: EMPTY_FC as any,
        promoteId: 'id',
      });

      map.addLayer({
        id: LYR_STRATA_FILL,
        type: 'fill',
        source: SRC_STRATA,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.1 },
      });
      map.addLayer({
        id: LYR_STRATA_LINE,
        type: 'line',
        source: SRC_STRATA,
        paint: { 'line-color': ['get', 'color'], 'line-width': 1 },
      });
      map.addLayer({
        id: LYR_BOUNDARY,
        type: 'line',
        source: SRC_BOUNDARY,
        paint: { 'line-color': '#97009c', 'line-width': 2 },
      });
      map.addLayer({
        id: LYR_EXCLUSIONS,
        type: 'line',
        source: SRC_EXCLUSIONS,
        paint: { 'line-color': '#ff0000', 'line-width': 2 },
      });
      // Selection lives in the GeoJSON properties so refreshes keep it.
      map.addLayer({
        id: LYR_POINTS,
        type: 'circle',
        source: SRC_POINTS,
        layout: {
          'circle-sort-key': ['case', ['get', 'selected'], 1, 0],
        },
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 6.5, 5],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['case', ['get', 'dimmed'], 0.15, 1],
        },
      });

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({
            modeName: MODE_LASSO,
            // Default 40px snaps to corners while placing points near them.
            pointerDistance: 12,
          }),
          new TerraDrawRenderMode({ modeName: MODE_IDLE, styles: {} }),
        ],
      });
      drawRef.current = draw;
      draw.start();
      draw.setMode(MODE_IDLE);

      draw.on('finish', (id, ctx) => {
        const feature =
          draw.getSnapshotFeature(id) ??
          draw
            .getSnapshot()
            .find((candidate) => String(candidate.id) === String(id));
        const finishedMode = feature?.properties?.mode ?? ctx.mode;
        if (
          finishedMode === MODE_LASSO &&
          feature?.geometry.type === 'Polygon'
        ) {
          handleLassoFinish(id, feature);
        }
      });

      map.on('click', (e) => {
        // Ignore the click that just closed a lasso.
        if (lassoActiveRef.current || pendingLassoRef.current) return;
        const [f] = map.queryRenderedFeatures(e.point, {
          layers: [LYR_POINTS],
        });
        if (!f) {
          setSelectedTransectIds(new Set());
          return;
        }
        const imageId = String(f.id ?? (f.properties as any)?.id ?? '');
        const image = segmentedImagesRef.current.find(
          (candidate) => String(candidate.id) === imageId,
        );
        const tid = Number(image?.transectId);
        if (!Number.isFinite(tid)) return;
        const { ctrlKey, metaKey, shiftKey } = e.originalEvent;
        toggleTransectRef.current(tid, ctrlKey || metaKey || shiftKey);
      });

      map.on('mouseenter', LYR_POINTS, () => {
        if (!lassoActiveRef.current) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', LYR_POINTS, () => {
        if (!lassoActiveRef.current) map.getCanvas().style.cursor = '';
      });

      setMapLoaded(true);
    });

    return () => {
      setMapLoaded(false);
      try {
        drawRef.current?.stop();
      } catch {
        /* ignore */
      }
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_POINTS) as maplibregl.GeoJSONSource
    )?.setData(pointsFC as any);
  }, [mapLoaded, pointsFC]);

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_BOUNDARY) as maplibregl.GeoJSONSource
    )?.setData(boundaryFC as any);
  }, [mapLoaded, boundaryFC]);

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_EXCLUSIONS) as maplibregl.GeoJSONSource
    )?.setData(exclusionsFC as any);
  }, [mapLoaded, exclusionsFC]);

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_STRATA) as maplibregl.GeoJSONSource
    )?.setData(strataFC as any);
  }, [mapLoaded, strataFC]);

  const fitTo = useCallback((images: SegmentedImage[]) => {
    const map = mapRef.current;
    if (!map) return false;
    const bounds = new maplibregl.LngLatBounds();
    for (const img of images) {
      if (isValidLatLng(img.latitude, img.longitude)) {
        bounds.extend([img.longitude, img.latitude]);
      }
    }
    if (bounds.isEmpty()) return false;
    map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 0 });
    return true;
  }, []);

  const fitAll = () => fitTo(segmentedImages);

  const zoomToTransect = (tid: number) =>
    fitTo(segmentedImages.filter((img) => img.transectId === tid));

  // Fit the map to the image points on initial load.
  useEffect(() => {
    if (!mapLoaded || hasFittedBounds || segmentedImages.length === 0) return;
    if (fitTo(segmentedImages)) setHasFittedBounds(true);
  }, [mapLoaded, segmentedImages, hasFittedBounds, fitTo]);

  const toggleFullscreen = () => {
    const frame = frameRef.current;
    if (!frame) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.requestFullscreen?.();
  };

  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const surveySaving = useSurveySaving(projectId);
  const editable = mapLoaded && !loading && !loadError && !saving;
  const dirty = !loading && segmentedImages !== savedImages;
  const hasArea = strata.length > 0 || !!boundary;
  const canSave = editable && hasArea && dirty && !surveySaving;
  const selectedImageCount = [...selectedTransectIds].reduce(
    (sum, tid) => sum + (transectImageCounts[tid] ?? 0),
    0,
  );

  const shortcutsRef = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcutsRef.current = (e: KeyboardEvent) => {
    const frame = frameRef.current;
    if (!frame || !frame.offsetParent || !editable) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && (key === 'z' || key === 'y')) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod || e.altKey) return;
    if (key === 'escape') {
      if (lassoActive || pendingLasso) stopLasso();
      else setSelectedTransectIds(new Set());
    } else if (key === 'enter' && pendingLasso) {
      e.preventDefault();
      splitPending();
    } else if (key === 'v') stopLasso();
    else if (key === 'p') startLasso();
    else if (key === 'm') mergeSelected();
    else if (key === 'r') redetect();
    else if (key === 't') setPanelOpen((open) => !open);
    else if (key === 'f') fitAll();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutsRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tools: {
    label: string;
    shortcut: string;
    icon: ReactNode;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    divider?: boolean;
  }[] = [
    {
      label: 'Select transects',
      shortcut: 'V',
      icon: <MousePointer2Icon className='size-4' />,
      active: !lassoActive && !pendingLasso,
      onClick: stopLasso,
    },
    {
      label: 'Draw around points to split them off',
      shortcut: 'P',
      icon: <LassoIcon className='size-4' />,
      active: lassoActive || !!pendingLasso,
      onClick: () => (lassoActive ? stopLasso() : startLasso()),
    },
    {
      label: 'Merge selected transects',
      shortcut: 'M',
      icon: <MergeIcon className='size-4' />,
      disabled: selectedTransectIds.size < 2,
      onClick: mergeSelected,
      divider: true,
    },
    {
      label: 'Detect transects again',
      shortcut: 'R',
      icon: <WandSparklesIcon className='size-4' />,
      onClick: redetect,
      divider: true,
    },
    {
      label: 'Undo',
      shortcut: 'Ctrl Z',
      icon: <Undo2Icon className='size-4' />,
      disabled: history.length === 0,
      onClick: undo,
      divider: true,
    },
    {
      label: 'Redo',
      shortcut: 'Ctrl Shift Z',
      icon: <Redo2Icon className='size-4' />,
      disabled: future.length === 0,
      onClick: redo,
    },
  ];

  const hint = lassoActive
    ? 'Click to draw around points · click the first point to finish'
    : selectedTransectIds.size === 0 && segmentedImages.length > 0
      ? 'Click a point to select its transect · Shift-click to add more'
      : null;

  const banners = [
    loadError && { tone: 'danger', text: loadError },
    !loading &&
      !loadError &&
      !hasArea && {
        tone: 'warning',
        text: 'Add a survey boundary in Define Strata before saving transects.',
      },
    !loading &&
      !loadError &&
      segmentedImages.length === 0 && {
        tone: 'warning',
        text: 'No images with location data are inside the survey area.',
      },
    saveError && { tone: 'danger', text: saveError },
  ].filter(Boolean) as { tone: 'danger' | 'warning'; text: string }[];

  return (
    <>
      <div className='p-4'>
        <div
          ref={frameRef}
          className={cn(
            'survey-map',
            fullscreen && 'h-full rounded-none border-0',
          )}
        >
          {/* Inline: maplibre's unlayered CSS overrides layered utilities here. */}
          <div ref={mapDivRef} style={{ position: 'absolute', inset: 0 }} />

          {banners.length > 0 && (
            <div className='absolute top-3 left-1/2 z-20 flex w-max max-w-[60%] -translate-x-1/2 flex-col gap-2'>
              {banners.map((banner) => (
                <div
                  key={banner.text}
                  className={cn(
                    'border px-3 py-2 text-sm text-[#212529] shadow-lg',
                    banner.tone === 'danger'
                      ? 'border-danger bg-[#fbe3e2]'
                      : 'border-warning bg-[#fff3cd]',
                  )}
                >
                  {banner.text}
                </div>
              ))}
            </div>
          )}

          {loading && (
            <div className='absolute inset-0 z-30 flex items-center justify-center bg-black/20'>
              <div
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm text-[#212529]',
                  MAP_CONTROLS,
                )}
              >
                <Spinner animation='border' size='sm' />
                {surveySaving
                  ? 'Waiting for the last save to finish...'
                  : `Loading images${
                      loadedCount > 0
                        ? ` · ${loadedCount.toLocaleString()} loaded`
                        : ''
                    }...`}
              </div>
            </div>
          )}

          {editable && (
            <div
              className={cn(
                'absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2',
                MAP_CONTROLS,
              )}
            >
              {tools.map((tool) => (
                <div key={tool.label} className='flex'>
                  {tool.divider && <div className={MAP_DIVIDER} />}
                  <MapButton
                    tipSide='top'
                    label={tool.label}
                    shortcut={tool.shortcut}
                    active={tool.active}
                    disabled={tool.disabled}
                    onClick={tool.onClick}
                  >
                    {tool.icon}
                  </MapButton>
                </div>
              ))}
            </div>
          )}

          {editable &&
            (pendingLasso || selectedTransectIds.size > 0 || hint) && (
              <div className='absolute bottom-[5.5rem] left-1/2 z-10 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2'>
                <div
                  className={cn(
                    'flex flex-wrap items-center gap-x-3 gap-y-1 border border-black/10 px-3 py-1.5 text-xs text-[#212529]',
                    MAP_CONTROLS,
                  )}
                >
                  {pendingLasso ? (
                    <>
                      <span>
                        <strong>
                          {pendingLasso.enclosedImageIds.size.toLocaleString()}
                        </strong>{' '}
                        point
                        {pendingLasso.enclosedImageIds.size === 1
                          ? ''
                          : 's'}{' '}
                        enclosed
                      </span>
                      <Button
                        size='xs'
                        variant='primary'
                        onClick={splitPending}
                      >
                        New transect <Kbd>Enter</Kbd>
                      </Button>
                      <button
                        type='button'
                        className='flex items-center gap-1 hover:text-primary'
                        onClick={stopLasso}
                      >
                        Cancel <Kbd>Esc</Kbd>
                      </button>
                    </>
                  ) : selectedTransectIds.size > 0 && !lassoActive ? (
                    <>
                      <span>
                        <strong>
                          {selectedTransectIds.size === 1
                            ? `Transect ${transectNumber.get(
                                [...selectedTransectIds][0],
                              )}`
                            : `${selectedTransectIds.size} transects selected`}
                        </strong>{' '}
                        · {selectedImageCount.toLocaleString()} image
                        {selectedImageCount === 1 ? '' : 's'}
                      </span>
                      {selectedTransectIds.size >= 2 ? (
                        <Button
                          size='xs'
                          variant='primary'
                          onClick={mergeSelected}
                        >
                          Merge <Kbd>M</Kbd>
                        </Button>
                      ) : (
                        <span className='text-[#6c757d]'>
                          Shift-click another to merge
                        </span>
                      )}
                      <button
                        type='button'
                        className='flex items-center gap-1 hover:text-primary'
                        onClick={() => setSelectedTransectIds(new Set())}
                      >
                        Clear <Kbd>Esc</Kbd>
                      </button>
                    </>
                  ) : (
                    <>
                      {hint}
                      {lassoActive && <Kbd>Esc cancel</Kbd>}
                    </>
                  )}
                </div>
              </div>
            )}

          {!loading && !loadError && (
            <div className='pointer-events-none absolute top-3 right-3 bottom-3 z-10 flex items-start'>
              {panelOpen ? (
                <div
                  className='pointer-events-auto flex max-h-full w-72 flex-col overflow-hidden bg-white text-foreground shadow-lg'
                  style={LIGHT_THEME}
                >
                  <div className='flex items-center gap-2 border-b border-black/10 px-3 py-2 text-sm'>
                    <ListIcon className='size-4' />
                    <span className='flex-1 font-semibold'>Transects</span>
                    <Kbd>T</Kbd>
                    <button
                      type='button'
                      aria-label='Hide panel'
                      onClick={() => setPanelOpen(false)}
                      className='p-0.5 hover:text-primary'
                    >
                      <XIcon className='size-4' />
                    </button>
                  </div>
                  <div className='border-b border-black/10 px-3 py-1.5 text-xs text-muted-foreground'>
                    {transectIds.length.toLocaleString()} transect
                    {transectIds.length === 1 ? '' : 's'} ·{' '}
                    {segmentedImages.length.toLocaleString()} image
                    {segmentedImages.length === 1 ? '' : 's'}
                  </div>
                  <div className='flex min-h-0 flex-col overflow-y-auto'>
                    {transectIds.map((tid) => {
                      const selected = selectedTransectIds.has(tid);
                      const count = transectImageCounts[tid] ?? 0;
                      const stratum = transectStratum.get(tid);
                      return (
                        <div
                          key={tid}
                          role='button'
                          tabIndex={0}
                          onClick={(e) =>
                            toggleTransect(
                              tid,
                              e.shiftKey || e.ctrlKey || e.metaKey,
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleTransect(tid, e.shiftKey);
                            }
                          }}
                          className={cn(
                            'flex cursor-pointer items-center gap-2.5 border-b border-black/5 px-3 py-1.5 text-sm select-none',
                            selected
                              ? 'bg-primary/10 shadow-[inset_3px_0_0_var(--color-primary)]'
                              : 'hover:bg-black/5',
                          )}
                        >
                          <span
                            className='size-2.5 shrink-0'
                            style={{ backgroundColor: colourFor(tid) }}
                          />
                          <span className='flex min-w-0 flex-1 flex-col'>
                            <span>Transect {transectNumber.get(tid)}</span>
                            <span className='truncate text-xs text-muted-foreground'>
                              {stratum ? `${stratum} · ` : ''}
                              {count.toLocaleString()} image
                              {count === 1 ? '' : 's'}
                            </span>
                          </span>
                          <button
                            type='button'
                            title='Zoom to'
                            aria-label={`Zoom to transect ${transectNumber.get(
                              tid,
                            )}`}
                            className='p-1 opacity-70 hover:text-primary hover:opacity-100'
                            onClick={(e) => {
                              e.stopPropagation();
                              zoomToTransect(tid);
                            }}
                          >
                            <CrosshairIcon className='size-3.5' />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <MapButton
                  label='Show transects'
                  shortcut='T'
                  tipSide='left'
                  className={cn('pointer-events-auto', MAP_CONTROLS)}
                  onClick={() => setPanelOpen(true)}
                >
                  <ListIcon className='size-4' />
                </MapButton>
              )}
            </div>
          )}

          <div
            className={cn(
              'absolute top-3 left-3 z-10 flex flex-col',
              MAP_CONTROLS,
            )}
          >
            <MapButton
              label={fullscreen ? 'Exit full screen' : 'Full screen'}
              shortcut={fullscreen ? 'Esc' : undefined}
              onClick={toggleFullscreen}
            >
              {fullscreen ? (
                <Minimize2Icon className='size-4' />
              ) : (
                <Maximize2Icon className='size-4' />
              )}
            </MapButton>
            <div className='mx-2 h-px bg-black/15' />
            <MapButton label='Zoom in' onClick={() => mapRef.current?.zoomIn()}>
              <PlusIcon className='size-4' />
            </MapButton>
            <MapButton
              label='Zoom out'
              onClick={() => mapRef.current?.zoomOut()}
            >
              <MinusIcon className='size-4' />
            </MapButton>
            <MapButton label='Fit to images' shortcut='F' onClick={fitAll}>
              <ScanIcon className='size-4' />
            </MapButton>
          </div>
        </div>
      </div>
      <Footer>
        <Button
          variant='ghost'
          className='mr-auto'
          onClick={() => showModal(null)}
          disabled={saving}
        >
          Close
        </Button>
        {saving ? (
          <span className='flex items-center gap-2 text-xs text-muted-foreground'>
            <Spinner animation='border' size='sm' />
            Saving ·{' '}
            {savingImageCount > 0
              ? Math.round((savingProgress / savingImageCount) * 100)
              : 0}
            %
          </span>
        ) : dirty ? (
          <span className='text-xs text-warning'>● Unsaved changes</span>
        ) : (
          justSaved && <span className='text-xs text-success'>Saved</span>
        )}
        <Button variant='primary' onClick={handleSubmit} disabled={!canSave}>
          Save changes
        </Button>
      </Footer>
    </>
  );
}
