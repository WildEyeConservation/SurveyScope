import type { ExpressionSpecification } from 'maplibre-gl';
import * as maplibregl from 'maplibre-gl';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';
import './survey/surveyMap.css';

import { buttonVariants } from '@/components/ui/button-variants';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useQueries } from '@tanstack/react-query';
import { booleanPointInPolygon, pointOnFeature } from '@turf/turf';
import {
  LassoIcon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  PlusIcon,
  ScanIcon,
} from 'lucide-react';
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import {
  adjectives,
  names,
  uniqueNamesGenerator,
} from 'unique-names-generator';
import { GlobalContext, ProjectContext, UserContext } from './Context';
import {
  DEFAULT_HEAT_RADIUS_KM,
  HEAT_COLOR_RAMP,
  heatCells,
  heatIntensity,
  heatRadiusExpression,
} from './densityHeat';
import ImageViewerModal from './ImageViewerModal';
import { formatInfoTagsForDisplay } from './infoTags';
import type { OverlapImage } from './overlapReview/layout';
import OverlapReviewModal, {
  type SightingDot,
} from './overlapReview/OverlapReviewModal';
import ReviewImageModal from './ReviewImageModal';
import ReviewImageStage, { type StageSlot } from './ReviewImageStage';
import { type Point, warmImage } from './reviewImageView';
import {
  extractUserIdFromOwner,
  setAnnotationsQuery,
  surveyGeoQuery,
} from './sightingQueries';
import { Kbd, MapButton } from './survey/mapControls';
import { LIGHT_THEME, MAP_CONTROLS } from './survey/mapTheme';
import { BASE_STYLE } from './survey/surveyMapStyle';
import { strataColors } from './survey/transectStrata';
import { useInfoTagData } from './useInfoTags';

/**
 * A single (survey, annotation set) pair whose annotations should be plotted.
 * Multiple sources can share a survey (only images/strata for that survey are
 * fetched once) or differ entirely (data is overlaid on the same map).
 */
export interface DensitySource {
  surveyId: string;
  annotationSetId: string;
}

interface DensityMapProps {
  /** Multi-source mode: every (survey, set) pair is overlaid on the map. */
  sources?: DensitySource[];
  /** Legacy single-source props (used by JollyResults). */
  surveyId?: string;
  annotationSetId?: string;
  /** Filter annotations by category id (within a single set) ... */
  categoryIds?: string[];
  /** ... and/or by category name (generalises across surveys). */
  categoryNames?: string[];
  /**
   * Keep only annotations carrying at least one of these informational tags
   * (matched by name, so a filter spans the sets of every overlaid survey).
   */
  infoTagNames?: string[];
  selectedUserIds?: string[];
  /** Filter to annotations/images whose image belongs to these transects. */
  transectIds?: string[];
  primaryOnly?: boolean;
  editable?: boolean;
  dropFalseNegatives?: boolean;
  /** Annotation set used when opening the image/annotation viewer. */
  primaryAnnotationSetId?: string;
  /**
   * Reports the transects discovered in the loaded images (with the same
   * per-survey "Transect N" numbering the map uses) so a parent can render a
   * transect filter that stays consistent with the map's labels/colours.
   */
  onTransectsLoaded?: (
    transects: { id: string; surveyId: string; number: number }[],
  ) => void;
  highlightedStratumId?: string | null;
  onStratumHover?: (stratumId: string | null) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NO_POINTS: Point[] = [];
// About human visual reaction time.
const HOVER_INTENT_MS = 250;

const SRC_ANNOTATIONS = 'annotations';
// Small weighted cells rather than clusters, so the heatmap shows density.
const SRC_HEAT = 'annotations-unclustered';
const SRC_IMAGES = 'images';
const SRC_STRATA = 'strata';
const SRC_STRATA_LABELS = 'strata-labels';
const SRC_EXCLUSIONS = 'exclusions';

const LYR_HEATMAP = 'annotations-heat';
const LYR_CLUSTERS = 'annotations-clusters';
const LYR_CLUSTER_COUNT = 'annotations-cluster-count';
const LYR_POINTS = 'annotations-points';
const LYR_IMAGES = 'images-points';
const LYR_STRATA_FILL = 'strata-fill';
const LYR_STRATA_LINE = 'strata-line';
const LYR_STRATA_LABEL = 'strata-label';
const LYR_EXCLUSIONS_FILL = 'exclusions-fill';
const LYR_EXCLUSIONS_LINE = 'exclusions-line';

const TRANSECT_COLORS = [
  '#FF5733',
  '#33FF57',
  '#3357FF',
  '#F333FF',
  '#33FFF8',
  '#FFA833',
  '#8B33FF',
  '#FF3380',
  '#33FF8B',
  '#FFD133',
];

type FeatureCollection = GeoJSON.FeatureCollection;

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

// Cheap deterministic hash so co-located annotations spread out slightly.
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !isNaN(lat) &&
    !isNaN(lng)
  );
}

// Convert a flat [lat, lng, lat, lng, ...] array into a closed GeoJSON ring.
function coordsToRing(coords: number[] | null | undefined): number[][] | null {
  if (!coords || coords.length < 6) return null;
  const ring: number[][] = [];
  for (let i = 0; i + 1 < coords.length; i += 2) {
    ring.push([coords[i + 1], coords[i]]); // [lng, lat]
  }
  if (ring.length < 3) return null;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  return ring;
}

export default function DensityMap({
  sources,
  surveyId,
  annotationSetId,
  categoryIds = [],
  categoryNames = [],
  infoTagNames = [],
  selectedUserIds = [],
  transectIds = [],
  primaryOnly = false,
  editable = false,
  dropFalseNegatives = false,
  primaryAnnotationSetId,
  onTransectsLoaded,
  highlightedStratumId = null,
  onStratumHover,
}: DensityMapProps) {
  const { client } = useContext(GlobalContext)!;
  const projectCategories = useContext(ProjectContext)?.categoriesHook.data;
  const isSysadmin =
    !!useContext(UserContext)?.cognitoGroups.includes('sysadmin');
  const canReviewOverlap = editable && isSysadmin;

  // Normalise the legacy single-source props into the `sources` shape.
  const effectiveSources = useMemo<DensitySource[]>(() => {
    if (sources && sources.length) return sources;
    if (surveyId && annotationSetId) return [{ surveyId, annotationSetId }];
    return [];
  }, [sources, surveyId, annotationSetId]);

  const primarySetId =
    primaryAnnotationSetId ??
    annotationSetId ??
    effectiveSources[0]?.annotationSetId ??
    '';

  // Stable, de-duplicated keys for the query arrays below. Sorting keeps the
  // key (and therefore the query order) stable regardless of selection order.
  const uniqueSurveyIds = useMemo(
    () => Array.from(new Set(effectiveSources.map((s) => s.surveyId))).sort(),
    [effectiveSources],
  );
  const uniqueSetSources = useMemo(() => {
    const seen = new Map<string, DensitySource>();
    for (const s of effectiveSources) seen.set(s.annotationSetId, s);
    return Array.from(seen.values()).sort((a, b) =>
      a.annotationSetId.localeCompare(b.annotationSetId),
    );
  }, [effectiveSources]);

  // Layer visibility
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showClusters, setShowClusters] = useState(true);
  const [showImages, setShowImages] = useState(false);
  const [showStrata, setShowStrata] = useState(true);
  const [heatRadiusKm, setHeatRadiusKm] = useState(DEFAULT_HEAT_RADIUS_KM);

  // Viewer modal state
  const [viewerImageId, setViewerImageId] = useState<string | null>(null);
  const [viewerSetId, setViewerSetId] = useState<string>(primarySetId);
  const [viewerOpen, setViewerOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const drawRef = useRef<TerraDraw | null>(null);
  const drawingRef = useRef(false);
  const drawFinishedAtRef = useRef(0);
  const [drawing, setDrawing] = useState(false);
  const [overlapIds, setOverlapIds] = useState<string[] | null>(null);
  const [overlapOpen, setOverlapOpen] = useState(false);

  // -----------------------------------------------------------------------
  // Data fetching — one cached query per survey (images + strata + exclusions)
  // and one per annotation set. Adding/removing a survey or set therefore only
  // triggers the new query; everything else is served from the react-query
  // cache, which is exactly what we want when the user tweaks the selection.
  // -----------------------------------------------------------------------
  const surveyQueries = useQueries({
    queries: uniqueSurveyIds.map((sid) => surveyGeoQuery(client, sid)),
  });

  const annotationQueries = useQueries({
    queries: uniqueSetSources.map(({ surveyId: sid, annotationSetId: setId }) =>
      setAnnotationsQuery(client, sid, setId),
    ),
  });

  // Informational tags for every set on the map: used both to filter and to
  // show what a sighting was tagged with in its popup.
  const {
    namesFor: infoTagNamesFor,
    dataSig: infoTagSig,
    isLoading: infoTagsLoading,
  } = useInfoTagData(uniqueSetSources.map((s) => s.annotationSetId));

  const loading =
    surveyQueries.some((q) => q.isLoading) ||
    annotationQueries.some((q) => q.isLoading) ||
    infoTagsLoading;
  const fetching =
    surveyQueries.some((q) => q.isFetching) ||
    annotationQueries.some((q) => q.isFetching);

  // Signatures used to memoise the (expensive) GeoJSON builds: recompute only
  // when the underlying data actually changes, not on every render.
  const surveyDataSig = surveyQueries
    .map((q) => (q.data ? `${q.data.surveyId}:${q.data.images.length}` : ''))
    .join('|');
  const annotationDataSig = annotationQueries
    .map((q) =>
      q.data
        ? `${q.data.annotationSetId}:${q.data.annotations.length}:${q.dataUpdatedAt}`
        : '',
    )
    .join('|');

  // imageId -> { lat, lng, transectId, surveyId, timestamp }
  const imageById = useMemo(() => {
    const map = new Map<
      string,
      {
        lat: number;
        lng: number;
        transectId: string | null;
        surveyId: string;
        timestamp: number;
      }
    >();
    for (const q of surveyQueries) {
      if (!q.data) continue;
      for (const img of q.data.images) {
        if (img.latitude == null || img.longitude == null) continue;
        map.set(img.id, {
          lat: img.latitude,
          lng: img.longitude,
          transectId: img.transectId ?? null,
          surveyId: q.data.surveyId,
          timestamp: img.timestamp ?? 0,
        });
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyDataSig]);

  // Match the transect map's ~5m circle for images sharing coordinates.
  // Build before filtering so an image keeps its position as filters change.
  const adjustedPositions = useMemo(() => {
    const groups = new Map<string, string[]>();
    const positions = new Map<string, { lat: number; lng: number }>();
    for (const [id, img] of imageById) {
      const key = `${img.lat},${img.lng}`;
      const group = groups.get(key) ?? [];
      group.push(id);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      group.sort();
      group.forEach((id, index) => {
        const img = imageById.get(id)!;
        const angle = (2 * Math.PI * index) / group.length;
        const radius = group.length > 1 ? 0.00005 : 0;
        positions.set(id, {
          lat: img.lat + radius * Math.sin(angle),
          lng:
            img.lng +
            (radius * Math.cos(angle)) /
              Math.max(Math.cos((img.lat * Math.PI) / 180), 1e-6),
        });
      });
    }
    return positions;
  }, [imageById]);

  // Ordered list of image ids (by capture time) for in-modal navigation.
  const orderedImageIds = useMemo(
    () =>
      Array.from(imageById.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .map(([id]) => id),
    [imageById],
  );

  // Transects discovered in the images, numbered per survey in image-appearance
  // order (matching the image-layer colouring). Derived from *all* images so the
  // filter options stay stable regardless of the active transect selection.
  const transectInfo = useMemo(() => {
    const lookup = new Map<string, { number: number; color: string }>();
    const flat: {
      id: string;
      surveyId: string;
      number: number;
      color: string;
    }[] = [];
    for (const q of surveyQueries) {
      if (!q.data) continue;
      let next = 0;
      for (const img of q.data.images) {
        if (img.latitude == null || img.longitude == null) continue;
        const t = img.transectId;
        if (!t || lookup.has(t)) continue;
        const color = TRANSECT_COLORS[next % TRANSECT_COLORS.length];
        lookup.set(t, { number: next + 1, color });
        flat.push({
          id: t,
          surveyId: q.data.surveyId,
          number: next + 1,
          color,
        });
        next++;
      }
    }
    return { lookup, flat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyDataSig]);

  // Report the transect list upward so a parent can render a consistent filter.
  useEffect(() => {
    onTransectsLoaded?.(
      transectInfo.flat.map(({ id, surveyId: sid, number }) => ({
        id,
        surveyId: sid,
        number,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transectInfo]);

  // Extracted dependency keys (keeps the useMemo dep array statically checkable).
  const selectedUserKey = selectedUserIds.join(',');
  const categoryIdKey = categoryIds.join(',');
  const categoryNameKey = categoryNames.join(',');
  const transectKey = transectIds.join(',');
  const infoTagKey = infoTagNames.join(',');

  // Annotation points GeoJSON, joined to image coordinates and filtered.
  const annotationsFC = useMemo<FeatureCollection>(() => {
    const userIdSet = new Set(selectedUserIds);
    const catIdSet = new Set(categoryIds);
    const catNameSet = new Set(categoryNames);
    const transectIdSet = new Set(transectIds);
    const infoTagSet = new Set(infoTagNames);
    const hasCatFilter = catIdSet.size > 0 || catNameSet.size > 0;
    const features: GeoJSON.Feature[] = [];

    for (const q of annotationQueries) {
      if (!q.data) continue;
      for (const a of q.data.annotations) {
        if (
          primaryOnly &&
          !(
            a.id === a.objectId &&
            (!dropFalseNegatives ||
              !(a.source ?? '').includes('false-negative'))
          )
        ) {
          continue;
        }
        if (userIdSet.size) {
          const uid = extractUserIdFromOwner(a.owner);
          if (!uid || !userIdSet.has(uid)) continue;
        }
        if (!a.category || !a.imageId) continue;
        if (
          hasCatFilter &&
          !catIdSet.has(a.category.id) &&
          !catNameSet.has(a.category.name)
        ) {
          continue;
        }
        const img = imageById.get(a.imageId);
        if (!img) continue;
        if (
          transectIdSet.size &&
          (!img.transectId || !transectIdSet.has(img.transectId))
        ) {
          continue;
        }
        const tagNames = infoTagNamesFor(q.data.annotationSetId, a.id);
        if (infoTagSet.size && !tagNames.some((n) => infoTagSet.has(n))) {
          continue;
        }

        // Small deterministic jitter (~3m) so co-located sightings separate.
        const h = hashString(a.id);
        const position = adjustedPositions.get(a.imageId)!;
        const radius = 0.00003;
        const angle = ((h % 360) * Math.PI) / 180;
        const dLat = radius * Math.sin(angle);
        const dLng =
          (radius * Math.cos(angle)) /
          Math.max(Math.cos((img.lat * Math.PI) / 180), 1e-6);

        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [position.lng + dLng, position.lat + dLat],
          },
          properties: {
            id: a.id,
            imageId: a.imageId,
            setId: a.setId ?? q.data.annotationSetId,
            categoryName: a.category.name,
            x: a.x,
            y: a.y,
            infoTags: formatInfoTagsForDisplay(tagNames),
          },
        });
      }
    }
    return { type: 'FeatureCollection', features };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    annotationDataSig,
    imageById,
    adjustedPositions,
    primaryOnly,
    dropFalseNegatives,
    selectedUserKey,
    categoryIdKey,
    categoryNameKey,
    transectKey,
    infoTagKey,
    infoTagSig,
  ]);

  const imageMetaById = useMemo(
    () =>
      new Map(
        surveyQueries
          .flatMap((q) => q.data?.images ?? [])
          .map((i) => [i.id, i]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surveyDataSig],
  );
  const pointsBySetImage = useMemo(() => {
    const out = new Map<string, Point[]>();
    for (const q of annotationQueries) {
      if (!q.data) continue;
      for (const a of q.data.annotations) {
        if (!a.imageId || a.x == null || a.y == null) continue;
        const key = `${a.setId ?? q.data.annotationSetId}:${a.imageId}`;
        const points = out.get(key) ?? [];
        points.push({ x: a.x, y: a.y });
        out.set(key, points);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationDataSig]);

  const sightingCounts = useMemo(() => {
    const out = new Map<string, Map<string, Map<string, number>>>();
    for (const f of annotationsFC.features) {
      const { setId, imageId, categoryName } = f.properties as {
        setId: string;
        imageId: string;
        categoryName: string;
      };
      const images = out.get(setId) ?? new Map<string, Map<string, number>>();
      const counts = images.get(imageId) ?? new Map<string, number>();
      counts.set(categoryName, (counts.get(categoryName) ?? 0) + 1);
      images.set(imageId, counts);
      out.set(setId, images);
    }
    return out;
  }, [annotationsFC]);

  const reviewSetId = viewerSetId || primarySetId;
  const reviewIds = useMemo(() => {
    const ids = new Set(sightingCounts.get(reviewSetId)?.keys());
    if (viewerImageId) ids.add(viewerImageId);
    return [...ids].sort(
      (a, b) =>
        (imageById.get(a)?.timestamp ?? 0) - (imageById.get(b)?.timestamp ?? 0),
    );
  }, [sightingCounts, reviewSetId, viewerImageId, imageById]);
  const reviewLookup = useCallback(
    (id: string): StageSlot | null => {
      const image = imageMetaById.get(id);
      if (!image) return null;
      const colorOf = (name: string) =>
        projectCategories?.find(
          (c) => c.annotationSetId === reviewSetId && c.name === name,
        )?.color ?? '#adb5bd';
      const counts = sightingCounts.get(reviewSetId)?.get(id);
      return {
        image,
        points: pointsBySetImage.get(`${reviewSetId}:${id}`) ?? NO_POINTS,
        counts: [...(counts ?? [])]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({
            key: name,
            label: name,
            color: colorOf(name),
            count,
          })),
      };
    },
    [
      imageMetaById,
      pointsBySetImage,
      sightingCounts,
      reviewSetId,
      projectCategories,
    ],
  );

  // Image points GeoJSON, coloured by transect (per survey) and transect-filtered.
  const imagesFC = useMemo<FeatureCollection>(() => {
    const transectIdSet = new Set(transectIds);
    const features: GeoJSON.Feature[] = [];
    for (const q of surveyQueries) {
      if (!q.data) continue;
      for (const img of q.data.images) {
        if (img.latitude == null || img.longitude == null) continue;
        const t = img.transectId;
        if (transectIdSet.size && (!t || !transectIdSet.has(t))) continue;
        const info = t ? transectInfo.lookup.get(t) : undefined;
        const position = adjustedPositions.get(img.id)!;
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [position.lng, position.lat],
          },
          properties: {
            imageId: img.id,
            latitude: img.latitude,
            longitude: img.longitude,
            color: info?.color ?? '#999999',
            transect: info?.number ?? 0,
          },
        });
      }
    }
    return { type: 'FeatureCollection', features };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyDataSig, adjustedPositions, transectInfo, transectKey]);

  const strataFC = useMemo<FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];
    for (const q of surveyQueries) {
      if (!q.data) continue;
      for (const s of q.data.strata) {
        const ring = coordsToRing(s.coordinates);
        if (!ring) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: {
            id: s.id,
            name: s.name ?? 'Stratum',
            color: strataColors[features.length % strataColors.length],
          },
        });
      }
    }
    return { type: 'FeatureCollection', features };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyDataSig]);

  // Labels sit at a point guaranteed to be inside each (possibly concave) stratum.
  const strataLabelsFC = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: strataFC.features.map((f) => ({
        ...pointOnFeature(f),
        properties: f.properties,
      })),
    }),
    [strataFC],
  );

  const exclusionsFC = useMemo<FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];
    for (const q of surveyQueries) {
      if (!q.data) continue;
      for (const e of q.data.exclusions) {
        const ring = coordsToRing(e.coordinates);
        if (!ring) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: {},
        });
      }
    }
    return { type: 'FeatureCollection', features };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyDataSig]);

  // -----------------------------------------------------------------------
  // Refs so the (one-time) map event handlers always read current values.
  // -----------------------------------------------------------------------
  const openViewer = (imageId: string, setId?: string) => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    setViewerImageId(imageId);
    setViewerSetId(setId || primarySetId);
    setViewerOpen(true);
  };
  const openViewerRef = useRef(openViewer);
  openViewerRef.current = openViewer;
  const closeViewer = useCallback(() => setViewerOpen(false), []);

  const stageViewer = (imageId: string, setId: string) => {
    if (!editable || viewerOpen) return;
    setViewerImageId(imageId);
    setViewerSetId(setId || primarySetId);
  };
  const stageViewerRef = useRef(stageViewer);
  stageViewerRef.current = stageViewer;

  const warmViewer = (imageId: string, setId: string) => {
    const image = imageMetaById.get(imageId);
    if (!editable || !image) return undefined;
    const stage = stageRef.current;
    const controller = new AbortController();
    warmImage(
      client,
      image,
      pointsBySetImage.get(`${setId || primarySetId}:${imageId}`) ?? [],
      controller.signal,
      stage?.clientWidth
        ? { width: stage.clientWidth, height: stage.clientHeight }
        : undefined,
    );
    return () => controller.abort();
  };
  const warmViewerRef = useRef(warmViewer);
  warmViewerRef.current = warmViewer;

  const stopDraw = () => {
    try {
      drawRef.current?.clear();
      drawRef.current?.stop();
    } catch {
      /* map torn down */
    }
    drawingRef.current = false;
    setDrawing(false);
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = '';
  };
  const stopDrawRef = useRef(stopDraw);
  stopDrawRef.current = stopDraw;

  const startDraw = () => {
    const draw = drawRef.current;
    if (!draw) return;
    draw.start();
    draw.setMode('polygon');
    drawingRef.current = true;
    setDrawing(true);
    mapRef.current!.getCanvas().style.cursor = 'crosshair';
  };

  const lasso = (polygon: GeoJSON.Feature<GeoJSON.Polygon>) => {
    const ids = imagesFC.features
      .filter((f) =>
        booleanPointInPolygon(
          (f.geometry as GeoJSON.Point).coordinates,
          polygon,
        ),
      )
      .map((f) => f.properties!.imageId as string);
    if (!ids.length) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    setOverlapIds(ids);
    setOverlapOpen(true);
  };
  const lassoRef = useRef(lasso);
  lassoRef.current = lasso;

  useEffect(() => {
    if (!drawing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopDrawRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing]);

  const overlapImages = useMemo<OverlapImage[]>(
    () =>
      (overlapIds ?? []).flatMap((id) => {
        const meta = imageMetaById.get(id);
        const place = imageById.get(id);
        if (!meta?.width || !meta.height || !place) return [];
        return [
          {
            id,
            cameraId: meta.cameraId ?? null,
            transectId: place.transectId,
            lat: place.lat,
            lng: place.lng,
            timestamp: place.timestamp,
            width: meta.width,
            height: meta.height,
            originalPath: meta.originalPath,
            boundaryStatus: meta.boundaryStatus,
          },
        ];
      }),
    [overlapIds, imageMetaById, imageById],
  );
  const overlapSightings = useMemo(() => {
    const out = new Map<string, SightingDot[]>();
    if (!overlapOpen) return out;
    for (const f of annotationsFC.features) {
      const p = f.properties as {
        imageId: string;
        setId: string;
        categoryName: string;
        x: number | null;
        y: number | null;
      };
      if (p.x == null || p.y == null) continue;
      const dots = out.get(p.imageId) ?? [];
      dots.push({
        x: p.x,
        y: p.y,
        label: p.categoryName,
        color:
          projectCategories?.find(
            (c) => c.annotationSetId === p.setId && c.name === p.categoryName,
          )?.color ?? '#ff8c00',
      });
      out.set(p.imageId, dots);
    }
    return out;
  }, [overlapOpen, annotationsFC, projectCategories]);
  const closeOverlap = useCallback(() => setOverlapOpen(false), []);

  const [mapHoveredStratumId, setMapHoveredStratumId] = useState<string | null>(
    null,
  );
  const onStratumHoverRef = useRef(onStratumHover);
  onStratumHoverRef.current = onStratumHover;

  // -----------------------------------------------------------------------
  // Map initialisation (once)
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const container = mapContainerRef.current;
    const map = new maplibregl.Map({
      container,
      style: BASE_STYLE,
      center: [0, 0],
      zoom: 1,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    // MapLibre does not automatically detect every flex/grid size change.
    // Keep its canvas in sync with the responsive container.
    const resizeObserver = new ResizeObserver(() => {
      map.resize();
      if (container.clientWidth) fitPendingRef.current();
    });
    resizeObserver.observe(container);

    map.addControl(
      new maplibregl.ScaleControl({ unit: 'metric' }),
      'bottom-left',
    );

    map.on('load', () => {
      // Sources (start empty; data is pushed via setData below).
      map.addSource(SRC_ANNOTATIONS, {
        type: 'geojson',
        data: EMPTY_FC,
        cluster: true,
        clusterMaxZoom: 16,
        clusterRadius: 50,
      });
      map.addSource(SRC_HEAT, { type: 'geojson', data: EMPTY_FC });
      map.addSource(SRC_IMAGES, { type: 'geojson', data: EMPTY_FC });
      map.addSource(SRC_STRATA, {
        type: 'geojson',
        data: EMPTY_FC,
        promoteId: 'id',
      });
      map.addSource(SRC_STRATA_LABELS, { type: 'geojson', data: EMPTY_FC });
      map.addSource(SRC_EXCLUSIONS, { type: 'geojson', data: EMPTY_FC });

      // Polygons (drawn underneath the points).
      map.addLayer({
        id: LYR_EXCLUSIONS_FILL,
        type: 'fill',
        source: SRC_EXCLUSIONS,
        paint: { 'fill-color': '#ff0000', 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: LYR_EXCLUSIONS_LINE,
        type: 'line',
        source: SRC_EXCLUSIONS,
        paint: { 'line-color': '#ff0000', 'line-width': 2 },
      });
      const strataHovered: ExpressionSpecification = [
        'boolean',
        ['feature-state', 'hover'],
        false,
      ];
      map.addLayer({
        id: LYR_STRATA_FILL,
        type: 'fill',
        source: SRC_STRATA,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', strataHovered, 0.25, 0.1],
        },
      });
      map.addLayer({
        id: LYR_STRATA_LINE,
        type: 'line',
        source: SRC_STRATA,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', strataHovered, 3, 1.5],
        },
      });

      // Image markers, coloured by transect.
      map.addLayer({
        id: LYR_IMAGES,
        type: 'circle',
        source: SRC_IMAGES,
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': 4,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.8,
        },
      });

      map.addLayer({
        id: LYR_HEATMAP,
        type: 'heatmap',
        source: SRC_HEAT,
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-color': HEAT_COLOR_RAMP,
          'heatmap-opacity': 0.8,
        },
      });

      // Clusters
      map.addLayer({
        id: LYR_CLUSTERS,
        type: 'circle',
        source: SRC_ANNOTATIONS,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#ff8c00',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            15,
            100,
            20,
            750,
            25,
          ],
          'circle-opacity': 0.9,
        },
      });
      map.addLayer({
        id: LYR_CLUSTER_COUNT,
        type: 'symbol',
        source: SRC_ANNOTATIONS,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 12,
          'text-font': ['Open Sans Semibold'],
        },
        paint: { 'text-color': '#ffffff' },
      });
      // Individual sightings
      map.addLayer({
        id: LYR_POINTS,
        type: 'circle',
        source: SRC_ANNOTATIONS,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#ff8c00',
          'circle-radius': 5,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      });

      // Above the sightings so names stay readable.
      map.addLayer({
        id: LYR_STRATA_LABEL,
        type: 'symbol',
        source: SRC_STRATA_LABELS,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 13,
          'text-font': ['Open Sans Regular'],
        },
        paint: {
          'text-color': '#212529',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
        },
      });

      // ---- Interactions -------------------------------------------------
      // Click a cluster -> zoom to its expansion.
      const clickCluster = (feature: maplibregl.MapGeoJSONFeature) => {
        const clusterId = feature.properties?.cluster_id;
        const src = map.getSource(SRC_ANNOTATIONS) as maplibregl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({
            center: (feature.geometry as GeoJSON.Point).coordinates as [
              number,
              number,
            ],
            zoom,
          });
        });
      };

      const pointPopup = (
        coordinates: [number, number],
        title: string,
        rows: string,
        imageId: string,
        setId: string,
      ) => {
        const node = document.createElement('div');
        node.innerHTML = `<div style="min-width:160px;color:#000">
            <div style="font-weight:600;margin-bottom:4px">${title}</div>
            ${rows}
            <button type="button">View Image</button>
          </div>`;
        const btn = node.querySelector('button');
        if (btn) {
          btn.className = buttonVariants({
            variant: 'primary',
            size: 'sm',
            className: 'mt-2',
          });
          btn.addEventListener('click', () =>
            openViewerRef.current(imageId, setId),
          );
        }
        const stopWarming = warmViewerRef.current(imageId, setId);
        stageViewerRef.current(imageId, setId);
        const popup = new maplibregl.Popup({ closeButton: true })
          .setLngLat(coordinates)
          .setDOMContent(node)
          .addTo(map);
        popup.on('close', () => stopWarming?.());
      };

      const clickPoint = (f: maplibregl.MapGeoJSONFeature) => {
        const p = f.properties;
        const name = uniqueNamesGenerator({
          dictionaries: [adjectives, names],
          seed: p.id,
          style: 'capital',
          separator: ' ',
        });
        pointPopup(
          (f.geometry as GeoJSON.Point).coordinates.slice() as [number, number],
          name,
          `<div><strong>Label:</strong> ${escapeHtml(p.categoryName ?? '')}</div>` +
            (p.infoTags
              ? `<div><strong>Info tags:</strong> ${escapeHtml(p.infoTags)}</div>`
              : ''),
          p.imageId,
          p.setId,
        );
      };

      const clickImage = (f: maplibregl.MapGeoJSONFeature) => {
        const p = f.properties;
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        pointPopup(
          [lng, lat],
          `Transect ${p.transect}`,
          `<div><strong>Coordinates:</strong> ${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}</div>`,
          p.imageId,
          '',
        );
      };

      const clickStratum = (
        f: maplibregl.MapGeoJSONFeature,
        lngLat: maplibregl.LngLat,
      ) => {
        new maplibregl.Popup()
          .setLngLat(lngLat)
          .setHTML(
            `<div style="color:#000"><strong>Stratum:</strong> ${
              f.properties?.name ?? ''
            }</div>`,
          )
          .addTo(map);
      };

      // Overlapping layers share one click: only the topmost kind responds.
      const topFeature = (point: maplibregl.Point, layers: string[]) => {
        const present = layers.filter((id) => map.getLayer(id));
        const hits = map.queryRenderedFeatures(point, { layers: present });
        for (const id of present) {
          const hit = hits.find((f) => f.layer.id === id);
          if (hit) return hit;
        }
        return undefined;
      };
      map.on('click', (e) => {
        if (drawingRef.current) return;
        // The click that closes the lasso arrives after 'finish'.
        if (performance.now() - drawFinishedAtRef.current < 500) return;
        const f = topFeature(e.point, [
          LYR_CLUSTERS,
          LYR_POINTS,
          LYR_IMAGES,
          LYR_STRATA_LINE,
        ]);
        if (!f) return;
        if (f.layer.id === LYR_CLUSTERS) clickCluster(f);
        else if (f.layer.id === LYR_POINTS) clickPoint(f);
        else if (f.layer.id === LYR_IMAGES) clickImage(f);
        else clickStratum(f, e.lngLat);
      });

      const hoverStratum = (id: string | null) => {
        setMapHoveredStratumId(id);
        onStratumHoverRef.current?.(id);
      };
      map.on('mousemove', LYR_STRATA_FILL, (e) => {
        hoverStratum(e.features?.[0]?.properties?.id ?? null);
      });
      map.on('mouseleave', LYR_STRATA_FILL, () => hoverStratum(null));

      // Prefetch only once the pointer rests on a point, not as it sweeps past.
      let hoverKey = '';
      let hoverTimer: ReturnType<typeof setTimeout> | undefined;
      let stopHoverWarm: (() => void) | undefined;
      const endHover = () => {
        clearTimeout(hoverTimer);
        stopHoverWarm?.();
        stopHoverWarm = undefined;
        hoverKey = '';
      };
      map.on('mousemove', (e) => {
        if (drawingRef.current) return;
        const p = topFeature(e.point, [LYR_POINTS, LYR_IMAGES])?.properties;
        if (!p?.imageId) {
          if (hoverKey) endHover();
          return;
        }
        const setId: string = p.setId ?? '';
        const key = `${setId}:${p.imageId}`;
        if (key === hoverKey) return;
        endHover();
        hoverKey = key;
        hoverTimer = setTimeout(() => {
          stopHoverWarm = warmViewerRef.current(p.imageId, setId);
        }, HOVER_INTENT_MS);
      });
      map.on('mouseout', endHover);

      for (const lyr of [
        LYR_CLUSTERS,
        LYR_POINTS,
        LYR_IMAGES,
        LYR_STRATA_LINE,
      ]) {
        map.on('mouseenter', lyr, () => {
          if (!drawingRef.current) map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', lyr, () => {
          if (!drawingRef.current) map.getCanvas().style.cursor = '';
        });
      }

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawPolygonMode({ pointerDistance: 12 })],
      });
      draw.on('finish', (id) => {
        const feature = draw.getSnapshot().find((f) => f.id === id);
        if (feature?.geometry.type === 'Polygon') {
          lassoRef.current(feature as GeoJSON.Feature<GeoJSON.Polygon>);
        }
        stopDrawRef.current();
        drawFinishedAtRef.current = performance.now();
      });
      drawRef.current = draw;

      setMapLoaded(true);
    });

    return () => {
      resizeObserver.disconnect();
      setMapLoaded(false);
      try {
        drawRef.current?.stop();
      } catch {
        /* map torn down */
      }
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // -----------------------------------------------------------------------
  // Push data into the sources whenever it changes.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_ANNOTATIONS) as maplibregl.GeoJSONSource
    )?.setData(annotationsFC);
  }, [mapLoaded, annotationsFC]);

  const heatPoints = useMemo(
    () =>
      annotationsFC.features
        .map(
          (f) => (f.geometry as GeoJSON.Point).coordinates as [number, number],
        )
        .filter((c) => isValidLatLng(c[1], c[0])),
    [annotationsFC],
  );
  const heatScale = useMemo(() => {
    if (!showHeatmap || heatPoints.length === 0) return null;
    const latitude =
      heatPoints.reduce((sum, [, lat]) => sum + lat, 0) / heatPoints.length;
    return {
      radius: heatRadiusExpression(heatRadiusKm, latitude),
      intensity: heatIntensity(heatPoints, heatRadiusKm),
    };
  }, [showHeatmap, heatPoints, heatRadiusKm]);

  useEffect(() => {
    if (!mapLoaded) return;
    (mapRef.current?.getSource(SRC_HEAT) as maplibregl.GeoJSONSource)?.setData(
      heatCells(heatPoints, heatRadiusKm),
    );
  }, [mapLoaded, heatPoints, heatRadiusKm]);

  useEffect(() => {
    if (!mapLoaded || !heatScale) return;
    const map = mapRef.current!;
    map.setPaintProperty(LYR_HEATMAP, 'heatmap-radius', heatScale.radius);
    map.setPaintProperty(LYR_HEATMAP, 'heatmap-intensity', heatScale.intensity);
  }, [mapLoaded, heatScale]);

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_IMAGES) as maplibregl.GeoJSONSource
    )?.setData(imagesFC);
  }, [mapLoaded, imagesFC]);

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_STRATA) as maplibregl.GeoJSONSource
    )?.setData(strataFC);
    (
      mapRef.current?.getSource(SRC_STRATA_LABELS) as maplibregl.GeoJSONSource
    )?.setData(strataLabelsFC);
  }, [mapLoaded, strataFC, strataLabelsFC]);

  const activeStratumId = mapHoveredStratumId ?? highlightedStratumId;
  useEffect(() => {
    if (!mapLoaded || !activeStratumId) return;
    const map = mapRef.current!;
    const target = { source: SRC_STRATA, id: activeStratumId };
    map.setFeatureState(target, { hover: true });
    return () => {
      if (mapRef.current === map) map.setFeatureState(target, { hover: false });
    };
  }, [mapLoaded, activeStratumId, strataFC]);

  useEffect(() => {
    if (!mapLoaded) return;
    (
      mapRef.current?.getSource(SRC_EXCLUSIONS) as maplibregl.GeoJSONSource
    )?.setData(exclusionsFC);
  }, [mapLoaded, exclusionsFC]);

  // -----------------------------------------------------------------------
  // Layer visibility toggles.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current!;
    const set = (id: string, visible: boolean) =>
      map.getLayer(id) &&
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    set(LYR_CLUSTERS, showClusters);
    set(LYR_CLUSTER_COUNT, showClusters);
    set(LYR_POINTS, showClusters);
    set(LYR_HEATMAP, showHeatmap);
    set(LYR_IMAGES, showImages);
    set(LYR_STRATA_FILL, showStrata);
    set(LYR_STRATA_LINE, showStrata);
    set(LYR_STRATA_LABEL, showStrata);
    set(LYR_EXCLUSIONS_FILL, showStrata);
    set(LYR_EXCLUSIONS_LINE, showStrata);
  }, [mapLoaded, showClusters, showHeatmap, showImages, showStrata]);

  // -----------------------------------------------------------------------
  // Fit bounds to the data whenever the displayed extent changes.
  // -----------------------------------------------------------------------
  const boundsKey = useMemo(() => {
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    const consume = (fc: FeatureCollection) => {
      for (const f of fc.features) {
        if (f.geometry.type !== 'Point') continue;
        const [lng, lat] = f.geometry.coordinates;
        if (!isValidLatLng(lat, lng)) continue;
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    };
    consume(imagesFC.features.length ? imagesFC : annotationsFC);
    if (minLng === Infinity) return null;
    return [minLng, minLat, maxLng, maxLat] as [number, number, number, number];
  }, [imagesFC, annotationsFC]);

  const fitAll = useCallback(
    (duration = 300) => {
      if (!boundsKey) return;
      mapRef.current?.fitBounds(
        [
          [boundsKey[0], boundsKey[1]],
          [boundsKey[2], boundsKey[3]],
        ],
        { padding: 40, maxZoom: 16, duration },
      );
    },
    [boundsKey],
  );

  const lastFitRef = useRef<string>('');
  useEffect(() => {
    if (!mapLoaded || !boundsKey) return;
    const key = boundsKey.join(',');
    if (key === lastFitRef.current) return;
    // A hidden tab has no size to fit to; the resize observer fits once shown.
    if (!mapContainerRef.current?.clientWidth) return;
    lastFitRef.current = key;
    fitAll(0);
  }, [mapLoaded, boundsKey, fitAll]);
  const fitPendingRef = useRef(() => {});
  fitPendingRef.current = () => {
    if (!boundsKey || boundsKey.join(',') === lastFitRef.current) return;
    lastFitRef.current = boundsKey.join(',');
    fitAll(0);
  };

  const frameRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen?.();
  };

  return (
    <div
      ref={frameRef}
      className={cn('survey-map h-full', fullscreen && 'rounded-none border-0')}
      style={{ minHeight: 0 }}
    >
      {/* Inline: maplibre's unlayered CSS overrides layered utilities here. */}
      <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0 }} />

      <div
        className={cn('absolute top-3 left-3 z-10 flex flex-col', MAP_CONTROLS)}
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
        <MapButton label='Zoom out' onClick={() => mapRef.current?.zoomOut()}>
          <MinusIcon className='size-4' />
        </MapButton>
        <MapButton
          label='Fit to sightings'
          disabled={!boundsKey}
          onClick={() => fitAll()}
        >
          <ScanIcon className='size-4' />
        </MapButton>
      </div>

      <div
        className={cn(
          'absolute top-3 right-3 z-10 flex min-w-36 flex-col gap-1 px-3 py-2 text-sm text-[#212529]',
          MAP_CONTROLS,
        )}
        style={LIGHT_THEME}
      >
        <span className='text-[11px] font-semibold tracking-wider text-[#6c757d] uppercase'>
          Layers
        </span>
        <LayerCheck
          id='dm-clusters'
          label='Sightings'
          checked={showClusters}
          onChange={setShowClusters}
        />
        <LayerCheck
          id='dm-heatmap'
          label='Heatmap'
          checked={showHeatmap}
          onChange={setShowHeatmap}
        />
        {showHeatmap && (
          <div className='mb-1 ml-6 text-xs'>
            <label htmlFor='dm-heat-radius' className='block text-[#6c757d]'>
              Radius: {heatRadiusKm} km
            </label>
            <input
              type='range'
              className='w-full accent-primary'
              id='dm-heat-radius'
              min={1}
              max={15}
              step={1}
              value={heatRadiusKm}
              onChange={(e) => setHeatRadiusKm(Number(e.target.value))}
            />
          </div>
        )}
        <LayerCheck
          id='dm-images'
          label='Images'
          checked={showImages}
          onChange={setShowImages}
        />
        <LayerCheck
          id='dm-strata'
          label='Strata'
          checked={showStrata}
          onChange={setShowStrata}
        />
      </div>

      {canReviewOverlap && (
        <div
          className={cn(
            'absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2',
            MAP_CONTROLS,
          )}
        >
          <MapButton
            tipSide='top'
            label='Draw around images to review overlapping transects'
            active={drawing}
            disabled={!mapLoaded || loading}
            onClick={drawing ? stopDraw : startDraw}
          >
            <LassoIcon className='size-4' />
          </MapButton>
        </div>
      )}
      {drawing && (
        <div
          className={cn(
            'absolute bottom-16 left-1/2 z-10 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 border border-black/10 px-3 py-1.5 text-xs text-[#212529]',
            MAP_CONTROLS,
          )}
        >
          Click to draw around the images to review · click the first point to
          finish
          <Kbd>Esc cancel</Kbd>
        </div>
      )}

      {/* Partial data would give a misleading map. */}
      {(loading || !mapLoaded) && (
        <div className='absolute inset-0 z-30 flex items-center justify-center bg-black/20'>
          <div
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm text-[#212529]',
              MAP_CONTROLS,
            )}
          >
            <Spinner size='sm' />
            Loading map data...
          </div>
        </div>
      )}
      {!loading && mapLoaded && fetching && (
        <div
          className={cn(
            'absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 px-3 py-1.5 text-xs text-[#212529]',
            MAP_CONTROLS,
          )}
        >
          <Spinner size='sm' />
          Updating...
        </div>
      )}

      {!loading && effectiveSources.length === 0 && (
        <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
          <div className={cn('px-4 py-3 text-sm text-[#212529]', MAP_CONTROLS)}>
            Select an annotation set to begin.
          </div>
        </div>
      )}

      {canReviewOverlap && (
        <OverlapReviewModal
          show={overlapOpen}
          onClose={closeOverlap}
          surveyIds={uniqueSurveyIds}
          images={overlapImages}
          transects={transectInfo.lookup}
          sightings={overlapSightings}
          annotationSetId={primarySetId}
        />
      )}

      {editable ? (
        <ReviewImageModal
          show={viewerOpen}
          onClose={closeViewer}
          stageRef={stageRef}
        >
          {viewerImageId && (
            <ReviewImageStage
              ids={reviewIds}
              currentId={viewerImageId}
              lookup={reviewLookup}
              annotationSetId={reviewSetId}
              visible={viewerOpen}
              buffer={viewerOpen}
              onStep={(delta) => {
                const next =
                  reviewIds[reviewIds.indexOf(viewerImageId) + delta];
                if (next) openViewer(next, reviewSetId);
              }}
            />
          )}
        </ReviewImageModal>
      ) : (
        <ImageViewerModal
          show={viewerOpen}
          onClose={closeViewer}
          imageId={viewerImageId}
          imageIds={orderedImageIds}
          annotationSetId={viewerSetId || primarySetId}
          onNavigate={(id) => openViewer(id, viewerSetId)}
          categoryIds={categoryIds}
        />
      )}
    </div>
  );
}

function LayerCheck({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className='flex items-center gap-2'>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <Label htmlFor={id} className='mb-0'>
        {label}
      </Label>
    </div>
  );
}
