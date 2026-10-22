import {
  useState,
  useEffect,
  useContext,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import { GlobalContext } from '../Context';
import { fetchAllPaginatedResults } from '../utils';
import { Form, Spinner, Button } from 'react-bootstrap';
import { Footer } from '../Modal';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRenderMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import * as turf from '@turf/turf';
import { detectTransects } from '../../amplify/functions/shared/detectTransects';
import { BASE_STYLE, EMPTY_FC } from './surveyMapStyle';
import './surveyMap.css';
import BoundaryRecomputeGate from './BoundaryRecomputeGate';
import {
  runSurveySave,
  surveySaveSettled,
  useSurveySaving,
} from './surveySaves';
import { loadSurveyArea } from '../utils/shapefileUtils';
import {
  assignTransectsToStrata,
  clearJollyResults,
  closedLngLatRing,
  isValidLatLng,
  loadOnEffortImages,
  loadStrata,
  segmentBySavedTransect,
  stratumMetrics,
  strataColors,
  transectColors,
  transectsByStratum,
  type LatLng,
  type SavedStratum,
  type SegmentedImage,
} from './transectStrata';

// Idle mode leaves image-point clicks available.
const MODE_ENCLOSE = 'enclose';
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingImageCount, setSavingImageCount] = useState(0);
  const [savingProgress, setSavingProgress] = useState(0);
  const [showInstructions, setShowInstructions] = useState(false);
  const [boundary, setBoundary] = useState<LatLng[] | null>(null);
  const [exclusions, setExclusions] = useState<LatLng[][]>([]);
  const [strata, setStrata] = useState<SavedStratum[]>([]);
  const [segmentedImages, setSegmentedImages] = useState<SegmentedImage[]>([]);
  const [selectedTransectIds, setSelectedTransectIds] = useState<Set<number>>(
    new Set()
  );
  const [pendingPolygon, setPendingPolygon] = useState<{
    id: string | number;
    enclosedImageIds: Set<string>;
    center: [number, number]; // [lng, lat]
  } | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [activeTool, setActiveTool] = useState<'enclose' | null>(null);
  const [hasFittedBounds, setHasFittedBounds] = useState(false);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pendingPopupRef = useRef<maplibregl.Popup | null>(null);
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

  // Jitter duplicate coordinates slightly so overlapping markers are visible
  const adjustedPositions = useMemo(() => {
    const byCoordKey: Record<string, SegmentedImage[]> = {};
    const adjusted: Record<string, { latitude: number; longitude: number }> =
      {};
    segmentedImages.forEach((img) => {
      const key = `${img.latitude},${img.longitude}`;
      (byCoordKey[key] = byCoordKey[key] || []).push(img);
    });
    Object.values(byCoordKey).forEach((group) => {
      if (group.length === 1) {
        const img = group[0];
        adjusted[img.id] = { latitude: img.latitude, longitude: img.longitude };
        return;
      }
      // Spread duplicates around a small circle (~5m radius)
      group.forEach((img, index) => {
        const latRad = (img.latitude * Math.PI) / 180;
        const radiusDeg = 0.00005;
        const angle = (2 * Math.PI * index) / group.length;
        adjusted[img.id] = {
          latitude: img.latitude + radiusDeg * Math.sin(angle),
          longitude:
            img.longitude +
            (radiusDeg * Math.cos(angle)) / Math.max(Math.cos(latRad), 1e-6),
        };
      });
    });
    return adjusted;
  }, [segmentedImages]);

  // Refs so the once-registered map handlers always read current values.
  const segmentedImagesRef = useRef(segmentedImages);
  segmentedImagesRef.current = segmentedImages;
  const adjustedPositionsRef = useRef(adjustedPositions);
  adjustedPositionsRef.current = adjustedPositions;
  const selectedTransectIdsRef = useRef(selectedTransectIds);
  selectedTransectIdsRef.current = selectedTransectIds;
  const transectImageCountsRef = useRef(transectImageCounts);
  transectImageCountsRef.current = transectImageCounts;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const pendingPolygonRef = useRef(pendingPolygon);
  pendingPolygonRef.current = pendingPolygon;

  const clearPendingSelection = useCallback(() => {
    const pending = pendingPolygonRef.current;
    if (pending) {
      try {
        drawRef.current?.removeFeatures([pending.id]);
      } catch {
        /* already gone */
      }
    }
    setPendingPolygon(null);
  }, []);

  const assignPendingToNewTransect = useCallback(() => {
    const pending = pendingPolygonRef.current;
    if (!pending) return;
    // Spreading every image into Math.max overflows the stack on large surveys.
    const currentMax = segmentedImages.reduce(
      (max, si) => Math.max(max, si.transectId),
      -1
    );
    const newTransectId = currentMax + 1;
    const enclosedIds = pending.enclosedImageIds;
    setSegmentedImages((prev) =>
      prev.map((si) =>
        enclosedIds.has(si.id) ? { ...si, transectId: newTransectId } : si
      )
    );
    setSelectedTransectIds(new Set([newTransectId]));
    try {
      drawRef.current?.removeFeatures([pending.id]);
    } catch {
      /* already gone */
    }
    setPendingPolygon(null);
    drawRef.current?.setMode(MODE_IDLE);
    setActiveTool(null);
  }, [segmentedImages]);

  const handleMergeSelectedInto = useCallback((targetTransectId: number) => {
    setSegmentedImages((prev) =>
      prev.map((si) =>
        selectedTransectIdsRef.current.has(si.transectId)
          ? { ...si, transectId: targetTransectId }
          : si
      )
    );
    setSelectedTransectIds(new Set());
  }, []);
  const handleMergeSelectedIntoRef = useRef(handleMergeSelectedInto);
  handleMergeSelectedIntoRef.current = handleMergeSelectedInto;
  const assignPendingToNewTransectRef = useRef(assignPendingToNewTransect);
  assignPendingToNewTransectRef.current = assignPendingToNewTransect;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        await surveySaveSettled(projectId);
        if (signal.aborted) return;
        const [imageData, area, savedStrata] = await Promise.all([
          loadOnEffortImages(client, projectId, signal),
          loadSurveyArea(client, projectId, signal),
          loadStrata(client, projectId, signal),
        ]);
        if (signal.aborted) return;
        const { images, imputedIds, dbTransectIds } = imageData;
        dbTransectIdsRef.current = dbTransectIds;
        imputedIdsRef.current = imputedIds;
        setBoundary(area.boundary);
        setExclusions(area.exclusions);
        setStrata(savedStrata);
        if (images.some((img) => img.dbTransectId)) {
          setSegmentedImages(segmentBySavedTransect(images).segmented);
        } else {
          const imagesById = new Map(images.map((img) => [img.id, img]));
          setSegmentedImages(
            detectTransects(images).map(({ id, transectIndex }) => ({
              ...imagesById.get(id)!,
              transectId: transectIndex,
            }))
          );
        }
        setLoading(false);
      } catch (err) {
        if (signal.aborted) return;
        console.error('Failed to load transects:', err);
        setLoadError('The survey data could not be loaded.');
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [client, projectId]);

  const handleSubmit = async () => {
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
        const assignment = assignTransectsToStrata(
          segmentedImages,
          currentStrata.map((st) => st.coords)
        );

        const transectMap: Record<number, string> = {};
        for (const tid of transectIds) {
          const index = assignment.get(tid);
          if (index == null) continue;
          const { data } = await (client.models.Transect.create as any)({
            projectId,
            stratumId: currentStrata[index].id,
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
        for (const img of segmentedImages) {
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
                : { id: img.id, transectId: trId }
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
          })
        );
        const savedTransectIds = new Map(dbTransectIds);
        for (const update of imageUpdates) {
          savedTransectIds.set(update.id, update.transectId);
        }
        dbTransectIdsRef.current = savedTransectIds;

        const allTransects = (await fetchAllPaginatedResults(
          client.models.Transect.transectsByProjectId as any,
          { projectId, limit: 10000, selectionSet: ['id'] } as any
        )) as any[];
        const usedTransectIds = new Set(Object.values(transectMap));
        await Promise.all(
          allTransects
            .map((t) => t.id as string)
            .filter((id) => !usedTransectIds.has(id))
            .map((id) => (client.models.Transect.delete as any)({ id }))
        );

        const groups = transectsByStratum(assignment, currentStrata.length);
        await Promise.all(
          currentStrata.map((st, i) =>
            (client.models.Stratum.update as any)({
              id: st.id,
              ...stratumMetrics(
                st.coords,
                exclusions,
                groups[i],
                segmentedImages
              ),
            })
          )
        );
        setStrata(currentStrata);

        await clearJollyResults(client, projectId);
      });
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
            color: transectColors[img.transectId % transectColors.length],
            selected: selectedTransectIds.has(img.transectId),
          },
          geometry: {
            type: 'Point',
            coordinates: [pos.longitude, pos.latitude],
          },
        };
      }),
    }),
    [segmentedImages, adjustedPositions, selectedTransectIds]
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
    [exclusions]
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
    [strata]
  );

  useEffect(() => {
    if (!mapDivRef.current) return;

    const map = new maplibregl.Map({
      container: mapDivRef.current,
      style: BASE_STYLE,
      center: [0, 0],
      zoom: 2,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right'
    );

    const showPopup = (lngLat: maplibregl.LngLatLike, node: HTMLElement) => {
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true })
        .setLngLat(lngLat)
        .setDOMContent(node)
        .addTo(map);
    };

    const handleEncloseFinish = (
      id: string | number,
      feature: ReturnType<TerraDraw['getSnapshotFeature']>
    ) => {
      const draw = drawRef.current;
      if (!draw || !feature || feature.geometry.type !== 'Polygon') return;

      // Use jittered screen positions for lasso hit testing.
      const screenPolygon = feature.geometry.coordinates[0].map(([lng, lat]) =>
        map.project([lng, lat])
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
      setActiveTool(null);

      if (!enclosed.length) {
        try {
          draw.removeFeatures([id]);
        } catch {
          /* ignore */
        }
        return;
      }
      const center = turf.centerOfMass(feature as any).geometry.coordinates as [
        number,
        number
      ];
      setPendingPolygon({
        id,
        enclosedImageIds: new Set(enclosed.map((img) => img.id)),
        center,
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
        paint: {
          'circle-radius': [
            'case',
            ['boolean', ['get', 'selected'], false],
            7,
            5,
          ],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': [
            'case',
            ['boolean', ['get', 'selected'], false],
            '#000000',
            ['get', 'color'],
          ],
          'circle-stroke-width': [
            'case',
            ['boolean', ['get', 'selected'], false],
            3,
            1,
          ],
          'circle-opacity': 1,
        },
      });

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({
            modeName: MODE_ENCLOSE,
            styles: {
              fillColor: '#000000',
              fillOpacity: 0.05,
              outlineColor: '#000000',
              outlineWidth: 2,
            },
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
          finishedMode === MODE_ENCLOSE &&
          feature?.geometry.type === 'Polygon'
        ) {
          handleEncloseFinish(id, feature);
        }
      });

      map.on('click', LYR_POINTS, (e) => {
        // Ignore the click that just closed a lasso.
        if (activeToolRef.current || pendingPolygonRef.current) return;
        const f = e.features?.[0];
        if (!f) return;
        const imageId = String(f.id ?? (f.properties as any)?.id ?? '');
        const image = segmentedImagesRef.current.find(
          (candidate) => String(candidate.id) === imageId
        );
        const tid = Number(image?.transectId);
        if (!Number.isFinite(tid)) return;
        const ctrl = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
        setSelectedTransectIds((prev) => {
          const next = new Set(prev);
          if (ctrl) {
            if (next.has(tid)) next.delete(tid);
            else next.add(tid);
          } else if (next.size === 1 && next.has(tid)) {
            next.clear();
          } else {
            next.clear();
            next.add(tid);
          }
          return next;
        });
      });

      map.on('contextmenu', LYR_POINTS, (e) => {
        if (activeToolRef.current) return;
        const f = e.features?.[0];
        if (!f) return;
        e.originalEvent.preventDefault();
        const imageId = String(f.id ?? (f.properties as any)?.id ?? '');
        const image = segmentedImagesRef.current.find(
          (candidate) => String(candidate.id) === imageId
        );
        const tid = Number(image?.transectId);
        if (!Number.isFinite(tid)) return;
        const selected = Array.from(selectedTransectIdsRef.current);
        const node = document.createElement('div');
        node.style.color = '#000';
        if (selected.length >= 2) {
          const ids = selected.sort((a, b) => a - b);
          node.style.cursor = 'pointer';
          node.textContent =
            ids.length === 2
              ? `Merge transect ${ids[0]} and ${ids[1]}`
              : `Merge ${ids.length} selected transects`;
          node.onclick = () => {
            handleMergeSelectedIntoRef.current(ids[0]);
            popupRef.current?.remove();
          };
        } else {
          node.innerHTML = `<div><strong>Transect:</strong> ${tid}</div><div><strong>Images:</strong> ${
            transectImageCountsRef.current[tid] || 0
          }</div>`;
        }
        showPopup(e.lngLat, node);
      });

      map.on('mouseenter', LYR_POINTS, () => {
        if (!activeToolRef.current) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', LYR_POINTS, () => {
        if (!activeToolRef.current) map.getCanvas().style.cursor = '';
      });

      setMapLoaded(true);
    });

    return () => {
      setMapLoaded(false);
      popupRef.current?.remove();
      popupRef.current = null;
      pendingPopupRef.current?.remove();
      pendingPopupRef.current = null;
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

  // Fit the map to the image points on initial load.
  useEffect(() => {
    if (!mapLoaded || hasFittedBounds || segmentedImages.length === 0) return;
    const map = mapRef.current;
    if (!map) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const img of segmentedImages) {
      const pos = adjustedPositions[img.id] || img;
      if (isValidLatLng(pos.latitude, pos.longitude)) {
        bounds.extend([pos.longitude, pos.latitude]);
      }
    }
    if (bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 30, maxZoom: 16, duration: 0 });
    setHasFittedBounds(true);
  }, [mapLoaded, segmentedImages, adjustedPositions, hasFittedBounds]);

  // Show the "Merge points" popup while a polygon selection is pending.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !pendingPolygon) return;
    const node = document.createElement('div');
    node.className = 'd-flex flex-column gap-2';
    node.style.color = '#000';
    const label = document.createElement('div');
    label.className = 'mb-1';
    label.innerHTML = `<strong>${pendingPolygon.enclosedImageIds.size}</strong> points selected`;
    node.appendChild(label);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary btn-sm';
    btn.textContent = 'Merge points';
    btn.onclick = () => assignPendingToNewTransectRef.current();
    node.appendChild(btn);
    // The click that closes the lasso would otherwise dismiss this popup.
    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      closeOnMove: false,
    })
      .setLngLat(pendingPolygon.center)
      .setDOMContent(node)
      .addTo(map);
    pendingPopupRef.current = popup;
    const onClose = () => {
      if (pendingPolygonRef.current) clearPendingSelection();
    };
    popup.on('close', onClose);
    return () => {
      popup.off('close', onClose);
      popup.remove();
      if (pendingPopupRef.current === popup) pendingPopupRef.current = null;
    };
  }, [pendingPolygon, mapLoaded, clearPendingSelection]);

  const toggleEnclose = () => {
    const draw = drawRef.current;
    if (!draw) return;
    popupRef.current?.remove();
    if (activeTool) {
      draw.setMode(MODE_IDLE);
      setActiveTool(null);
    } else {
      draw.setMode(MODE_ENCLOSE);
      setActiveTool('enclose');
    }
  };

  const toolsDisabled = loading || saving;
  const surveySaving = useSurveySaving(projectId);
  const canSave = !loading && !loadError && (strata.length > 0 || !!boundary);

  return (
    <>
      <Form className='d-flex flex-column gap-3 p-3'>
        <div
          className='text-uppercase fw-semibold text-muted'
          style={{ letterSpacing: 0.5, fontSize: 12 }}
        >
          Define Transects
        </div>
        <div>
          <button
            type='button'
            className='text-muted d-flex align-items-center gap-1'
            onClick={() => setShowInstructions((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                transform: showInstructions ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s',
              }}
            >
              ▶
            </span>
            Instructions
          </button>
          {showInstructions && (
            <ul className='mt-2 mb-0 text-muted' style={{ fontSize: '14px' }}>
              <li>
                Single-click a point to select its transect (Ctrl/⌘-click for
                multi-select). Clicking a selected transect deselects it.
              </li>
              <li>
                Right-click a point to view that transect's info (number and
                image count). With multiple transects selected, right-click to
                merge them, or use the "Merge Selected Transects" button below
                the map.
              </li>
              <li>
                Use the <strong>Select points</strong> tool to draw around
                points, then click "Merge points" to put only the enclosed
                points into a new transect.
              </li>
              <li>
                Each transect is placed in the stratum containing its first
                image. Define strata in the <strong>Define Strata</strong> tab;
                without strata the whole survey area is one stratum.
              </li>
              <li>
                Save your work with the save button at the bottom of the page
                (even if you haven't made changes).
              </li>
            </ul>
          )}
        </div>

        <div className='d-flex gap-2 flex-wrap'>
          <Button
            size='sm'
            variant={activeTool === 'enclose' ? 'primary' : 'outline-primary'}
            onClick={toggleEnclose}
            disabled={toolsDisabled}
          >
            {activeTool === 'enclose' ? 'Selecting points…' : 'Select points'}
          </Button>
        </div>

        <div className='survey-map'>
          <div
            ref={mapDivRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
            }}
          />

          {selectedTransectIds.size >= 2 && (
            <div
              className='d-flex flex-row gap-2 p-2'
              style={{
                position: 'absolute',
                bottom: '10px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 2,
                backgroundColor: 'rgba(255,255,255,0.9)',
                border: '2px solid rgba(0, 0, 0, 0.28)',
                borderRadius: '4px',
              }}
            >
              <Button
                variant='primary'
                onClick={() =>
                  handleMergeSelectedInto(Math.min(...selectedTransectIds))
                }
              >
                Merge Selected Transects ({selectedTransectIds.size})
              </Button>
            </div>
          )}

          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(255,255,255,0.8)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000,
              }}
            >
              <Spinner animation='border' />
              <span className='ms-2'>
                {surveySaving
                  ? 'Waiting for the last save to finish'
                  : 'Loading data'}
              </span>
            </div>
          )}
        </div>
        {loadError && (
          <div className='alert alert-danger mb-0'>{loadError}</div>
        )}
        {!loading && !loadError && !boundary && strata.length === 0 && (
          <div className='alert alert-warning mb-0'>
            Add a survey boundary in Edit Shape File before saving transects.
          </div>
        )}
        {saveError && (
          <div className='alert alert-danger mb-0'>{saveError}</div>
        )}
        {saving && (
          <div className='d-flex justify-content-center align-items-center mt-3'>
            <Spinner animation='border' size='sm' />
            <span className='ms-2'>
              Saving images to transects:{' '}
              {savingImageCount > 0
                ? Math.round((savingProgress / savingImageCount) * 100)
                : 0}
              %
            </span>
          </div>
        )}
      </Form>
      <Footer>
        <Button
          variant='primary'
          onClick={handleSubmit}
          disabled={!canSave || saving || surveySaving}
        >
          Save Transects
        </Button>
        <Button
          variant='dark'
          onClick={() => showModal(null)}
          disabled={saving}
        >
          Close
        </Button>
      </Footer>
    </>
  );
}
