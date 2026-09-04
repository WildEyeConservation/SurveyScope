import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import { client } from '../stores/appClient';
import { showModalAction as showModal } from '../stores/modalStore';
import { fetchAllPaginatedResults } from '../utils';
import { Form, Spinner, Button } from 'react-bootstrap';
import { Footer } from '../Modal';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawLineStringMode,
  TerraDrawSelectMode,
  TerraDrawRenderMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import * as turf from '@turf/turf';
import type {
  Feature as GeoJSONFeature,
  Polygon as GeoJSONPolygon,
  LineString as GeoJSONLineString,
} from 'geojson';
import proj4 from 'proj4';
import { BASE_STYLE, EMPTY_FC } from './surveyMapStyle';
import './surveyMap.css';

// tolerance in degrees for simplifying the transect line
const SIMPLIFY_TOLERANCE = 0.002;

// Terra Draw mode names: a polygon "enclose" tool to lasso points into a new
// transect, a linestring "strata" tool to split the boundary into strata, a
// select mode to edit/delete drawn lines, and an inert idle/render mode so the
// image-point click handlers work when no tool is active.
const MODE_ENCLOSE = 'enclose';
const MODE_STRATA = 'strata';
const MODE_SELECT = 'select';
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

// a simple palette for transect / strata colors
const transectColors = [
  'red',
  'blue',
  'green',
  'orange',
  'purple',
  'brown',
  'pink',
  'cyan',
];
const strataColors = [
  'yellow',
  'cyan',
  'magenta',
  'grey',
  'lightgreen',
  'lightblue',
  'lightcoral',
  'lightpink',
];

type LatLng = [number, number]; // [lat, lng]

// Utilities: validation and sanitization
function isFiniteNumber(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n) && !Number.isNaN(n);
}

function isValidLatLng(lat: any, lng: any): lat is number {
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function toLatLngPairs(values: Array<number | null | undefined>): LatLng[] {
  const pairs: LatLng[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    const lat = values[i] as any;
    const lng = values[i + 1] as any;
    if (isValidLatLng(lat, lng)) {
      pairs.push([lat, lng]);
    }
  }
  return pairs;
}

// Impute missing/invalid lat/lng by time-based linear interpolation between
// nearest valid neighbors; falls back to nearest neighbor if only one side exists
function imputeLatLngForImages(
  imgs: Array<{
    id: any;
    timestamp: any;
    latitude: any;
    longitude: any;
  }>
): { filled: any[]; imputedIds: Set<any> } {
  if (!imgs || imgs.length === 0) return { filled: [], imputedIds: new Set() };
  const filled = imgs.map((img) => ({ ...img }));
  const n = filled.length;
  const isValid: boolean[] = filled.map((img) =>
    isValidLatLng(img.latitude, img.longitude)
  );
  const prevValidIdx: number[] = Array(n).fill(-1);
  const nextValidIdx: number[] = Array(n).fill(-1);
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (isValid[i]) last = i;
    prevValidIdx[i] = last;
  }
  last = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (isValid[i]) last = i;
    nextValidIdx[i] = last;
  }
  const imputedIds = new Set<any>();
  for (let i = 0; i < n; i++) {
    if (isValid[i]) continue;
    const p = prevValidIdx[i];
    const q = nextValidIdx[i];
    if (p !== -1 && q !== -1) {
      const t0 = new Date(filled[p].timestamp).getTime();
      const t1 = new Date(filled[q].timestamp).getTime();
      const ti = new Date(filled[i].timestamp).getTime();
      const denom = Math.max(t1 - t0, 1);
      const r = Math.min(Math.max((ti - t0) / denom, 0), 1);
      const lat =
        (filled[p].latitude as number) +
        r * ((filled[q].latitude as number) - (filled[p].latitude as number));
      const lng =
        (filled[p].longitude as number) +
        r * ((filled[q].longitude as number) - (filled[p].longitude as number));
      filled[i].latitude = lat;
      filled[i].longitude = lng;
      (filled[i] as any)._imputed = true;
      imputedIds.add(filled[i].id);
    } else if (p !== -1) {
      filled[i].latitude = filled[p].latitude;
      filled[i].longitude = filled[p].longitude;
      (filled[i] as any)._imputed = true;
      imputedIds.add(filled[i].id);
    } else if (q !== -1) {
      filled[i].latitude = filled[q].latitude;
      filled[i].longitude = filled[q].longitude;
      (filled[i] as any)._imputed = true;
      imputedIds.add(filled[i].id);
    }
  }
  return { filled, imputedIds };
}

// Normalize mixed timestamp units to milliseconds since epoch
function normalizeToMillis(ts: any): number {
  const n = typeof ts === 'string' ? Number(ts) : ts ?? 0;
  // If value looks like seconds (10 digits) convert to ms
  return n > 0 && n < 1e12 ? n * 1000 : n;
}

// Finds the UTM projection for the given coordinates
function getUTMProjection(lon: number, lat: number) {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const hemisphere = lat >= 0 ? 'north' : 'south';
  const projStr = `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs ${hemisphere === 'south' ? '+south' : ''
    }`;
  return projStr;
}

// generates the baseline and its length
function getProjectedDirectionalBaseline(
  polygon: GeoJSONFeature<GeoJSONPolygon>,
  bearing: number
): { baseline: GeoJSONFeature<GeoJSONLineString>; length: number } {
  // project everything to UTM to do this accurately
  // because we are going use treat the coords as cartesian coords - which falls apart quickly in normal WGS84
  const center = turf.centerOfMass(polygon).geometry.coordinates;
  const projStr = getUTMProjection(center[0], center[1]);
  const coords = turf.getCoords(polygon)[0] as [number, number][];
  const projected: [number, number][] = coords.map((pt) => {
    const [lon, lat] = pt;
    return proj4('WGS84', projStr, [lon, lat]) as [number, number];
  });
  const centerXY = proj4('WGS84', projStr, center);

  // Rotate all points into bearing-aligned frame
  const theta = (bearing * Math.PI) / 180;
  const rotated = projected.map(([x, y]) => {
    const dx = x - centerXY[0];
    const dy = y - centerXY[1];
    const xRot = dx * Math.cos(theta) - dy * Math.sin(theta);
    const yRot = dx * Math.sin(theta) + dy * Math.cos(theta);
    return [xRot, yRot];
  });

  // Now find min/max along the aligned axis (which is yRot)
  const yVals = rotated.map(([, y]) => y);
  const minY = Math.min(...yVals);
  const maxY = Math.max(...yVals);

  // Project these max distances along the original baseline
  const pt1XY = [
    centerXY[0] + minY * Math.sin(theta),
    centerXY[1] + minY * Math.cos(theta),
  ];
  const pt2XY = [
    centerXY[0] + maxY * Math.sin(theta),
    centerXY[1] + maxY * Math.cos(theta),
  ];

  //convert back to WGS84 coords
  const pt1LL = proj4(projStr, 'WGS84', pt1XY);
  const pt2LL = proj4(projStr, 'WGS84', pt2XY);

  //create a line and calc its length
  const baseline = turf.lineString([pt1LL, pt2LL]);
  const length = turf.length(baseline, { units: 'meters' });

  return { baseline, length };
}

// finds the average transect heading and returns the orthogonal baseline heading
function getBaselineBearing(
  transectIds: number[],
  segmentedImages: Array<{
    longitude: number;
    latitude: number;
    transectId: number;
  }>
): number {
  // average transect heading
  const headings: number[] = [];
  transectIds.forEach((id) => {
    const imgs = segmentedImages.filter((si) => si.transectId === id);
    if (imgs.length >= 2) {
      const start = imgs[0];
      const end = imgs[imgs.length - 1];
      headings.push(
        turf.bearing(
          [start.longitude, start.latitude],
          [end.longitude, end.latitude]
        )
      );
    }
  });

  // average the headings - accounting for sign changes
  let avgHeading = 0;
  if (headings.length) {
    let sumX = 0,
      sumY = 0;
    headings.forEach((h) => {
      const rad = (h * Math.PI) / 180;
      sumX += Math.cos(rad);
      sumY += Math.sin(rad);
    });
    const avgRad = Math.atan2(sumY, sumX);
    avgHeading = (avgRad * 180) / Math.PI;
  }

  // baseline is orthogonal to the average
  const baselineBearing = (avgHeading + 90) % 360;

  return baselineBearing;
}

// merges small segments into closest neighbor based on first/last image GPS
function mergeSmallSegmentsByBoundary(
  segImgs: Array<any & { transectId: number }>,
  threshold: number
): Array<any & { transectId: number }> {
  const counts: Record<number, number> = segImgs.reduce((acc, img) => {
    acc[img.transectId] = (acc[img.transectId] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);
  const segmentGroups: Record<number, typeof segImgs> = {};
  segImgs.forEach((img) => {
    segmentGroups[img.transectId] = segmentGroups[img.transectId] || [];
    segmentGroups[img.transectId].push(img);
  });
  Object.entries(counts).forEach(([key, count]) => {
    const id = Number(key);
    if (count > threshold) return;
    const group = segmentGroups[id];
    if (!group) return;
    const boundary = [group[0], group[group.length - 1]];
    const neighbors = [id - 1, id + 1].filter((nbr) => segmentGroups[nbr]);
    if (neighbors.length === 0) return;
    const neighborDist = (nbr: number): number => {
      let minDist = Infinity;
      segmentGroups[nbr].forEach((nbrImg) => {
        boundary.forEach((b) => {
          const d = turf.distance(
            turf.point([b.longitude, b.latitude]),
            turf.point([nbrImg.longitude, nbrImg.latitude]),
            { units: 'kilometers' }
          );
          if (d < minDist) minDist = d;
        });
      });
      return minDist;
    };
    const bestNeighbor = neighbors.reduce(
      (best, nbr) => (neighborDist(nbr) < neighborDist(best) ? nbr : best),
      neighbors[0]
    );
    segImgs.forEach((img) => {
      if (img.transectId === id) img.transectId = bestNeighbor;
    });
  });
  return segImgs;
}

// define transects and strata
export default function DefineTransects({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  const [images, setImages] = useState<any[]>([]);
  const [partsLoading, setPartsLoading] = useState<null | number>(0);
  const [saving, setSaving] = useState(false);
  const [savingImageCount, setSavingImageCount] = useState(0);
  const [savingProgress, setSavingProgress] = useState(0);
  // disabledClose: only disables Close during active save; saveDisabled: governs Save button enablement
  const [disabledClose, setDisabledClose] = useState(false);
  const [saveDisabled, setSaveDisabled] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [polygonCoords, setPolygonCoords] = useState<LatLng[] | null>(null);
  const [segmentedImages, setSegmentedImages] = useState<
    (any & { transectId: number })[]
  >([]);
  const [selectedTransectIds, setSelectedTransectIds] = useState<Set<number>>(
    new Set()
  );
  const [pendingPolygon, setPendingPolygon] = useState<{
    id: string | number;
    enclosedImageIds: Set<any>;
    center: [number, number]; // [lng, lat]
  } | null>(null);
  const [strataLines, setStrataLines] = useState<LatLng[][]>([]);
  const [strataSections, setStrataSections] = useState<
    { coords: LatLng[]; id: number }[]
  >([]);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [activeTool, setActiveTool] = useState<
    'enclose' | 'strata' | 'select' | null
  >(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pendingPopupRef = useRef<maplibregl.Popup | null>(null);
  // Track if we've already fitted the map bounds
  const [hasFittedBounds, setHasFittedBounds] = useState(false);

  // Add state to track if existing transect data is present
  const [existingData, setExistingData] = useState<boolean>(false);
  // Add state for shapefile exclusion polygons
  const [exclusionCoords, setExclusionCoords] = useState<LatLng[][]>([]);
  const [imputedImageIds, setImputedImageIds] = useState<Set<any>>(new Set());
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
    const byCoordKey: Record<string, (any & { transectId: number })[]> = {};
    const adjusted: Record<string, { latitude: number; longitude: number }> =
      {};
    const keyFor = (lat: number, lng: number) => `${lat},${lng}`;

    segmentedImages.forEach((img) => {
      const key = keyFor(img.latitude, img.longitude);
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
        const radiusDeg = 0.00005; // ~5.5m in latitude
        const angle = (2 * Math.PI * index) / group.length;
        const dLat = radiusDeg * Math.sin(angle);
        const dLng =
          (radiusDeg * Math.cos(angle)) / Math.max(Math.cos(latRad), 1e-6);
        adjusted[img.id] = {
          latitude: img.latitude + dLat,
          longitude: img.longitude + dLng,
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

  // Polygon selection actions
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
    const currentMax =
      segmentedImages.length > 0
        ? Math.max(...segmentedImages.map((si) => si.transectId))
        : -1;
    const newTransectId = isFiniteNumber(currentMax) ? currentMax + 1 : 0;
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

  const handleMergeSelectedInto = useCallback(
    (targetTransectId: number) => {
      setSegmentedImages((prev) =>
        prev.map((si) =>
          selectedTransectIdsRef.current.has(si.transectId)
            ? { ...si, transectId: targetTransectId }
            : si
        )
      );
      setSelectedTransectIds(new Set());
    },
    []
  );
  const handleMergeSelectedIntoRef = useRef(handleMergeSelectedInto);
  handleMergeSelectedIntoRef.current = handleMergeSelectedInto;
  const assignPendingToNewTransectRef = useRef(assignPendingToNewTransect);
  assignPendingToNewTransectRef.current = assignPendingToNewTransect;

  const clearStrata = () => {
    setExistingData(false);
    setStrataSections([]);
    setStrataLines([]);
    // Remove any drawn strata lines from Terra Draw.
    const draw = drawRef.current;
    if (draw) {
      const ids = draw
        .getSnapshot()
        .filter(
          (f: any) =>
            f.geometry?.type === 'LineString' && f.properties?.mode === MODE_STRATA
        )
        .map((f: any) => f.id);
      if (ids.length) {
        try {
          draw.removeFeatures(ids);
        } catch {
          /* ignore */
        }
      }
    }
  };

  // submit handler: creates strata, transects, and assigns images
  const handleSubmit = async () => {
    if (!polygonCoords) return;
    setDisabledClose(true);
    setSaving(true);

    // Calculate how many images will be linked to transects
    const imagesToUpdate = segmentedImages.filter(
      (img) => img.transectId != null
    );
    const imageCount = imagesToUpdate.length;
    setSavingImageCount(imageCount);
    setSavingProgress(0);

    // delete all existing strata so we can recreate them fresh
    const existingStrata = await fetchAllPaginatedResults(
      client.models.Stratum.strataByProjectId as any,
      { projectId, limit: 10000, selectionSet: ['id'] } as any
    );
    await Promise.all(
      existingStrata.map((st: any) =>
        (client.models.Stratum.delete as any)({ id: st.id })
      )
    );

    // generate strata polys
    const stratumPolys: Record<number, GeoJSONFeature<GeoJSONPolygon>> = {};
    const stratumTransects: Record<number, number[]> = {};
    for (const section of strataSections) {
      const secLngLat = section.coords.map((coord) => {
        const [lat, lng] = coord as [number, number];
        return [lng, lat] as [number, number];
      });
      if (
        secLngLat[0][0] !== secLngLat[secLngLat.length - 1][0] ||
        secLngLat[0][1] !== secLngLat[secLngLat.length - 1][1]
      ) {
        secLngLat.push(secLngLat[0]);
      }
      const secPoly = turf.polygon([secLngLat]);
      stratumPolys[section.id] = secPoly;
      stratumTransects[section.id] = [];
    }

    // stratify transects
    for (const tid of transectIds) {
      const imgs = segmentedImages.filter((si) => si.transectId === tid);
      if (!imgs.length) continue;
      const rep = imgs[0];
      const repPt = turf.point([rep.longitude, rep.latitude]);
      let assigned: number | null = null;
      for (const section of strataSections) {
        const secPoly = stratumPolys[section.id];
        if (turf.booleanPointInPolygon(repPt, secPoly)) {
          assigned = section.id;
          break;
        }
      }
      if (assigned === null) continue;
      stratumTransects[assigned].push(tid);
    }

    // create strata
    const stratumMap: Record<number, string> = {};
    for (const section of strataSections) {
      const secPoly = stratumPolys[section.id];

      // calculate raw area of section polygon
      const rawArea = turf.area(secPoly);

      // subtract exclusion polygons entirely if they intersect
      let exclusionAreaSqm = 0;
      exclusionCoords.forEach((coords) => {
        if (coords.length < 3) return;
        const excCoordsLngLat = coords.map((pt) => {
          if (Array.isArray(pt)) {
            const t = pt as [number, number];
            return [t[1], t[0]] as [number, number];
          }
          const ll = pt as any;
          return [ll.lng as number, ll.lat as number] as [number, number];
        });
        // ensure closure
        if (
          excCoordsLngLat[0][0] !==
          excCoordsLngLat[excCoordsLngLat.length - 1][0] ||
          excCoordsLngLat[0][1] !==
          excCoordsLngLat[excCoordsLngLat.length - 1][1]
        ) {
          excCoordsLngLat.push(excCoordsLngLat[0]);
        }
        const exclusionPoly = turf.polygon([excCoordsLngLat]);
        // if exclusion overlaps this section, subtract full exclusion area
        if (turf.booleanIntersects(secPoly, exclusionPoly)) {
          exclusionAreaSqm += turf.area(exclusionPoly);
        }
      });

      // compute net area and convert to km²
      const netAreaSqm = rawArea - exclusionAreaSqm;
      const netAreaKm = netAreaSqm / 1e6;
      const area = netAreaKm;

      // compute baseline length
      const baselineBearing = getBaselineBearing(
        stratumTransects[section.id],
        segmentedImages
      );
      const { length } = getProjectedDirectionalBaseline(
        secPoly,
        baselineBearing
      );

      // create new stratum with polygon coordinates
      const secName = `Stratum ${section.id}`;
      const flatCoords = section.coords.flatMap(
        (coord) => coord as [number, number]
      );
      const createStratumRes = await (client.models.Stratum.create as any)({
        projectId,
        name: secName,
        area,
        baselineLength: length,
        coordinates: flatCoords,
        group: organizationId,
      });
      const newSid = createStratumRes.data.id as string;
      stratumMap[section.id] = newSid;
    }

    // create transects
    const transectMap: Record<number, string> = {};
    for (const tid of transectIds) {
      let assigned: number | null = null;
      for (const section of strataSections) {
        if (stratumTransects[section.id].includes(tid)) {
          assigned = section.id;
          break;
        }
      }

      if (assigned === null) continue;
      const strId = stratumMap[assigned];
      const createTransectRes = await (client.models.Transect.create as any)({
        projectId,
        stratumId: strId,
        group: organizationId,
      });
      const trId = createTransectRes.data.id as string;
      transectMap[tid] = trId;
    }

    // update images with progress tracking
    await Promise.all(
      segmentedImages.map(async (img) => {
        const trId = transectMap[img.transectId];
        if (trId) {
          const update: any = {
            id: img.id,
            transectId: trId,
          };
          // if this image had imputed coordinates, persist them back
          if (imputedImageIds.has(img.id)) {
            update.latitude = img.latitude;
            update.longitude = img.longitude;
          }
          await (client.models.Image.update as any)(update);
          setSavingProgress((p) => p + 1);
        }
      })
    );

    // cleanup: delete unused transects from the database
    const allTransects = await fetchAllPaginatedResults(
      client.models.Transect.transectsByProjectId as any,
      { projectId, limit: 10000, selectionSet: ['id'] } as any
    );
    const usedTransectIds = new Set(Object.values(transectMap));
    await Promise.all(
      allTransects
        .map((t: any) => t.id)
        .filter((id: string) => !usedTransectIds.has(id))
        .map((id: string) => (client.models.Transect.delete as any)({ id }))
    );

    //clear jolly results
    const jollyResults = await fetchAllPaginatedResults(
      client.models.JollyResult.jollyResultsBySurveyId as any,
      {
        surveyId: projectId,
        limit: 10000,
        selectionSet: [
          'surveyId',
          'stratumId',
          'annotationSetId',
          'categoryId',
        ],
      } as any
    );

    await Promise.all(
      jollyResults.map((jr: any) =>
        (client.models.JollyResult.delete as any)({
          surveyId: jr.surveyId,
          stratumId: jr.stratumId,
          annotationSetId: jr.annotationSetId,
          categoryId: jr.categoryId,
        })
      )
    );

    setDisabledClose(false);
    setSaving(false);
    setSavingImageCount(0);
    setSavingProgress(0);
  };

  useEffect(() => {
    setSaveDisabled(strataSections.length === 0);
  }, [strataSections]);

  // fetch images for project
  useEffect(() => {
    async function loadImages() {
      const rawImgs = (await fetchAllPaginatedResults(
        client.models.Image.imagesByProjectId as any,
        {
          projectId,
          limit: 10000,
          selectionSet: [
            'id',
            'timestamp',
            'latitude',
            'longitude',
            'transectId',
          ],
        } as any
      )) as any[];
      // normalize timestamp unit and sort chronologically before imputation
      rawImgs.forEach((img) => {
        img.timestamp = normalizeToMillis(img.timestamp);
      });
      rawImgs.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      const { filled, imputedIds } = imputeLatLngForImages(rawImgs);
      setImages(filled);
      setImputedImageIds((prev) => {
        const next = new Set(prev);
        imputedIds.forEach((id) => next.add(id));
        return next;
      });
      setPartsLoading((l) => (l === null ? 1 : l + 1));
    }
    loadImages();
  }, [projectId]);

  // Insert logic to load existing strata and transect assignments
  useEffect(() => {
    async function loadExistingData() {
      const existingStrata = await fetchAllPaginatedResults(
        client.models.Stratum.strataByProjectId as any,
        {
          projectId,
          limit: 10000,
          selectionSet: ['id', 'coordinates', 'name'],
        } as any
      );
      if (existingStrata.length > 0) {
        setExistingData(true);
        const rawImgsWithTx = await fetchAllPaginatedResults(
          client.models.Image.imagesByProjectId as any,
          {
            projectId,
            limit: 10000,
            selectionSet: [
              'id',
              'timestamp',
              'latitude',
              'longitude',
              'transectId',
            ],
          } as any
        );
        const imgsWithTxRaw = rawImgsWithTx as any[];
        imgsWithTxRaw.forEach((img) => {
          img.timestamp = normalizeToMillis(img.timestamp);
        });
        imgsWithTxRaw.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        const { filled: imgsWithTx, imputedIds: impIds } =
          imputeLatLngForImages(imgsWithTxRaw);
        setImputedImageIds((prev) => {
          const next = new Set(prev);
          impIds.forEach((id) => next.add(id));
          return next;
        });
        // build UI segment IDs from DB transect IDs
        const uniqueDbIds = Array.from(
          new Set(
            imgsWithTx
              .map((img) => img.transectId)
              .filter((id): id is string => id != null)
          )
        );
        uniqueDbIds.sort((a, b) => {
          const imgsA = imgsWithTx.filter((img) => img.transectId === a);
          const imgsB = imgsWithTx.filter((img) => img.transectId === b);
          return (
            new Date(imgsA[0].timestamp).getTime() -
            new Date(imgsB[0].timestamp).getTime()
          );
        });
        const dbToUI: Record<string, number> = {};
        uniqueDbIds.forEach((id, idx) => {
          dbToUI[id] = idx;
        });
        const segImgs = imgsWithTx.map((img) => ({
          ...img,
          transectId: img.transectId ? dbToUI[img.transectId] : 0,
        }));
        setSegmentedImages(segImgs);
        // load existing strata polygons into state
        const loadedSections = existingStrata
          .map((st: any) => {
            const flat = st.coordinates || [];
            const latlngs = toLatLngPairs(
              (flat as Array<number | null>).filter(
                (n): n is number => n != null
              )
            );
            if (latlngs.length < 3) return null;
            const match = /^Stratum (\d+)$/.exec(st.name);
            const id = match ? parseInt(match[1], 10) : 0;
            return { coords: latlngs, id };
          })
          .filter((x): x is { coords: LatLng[]; id: number } => !!x);
        setStrataSections(loadedSections);
      }

      setPartsLoading((l) => (l === null ? 1 : l + 1));
    }
    loadExistingData();
  }, [projectId]);

  // Add effect to load shapefile exclusion polygons
  useEffect(() => {
    async function loadExclusions() {
      const result = (await (
        client.models.ShapefileExclusions.shapefileExclusionsByProjectId as any
      )({ projectId })) as any;
      const data = result.data as Array<{ coordinates: (number | null)[] }>;
      const polys: LatLng[][] = [];
      data.forEach((ex) => {
        if (ex.coordinates) {
          const coordsArr = ex.coordinates.filter(
            (n): n is number => n != null
          );
          const latlngs = toLatLngPairs(coordsArr);
          if (latlngs.length < 3) return;
          polys.push(latlngs);
        }
      });
      setExclusionCoords(polys);

      setPartsLoading((l) => (l === null ? 1 : l + 1));
    }
    loadExclusions();
  }, [projectId]);

  // fetch existing shapefile polygon
  useEffect(() => {
    async function loadShapefile() {
      const result = (await (
        client.models.Shapefile.shapefilesByProjectId as any
      )({ projectId })) as any;
      const data = result.data as Array<{ coordinates: (number | null)[] }>;
      if (data.length > 0 && data[0].coordinates) {
        const coordsArr = data[0].coordinates.filter(
          (n): n is number => n != null
        );
        const latlngs = toLatLngPairs(coordsArr);
        if (latlngs.length < 3) {
          setPartsLoading((l) => (l === null ? 1 : l + 1));
          return;
        }
        setPolygonCoords(latlngs);
      }

      setPartsLoading((l) => (l === null ? 1 : l + 1));
    }
    loadShapefile();
  }, [projectId]);

  // Modify segmentation to skip calculation if existing data loaded
  useEffect(() => {
    if (existingData) return;
    // only run segmentation once when no segments exist
    if (partsLoading === null && segmentedImages.length === 0) {
      const validImgs = images.filter((img) =>
        isValidLatLng(img.latitude, img.longitude)
      );
      if (validImgs.length <= 1) return;
      // build lineString in [lng,lat]
      const coords = validImgs.map(
        (img) => [img.longitude, img.latitude] as [number, number]
      );
      const line = turf.lineString(coords);
      const simplified = turf.simplify(line, { tolerance: SIMPLIFY_TOLERANCE });
      const anchorCoords = simplified.geometry.coordinates as [
        number,
        number
      ][];
      // find original indices of anchor points
      const anchorIndices = anchorCoords
        .map((pt) => coords.findIndex((c) => c[0] === pt[0] && c[1] === pt[1]))
        .filter((idx) => idx >= 0)
        .sort((a, b) => a - b);
      // assign each image to a transect segment
      const segImgs = validImgs.map((img, idx) => {
        let segId = anchorIndices.length - 1;
        for (let i = 0; i < anchorIndices.length - 1; i++) {
          if (idx >= anchorIndices[i] && idx < anchorIndices[i + 1]) {
            segId = i;
            break;
          }
        }
        return { ...img, transectId: segId };
      });
      const mergedSegImgs = mergeSmallSegmentsByBoundary(segImgs, 5);
      // compact transect ids to be sequential
      const uniqueIds: number[] = Array.from(
        new Set(mergedSegImgs.map((img: any) => img.transectId))
      ).sort((a: number, b: number) => a - b);
      const idMap: Record<number, number> = uniqueIds.reduce<
        Record<number, number>
      >((acc, oldId, index) => {
        acc[oldId] = index;
        return acc;
      }, {});
      mergedSegImgs.forEach((img: any) => {
        img.transectId = idMap[img.transectId];
      });
      setSegmentedImages(mergedSegImgs);
    }
  }, [images, partsLoading, existingData, segmentedImages]);

  // Split a polygon by a multi-vertex polyline. Returns 1 or 2 polygons (open rings in [lat,lng]).
  const splitPolygon = (
    poly: LatLng[],
    line: LatLng[]
  ): LatLng[][] => {
    if (poly.length < 3 || line.length < 2) return [poly];

    // Convert to [lng,lat]
    const ringLngLat = ((): [number, number][] => {
      const arr: [number, number][] = [];
      for (let i = 0; i < poly.length; i++) {
        const [lat, lng] = poly[i] as [number, number];
        arr.push([lng, lat]);
      }
      // ensure closure
      if (
        arr[0][0] !== arr[arr.length - 1][0] ||
        arr[0][1] !== arr[arr.length - 1][1]
      ) {
        arr.push([arr[0][0], arr[0][1]]);
      }
      return arr;
    })();
    const lineLngLat: [number, number][] = line.map((pt) => {
      const [lat, lng] = pt as [number, number];
      return [lng, lat];
    });

    const polyFC = turf.polygon([ringLngLat]);
    const lineFC = turf.lineString(lineLngLat);
    const boundary = turf.polygonToLine(polyFC);
    const intersections = turf.lineIntersect(lineFC, boundary);

    // Deduplicate intersections
    const uniqKey = (c: [number, number]) =>
      `${c[0].toFixed(10)},${c[1].toFixed(10)}`;
    const uniquePtsMap: Record<string, any> = {};
    intersections.features.forEach((f) => {
      const c = f.geometry.coordinates as [number, number];
      uniquePtsMap[uniqKey(c)] = f as any;
    });
    const uniquePts = Object.values(uniquePtsMap);

    if (uniquePts.length < 2) {
      // No proper cut; return original
      return [poly];
    }

    // Order intersections along the polyline
    const withLoc = uniquePts
      .map((pt) => {
        const onLine = turf.nearestPointOnLine(lineFC, pt);
        return { pt, location: (onLine.properties as any).location as number };
      })
      .sort((a, b) => a.location - b.location);
    const aPt = withLoc[0].pt;
    const bPt = withLoc[withLoc.length - 1].pt;

    // Find ring segment indices where intersections occur
    const ringLine = turf.lineString(ringLngLat);
    const aOnRing = turf.nearestPointOnLine(ringLine, aPt);
    const bOnRing = turf.nearestPointOnLine(ringLine, bPt);
    const aIdx = (aOnRing.properties as any).index as number;
    const bIdx = (bOnRing.properties as any).index as number;

    // Slice the polyline between a->b
    const lineSlice = turf.lineSlice(aPt, bPt, lineFC);
    const lineSliceCoords = turf.getCoords(lineSlice) as [number, number][];

    // Helper to collect ring path going forward from idxA+1 .. idxB
    const ringNoClose = ringLngLat.slice(0, ringLngLat.length - 1);
    const ringLen = ringNoClose.length;
    const collectRingPath = (
      startIdx: number,
      endIdx: number,
      startCoord: [number, number],
      endCoord: [number, number]
    ): [number, number][] => {
      const path: [number, number][] = [];
      path.push(startCoord);
      let i = (startIdx + 1) % ringLen;
      for (;;) {
        path.push(ringNoClose[i]);
        if (i === endIdx) break;
        i = (i + 1) % ringLen;
      }
      // Avoid duplicating end vertex if identical to endCoord
      const last = path[path.length - 1];
      if (last[0] !== endCoord[0] || last[1] !== endCoord[1]) {
        path.push(endCoord);
      }
      return path;
    };

    const aCoord = aPt.geometry.coordinates as [number, number];
    const bCoord = bPt.geometry.coordinates as [number, number];
    const aT = ((aOnRing.properties as any)?.t as number | undefined) ?? 0;
    const bT = ((bOnRing.properties as any)?.t as number | undefined) ?? 1;

    // Build ring paths between intersections, with special handling when both
    // intersections lie on the same edge (aIdx === bIdx)
    let path1: [number, number][]; // A -> ... -> B along ring
    let path2: [number, number][]; // B -> ... -> A along ring
    if (aIdx === bIdx) {
      if (aT <= bT) {
        // Small forward segment along the same edge
        path1 = [aCoord, bCoord];
        // Complement goes the long way around the ring
        path2 = collectRingPath(bIdx, aIdx, bCoord, aCoord);
      } else {
        // Forward path wraps around the ring
        path1 = collectRingPath(aIdx, bIdx, aCoord, bCoord);
        // Complement is the small segment along the same edge (backwards)
        path2 = [bCoord, aCoord];
      }
    } else {
      path1 = collectRingPath(aIdx, bIdx, aCoord, bCoord); // A -> ... -> B (ring)
      path2 = collectRingPath(bIdx, aIdx, bCoord, aCoord); // B -> ... -> A (ring)
    }

    // Compose polygons by adding the polyline segment (nonlinear) to close loops
    const segAtoB = lineSliceCoords; // A -> ... -> B
    const segBtoA = lineSliceCoords.slice().reverse(); // B -> ... -> A

    // Append without duplicating endpoints
    const region1LngLat: [number, number][] = [
      ...path1,
      ...segBtoA.slice(1, -1), // B..A (without duplicating B and A)
    ];
    const region2LngLat: [number, number][] = [
      ...path2,
      ...segAtoB.slice(1, -1), // A..B (without duplicating A and B)
    ];

    // Convert back to [lat,lng] and ensure open rings (no duplicate last == first)
    const toLatLng = (coords: [number, number][]): LatLng[] => {
      if (coords.length === 0) return [];
      const out = coords.map(([x, y]) => [y, x] as [number, number]);
      const first = out[0] as [number, number];
      const last = out[out.length - 1] as [number, number];
      if (first[0] === last[0] && first[1] === last[1]) out.pop();
      return out;
    };

    const r1 = toLatLng(region1LngLat);
    const r2 = toLatLng(region2LngLat);

    // Validate minimal polygon
    const results: LatLng[][] = [];
    if (r1.length >= 3) results.push(r1);
    if (r2.length >= 3) results.push(r2);
    return results.length ? results : [poly];
  };

  // compute strata sections when boundary or lines change
  useEffect(() => {
    if (existingData) return;
    if (!polygonCoords) return;
    let regions: LatLng[][] = [polygonCoords];
    strataLines.forEach((line) => {
      const newRegions: LatLng[][] = [];
      regions.forEach((region) => {
        const parts = splitPolygon(region, line);
        parts.forEach((p) => {
          if (p.length >= 3) newRegions.push(p);
        });
      });
      regions = newRegions;
    });
    setStrataSections(regions.map((coords, i) => ({ coords, id: i + 1 })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polygonCoords, strataLines, existingData]);

  useEffect(() => {
    if (partsLoading === null) return;
    if (partsLoading === 4) {
      setPartsLoading(null);
    }
  }, [partsLoading]);

  // Reset fit bounds flag when project changes
  useEffect(() => {
    setHasFittedBounds(false);
  }, [projectId]);

  // -----------------------------------------------------------------------
  // GeoJSON for the image points, coloured by transect.
  // -----------------------------------------------------------------------
  const pointsFC = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: segmentedImages.map((img) => {
        const pos = adjustedPositions[img.id] || {
          latitude: img.latitude,
          longitude: img.longitude,
        };
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
    };
  }, [segmentedImages, adjustedPositions, selectedTransectIds]);

  const boundaryFC = useMemo(() => {
    if (!polygonCoords || polygonCoords.length < 3) return EMPTY_FC;
    const ring = polygonCoords.map(([lat, lng]) => [lng, lat]);
    const [fx, fy] = ring[0];
    const [lx, ly] = ring[ring.length - 1];
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: ring },
        },
      ],
    };
  }, [polygonCoords]);

  const exclusionsFC = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: exclusionCoords
        .filter((c) => c.length >= 3)
        .map((coords) => {
          const ring = coords.map(([lat, lng]) => [lng, lat]);
          const [fx, fy] = ring[0];
          const [lx, ly] = ring[ring.length - 1];
          if (fx !== lx || fy !== ly) ring.push([fx, fy]);
          return {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: ring },
          };
        }),
    };
  }, [exclusionCoords]);

  const strataFC = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: strataSections
        .filter((s) => s.coords.length >= 3)
        .map((section) => {
          const ring = section.coords.map(([lat, lng]) => [lng, lat]);
          const [fx, fy] = ring[0];
          const [lx, ly] = ring[ring.length - 1];
          if (fx !== lx || fy !== ly) ring.push([fx, fy]);
          return {
            type: 'Feature',
            properties: {
              id: section.id,
              color: strataColors[section.id % strataColors.length],
            },
            geometry: { type: 'Polygon', coordinates: [ring] },
          };
        }),
    };
  }, [strataSections]);

  // -----------------------------------------------------------------------
  // Map + Terra Draw initialisation (once).
  // -----------------------------------------------------------------------
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

    const rebuildStrataLines = () => {
      const lines = drawRef.current
        ?.getSnapshot()
        .filter(
          (f: any) =>
            f.geometry?.type === 'LineString' && f.properties?.mode === MODE_STRATA
        );
      setStrataLines(
        (lines ?? []).map((f: any) =>
          (f.geometry.coordinates as [number, number][]).map(
            ([lng, lat]) => [lat, lng] as LatLng
          )
        )
      );
    };

    const handleEncloseFinish = (
      id: string | number,
      feature: ReturnType<TerraDraw['getSnapshotFeature']>
    ) => {
      const draw = drawRef.current;
      if (!draw || !feature || feature.geometry.type !== 'Polygon') return;

      // Query the point layer using the polygon in screen coordinates. This
      // makes the selection match the points currently rendered on the map,
      // including their jittered display positions.
      const screenPolygon = feature.geometry.coordinates[0].map(
        ([lng, lat]) => map.project([lng, lat])
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
        const pos = adjustedPositionsRef.current[img.id] || {
          latitude: img.latitude,
          longitude: img.longitude,
        };
        const screenPoint = map.project([pos.longitude, pos.latitude]);
        return isInsideScreenPolygon(
          screenPoint.x,
          screenPoint.y
        );
      });

      // Polygon selection is a one-shot action. Keep the completed polygon
      // visible while the user decides whether to merge the enclosed points.
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
      const center = turf.centerOfMass(feature as any).geometry
        .coordinates as [number, number];
      setPendingPolygon({
        id,
        enclosedImageIds: new Set(enclosed.map((img) => img.id)),
        center,
      });
    };

    map.on('load', () => {
      // Sources (start empty; populated by the data effects below).
      map.addSource(SRC_STRATA, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_BOUNDARY, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_EXCLUSIONS, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_POINTS, {
        type: 'geojson',
        data: EMPTY_FC as any,
        promoteId: 'id',
      });

      // Strata fill + outline (under everything else).
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
      // Boundary + exclusions (outlines only).
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
      // Image points, coloured by transect. Selection is stored in the
      // GeoJSON properties so source refreshes cannot discard it.
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

      // ---- Terra Draw ----
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
        } else if (
          finishedMode === MODE_STRATA ||
          finishedMode === MODE_SELECT
        ) {
          rebuildStrataLines();
        }
      });
      draw.on('change', (_ids, type, context) => {
        const fromApi =
          !!context && 'origin' in context && context.origin === 'api';
        if (type === 'delete' && !fromApi) {
          rebuildStrataLines();
        }
      });
      draw.on('select', (id) => setSelectedLineId(String(id)));
      draw.on('deselect', () => setSelectedLineId(null));

      // ---- Image point interactions (only when no draw tool is active) ----
      map.on('click', LYR_POINTS, (e) => {
        // Ignore the click that just closed a lasso: by the time this fires the
        // enclose tool has cleared, but a pending selection is in progress.
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
        if (selected.length >= 2) {
          const ids = selected.sort((a, b) => a - b);
          const primary = Math.min(...ids);
          const node = document.createElement('div');
          node.style.cursor = 'pointer';
          node.style.color = '#000';
          node.textContent =
            ids.length === 2
              ? `Merge transect ${ids[0]} and ${ids[1]}`
              : `Merge ${ids.length} selected transects`;
          node.onclick = () => {
            handleMergeSelectedIntoRef.current(primary);
            popupRef.current?.remove();
          };
          showPopup(e.lngLat, node);
        } else {
          const node = document.createElement('div');
          node.style.color = '#000';
          node.innerHTML = `<div><strong>Transect:</strong> ${tid}</div><div><strong>Images:</strong> ${transectImageCountsRef.current[tid] || 0
            }</div>`;
          showPopup(e.lngLat, node);
        }
      });

      // Stratum info popup (ignored if a point sits under the cursor).
      map.on('click', LYR_STRATA_FILL, (e) => {
        if (activeToolRef.current || pendingPolygonRef.current) return;
        const pts = map.queryRenderedFeatures(e.point, { layers: [LYR_POINTS] });
        if (pts.length) return;
        const f = e.features?.[0];
        if (!f) return;
        const node = document.createElement('div');
        node.style.color = '#000';
        node.innerHTML = `<div><strong>Stratum:</strong> ${(f.properties as any)?.id ?? ''
          }</div>`;
        showPopup(e.lngLat, node);
      });

      for (const lyr of [LYR_POINTS, LYR_STRATA_FILL]) {
        map.on('mouseenter', lyr, () => {
          if (!activeToolRef.current) map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', lyr, () => {
          if (!activeToolRef.current) map.getCanvas().style.cursor = '';
        });
      }

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

  // Push GeoJSON data into the sources whenever it changes.
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    const src = map?.getSource(SRC_POINTS) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!map || !src) return;
    src.setData(pointsFC as any);
  }, [mapLoaded, pointsFC]);

  useEffect(() => {
    if (!mapLoaded) return;
    (mapRef.current?.getSource(SRC_BOUNDARY) as maplibregl.GeoJSONSource)?.setData(
      boundaryFC as any
    );
  }, [mapLoaded, boundaryFC]);

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_EXCLUSIONS) as maplibregl.GeoJSONSource
    )?.setData(exclusionsFC as any);
  }, [mapLoaded, exclusionsFC]);

  useEffect(() => {
    if (!mapLoaded) return;
    (mapRef.current?.getSource(SRC_STRATA) as maplibregl.GeoJSONSource)?.setData(
      strataFC as any
    );
  }, [mapLoaded, strataFC]);

  // Fit the map to the image points on initial load.
  useEffect(() => {
    if (!mapLoaded || hasFittedBounds || segmentedImages.length === 0) return;
    const map = mapRef.current;
    if (!map) return;
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const img of segmentedImages) {
      const pos = adjustedPositions[img.id] || {
        latitude: img.latitude,
        longitude: img.longitude,
      };
      if (!isValidLatLng(pos.latitude, pos.longitude)) continue;
      if (pos.longitude < minLng) minLng = pos.longitude;
      if (pos.latitude < minLat) minLat = pos.latitude;
      if (pos.longitude > maxLng) maxLng = pos.longitude;
      if (pos.latitude > maxLat) maxLat = pos.latitude;
    }
    if (!Number.isFinite(minLng)) return;
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 30, maxZoom: 16, duration: 0 }
    );
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
    btn.className = 'btn btn-primary btn-sm';
    btn.textContent = 'Merge points';
    btn.onclick = () => assignPendingToNewTransectRef.current();
    node.appendChild(btn);
    // closeOnClick defaults to true; the same click that closes the lasso would
    // otherwise immediately dismiss this popup (and discard the selection).
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
      // Closed without merging -> discard the drawn polygon.
      if (pendingPolygonRef.current) clearPendingSelection();
    };
    popup.on('close', onClose);
    return () => {
      popup.off('close', onClose);
      popup.remove();
      if (pendingPopupRef.current === popup) pendingPopupRef.current = null;
    };
  }, [pendingPolygon, mapLoaded, clearPendingSelection]);

  // Tool toggles
  const toggleTool = useCallback(
    (tool: 'enclose' | 'strata' | 'select') => {
      const draw = drawRef.current;
      if (!draw) return;
      popupRef.current?.remove();
      if (activeTool === tool) {
        draw.setMode(MODE_IDLE);
        setActiveTool(null);
        setSelectedLineId(null);
      } else {
        const modeName =
          tool === 'enclose'
            ? MODE_ENCLOSE
            : tool === 'strata'
              ? MODE_STRATA
              : MODE_SELECT;
        draw.setMode(modeName);
        setActiveTool(tool);
        // Leaving a pending selection behind would orphan its polygon.
        if (tool !== 'enclose' && pendingPolygonRef.current) {
          clearPendingSelection();
        }
      }
    },
    [activeTool, clearPendingSelection]
  );

  const deleteSelectedLine = useCallback(() => {
    const draw = drawRef.current;
    if (!draw || !selectedLineId) return;
    try {
      draw.removeFeatures([selectedLineId]);
    } catch {
      /* ignore */
    }
    setSelectedLineId(null);
    // removeFeatures is an API change (no rebuild from 'change'), so sync now.
    const lines = draw
      .getSnapshot()
      .filter(
        (f: any) =>
          f.geometry?.type === 'LineString' && f.properties?.mode === MODE_STRATA
      );
    setStrataLines(
      lines.map((f: any) =>
        (f.geometry.coordinates as [number, number][]).map(
          ([lng, lat]) => [lat, lng] as LatLng
        )
      )
    );
  }, [selectedLineId]);

  const toolsDisabled = partsLoading !== null || saving;

  return (
    <>
      <Form className='d-flex flex-column gap-3 p-3'>
        <div className='d-flex justify-content-between align-items-center gap-2'>
          <div
            className='text-uppercase fw-semibold text-muted'
            style={{ letterSpacing: 0.5, fontSize: 12 }}
          >
            Define Transects and Strata
          </div>
          {existingData && (
            <Button variant='outline-primary' size='sm' onClick={clearStrata}>
              Clear Strata
            </Button>
          )}
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
                Define strata with the <strong>Draw strata line</strong> tool:
                draw a line across the boundary (start and end outside it). Use{' '}
                <strong>Edit lines</strong> to adjust or delete a line.
              </li>
              <li>
                Save your work with the save button at the bottom of the page
                (even if you haven't made changes).
              </li>
              {existingData && (
                <li>
                  To make changes to strata, clear strata and redraw the strata
                  lines.
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Map toolbar */}
        <div className='d-flex gap-2 flex-wrap'>
          <Button
            size='sm'
            variant={activeTool === 'enclose' ? 'primary' : 'outline-primary'}
            onClick={() => toggleTool('enclose')}
            disabled={toolsDisabled}
          >
            {activeTool === 'enclose' ? 'Selecting points…' : 'Select points'}
          </Button>
          {!existingData && (
            <>
              <Button
                size='sm'
                variant={
                  activeTool === 'strata' ? 'primary' : 'outline-primary'
                }
                onClick={() => toggleTool('strata')}
                disabled={toolsDisabled}
              >
                {activeTool === 'strata' ? 'Drawing line…' : 'Draw strata line'}
              </Button>
              <Button
                size='sm'
                variant={
                  activeTool === 'select' ? 'primary' : 'outline-primary'
                }
                onClick={() => toggleTool('select')}
                disabled={toolsDisabled}
              >
                {activeTool === 'select' ? 'Editing lines…' : 'Edit lines'}
              </Button>
              {activeTool === 'select' && (
                <Button
                  size='sm'
                  variant='outline-danger'
                  onClick={deleteSelectedLine}
                  disabled={!selectedLineId}
                >
                  Delete selected line
                </Button>
              )}
            </>
          )}
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

          {/* Merge Selected Transects button */}
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
                onClick={() => {
                  const selected = Array.from(selectedTransectIds);
                  const primary = Math.min(...selected);
                  handleMergeSelectedInto(primary);
                }}
              >
                Merge Selected Transects ({selectedTransectIds.size})
              </Button>
            </div>
          )}

          {/* Loading overlay */}
          {partsLoading !== null && (
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
              <span className='ms-2'>Loading data</span>
            </div>
          )}
        </div>
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
          disabled={saveDisabled || saving}
        >
          Save Transects and Strata
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
