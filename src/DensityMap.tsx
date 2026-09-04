import { useState, useEffect, useRef, useMemo } from 'react';
import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQueries } from '@tanstack/react-query';
import { fetchAllPaginatedResults } from './utils';
import { client } from './stores/appClient';
import ImageViewerModal from './ImageViewerModal';
import AnnotationViewerModal from './AnnotationViewerModal';
import {
  uniqueNamesGenerator,
  adjectives,
  names,
} from 'unique-names-generator';
import { Spinner, Form } from 'react-bootstrap';
import { useInfoTagData } from './useInfoTags';
import { formatInfoTagsForDisplay } from './infoTags';

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
    transects: { id: string; surveyId: string; number: number }[]
  ) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SRC_ANNOTATIONS = 'annotations';
const SRC_IMAGES = 'images';
const SRC_STRATA = 'strata';
const SRC_EXCLUSIONS = 'exclusions';

const LYR_HEATMAP = 'annotations-heat';
const LYR_CLUSTERS = 'annotations-clusters';
const LYR_CLUSTER_COUNT = 'annotations-cluster-count';
const LYR_POINTS = 'annotations-points';
const LYR_IMAGES = 'images-points';
const LYR_STRATA_LINE = 'strata-line';
const LYR_EXCLUSIONS_FILL = 'exclusions-fill';
const LYR_EXCLUSIONS_LINE = 'exclusions-line';

const TRANSECT_COLORS = [
  '#FF5733', '#33FF57', '#3357FF', '#F333FF', '#33FFF8',
  '#FFA833', '#8B33FF', '#FF3380', '#33FF8B', '#FFD133',
];

// OpenStreetMap raster basemap. Glyphs are needed for the cluster-count labels
// and reuse the same endpoint as the rest of the app's MapLibre views.
const BASE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      // OSM only serves tiles up to z19; beyond that MapLibre overzooms
      // (upscales the z19 tile) instead of requesting non-existent tiles,
      // which would 400 and surface as a (header-less) CORS error.
      maxzoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

type FeatureCollection = {
  type: 'FeatureCollection';
  features: any[];
};

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

// If contains "::", the userId is the part before it; otherwise the whole field.
function extractUserIdFromOwner(
  owner: string | null | undefined
): string | null {
  if (!owner) return null;
  return owner.includes('::') ? owner.split('::')[0] : owner;
}

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
      })[character]!
  );
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !isNaN(lat) && !isNaN(lng)
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
}: DensityMapProps) {
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
    [effectiveSources]
  );
  const uniqueSetSources = useMemo(() => {
    const seen = new Map<string, DensitySource>();
    for (const s of effectiveSources) seen.set(s.annotationSetId, s);
    return Array.from(seen.values()).sort((a, b) =>
      a.annotationSetId.localeCompare(b.annotationSetId)
    );
  }, [effectiveSources]);

  // Layer visibility
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showClusters, setShowClusters] = useState(true);
  const [showImages, setShowImages] = useState(false);
  const [showStrata, setShowStrata] = useState(true);

  // Viewer modal state
  const [viewerImageId, setViewerImageId] = useState<string | null>(null);
  const [viewerSetId, setViewerSetId] = useState<string>(primarySetId);
  const [viewerOpen, setViewerOpen] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // -----------------------------------------------------------------------
  // Data fetching — one cached query per survey (images + strata + exclusions)
  // and one per annotation set. Adding/removing a survey or set therefore only
  // triggers the new query; everything else is served from the react-query
  // cache, which is exactly what we want when the user tweaks the selection.
  // -----------------------------------------------------------------------
  const surveyQueries = useQueries({
    queries: uniqueSurveyIds.map((sid) => ({
      queryKey: ['densitymap', 'survey-geo', sid],
      staleTime: 30 * 60 * 1000,
      queryFn: async () => {
        const [images, strata, exclusions] = await Promise.all([
          fetchAllPaginatedResults(client.models.Image.imagesByProjectId, {
            projectId: sid,
            limit: 10000,
            selectionSet: ['id', 'latitude', 'longitude', 'transectId', 'timestamp'],
          }),
          fetchAllPaginatedResults(client.models.Stratum.strataByProjectId, {
            projectId: sid,
            limit: 10000,
            selectionSet: ['id', 'name', 'coordinates'],
          }),
          fetchAllPaginatedResults(
            client.models.ShapefileExclusions.shapefileExclusionsByProjectId,
            {
              projectId: sid,
              limit: 10000,
              selectionSet: ['id', 'coordinates'],
            }
          ),
        ]);
        return { surveyId: sid, images, strata, exclusions };
      },
    })),
  });

  const annotationQueries = useQueries({
    queries: uniqueSetSources.map(({ surveyId: sid, annotationSetId: setId }) => ({
      queryKey: ['densitymap', 'annotations', setId],
      staleTime: 30 * 60 * 1000,
      queryFn: async () => {
        const annotations = await fetchAllPaginatedResults(
          client.models.Annotation.annotationsByAnnotationSetId,
          {
            setId,
            limit: 10000,
            selectionSet: [
              'id',
              'imageId',
              'setId',
              'category.name',
              'category.id',
              'objectId',
              'source',
              'owner',
            ],
          } as any
        );
        return { surveyId: sid, annotationSetId: setId, annotations };
      },
    })),
  });

  // Informational tags for every set on the map: used both to filter and to
  // show what a sighting was tagged with in its popup.
  const { namesFor: infoTagNamesFor, dataSig: infoTagSig } = useInfoTagData(
    uniqueSetSources.map((s) => s.annotationSetId)
  );

  const loading =
    surveyQueries.some((q) => q.isLoading) ||
    annotationQueries.some((q) => q.isLoading);
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
      q.data ? `${q.data.annotationSetId}:${q.data.annotations.length}` : ''
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
      for (const img of q.data.images as any[]) {
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

  // Ordered list of image ids (by capture time) for in-modal navigation.
  const orderedImageIds = useMemo(
    () =>
      Array.from(imageById.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .map(([id]) => id),
    [imageById]
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
      for (const img of q.data.images as any[]) {
        if (img.latitude == null || img.longitude == null) continue;
        const t = img.transectId;
        if (!t || lookup.has(t)) continue;
        const color = TRANSECT_COLORS[next % TRANSECT_COLORS.length];
        lookup.set(t, { number: next + 1, color });
        flat.push({ id: t, surveyId: q.data.surveyId, number: next + 1, color });
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
      }))
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
    const features: any[] = [];

    for (const q of annotationQueries) {
      if (!q.data) continue;
      for (const a of q.data.annotations as any[]) {
        if (
          primaryOnly &&
          !(
            a.id === a.objectId &&
            (!dropFalseNegatives || !(a.source ?? '').includes('false-negative'))
          )
        ) {
          continue;
        }
        if (userIdSet.size) {
          const uid = extractUserIdFromOwner(a.owner);
          if (!uid || !userIdSet.has(uid)) continue;
        }
        if (!a.category) continue;
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
            coordinates: [img.lng + dLng, img.lat + dLat],
          },
          properties: {
            id: a.id,
            imageId: a.imageId,
            setId: a.setId ?? q.data.annotationSetId,
            categoryName: a.category.name,
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
    primaryOnly,
    dropFalseNegatives,
    selectedUserKey,
    categoryIdKey,
    categoryNameKey,
    transectKey,
    infoTagKey,
    infoTagSig,
  ]);

  // Image points GeoJSON, coloured by transect (per survey) and transect-filtered.
  const imagesFC = useMemo<FeatureCollection>(() => {
    const transectIdSet = new Set(transectIds);
    const features: any[] = [];
    for (const q of surveyQueries) {
      if (!q.data) continue;
      for (const img of q.data.images as any[]) {
        if (img.latitude == null || img.longitude == null) continue;
        const t = img.transectId;
        if (transectIdSet.size && (!t || !transectIdSet.has(t))) continue;
        const info = t ? transectInfo.lookup.get(t) : undefined;
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [img.longitude, img.latitude],
          },
          properties: {
            imageId: img.id,
            color: info?.color ?? '#999999',
            transect: info?.number ?? 0,
          },
        });
      }
    }
    return { type: 'FeatureCollection', features };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyDataSig, transectInfo, transectKey]);

  const strataFC = useMemo<FeatureCollection>(() => {
    const features: any[] = [];
    for (const q of surveyQueries) {
      if (!q.data) continue;
      for (const s of q.data.strata as any[]) {
        const ring = coordsToRing(s.coordinates);
        if (!ring) continue;
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: { name: s.name ?? 'Stratum' },
        });
      }
    }
    return { type: 'FeatureCollection', features };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyDataSig]);

  const exclusionsFC = useMemo<FeatureCollection>(() => {
    const features: any[] = [];
    for (const q of surveyQueries) {
      if (!q.data) continue;
      for (const e of q.data.exclusions as any[]) {
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
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      // Sources (start empty; data is pushed via setData below).
      map.addSource(SRC_ANNOTATIONS, {
        type: 'geojson',
        data: EMPTY_FC as any,
        cluster: true,
        clusterMaxZoom: 16,
        clusterRadius: 50,
      });
      map.addSource(SRC_IMAGES, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_STRATA, { type: 'geojson', data: EMPTY_FC as any });
      map.addSource(SRC_EXCLUSIONS, { type: 'geojson', data: EMPTY_FC as any });

      // Polygons (drawn underneath the points).
      map.addLayer({
        id: LYR_EXCLUSIONS_FILL,
        type: 'fill',
        source: SRC_EXCLUSIONS,
        paint: { 'fill-color': '#FF0000', 'fill-opacity': 0.3 },
      });
      map.addLayer({
        id: LYR_EXCLUSIONS_LINE,
        type: 'line',
        source: SRC_EXCLUSIONS,
        paint: { 'line-color': '#FF0000', 'line-width': 2 },
      });
      map.addLayer({
        id: LYR_STRATA_LINE,
        type: 'line',
        source: SRC_STRATA,
        paint: { 'line-color': '#3357FF', 'line-width': 2 },
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

      // Heatmap (reads the clustered source; weight by cluster size).
      map.addLayer({
        id: LYR_HEATMAP,
        type: 'heatmap',
        source: SRC_ANNOTATIONS,
        layout: { visibility: 'none' },
        paint: {
          'heatmap-weight': [
            'case',
            ['has', 'point_count'],
            ['min', ['/', ['get', 'point_count'], 50], 5],
            1,
          ],
          'heatmap-radius': 20,
          'heatmap-opacity': 0.7,
        },
      });

      // Clusters
      map.addLayer({
        id: LYR_CLUSTERS,
        type: 'circle',
        source: SRC_ANNOTATIONS,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#51bbd6', 100, '#f1f075', 750, '#f28cb1',
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            15, 100, 20, 750, 25,
          ],
          'circle-opacity': 0.85,
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
        },
        paint: { 'text-color': '#000000' },
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

      // ---- Interactions -------------------------------------------------
      // Click a cluster -> zoom to its expansion.
      map.on('click', LYR_CLUSTERS, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const clusterId = feature.properties?.cluster_id;
        const src = map.getSource(SRC_ANNOTATIONS) as maplibregl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({
            center: (feature.geometry as any).coordinates,
            zoom,
          });
        });
      });

      const pointPopup = (
        coordinates: [number, number],
        title: string,
        rows: string,
        imageId: string,
        setId: string
      ) => {
        const node = document.createElement('div');
        node.innerHTML = `<div style="min-width:160px;color:#000">
            <div style="font-weight:600;margin-bottom:4px">${title}</div>
            ${rows}
            <button class="btn btn-sm btn-primary mt-2" type="button">View Image</button>
          </div>`;
        const btn = node.querySelector('button');
        btn?.addEventListener('click', () => openViewerRef.current(imageId, setId));
        new maplibregl.Popup({ closeButton: true })
          .setLngLat(coordinates)
          .setDOMContent(node)
          .addTo(map);
      };

      map.on('click', LYR_POINTS, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as any;
        const name = uniqueNamesGenerator({
          dictionaries: [adjectives, names],
          seed: p.id,
          style: 'capital',
          separator: ' ',
        });
        pointPopup(
          (f.geometry as any).coordinates.slice(),
          name,
          `<div><strong>Label:</strong> ${escapeHtml(p.categoryName ?? '')}</div>` +
            (p.infoTags
              ? `<div><strong>Info tags:</strong> ${escapeHtml(p.infoTags)}</div>`
              : ''),
          p.imageId,
          p.setId
        );
      });

      map.on('click', LYR_IMAGES, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as any;
        const [lng, lat] = (f.geometry as any).coordinates;
        pointPopup(
          [lng, lat],
          `Transect ${p.transect}`,
          `<div><strong>Coordinates:</strong> ${lat.toFixed(4)}, ${lng.toFixed(4)}</div>`,
          p.imageId,
          ''
        );
      });

      map.on('click', LYR_STRATA_LINE, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="color:#000"><strong>Stratum:</strong> ${
              (f.properties as any)?.name ?? ''
            }</div>`
          )
          .addTo(map);
      });

      for (const lyr of [LYR_CLUSTERS, LYR_POINTS, LYR_IMAGES, LYR_STRATA_LINE]) {
        map.on('mouseenter', lyr, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', lyr, () => {
          map.getCanvas().style.cursor = '';
        });
      }

      setMapLoaded(true);
    });

    return () => {
      resizeObserver.disconnect();
      setMapLoaded(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // -----------------------------------------------------------------------
  // Push data into the sources whenever it changes.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!mapLoaded) return;
    (mapRef.current?.getSource(SRC_ANNOTATIONS) as maplibregl.GeoJSONSource)?.setData(
      annotationsFC as any
    );
  }, [mapLoaded, annotationsFC]);

  useEffect(() => {
    if (!mapLoaded) return;
    (mapRef.current?.getSource(SRC_IMAGES) as maplibregl.GeoJSONSource)?.setData(
      imagesFC as any
    );
  }, [mapLoaded, imagesFC]);

  useEffect(() => {
    if (!mapLoaded) return;
    (mapRef.current?.getSource(SRC_STRATA) as maplibregl.GeoJSONSource)?.setData(
      strataFC as any
    );
  }, [mapLoaded, strataFC]);

  useEffect(() => {
    if (!mapLoaded) return;
    (mapRef.current?.getSource(SRC_EXCLUSIONS) as maplibregl.GeoJSONSource)?.setData(
      exclusionsFC as any
    );
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
    set(LYR_STRATA_LINE, showStrata);
    set(LYR_EXCLUSIONS_FILL, showStrata);
    set(LYR_EXCLUSIONS_LINE, showStrata);
  }, [mapLoaded, showClusters, showHeatmap, showImages, showStrata]);

  // -----------------------------------------------------------------------
  // Fit bounds to the data whenever the displayed extent changes.
  // -----------------------------------------------------------------------
  const boundsKey = useMemo(() => {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
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

  const lastFitRef = useRef<string>('');
  useEffect(() => {
    if (!mapLoaded || !boundsKey) return;
    const key = boundsKey.join(',');
    if (key === lastFitRef.current) return;
    lastFitRef.current = key;
    mapRef.current!.fitBounds(
      [
        [boundsKey[0], boundsKey[1]],
        [boundsKey[2], boundsKey[3]],
      ],
      { padding: 40, maxZoom: 16, duration: 0 }
    );
  }, [mapLoaded, boundsKey]);

  return (
    <div className='w-100 h-100' style={{ position: 'relative', minHeight: 0 }}>
      <div
        ref={mapContainerRef}
        style={{ height: '100%', width: '100%', position: 'absolute', inset: 0 }}
      />

      {/* Layer toggles */}
      <div
        className='position-absolute bg-white rounded shadow-sm p-2'
        style={{ top: 10, left: 10, zIndex: 1, minWidth: 140, color: '#000' }}
      >
        <div className='fw-bold mb-1' style={{ fontSize: 12 }}>
          Layers
        </div>
        <Form.Check
          type='checkbox'
          id='dm-clusters'
          label='Sightings'
          checked={showClusters}
          onChange={(e) => setShowClusters(e.target.checked)}
          style={{ fontSize: 13 }}
        />
        <Form.Check
          type='checkbox'
          id='dm-heatmap'
          label='Heatmap'
          checked={showHeatmap}
          onChange={(e) => setShowHeatmap(e.target.checked)}
          style={{ fontSize: 13 }}
        />
        <Form.Check
          type='checkbox'
          id='dm-images'
          label='Images'
          checked={showImages}
          onChange={(e) => setShowImages(e.target.checked)}
          style={{ fontSize: 13 }}
        />
        <Form.Check
          type='checkbox'
          id='dm-strata'
          label='Strata'
          checked={showStrata}
          onChange={(e) => setShowStrata(e.target.checked)}
          style={{ fontSize: 13 }}
        />
      </div>

      {/* Loading / status overlay */}
      {(loading || fetching) && (
        <div
          className='position-absolute bg-white rounded shadow-sm px-2 py-1 d-flex align-items-center'
          style={{ top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 1 }}
        >
          <Spinner size='sm' />
          <span className='ms-2' style={{ fontSize: 13, color: '#000' }}>
            {loading ? 'Loading map data…' : 'Updating…'}
          </span>
        </div>
      )}

      {!loading && effectiveSources.length === 0 && (
        <div
          className='position-absolute bg-white rounded shadow-sm px-3 py-2'
          style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 1, color: '#000' }}
        >
          Select an annotation set to begin.
        </div>
      )}

      {editable ? (
        <AnnotationViewerModal
          show={viewerOpen}
          onClose={() => setViewerOpen(false)}
          imageId={viewerImageId}
          imageIds={orderedImageIds}
          annotationSetId={viewerSetId || primarySetId}
          onNavigate={(id) => openViewer(id, viewerSetId)}
        />
      ) : (
        <ImageViewerModal
          show={viewerOpen}
          onClose={() => setViewerOpen(false)}
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
