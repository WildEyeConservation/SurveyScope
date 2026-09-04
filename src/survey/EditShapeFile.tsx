import { useState, useEffect, useCallback, useRef } from 'react';
import { client } from '../stores/appClient';
import { showModalAction as showModal } from '../stores/modalStore';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
  TerraDrawRenderMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import {
  parseShapefileToLatLngs,
  saveShapefileForProject,
} from '../utils/shapefileUtils';
import { Form, Spinner, Button } from 'react-bootstrap';
import { Footer } from '../Modal';
import FileInput from '../FileInput';
import { BASE_STYLE } from './surveyMapStyle';
import './surveyMap.css';

// Terra Draw mode names. The boundary and exclusion zones are two separate
// named polygon modes so they can be styled (and edited) independently; the
// select mode edits either, and the render mode is an inert "idle" state.
const MODE_SHAPEFILE = 'shapefile';
const MODE_EXCLUSION = 'exclusion';
const MODE_SELECT = 'select';
const MODE_IDLE = 'idle';

type LatLng = [number, number]; // [lat, lng]

// [lat,lng] ring -> Terra Draw Polygon feature ([lng,lat], closed ring).
function latLngsToPolygonFeature(
  latlngs: LatLng[],
  mode: string,
  id: string | number,
  coordinatePrecision: number
): any {
  const scale = 10 ** coordinatePrecision;
  const round = (value: number) => Math.round(value * scale) / scale;
  const ring: [number, number][] = [];
  for (const [lat, lng] of latlngs) {
    const point: [number, number] = [round(lng), round(lat)];
    const previous = ring[ring.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      ring.push(point);
    }
  }
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (ring.length > 1 && fx === lx && fy === ly) ring.pop();
  ring.push([ring[0][0], ring[0][1]]);
  return {
    id,
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { mode },
  };
}

function addPolygonFeatures(
  draw: TerraDraw,
  polygons: Array<{ coords: LatLng[]; mode: string }>,
  coordinatePrecision: number
) {
  const results = draw.addFeatures(
    polygons.map(({ coords, mode }) =>
      latLngsToPolygonFeature(
        coords,
        mode,
        draw.getFeatureId(),
        coordinatePrecision
      )
    )
  );
  const invalid = results.filter((result) => !result.valid);
  if (invalid.length) {
    console.error('Failed to add shapefile geometry:', invalid);
  }
}

// Terra Draw Polygon feature ([lng,lat], closed) -> [lat,lng] ring (open).
function polygonFeatureToLatLngs(feature: any): LatLng[] {
  const ring = (feature.geometry.coordinates[0] as [number, number][]).map(
    ([lng, lat]) => [lat, lng] as LatLng
  );
  if (ring.length > 1) {
    const [fx, fy] = ring[0];
    const [lx, ly] = ring[ring.length - 1];
    if (fx === lx && fy === ly) ring.pop();
  }
  return ring;
}

export default function EditShapeFile({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  const [polygonCoords, setPolygonCoords] = useState<LatLng[] | null>(null);
  const [shapefileBuffer, setShapefileBuffer] = useState<ArrayBuffer>();
  const [exclusionPolygons, setExclusionPolygons] = useState<LatLng[][]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingShapefile, setLoadingShapefile] = useState(false);
  const [drawMode, setDrawMode] = useState<'shapefile' | 'exclusions'>(
    'shapefile'
  );
  // disabledClose: only disables Close during active save; saveDisabled: governs Save button enablement
  const [disabledClose, setDisabledClose] = useState(false);
  const [saveDisabled, setSaveDisabled] = useState(false);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [activeTool, setActiveTool] = useState<'draw' | 'edit' | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(
    null
  );

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const drawAdapterRef =
    useRef<TerraDrawMapLibreGLAdapter<maplibregl.Map> | null>(null);
  const seededRef = useRef(false);
  const fittedRef = useRef(false);
  // Latest values for the seed effect / one-time map handlers.
  const polygonCoordsRef = useRef(polygonCoords);
  polygonCoordsRef.current = polygonCoords;
  const exclusionPolygonsRef = useRef(exclusionPolygons);
  exclusionPolygonsRef.current = exclusionPolygons;

  // Fit the map to a set of [lat,lng] points.
  const fitToLatLngs = useCallback((pts: LatLng[]) => {
    const map = mapRef.current;
    if (!map || pts.length === 0) return;
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const [lat, lng] of pts) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
    if (!Number.isFinite(minLng)) return;
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 40, maxZoom: 16, duration: 0 }
    );
  }, []);

  // -----------------------------------------------------------------------
  // Load existing shapefile + exclusions (in parallel), then mark data ready.
  // -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingShapefile(true);
      try {
        const [shpRes, exRes] = await Promise.all([
          (client.models.Shapefile.shapefilesByProjectId as any)({ projectId }),
          (
            client.models.ShapefileExclusions
              .shapefileExclusionsByProjectId as any
          )({ projectId }),
        ]);
        if (cancelled) return;

        const shpData = (shpRes?.data ?? []) as Array<{
          coordinates: (number | null)[] | null;
        }>;
        if (shpData.length > 0 && shpData[0].coordinates) {
          const flat = shpData[0].coordinates.filter(
            (n): n is number => n != null
          );
          const coords: LatLng[] = [];
          for (let i = 0; i + 1 < flat.length; i += 2) {
            coords.push([flat[i], flat[i + 1]]);
          }
          if (coords.length >= 3) setPolygonCoords(coords);
        }

        const exData = (exRes?.data ?? []) as Array<{
          coordinates: (number | null)[] | null;
        }>;
        const loadedPolys: LatLng[][] = [];
        for (const item of exData) {
          if (!item.coordinates) continue;
          const flat = item.coordinates.filter((n): n is number => n != null);
          const poly: LatLng[] = [];
          for (let i = 0; i + 1 < flat.length; i += 2) {
            poly.push([flat[i], flat[i + 1]]);
          }
          if (poly.length >= 3) loadedPolys.push(poly);
        }
        setExclusionPolygons(loadedPolys);
      } catch (err) {
        console.error('Failed to load shapefile/exclusions:', err);
      } finally {
        if (!cancelled) {
          setLoadingShapefile(false);
          setDataLoaded(true);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // -----------------------------------------------------------------------
  // Map + Terra Draw initialisation (once).
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
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

    // Rebuild React state (for saving) from the Terra Draw store.
    const rebuildFromSnapshot = () => {
      const snap = drawRef.current?.getSnapshot() ?? [];
      const polys = snap.filter(
        (f: any) =>
          f.geometry?.type === 'Polygon' &&
          (f.properties?.mode === MODE_SHAPEFILE ||
            f.properties?.mode === MODE_EXCLUSION)
      );
      const shp = polys.find((f: any) => f.properties.mode === MODE_SHAPEFILE);
      const exc = polys.filter(
        (f: any) => f.properties.mode === MODE_EXCLUSION
      );
      setPolygonCoords(shp ? polygonFeatureToLatLngs(shp) : null);
      setExclusionPolygons(exc.map((f: any) => polygonFeatureToLatLngs(f)));
    };

    map.on('load', () => {
      const adapter = new TerraDrawMapLibreGLAdapter({ map });
      drawAdapterRef.current = adapter;
      const draw = new TerraDraw({
        adapter,
        modes: [
          new TerraDrawPolygonMode({
            modeName: MODE_SHAPEFILE,
            styles: {
              fillColor: '#97009c',
              fillOpacity: 0.08,
              outlineColor: '#97009c',
              outlineWidth: 2,
            },
          }),
          new TerraDrawPolygonMode({
            modeName: MODE_EXCLUSION,
            styles: {
              fillColor: '#ff0000',
              fillOpacity: 0.25,
              outlineColor: '#ff0000',
              outlineWidth: 2,
            },
          }),
          new TerraDrawSelectMode({
            flags: {
              [MODE_SHAPEFILE]: {
                feature: {
                  draggable: true,
                  coordinates: {
                    draggable: true,
                    midpoints: { draggable: true },
                    deletable: true,
                  },
                },
              },
              [MODE_EXCLUSION]: {
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

      draw.on('finish', (id, ctx) => {
        // Only one boundary polygon may exist: drop any older ones.
        if (ctx.action === 'draw' && ctx.mode === MODE_SHAPEFILE) {
          const others = draw
            .getSnapshot()
            .filter(
              (f: any) =>
                f.geometry?.type === 'Polygon' &&
                f.properties?.mode === MODE_SHAPEFILE &&
                f.id !== id
            )
            .map((f: any) => f.id);
          if (others.length) draw.removeFeatures(others);
        }
        rebuildFromSnapshot();
        // A boundary is a single shape — return to idle once it's drawn.
        if (ctx.action === 'draw' && ctx.mode === MODE_SHAPEFILE) {
          draw.setMode(MODE_IDLE);
          setActiveTool(null);
        }
      });
      draw.on('change', (_ids, type, context) => {
        const fromApi =
          !!context && 'origin' in context && context.origin === 'api';
        if (type === 'delete' && !fromApi) {
          rebuildFromSnapshot();
        }
      });
      draw.on('select', (id) => setSelectedFeatureId(String(id)));
      draw.on('deselect', () => setSelectedFeatureId(null));

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
      drawAdapterRef.current = null;
      map.remove();
      mapRef.current = null;
      seededRef.current = false;
      fittedRef.current = false;
    };
  }, []);

  // Seed existing geometry into Terra Draw once the map and data are ready.
  useEffect(() => {
    if (!mapLoaded || !dataLoaded || seededRef.current) return;
    const draw = drawRef.current;
    if (!draw) return;
    const polygons: Array<{ coords: LatLng[]; mode: string }> = [];
    if (polygonCoordsRef.current && polygonCoordsRef.current.length >= 3) {
      polygons.push({
        coords: polygonCoordsRef.current,
        mode: MODE_SHAPEFILE,
      });
    }
    for (const ex of exclusionPolygonsRef.current) {
      if (ex.length >= 3) {
        polygons.push({ coords: ex, mode: MODE_EXCLUSION });
      }
    }
    if (polygons.length) {
      try {
        addPolygonFeatures(
          draw,
          polygons,
          drawAdapterRef.current?.getCoordinatePrecision() ?? 9
        );
      } catch (err) {
        console.error('Failed to seed shapefile geometry:', err);
      }
    }
    seededRef.current = true;
    if (!fittedRef.current && polygonCoordsRef.current?.length) {
      fitToLatLngs(polygonCoordsRef.current);
      fittedRef.current = true;
    }
  }, [mapLoaded, dataLoaded, fitToLatLngs]);

  // Parse an uploaded shapefile and set it as the boundary.
  useEffect(() => {
    if (!shapefileBuffer) return;
    let cancelled = false;
    parseShapefileToLatLngs(shapefileBuffer)
      .then((latLngs) => {
        if (cancelled || !latLngs) return;
        setPolygonCoords(latLngs);
        const draw = drawRef.current;
        if (seededRef.current && draw) {
          const old = draw
            .getSnapshot()
            .filter(
              (f: any) =>
                f.geometry?.type === 'Polygon' &&
                f.properties?.mode === MODE_SHAPEFILE
            )
            .map((f: any) => f.id);
          if (old.length) draw.removeFeatures(old);
          try {
            addPolygonFeatures(
              draw,
              [{ coords: latLngs as LatLng[], mode: MODE_SHAPEFILE }],
              drawAdapterRef.current?.getCoordinatePrecision() ?? 9
            );
          } catch (err) {
            console.error('Failed to add uploaded shapefile:', err);
          }
        }
        fitToLatLngs(latLngs as LatLng[]);
        fittedRef.current = true;
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [shapefileBuffer, fitToLatLngs]);

  // When the draw target (radio) changes while drawing, switch the active mode.
  useEffect(() => {
    if (!mapLoaded || !drawRef.current) return;
    if (activeTool === 'draw') {
      drawRef.current.setMode(
        drawMode === 'shapefile' ? MODE_SHAPEFILE : MODE_EXCLUSION
      );
    }
  }, [drawMode, activeTool, mapLoaded]);

  // enable submit only when polygon defined
  useEffect(() => {
    setSaveDisabled(!polygonCoords);
  }, [polygonCoords]);

  // Tool handlers
  const toggleDraw = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    if (activeTool === 'draw') {
      draw.setMode(MODE_IDLE);
      setActiveTool(null);
    } else {
      draw.setMode(drawMode === 'shapefile' ? MODE_SHAPEFILE : MODE_EXCLUSION);
      setActiveTool('draw');
    }
  }, [activeTool, drawMode]);

  const toggleEdit = useCallback(() => {
    const draw = drawRef.current;
    if (!draw) return;
    if (activeTool === 'edit') {
      draw.setMode(MODE_IDLE);
      setActiveTool(null);
      setSelectedFeatureId(null);
    } else {
      draw.setMode(MODE_SELECT);
      setActiveTool('edit');
    }
  }, [activeTool]);

  const deleteSelected = useCallback(() => {
    const draw = drawRef.current;
    if (!draw || !selectedFeatureId) return;
    try {
      draw.removeFeatures([selectedFeatureId]);
    } catch (err) {
      console.error('Failed to delete feature:', err);
    }
    setSelectedFeatureId(null);
    // removeFeatures is an API change (no 'change' rebuild), so sync manually.
    const snap = draw.getSnapshot();
    const shp = snap.find(
      (f: any) =>
        f.geometry?.type === 'Polygon' && f.properties?.mode === MODE_SHAPEFILE
    );
    const exc = snap.filter(
      (f: any) =>
        f.geometry?.type === 'Polygon' && f.properties?.mode === MODE_EXCLUSION
    );
    setPolygonCoords(shp ? polygonFeatureToLatLngs(shp) : null);
    setExclusionPolygons(exc.map((f: any) => polygonFeatureToLatLngs(f)));
  }, [selectedFeatureId]);

  const saveShapefile = async () => {
    setDisabledClose(true);
    setSaving(true);
    try {
      if (!polygonCoords) return;
      const latLngs: LatLng[] = polygonCoords.map((pt) => [pt[0], pt[1]]);
      await saveShapefileForProject(client, projectId, latLngs, organizationId);

      // save exclusion polygons
      const exResult = (await (
        client.models.ShapefileExclusions.shapefileExclusionsByProjectId as any
      )({ projectId })) as any;
      const existingExclusions = exResult.data as Array<{ id: string }>;
      await Promise.all(
        existingExclusions.map((ex: any) =>
          (client.models.ShapefileExclusions.delete as any)({ id: ex.id })
        )
      );
      await Promise.all(
        exclusionPolygons.map((poly) => {
          const flatEx: number[] = [];
          poly.forEach(([lat, lng]) => {
            flatEx.push(lat, lng);
          });
          return (client.models.ShapefileExclusions.create as any)({
            projectId,
            coordinates: flatEx,
            group: organizationId,
          });
        })
      );

      // delete strata information and jolly results
      const { data: strata } = await (
        client.models.Stratum.strataByProjectId as any
      )({ projectId });
      const { data: jollyResults } = await (
        client.models.JollyResult.jollyResultsBySurveyId as any
      )({ surveyId: projectId });

      await Promise.all(
        (strata as any[]).map((s: any) =>
          (client.models.Stratum.delete as any)({ id: s.id })
        )
      );
      await Promise.all(
        (jollyResults as any[]).map((r: any) =>
          (client.models.JollyResult.delete as any)({
            surveyId: projectId,
            stratumId: r.stratumId,
            annotationSetId: r.annotationSetId,
            categoryId: r.categoryId,
          })
        )
      );

      alert(
        'You have successfully updated the shapefile. Please review your strata and transects on the next tab and save your work whether you made any changes or not.'
      );
    } finally {
      setDisabledClose(false);
      setSaving(false);
    }
  };

  return (
    <>
      <Form className='d-flex flex-column gap-3 p-3'>
        <div className='d-flex flex-column'>
          <div
            className='text-uppercase fw-semibold text-muted mb-1'
            style={{ letterSpacing: 0.5, fontSize: 12 }}
          >
            Upload or Draw Shapefile
          </div>
          <span className='text-muted mb-2' style={{ fontSize: '14px' }}>
            Select a shapefile to overlay on the map or draw a new one. Press
            "Save Shapefile" at the bottom of the page to save.
          </span>
          <FileInput
            id='shapefile-file'
            fileType='.zip'
            onFileChange={async (files) => {
              const buf = await files[0].arrayBuffer();
              setShapefileBuffer(buf);
            }}
          >
            <p className='mb-0'>Select Shapefile (optional)</p>
          </FileInput>
          {loadingShapefile && (
            <div className='d-flex justify-content-center align-items-center mt-3'>
              <Spinner animation='border' />
              <span className='ms-2'>Loading shapefile</span>
            </div>
          )}
        </div>

        <hr
          className='m-0'
          style={{
            borderTop: '1px solid rgba(255, 255, 255, 0.12)',
            opacity: 1,
          }}
        />

        <div className='d-flex flex-column'>
          <div
            className='text-uppercase fw-semibold text-muted mb-2'
            style={{ letterSpacing: 0.5, fontSize: 12 }}
          >
            Shapefile Map
          </div>
          <Form.Group className='d-flex flex-column mb-2'>
            <Form.Label className='mb-0'>Drawing Mode</Form.Label>
            <div className='d-flex gap-3'>
              <Form.Check
                type='radio'
                id='mode-shapefile'
                label='Shapefile'
                name='draw-mode'
                checked={drawMode === 'shapefile'}
                onChange={() => setDrawMode('shapefile')}
              />
              <Form.Check
                type='radio'
                id='mode-exclusions'
                label='Exclusion Zones'
                name='draw-mode'
                checked={drawMode === 'exclusions'}
                onChange={() => setDrawMode('exclusions')}
              />
            </div>
            <span className='text-muted mt-1' style={{ fontSize: '14px' }}>
              Pick a mode, then use <strong>Draw</strong> to add a polygon (click
              the first point to finish). Use <strong>Edit</strong> to drag
              vertices, and <strong>Delete selected</strong> to remove a polygon.
              Exclusion zones are deducted from the total area when computing
              results.
            </span>
          </Form.Group>

          {/* Map toolbar */}
          <div className='d-flex gap-2 mb-2 flex-wrap'>
            <Button
              size='sm'
              variant={activeTool === 'draw' ? 'primary' : 'outline-primary'}
              onClick={toggleDraw}
              disabled={!mapLoaded || saving}
            >
              {activeTool === 'draw'
                ? `Drawing ${drawMode === 'shapefile' ? 'boundary' : 'exclusion'}…`
                : 'Draw'}
            </Button>
            <Button
              size='sm'
              variant={activeTool === 'edit' ? 'primary' : 'outline-primary'}
              onClick={toggleEdit}
              disabled={!mapLoaded || saving}
            >
              {activeTool === 'edit' ? 'Editing…' : 'Edit'}
            </Button>
            <Button
              size='sm'
              variant='outline-danger'
              onClick={deleteSelected}
              disabled={!selectedFeatureId || saving}
            >
              Delete selected
            </Button>
          </div>

          <div className='survey-map'>
            <div
              ref={mapContainerRef}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
              }}
            />
          </div>
          {saving && (
            <div className='d-flex justify-content-center align-items-center mt-3'>
              <Spinner animation='border' />
              <span className='ms-2'>
                Saving, please do not close this window
              </span>
            </div>
          )}
        </div>
      </Form>
      <Footer>
        <Button
          variant='primary'
          onClick={saveShapefile}
          disabled={saveDisabled || saving}
        >
          Save Shapefile
        </Button>
        <Button
          variant='dark'
          onClick={() => showModal(null)}
          disabled={disabledClose}
        >
          Close
        </Button>
      </Footer>
    </>
  );
}
