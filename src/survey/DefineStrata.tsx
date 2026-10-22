import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawSelectMode,
  TerraDrawRenderMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import * as turf from '@turf/turf';
import { GlobalContext } from '../Context';
import { Footer } from '../Modal';
import { fetchAllPaginatedResults } from '../utils';
import { BASE_STYLE, EMPTY_FC } from './surveyMapStyle';
import './surveyMap.css';
import BoundaryRecomputeGate from './BoundaryRecomputeGate';
import {
  runSurveySave,
  surveySaveSettled,
  useSurveySaving,
} from './surveySaves';
import { loadSurveyArea } from '../utils/shapefileUtils';
import { ringAreaKm2, ringToPolygon } from './new-survey/surveyArea';
import {
  assignTransectsToStrata,
  clearJollyResults,
  closedLngLatRing,
  loadOnEffortImages,
  loadStrata,
  segmentBySavedTransect,
  splitBoundary,
  stratumMetrics,
  strataColors,
  transectsByStratum,
  type LatLng,
  type SavedStratum,
  type SegmentedImage,
} from './transectStrata';

const MODE_STRATA = 'strata';
const MODE_SELECT = 'select';
const MODE_IDLE = 'idle';

const SRC_POINTS = 'st-points';
const LYR_POINTS = 'st-points-layer';
const SRC_BOUNDARY = 'st-boundary';
const LYR_BOUNDARY = 'st-boundary-line';
const SRC_EXCLUSIONS = 'st-exclusions';
const LYR_EXCLUSIONS = 'st-exclusions-line';
const SRC_STRATA = 'st-strata';
const LYR_STRATA_FILL = 'st-strata-fill';
const LYR_STRATA_LINE = 'st-strata-line';
const SRC_LABELS = 'st-labels';
const LYR_LABELS = 'st-labels-text';

const HISTORY_LIMIT = 30;
const UNASSIGNED_COLOR = '#8a8a8a';

type Tool = 'draw' | 'edit';

// Preserve saved geometry until the user redraws.
type Layout = { redrawn: boolean; lines: LatLng[][] };

type DefineStrataProps = { projectId: string; organizationId: string };

export default function DefineStrata(props: DefineStrataProps) {
  return (
    <BoundaryRecomputeGate projectId={props.projectId} what='Strata'>
      <DefineStrataEditor {...props} />
    </BoundaryRecomputeGate>
  );
}

function formatArea(km2: number): string {
  if (km2 >= 100) return `${Math.round(km2).toLocaleString()} km²`;
  if (km2 >= 1) return `${km2.toFixed(1)} km²`;
  return `${km2.toFixed(2)} km²`;
}

function lineFeatures(draw: TerraDraw): any[] {
  return draw
    .getSnapshot()
    .filter(
      (f: any) =>
        f.geometry?.type === 'LineString' && f.properties?.mode === MODE_STRATA
    );
}

function DefineStrataEditor({ projectId, organizationId }: DefineStrataProps) {
  const { client, showModal } = useContext(GlobalContext)!;
  const [loading, setLoading] = useState(true);
  const [imagesLoading, setImagesLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [boundary, setBoundary] = useState<LatLng[] | null>(null);
  const [exclusions, setExclusions] = useState<LatLng[][]>([]);
  const [saved, setSaved] = useState<SavedStratum[]>([]);
  const [segmented, setSegmented] = useState<SegmentedImage[]>([]);
  const [dbIdByIndex, setDbIdByIndex] = useState<string[]>([]);
  const [layout, setLayout] = useState<Layout>({ redrawn: false, lines: [] });
  const [history, setHistory] = useState<Layout[]>([]);
  const [names, setNames] = useState<string[]>([]);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const precisionRef = useRef(9);
  const fittedRef = useRef(false);
  // The lines the draw store currently shows; other values get re-seeded.
  const syncedLinesRef = useRef<LatLng[][]>([]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const showSaved = saved.length > 0 && !layout.redrawn;

  const sections = useMemo<LatLng[][]>(() => {
    if (showSaved) return saved.map((st) => st.coords);
    return boundary ? splitBoundary(boundary, layout.lines) : [];
  }, [showSaved, saved, boundary, layout.lines]);

  const sectionNames = useMemo(
    () =>
      sections.map(
        (_, i) => names[i] ?? (showSaved ? saved[i].name : `Stratum ${i + 1}`)
      ),
    [sections, names, showSaved, saved]
  );

  const assignment = useMemo(
    () => assignTransectsToStrata(segmented, sections),
    [segmented, sections]
  );

  const sectionStats = useMemo(() => {
    const stats = sections.map(() => ({ transects: 0, images: 0 }));
    for (const index of assignment.values()) {
      if (index !== null) stats[index].transects++;
    }
    for (const img of segmented) {
      const index = assignment.get(img.transectId);
      if (index != null) stats[index].images++;
    }
    return stats;
  }, [sections, assignment, segmented]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        await surveySaveSettled(projectId);
        if (signal.aborted) return;
        const [area, strata] = await Promise.all([
          loadSurveyArea(client, projectId, signal),
          loadStrata(client, projectId, signal),
        ]);
        if (signal.aborted) return;
        setBoundary(area.boundary);
        setExclusions(area.exclusions);
        setSaved(strata);
        setLoading(false);
        const { images } = await loadOnEffortImages(client, projectId, signal);
        if (signal.aborted) return;
        const result = segmentBySavedTransect(images);
        setSegmented(result.segmented);
        setDbIdByIndex(result.dbIdByIndex);
        setImagesLoading(false);
      } catch (err) {
        if (signal.aborted) return;
        console.error('Failed to load strata:', err);
        setLoadError('The survey data could not be loaded.');
        setLoading(false);
        setImagesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [client, projectId]);

  const commitLayout = useCallback((next: Layout, fromDraw = false) => {
    const previous = layoutRef.current;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    layoutRef.current = next;
    setHistory((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), previous]);
    if (fromDraw) syncedLinesRef.current = next.lines;
    setLayout(next);
    setNames([]);
  }, []);

  const fitToRings = useCallback((rings: LatLng[][]) => {
    const map = mapRef.current;
    if (!map) return false;
    const bounds = new maplibregl.LngLatBounds();
    for (const [lat, lng] of rings.flat()) bounds.extend([lng, lat]);
    if (bounds.isEmpty()) return false;
    map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 0 });
    return true;
  }, []);

  const fitAll = useCallback(
    () => fitToRings([...(boundary ? [boundary] : []), ...sections]),
    [fitToRings, boundary, sections]
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
    map.addControl(
      new maplibregl.ScaleControl({ unit: 'metric' }),
      'bottom-left'
    );

    const commitSnapshot = () => {
      const draw = drawRef.current;
      if (!draw) return;
      const lines = lineFeatures(draw).map((f: any) =>
        (f.geometry.coordinates as [number, number][]).map(
          ([lng, lat]) => [lat, lng] as LatLng
        )
      );
      commitLayout({ redrawn: true, lines }, true);
    };

    map.on('load', () => {
      for (const src of [
        SRC_STRATA,
        SRC_BOUNDARY,
        SRC_EXCLUSIONS,
        SRC_POINTS,
        SRC_LABELS,
      ]) {
        map.addSource(src, { type: 'geojson', data: EMPTY_FC as any });
      }
      map.addLayer({
        id: LYR_STRATA_FILL,
        type: 'fill',
        source: SRC_STRATA,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['get', 'highlighted'], 0.35, 0.15],
        },
      });
      map.addLayer({
        id: LYR_STRATA_LINE,
        type: 'line',
        source: SRC_STRATA,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'highlighted'], 3, 1],
        },
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
      map.addLayer({
        id: LYR_POINTS,
        type: 'circle',
        source: SRC_POINTS,
        paint: {
          'circle-radius': 3,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#000',
          'circle-stroke-width': 0.5,
        },
      });
      map.addLayer({
        id: LYR_LABELS,
        type: 'symbol',
        source: SRC_LABELS,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 14,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#000',
          'text-halo-color': '#fff',
          'text-halo-width': 2,
        },
      });

      const adapter = new TerraDrawMapLibreGLAdapter({ map });
      precisionRef.current = adapter.getCoordinatePrecision();
      const draw = new TerraDraw({
        adapter,
        modes: [
          new TerraDrawLineStringMode({
            modeName: MODE_STRATA,
            styles: { lineStringColor: '#000000', lineStringWidth: 2 },
          }),
          new TerraDrawSelectMode({
            flags: {
              [MODE_STRATA]: {
                feature: {
                  draggable: true,
                  coordinates: {
                    draggable: true,
                    midpoints: { draggable: true },
                    deletable: true,
                  },
                },
              },
            },
          }),
          new TerraDrawRenderMode({ modeName: MODE_IDLE, styles: {} }),
        ],
      });
      drawRef.current = draw;
      draw.start();
      draw.setMode(MODE_IDLE);

      draw.on('finish', () => commitSnapshot());
      draw.on('change', (_ids, type, context) => {
        const fromApi =
          !!context && 'origin' in context && context.origin === 'api';
        if (type !== 'delete' || fromApi) return;
        // Ignore deletion of selection handles.
        if (lineFeatures(draw).length !== syncedLinesRef.current.length) {
          commitSnapshot();
        }
      });
      draw.on('select', (id) => setSelectedLineId(String(id)));
      draw.on('deselect', () => setSelectedLineId(null));

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
      fittedRef.current = false;
      syncedLinesRef.current = [];
    };
  }, [commitLayout]);

  const stopTool = useCallback(() => {
    try {
      drawRef.current?.setMode(MODE_IDLE);
    } catch {
      /* ignore */
    }
    setActiveTool(null);
    setSelectedLineId(null);
  }, []);

  useEffect(() => {
    const draw = drawRef.current;
    if (!mapLoaded || !draw || syncedLinesRef.current === layout.lines) return;
    stopTool();
    const stale = lineFeatures(draw).map((f: any) => f.id);
    if (stale.length) draw.removeFeatures(stale);
    const scale = 10 ** precisionRef.current;
    const round = (v: number) => Math.round(v * scale) / scale;
    const features = layout.lines.map((line) => ({
      id: draw.getFeatureId(),
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: line.map(([lat, lng]) => [round(lng), round(lat)]),
      },
      properties: { mode: MODE_STRATA },
    }));
    if (features.length) draw.addFeatures(features as any);
    syncedLinesRef.current = layout.lines;
  }, [mapLoaded, layout.lines, stopTool]);

  const strataFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: sections.map((coords, i) => ({
        type: 'Feature',
        properties: {
          color: strataColors[i % strataColors.length],
          highlighted: highlighted === i,
        },
        geometry: { type: 'Polygon', coordinates: [closedLngLatRing(coords)] },
      })),
    }),
    [sections, highlighted]
  );

  const labelsFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: sections.map((coords, i) => ({
        ...turf.pointOnFeature(ringToPolygon(coords)!),
        properties: { label: sectionNames[i] },
      })),
    }),
    [sections, sectionNames]
  );

  const pointsFC = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: segmented.map((img) => {
        const index = assignment.get(img.transectId);
        return {
          type: 'Feature',
          properties: {
            color:
              index == null
                ? UNASSIGNED_COLOR
                : strataColors[index % strataColors.length],
          },
          geometry: {
            type: 'Point',
            coordinates: [img.longitude, img.latitude],
          },
        };
      }),
    }),
    [segmented, assignment]
  );

  const boundaryFC = useMemo(
    () =>
      boundary
        ? {
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
          }
        : EMPTY_FC,
    [boundary]
  );

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

  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    const sources: [string, unknown][] = [
      [SRC_STRATA, strataFC],
      [SRC_LABELS, labelsFC],
      [SRC_POINTS, pointsFC],
      [SRC_BOUNDARY, boundaryFC],
      [SRC_EXCLUSIONS, exclusionsFC],
    ];
    for (const [id, data] of sources) {
      (map?.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(
        data as any
      );
    }
  }, [mapLoaded, strataFC, labelsFC, pointsFC, boundaryFC, exclusionsFC]);

  useEffect(() => {
    if (!mapLoaded || fittedRef.current || loading) return;
    if (fitAll()) fittedRef.current = true;
  }, [mapLoaded, loading, fitAll]);

  const toggleTool = (tool: Tool) => {
    const draw = drawRef.current;
    if (!draw) return;
    if (activeTool === tool) {
      stopTool();
      return;
    }
    setSelectedLineId(null);
    draw.setMode(tool === 'draw' ? MODE_STRATA : MODE_SELECT);
    setActiveTool(tool);
  };

  const deleteSelectedLine = () => {
    const draw = drawRef.current;
    if (!draw || !selectedLineId) return;
    const index = lineFeatures(draw).findIndex(
      (f: any) => String(f.id) === selectedLineId
    );
    if (index === -1) return;
    commitLayout({
      redrawn: true,
      lines: layout.lines.filter((_, i) => i !== index),
    });
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    layoutRef.current = previous;
    setLayout(previous);
    setNames([]);
  };

  const redraw = () => commitLayout({ redrawn: true, lines: [] });

  const trimmedNames = sectionNames.map((name) => name.trim());
  const nameError = trimmedNames.some((name) => !name)
    ? 'Every stratum needs a name.'
    : new Set(trimmedNames).size !== trimmedNames.length
    ? 'Stratum names must be unique.'
    : null;

  const handleSubmit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await runSurveySave(projectId, async () => {
        if (showSaved) {
          await Promise.all(
            saved
              .map((st, i) => ({ st, name: trimmedNames[i] }))
              .filter(({ st, name }) => st.name !== name)
              .map(({ st, name }) =>
                (client.models.Stratum.update as any)({ id: st.id, name })
              )
          );
          const renamed = saved.map((st, i) => ({
            ...st,
            name: trimmedNames[i],
          }));
          setSaved(renamed);
          setNames([]);
          return;
        }

        const previous = await loadStrata(client, projectId);
        const previousIds = new Set(previous.map((st) => st.id));
        await Promise.all(
          previous.map((st) =>
            (client.models.Stratum.delete as any)({ id: st.id })
          )
        );

        const groups = transectsByStratum(assignment, sections.length);
        const created: SavedStratum[] = [];
        for (let i = 0; i < sections.length; i++) {
          const coords = sections[i];
          const { data } = await (client.models.Stratum.create as any)({
            projectId,
            name: trimmedNames[i],
            coordinates: coords.flat(),
            group: organizationId,
            ...stratumMetrics(coords, exclusions, groups[i], segmented),
          });
          created.push({ id: data.id, name: trimmedNames[i], coords });
        }

        const newStratumByDbId = new Map<string, string>();
        for (const [tid, index] of assignment) {
          if (index !== null)
            newStratumByDbId.set(dbIdByIndex[tid], created[index].id);
        }
        const transects = (await fetchAllPaginatedResults(
          client.models.Transect.transectsByProjectId as any,
          { projectId, limit: 10000, selectionSet: ['id', 'stratumId'] } as any
        )) as any[];
        await Promise.all(
          transects
            .map((t) => ({
              id: t.id as string,
              stratumId:
                newStratumByDbId.get(t.id) ??
                (previousIds.has(t.stratumId) ? created[0]?.id : undefined),
            }))
            .filter((t) => t.stratumId)
            .map((t) => (client.models.Transect.update as any)(t))
        );

        await clearJollyResults(client, projectId);
        setSaved(created);
        setNames([]);
        setLayout({ redrawn: false, lines: [] });
        setHistory([]);
        stopTool();
      });
    } catch (err) {
      console.error('Failed to save strata:', err);
      setSaveError('The strata could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toolHint =
    activeTool === 'edit'
      ? 'Click a line to select it, then drag it or its points. Right-click a point to delete it.'
      : activeTool === 'draw'
      ? 'Click to place points across the boundary, starting and ending outside it. Click the last point again or press Enter to finish.'
      : null;

  const editingDisabled = loading || saving || !boundary;
  const surveySaving = useSurveySaving(projectId);
  const canSave =
    !loading &&
    !imagesLoading &&
    !loadError &&
    sections.length > 0 &&
    !nameError;

  return (
    <>
      <Form className='d-flex flex-column gap-3 p-3'>
        <div
          className='text-uppercase fw-semibold text-muted'
          style={{ letterSpacing: 0.5, fontSize: 12 }}
        >
          Define Strata
        </div>
        <div className='d-flex flex-wrap gap-3'>
          <div
            className='d-flex flex-column gap-2'
            style={{ flex: '1 1 260px', maxWidth: 360, minWidth: 0 }}
          >
            <Form.Label className='mb-0'>Strata</Form.Label>
            <Form.Text className='d-block mt-0' style={{ fontSize: 12 }}>
              {showSaved
                ? 'These are the saved strata. Rename them here, or redraw them to change their shape.'
                : 'Draw lines across the boundary to split it into strata. Without lines the whole survey area is one stratum. Changing the lines resets the names.'}
            </Form.Text>
            {loading ? (
              <span
                className='text-muted d-flex align-items-center gap-2'
                style={{ fontSize: 12 }}
              >
                <Spinner animation='border' size='sm' />
                {surveySaving && 'Waiting for the last save to finish'}
              </span>
            ) : sections.length === 0 ? (
              <div className='alert alert-warning mb-0 p-2'>
                Add a survey boundary in Edit Shape File before defining strata.
              </div>
            ) : (
              <div
                className='d-flex flex-column gap-2'
                style={{ maxHeight: 520, overflowY: 'auto' }}
              >
                {sections.map((coords, i) => (
                  <div
                    key={i}
                    className='d-flex align-items-center gap-2 border border-dark p-2'
                    onMouseEnter={() => setHighlighted(i)}
                    onMouseLeave={() => setHighlighted(null)}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        flex: '0 0 auto',
                        background: strataColors[i % strataColors.length],
                      }}
                    />
                    <div className='flex-grow-1' style={{ minWidth: 0 }}>
                      <Form.Control
                        size='sm'
                        aria-label={`Name of stratum ${i + 1}`}
                        value={sectionNames[i]}
                        disabled={saving}
                        isInvalid={!trimmedNames[i]}
                        onChange={(e) => {
                          const next = [...sectionNames];
                          next[i] = e.target.value;
                          setNames(next);
                        }}
                      />
                      <div className='text-muted mt-1' style={{ fontSize: 12 }}>
                        {formatArea(ringAreaKm2(coords))}
                        {!imagesLoading &&
                          `, ${sectionStats[i].transects} transect${
                            sectionStats[i].transects === 1 ? '' : 's'
                          }, ${sectionStats[i].images} images`}
                      </div>
                    </div>
                    <Button
                      size='sm'
                      variant='outline-light'
                      onClick={() => fitToRings([coords])}
                    >
                      Show
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {imagesLoading && !loading && (
              <span
                className='text-muted d-flex align-items-center gap-2'
                style={{ fontSize: 12 }}
              >
                <Spinner animation='border' size='sm' /> Loading transects
              </span>
            )}
            {nameError && !loading && (
              <div className='text-danger' style={{ fontSize: 12 }}>
                {nameError}
              </div>
            )}
            {loadError && (
              <div className='alert alert-danger mb-0 p-2'>{loadError}</div>
            )}
            {saveError && (
              <div className='alert alert-danger mb-0 p-2'>{saveError}</div>
            )}
          </div>
          <div
            className='d-flex flex-column gap-2'
            style={{ flex: '3 1 480px', minWidth: 0 }}
          >
            <div className='d-flex gap-2 flex-wrap align-items-center'>
              {showSaved ? (
                <Button
                  size='sm'
                  variant='outline-primary'
                  onClick={redraw}
                  disabled={editingDisabled}
                >
                  Redraw strata
                </Button>
              ) : (
                <>
                  <Button
                    size='sm'
                    variant={
                      activeTool === 'draw' ? 'primary' : 'outline-primary'
                    }
                    onClick={() => toggleTool('draw')}
                    disabled={editingDisabled || !mapLoaded}
                  >
                    {activeTool === 'draw'
                      ? 'Drawing line…'
                      : 'Draw strata line'}
                  </Button>
                  <Button
                    size='sm'
                    variant={
                      activeTool === 'edit' ? 'primary' : 'outline-primary'
                    }
                    onClick={() => toggleTool('edit')}
                    disabled={
                      editingDisabled || !mapLoaded || layout.lines.length === 0
                    }
                  >
                    {activeTool === 'edit' ? 'Editing…' : 'Edit lines'}
                  </Button>
                  <Button
                    size='sm'
                    variant='outline-danger'
                    onClick={deleteSelectedLine}
                    disabled={!selectedLineId}
                  >
                    Delete selected
                  </Button>
                </>
              )}
              <Button
                size='sm'
                variant='outline-light'
                onClick={undo}
                disabled={history.length === 0 || saving}
              >
                Undo
              </Button>
              <Button
                size='sm'
                variant='outline-light'
                onClick={fitAll}
                disabled={!mapLoaded}
              >
                Fit
              </Button>
            </div>
            {toolHint && (
              <span className='text-muted' style={{ fontSize: 12 }}>
                {toolHint}
              </span>
            )}
            <div className='survey-map'>
              <div ref={mapDivRef} style={{ position: 'absolute', inset: 0 }} />
            </div>
          </div>
        </div>
        {saving && (
          <div className='d-flex justify-content-center align-items-center'>
            <Spinner animation='border' size='sm' />
            <span className='ms-2'>Saving strata</span>
          </div>
        )}
      </Form>
      <Footer>
        <Button
          variant='primary'
          onClick={handleSubmit}
          disabled={!canSave || saving || surveySaving}
        >
          Save Strata
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
