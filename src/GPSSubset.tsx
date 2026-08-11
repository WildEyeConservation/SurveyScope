import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import Button from 'react-bootstrap/Button';
import { Form } from 'react-bootstrap';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { booleanPointInPolygon } from '@turf/turf';
import shp from 'shpjs';
import { parseShapefileToLatLngs } from './utils/shapefileUtils';
import FileInput from './FileInput';
import GPSSubsetImageViewerModal from './GPSSubsetImageViewerModal';
import {
  BASE_STYLE,
  EMPTY_FC,
  escapeHtml,
  type FeatureCollection,
} from './survey/surveyMapStyle';
import './survey/surveyMap.css';

// Define the GPS data structure
export interface GPSData {
  timestamp?: number;
  filepath?: string;
  lat: number;
  lng: number;
  alt: number;
}

// Props for the component
export interface GPSSubsetProps {
  gpsData: GPSData[];
  onFilter: (filteredData: GPSData[]) => void;
  imageFiles?: File[];
  onShapefileParsed?: (latLngs: [number, number][]) => void;
  existingImages?: { lat: number; lng: number }[];
}

// ---------------------------------------------------------------------------
// Map constants. Rendering goes through MapLibre GeoJSON sources + WebGL
// circle layers (same pattern as the Edit Survey tabs) instead of one SVG
// marker per point — the old approach created 100k+ DOM nodes on large
// surveys and killed the tab.
// ---------------------------------------------------------------------------

const SRC_POINTS = 'gps-points';
const LYR_POINTS = 'gps-points-circles';
const SRC_EXISTING = 'existing-images';
const LYR_EXISTING = 'existing-images-circles';
const SRC_SHAPEFILE = 'shapefile';
const LYR_SHAPEFILE = 'shapefile-line';

type PopupProps = {
  key: string;
  filepath?: string;
  timestamp?: number;
  lat: number;
  lng: number;
  alt: number;
  included: boolean;
};

// The main component
const GPSSubset: React.FC<GPSSubsetProps> = ({
  gpsData,
  onFilter,
  imageFiles,
  onShapefileParsed,
  existingImages,
}) => {
  const [showExistingImages, setShowExistingImages] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [polygonCount, setPolygonCount] = useState(0);
  const [shapefileFC, setShapefileFC] = useState<FeatureCollection | null>(
    null
  );

  // Image modal state
  const [showImageModal, setShowImageModal] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [imageRotation, setImageRotation] = useState(0); // Global rotation for all images (0, 90, 180, 270)

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const drawingRef = useRef(false);
  const didFitRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const validGpsData = useMemo(
    () =>
      gpsData.filter(
        (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
      ),
    [gpsData]
  );

  const validExistingImages = useMemo(
    () =>
      (existingImages || []).filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
      ),
    [existingImages]
  );

  const createPointKey = useCallback((p: GPSData) => {
    return `${p.filepath ?? ''}|${p.timestamp ?? ''}|${p.lat}|${p.lng}|${
      p.alt
    }`;
  }, []);

  const [currentFilteredPoints, setCurrentFilteredPoints] =
    useState<GPSData[]>(validGpsData);
  const [deletedPointsStack, setDeletedPointsStack] = useState<GPSData[][]>([]);

  // Keep a snapshot of the initial set of points so that when parent filters
  // (e.g., time filter), we can still render excluded points as red markers.
  const initialPointsRef = useRef<Map<string, GPSData> | null>(null);
  useEffect(() => {
    if (!initialPointsRef.current && validGpsData.length > 0) {
      const map = new Map<string, GPSData>();
      for (const p of validGpsData) {
        map.set(createPointKey(p), p);
      }
      initialPointsRef.current = map;
    }
  }, [validGpsData, createPointKey]);

  const visibleKeys = useMemo(
    () => new Set(currentFilteredPoints.map((p) => createPointKey(p))),
    [currentFilteredPoints, createPointKey]
  );

  // Union of the initial snapshot, all removed points, and the visible set:
  // everything that should be drawn (visible points orange, removed red).
  const allPointsByKey = useMemo(() => {
    const union = new Map<string, GPSData>();
    if (initialPointsRef.current) {
      for (const [k, v] of initialPointsRef.current.entries()) {
        union.set(k, v);
      }
    }
    for (const p of deletedPointsStack.flat()) {
      union.set(createPointKey(p), p);
    }
    for (const p of currentFilteredPoints) {
      union.set(createPointKey(p), p);
    }
    return union;
  }, [deletedPointsStack, currentFilteredPoints, createPointKey]);

  // Sync visible points when parent-provided data changes (e.g., time filter).
  // This treats externally excluded points like "removed" without losing
  // manual removals.
  useEffect(() => {
    const manualRemovedKeys = new Set<string>();
    for (const group of deletedPointsStack) {
      for (const p of group) {
        manualRemovedKeys.add(createPointKey(p));
      }
    }
    const nextVisible = validGpsData.filter(
      (p) => !manualRemovedKeys.has(createPointKey(p))
    );

    // Only update if the filtered points have actually changed
    setCurrentFilteredPoints((prev) => {
      if (prev.length === nextVisible.length) {
        const prevKeys = new Set(prev.map((p) => createPointKey(p)));
        const unchanged = nextVisible.every((p) =>
          prevKeys.has(createPointKey(p))
        );
        if (unchanged) return prev;
      }
      return nextVisible;
    });
  }, [validGpsData, deletedPointsStack, createPointKey]);

  // ---------------------------------------------------------------------
  // Lazy object URLs for image previews (created on demand, cached, revoked
  // on unmount).
  // ---------------------------------------------------------------------
  const objectUrlCacheRef = useRef<Map<string, string>>(new Map());

  const fileByPath = useMemo(() => {
    const m = new Map<string, File>();
    for (const f of imageFiles ?? []) {
      const p = f.webkitRelativePath;
      if (p) m.set(p.toLowerCase(), f);
    }
    return m;
  }, [imageFiles]);

  const getObjectUrl = useCallback(
    (filepath: string): string | null => {
      if (!filepath) return null;
      const key = filepath.toLowerCase();
      const cached = objectUrlCacheRef.current.get(key);
      if (cached) return cached;
      const file = fileByPath.get(key);
      if (!file) return null;
      const url = URL.createObjectURL(file);
      objectUrlCacheRef.current.set(key, url);
      return url;
    },
    [fileByPath]
  );

  useEffect(() => {
    const cache = objectUrlCacheRef.current;
    return () => {
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
    };
  }, []);

  // ---------------------------------------------------------------------
  // Point actions
  // ---------------------------------------------------------------------

  // Latest state for the once-registered map event handlers, and so the
  // action handlers below can read fresh values and call onFilter outside a
  // state updater (calling it inside one triggers a parent setState during
  // this component's render).
  const currentPointsRef = useRef(currentFilteredPoints);
  currentPointsRef.current = currentFilteredPoints;
  const deletedStackRef = useRef(deletedPointsStack);
  deletedStackRef.current = deletedPointsStack;
  const allPointsByKeyRef = useRef(allPointsByKey);
  allPointsByKeyRef.current = allPointsByKey;

  const handleRemovePoint = useCallback(
    (index: number) => {
      const prevPoints = currentPointsRef.current;
      if (index < 0 || index >= prevPoints.length) return;
      const removedPoint = prevPoints[index];
      const newPoints = prevPoints.filter((_, i) => i !== index);
      setDeletedPointsStack((prevStack) => [...prevStack, [removedPoint]]);
      setCurrentFilteredPoints(newPoints);
      onFilter(newPoints);
    },
    [onFilter]
  );

  const handleRestorePoint = useCallback(
    (point: GPSData) => {
      const keyToRestore = createPointKey(point);
      // Remove this point from the manual deleted stack so the sync effect
      // doesn't exclude it again
      setDeletedPointsStack((prev) =>
        prev
          .map((group) =>
            group.filter((p) => createPointKey(p) !== keyToRestore)
          )
          .filter((group) => group.length > 0)
      );

      const prevPoints = currentPointsRef.current;
      const alreadyVisible = prevPoints.some(
        (p) => createPointKey(p) === keyToRestore
      );
      if (alreadyVisible) return;
      const newPoints = [...prevPoints, point];
      setCurrentFilteredPoints(newPoints);
      onFilter(newPoints);
    },
    [onFilter, createPointKey]
  );

  const handleUndo = useCallback(() => {
    const oldStack = deletedStackRef.current;
    if (oldStack.length === 0) return;
    const lastDeleted = oldStack[oldStack.length - 1];
    const newVisible = [...currentPointsRef.current, ...lastDeleted];
    setDeletedPointsStack(oldStack.slice(0, oldStack.length - 1));
    setCurrentFilteredPoints(newVisible);
    onFilter(newVisible);
  }, [onFilter]);

  const actionsRef = useRef<{
    removeByKey: (key: string) => void;
    restoreByKey: (key: string) => void;
    viewByKey: (key: string) => void;
    getObjectUrl: (filepath: string) => string | null;
  } | null>(null);
  actionsRef.current = {
    removeByKey: (key: string) => {
      const index = currentPointsRef.current.findIndex(
        (p) => createPointKey(p) === key
      );
      if (index !== -1) handleRemovePoint(index);
      popupRef.current?.remove();
    },
    restoreByKey: (key: string) => {
      const point = allPointsByKeyRef.current.get(key);
      if (point) handleRestorePoint(point);
      popupRef.current?.remove();
    },
    viewByKey: (key: string) => {
      const index = currentPointsRef.current.findIndex(
        (p) => createPointKey(p) === key
      );
      if (index !== -1) {
        setCurrentImageIndex(index);
        setShowImageModal(true);
        popupRef.current?.remove();
      }
    },
    getObjectUrl,
  };

  // Build the popup content with plain DOM (the popup lives outside the React
  // tree). Buttons dispatch through actionsRef so they always see fresh state.
  const openPointPopup = useCallback((props: PopupProps) => {
    const map = mapRef.current;
    if (!map) return;
    popupRef.current?.remove();

    const container = document.createElement('div');
    container.style.maxWidth = '260px';
    container.style.color = '#000';

    let html = '';
    if (props.timestamp) {
      html += `<div><strong>Timestamp:</strong> ${new Date(
        props.timestamp
      ).toISOString()}</div>`;
    }
    if (props.filepath) {
      html += `<div style="word-break:break-all"><strong>Filepath:</strong> ${escapeHtml(
        props.filepath
      )}</div>`;
    }
    html += `<div><strong>Lng:</strong> ${props.lng}</div>`;
    html += `<div><strong>Lat:</strong> ${props.lat}</div>`;
    html += `<div><strong>Alt:</strong> ${props.alt}</div>`;
    container.innerHTML = html;

    if (props.filepath) {
      const url = actionsRef.current?.getObjectUrl(props.filepath);
      if (url) {
        const imgWrap = document.createElement('div');
        imgWrap.style.cssText = 'text-align:center;margin:8px 0';
        const img = document.createElement('img');
        img.src = url;
        img.alt = props.filepath;
        img.style.cssText =
          'max-width:150px;max-height:150px;object-fit:contain;display:block;margin:auto';
        imgWrap.appendChild(img);
        container.appendChild(imgWrap);

        if (props.included) {
          const viewBtn = document.createElement('button');
          viewBtn.type = 'button';
          viewBtn.className = 'btn btn-primary btn-sm w-100 mt-2';
          viewBtn.textContent = 'View Image';
          viewBtn.onclick = () => actionsRef.current?.viewByKey(props.key);
          container.appendChild(viewBtn);
        }
      }
    }

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    if (props.included) {
      actionBtn.className = 'btn btn-danger btn-sm w-100 mt-2';
      actionBtn.textContent = 'Remove';
      actionBtn.onclick = () => actionsRef.current?.removeByKey(props.key);
    } else {
      actionBtn.className = 'btn btn-success btn-sm w-100 mt-2';
      actionBtn.textContent = 'Add Back';
      actionBtn.onclick = () => actionsRef.current?.restoreByKey(props.key);
    }
    container.appendChild(actionBtn);

    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      maxWidth: '280px',
    })
      .setLngLat([props.lng, props.lat])
      .setDOMContent(container)
      .addTo(map);
  }, []);
  const openPointPopupRef = useRef(openPointPopup);
  openPointPopupRef.current = openPointPopup;

  // ---------------------------------------------------------------------
  // GeoJSON derivations
  // ---------------------------------------------------------------------

  // Full point set with an `included` flag driving the orange/red styling.
  // Rebuilt (and pushed via setData) only on explicit filter actions — cheap
  // compared to re-rendering per-point DOM markers.
  const pointsFC = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: Array.from(allPointsByKey.entries()).map(([key, p]) => ({
        type: 'Feature',
        properties: {
          key,
          filepath: p.filepath,
          timestamp: p.timestamp,
          lat: p.lat,
          lng: p.lng,
          alt: p.alt,
          included: visibleKeys.has(key),
        },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    }),
    [allPointsByKey, visibleKeys]
  );

  const existingFC = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: validExistingImages.map((p) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    }),
    [validExistingImages]
  );

  // ---------------------------------------------------------------------
  // Map initialisation (once)
  // ---------------------------------------------------------------------
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
    map.addControl(
      new maplibregl.ScaleControl({ unit: 'metric' }),
      'bottom-left'
    );

    map.on('load', () => {
      map.addSource(SRC_POINTS, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_EXISTING, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_SHAPEFILE, { type: 'geojson', data: EMPTY_FC as any });

      map.addLayer({
        id: LYR_SHAPEFILE,
        type: 'line',
        source: SRC_SHAPEFILE,
        paint: { 'line-color': '#fd7e14', 'line-width': 2 },
      });

      // Existing survey images: faint cyan, non-interactive, under the points.
      map.addLayer({
        id: LYR_EXISTING,
        type: 'circle',
        source: SRC_EXISTING,
        paint: {
          'circle-radius': 4,
          'circle-color': '#00ffff',
          'circle-opacity': 0.15,
          'circle-stroke-color': '#00ffff',
          'circle-stroke-opacity': 0.3,
          'circle-stroke-width': 1,
        },
      });

      map.addLayer({
        id: LYR_POINTS,
        type: 'circle',
        source: SRC_POINTS,
        paint: {
          'circle-radius': 5,
          'circle-color': [
            'case',
            ['boolean', ['get', 'included'], false],
            '#ffa500',
            '#ff0000',
          ],
          'circle-opacity': 0.7,
          'circle-stroke-width': 1,
          'circle-stroke-color': [
            'case',
            ['boolean', ['get', 'included'], false],
            '#ffa500',
            '#ff0000',
          ],
        },
      });

      map.on('click', LYR_POINTS, (e) => {
        if (drawingRef.current) return; // drawing mode owns map clicks
        const feature = e.features?.[0];
        if (!feature) return;
        const props = feature.properties as unknown as PopupProps;
        openPointPopupRef.current(props);
      });

      map.on('mouseenter', LYR_POINTS, () => {
        if (!drawingRef.current) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', LYR_POINTS, () => {
        if (!drawingRef.current) map.getCanvas().style.cursor = '';
      });

      // Polygon lasso. Terra Draw renders its own layers via the adapter; the
      // finished polygons stay on the map until "Include"/"Remove"/cancel so
      // users can draw several before applying.
      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawPolygonMode()],
      });
      draw.on('finish', () => {
        try {
          const snapshot = draw.getSnapshot();
          setPolygonCount(
            snapshot.filter((f: any) => f.geometry?.type === 'Polygon').length
          );
        } catch {
          /* ignore */
        }
      });
      drawRef.current = draw;

      setMapLoaded(true);
    });

    // Wizard steps show/hide this map with display:none; keep the canvas in
    // sync with the container's real size whenever it changes.
    const resizeObserver = new ResizeObserver(() => {
      try {
        map.resize();
      } catch {
        /* map torn down; ignore */
      }
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      setMapLoaded(false);
      popupRef.current?.remove();
      popupRef.current = null;
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

  // Push points into the source; fit bounds on first non-empty data.
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    const src = map?.getSource(SRC_POINTS) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!map || !src) return;
    src.setData(pointsFC as any);

    if (!didFitRef.current && pointsFC.features.length > 0) {
      didFitRef.current = true;
      let minLng = Infinity;
      let minLat = Infinity;
      let maxLng = -Infinity;
      let maxLat = -Infinity;
      for (const f of pointsFC.features) {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 40, maxZoom: 16, duration: 0 }
      );
    }
  }, [mapLoaded, pointsFC]);

  // Existing survey images source + visibility toggle.
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    const src = map?.getSource(SRC_EXISTING) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!map || !src) return;
    src.setData(existingFC as any);
    map.setLayoutProperty(
      LYR_EXISTING,
      'visibility',
      showExistingImages ? 'visible' : 'none'
    );
  }, [mapLoaded, existingFC, showExistingImages]);

  // Shapefile outline overlay.
  useEffect(() => {
    if (!mapLoaded) return;
    const src = mapRef.current?.getSource(SRC_SHAPEFILE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    src.setData((shapefileFC ?? EMPTY_FC) as any);
  }, [mapLoaded, shapefileFC]);

  // ---------------------------------------------------------------------
  // Polygon drawing / filtering
  // ---------------------------------------------------------------------

  const stopDrawing = useCallback(() => {
    const map = mapRef.current;
    const draw = drawRef.current;
    try {
      draw?.clear();
      draw?.stop();
    } catch {
      /* ignore */
    }
    drawingRef.current = false;
    setIsDrawing(false);
    setPolygonCount(0);
    if (map) map.getCanvas().style.cursor = '';
  }, []);

  const toggleDrawing = useCallback(() => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw) return;
    if (drawingRef.current) {
      stopDrawing();
    } else {
      try {
        popupRef.current?.remove();
        draw.start();
        draw.setMode('polygon');
        drawingRef.current = true;
        setIsDrawing(true);
        map.getCanvas().style.cursor = 'crosshair';
      } catch (err) {
        console.error('Failed to start drawing:', err);
      }
    }
  }, [stopDrawing]);

  // Filter points using the drawn polygons. exclude=true keeps only points
  // inside a polygon ("Include Images"); exclude=false removes the points
  // inside ("Remove Images").
  const handleFilterPoints = useCallback(
    (exclude: boolean) => {
      const draw = drawRef.current;
      if (!draw) return;
      let polygons: any[] = [];
      try {
        polygons = draw
          .getSnapshot()
          .filter((f: any) => f.geometry?.type === 'Polygon');
      } catch {
        polygons = [];
      }
      if (polygons.length === 0) {
        return;
      }
      const newVisiblePoints: GPSData[] = [];
      const removedPoints: GPSData[] = [];
      currentFilteredPoints.forEach((point) => {
        const inside = polygons.some((polygon) =>
          booleanPointInPolygon([point.lng, point.lat], polygon)
        );
        if ((!exclude && inside) || (exclude && !inside)) {
          removedPoints.push(point);
        } else {
          newVisiblePoints.push(point);
        }
      });
      // Record the removed points (for undo) and update current visible points
      setDeletedPointsStack((prev) => [...prev, removedPoints]);
      setCurrentFilteredPoints(newVisiblePoints);
      onFilter(newVisiblePoints);
      stopDrawing();
    },
    [currentFilteredPoints, onFilter, stopDrawing]
  );

  // ---------------------------------------------------------------------
  // Shapefile upload: filter to points inside its polygons (undoable) and
  // draw its outline.
  // ---------------------------------------------------------------------
  const handleShapefileSelected = useCallback(
    async (file: File) => {
      try {
        const buffer = await file.arrayBuffer();
        const geojson: any = await shp(buffer);
        let allowedPolygons: any[] = [];
        if (geojson.type === 'FeatureCollection') {
          allowedPolygons = geojson.features.filter(
            (feature: any) =>
              feature.geometry &&
              (feature.geometry.type === 'Polygon' ||
                feature.geometry.type === 'MultiPolygon')
          );
        } else if (
          geojson.type === 'Feature' &&
          geojson.geometry &&
          (geojson.geometry.type === 'Polygon' ||
            geojson.geometry.type === 'MultiPolygon')
        ) {
          allowedPolygons = [geojson];
        }
        if (allowedPolygons.length === 0) {
          console.warn('No valid polygon found in shapefile');
          return;
        }

        setShapefileFC({
          type: 'FeatureCollection',
          features: allowedPolygons,
        });

        // Apply shapefile filter relative to the current filtered set and
        // push the removed points onto the undo stack so this is undoable.
        const newVisiblePoints: GPSData[] = [];
        const removedPoints: GPSData[] = [];
        currentPointsRef.current.forEach((point) => {
          const inside = allowedPolygons.some((feature: any) =>
            booleanPointInPolygon([point.lng, point.lat], feature)
          );
          if (inside) {
            newVisiblePoints.push(point);
          } else {
            removedPoints.push(point);
          }
        });
        setDeletedPointsStack((stack) => [...stack, removedPoints]);
        setCurrentFilteredPoints(newVisiblePoints);
        onFilter(newVisiblePoints);

        // Also parse to simplified [lat,lng] list for saving later
        try {
          const latLngs = await parseShapefileToLatLngs(buffer);
          if (latLngs && onShapefileParsed) onShapefileParsed(latLngs);
        } catch (e) {
          console.error('Error simplifying shapefile for save', e);
        }
      } catch (err) {
        console.error('Error parsing shapefile', err);
      }
    },
    [onFilter, onShapefileParsed]
  );

  // ---------------------------------------------------------------------
  // Image modal handlers
  // ---------------------------------------------------------------------

  const handleCloseModal = useCallback(() => {
    setShowImageModal(false);
  }, []);

  const handleNextImage = useCallback(() => {
    setCurrentImageIndex((prev) => (prev + 1) % currentFilteredPoints.length);
  }, [currentFilteredPoints.length]);

  const handlePrevImage = useCallback(() => {
    setCurrentImageIndex((prev) =>
      prev === 0 ? currentFilteredPoints.length - 1 : prev - 1
    );
  }, [currentFilteredPoints.length]);

  const handleRemoveImage = useCallback(() => {
    handleRemovePoint(currentImageIndex);
    // Adjust current index if we're removing the last image or if the index is now out of bounds
    if (currentFilteredPoints.length === 1) {
      setShowImageModal(false);
    } else if (currentImageIndex >= currentFilteredPoints.length - 1) {
      setCurrentImageIndex(currentFilteredPoints.length - 2);
    }
  }, [currentImageIndex, currentFilteredPoints.length, handleRemovePoint]);

  const handleRotateImage = useCallback(() => {
    setImageRotation((prev) => (prev + 90) % 360);
  }, []);

  return (
    <>
      <Form.Group className='mt-3'>
        <Form.Label className='mb-0'>Upload Shapefile (Optional)</Form.Label>
        <Form.Text className='d-block mb-1 mt-0' style={{ fontSize: '12px' }}>
          If you have a zipped shapefile, you can upload it here. Uploading this
          file will filter the GPS data to only include images within the
          shapefile.
        </Form.Text>
        <FileInput
          id='shapefile-file'
          fileType='.zip'
          onFileChange={(files) => {
            if (files[0]) handleShapefileSelected(files[0]);
          }}
        >
          <p className='mb-0'>Select Shapefile</p>
        </FileInput>
      </Form.Group>
      <Form.Group className='mt-3 d-flex flex-column gap-2'>
        <div>
          <Form.Label className='d-block mb-0'>
            Filter Data by Polygon (Optional)
          </Form.Label>
          <Form.Text className='d-block' style={{ fontSize: '12px' }}>
            <b>These points represent your georeferenced images.</b>
          </Form.Text>
          <Form.Text style={{ fontSize: '12px' }}>
            Use this tool to filter out images based on a polygon.
            <ul>
              <li>
                Click "Draw polygon", then click on the map to place vertices;
                click the first vertex (or double-click) to finish. You can
                draw multiple polygons.
              </li>
              <li>
                Click "Include Images" to keep only the images within the
                polygons.
              </li>
              <li>Click "Remove Images" to remove the images within them.</li>
              <li>Click "Undo" to reverse the last action.</li>
              <li>Click a point to see its details and preview.</li>
              <li>
                <span style={{ color: 'orange' }}>Orange points</span> represent
                images that are included.
              </li>
              <li>
                <span style={{ color: 'red' }}>Red points</span> represent
                images that are removed.
              </li>
            </ul>
          </Form.Text>
        </div>
        {validExistingImages.length > 0 && (
          <Form.Check
            type='switch'
            id='toggle-existing-images'
            label={
              <span>
                Show existing survey images (
                <span style={{ color: 'cyan' }}>cyan</span>):{' '}
                {validExistingImages.length}
              </span>
            }
            checked={showExistingImages}
            onChange={(e) => setShowExistingImages(e.target.checked)}
            className='mb-1'
          />
        )}
        <div className='survey-map'>
          <div
            ref={mapContainerRef}
            style={{ position: 'absolute', inset: 0 }}
          />
          <div
            className='d-flex flex-row gap-2 p-2'
            style={{
              position: 'absolute',
              bottom: '10px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 10,
              backgroundColor: 'rgba(255,255,255,0.8)',
              border: '2px solid rgba(0, 0, 0, 0.28)',
              borderRadius: '4px',
            }}
          >
            <Button
              variant={isDrawing ? 'warning' : 'secondary'}
              onClick={toggleDrawing}
            >
              {isDrawing ? 'Cancel drawing' : 'Draw polygon'}
            </Button>
            <Button
              variant='info'
              disabled={polygonCount === 0}
              onClick={() => handleFilterPoints(true)}
            >
              Include Images
            </Button>
            <Button
              variant='danger'
              disabled={polygonCount === 0}
              onClick={() => handleFilterPoints(false)}
            >
              Remove Images
            </Button>
            <Button
              disabled={deletedPointsStack.length === 0}
              variant='outline-primary'
              onClick={handleUndo}
            >
              Undo
            </Button>
          </div>
        </div>
      </Form.Group>

      <GPSSubsetImageViewerModal
        showImageModal={showImageModal}
        imageData={{
          currentImageIndex,
          currentFilteredPoints,
          getObjectUrl,
          imageRotation,
        }}
        handlers={{
          handleCloseModal,
          handleNextImage,
          handlePrevImage,
          handleRotateImage,
          handleRemoveImage,
        }}
      />
    </>
  );
};

export default React.memo(GPSSubset);
