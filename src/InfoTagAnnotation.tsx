import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Alert, Badge, Button, Card } from 'react-bootstrap';
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  SearchCheck,
  Undo2,
} from 'lucide-react';
import { GlobalContext, UserContext } from './Context';
import {
  ACTIVE_MARKER_SIZE,
  applyActiveMarkerStyle,
  applyTagBadgeContainerStyle,
  applyTagBadgeStyle,
} from './activeMarkerStyle';
import { getTileBlob } from './StorageLayer';
import type { Schema } from './amplify/client-schema';
import {
  assertNoGraphqlErrors,
  commitInfoTagsForAnnotation,
  fetchImageAnnotationsWithTags,
  finalizeInfoTagImage,
  formatInfoTagsForDisplay,
  type InfoTagImageProgress,
} from './infoTags';
import { findShortcutMatch, formatShortcutKey } from './utils/hotkeys';

const TILE_SIZE = 256;
const DEFAULT_ZOOM_OFFSET = 6;
const SOURCE_CURRENT = 'info-tag-current';
const LAYER_CURRENT_LABEL = 'info-tag-current-label';
const SOURCE_ANNOTATIONS = 'info-tag-annotations';
const LAYER_ANNOTATIONS = 'info-tag-annotations-circles';

type CategoryOption = {
  id: string;
  name: string;
  shortcutKey: string | null;
};
type InfoTagOption = {
  id: string;
  name: string;
  shortcutKey: string | null;
  color: string | null;
};
type AnnotationRow = {
  id: string;
  imageId: string;
  setId: string;
  projectId: string;
  group: string | null;
  categoryId: string;
  x: number;
  y: number;
  infoTaggedBy: string | null;
};

// Kept so a save that failed mid-image can be retried without re-tagging.
type CommitRecord = {
  run: () => Promise<void>;
  promise: Promise<void>;
  failed: boolean;
};

type Props = {
  imageId: string;
  annotationSetId: string;
  categoryIds: string[];
  queueId: string;
  ack?: () => Promise<void>;
  stopHeartbeat?: () => void;
  next?: () => void;
  prev?: () => void;
  visible: boolean;
  categories: CategoryOption[];
  infoTags: InfoTagOption[];
  projectId?: string;
  group?: string;
  queueZoom: number | null;
  setQueueZoom: (zoom: number | null) => void;
  adminMemberships?: { projectId: string; queueId: string }[];
  legendCollapsed: boolean;
  setLegendCollapsed: (collapsed: boolean) => void;
};

function buildTargetTour(
  targets: AnnotationRow[],
  width: number,
  height: number
): AnnotationRow[] {
  if (targets.length > 2000) {
    return targets.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  }
  const remaining = targets.slice();
  const tour: AnnotationRow[] = [];
  let current = { x: width / 2, y: height / 2 };
  while (remaining.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < remaining.length; index++) {
      const dx = remaining[index].x - current.x;
      const dy = remaining[index].y - current.y;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    const [nearest] = remaining.splice(nearestIndex, 1);
    tour.push(nearest);
    current = nearest;
  }
  return tour;
}

export default function InfoTagAnnotation({
  imageId,
  annotationSetId,
  categoryIds,
  queueId,
  ack,
  stopHeartbeat,
  next,
  prev,
  visible,
  categories,
  infoTags,
  projectId,
  group,
  queueZoom,
  setQueueZoom,
  adminMemberships,
  legendCollapsed,
  setLegendCollapsed,
}: Props) {
  const { client } = useContext(GlobalContext)!;
  const { user } = useContext(UserContext)!;
  const navigate = useNavigate();
  const [image, setImage] = useState<Schema['Image']['type'] | null>(null);
  const [sourceKey, setSourceKey] = useState<string>();
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([]);
  const [targets, setTargets] = useState<AnnotationRow[]>([]);
  const targetsRef = useRef<AnnotationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const persistedTagIdsRef = useRef(new Map<string, Set<string>>());
  const persistedPositionsRef = useRef(
    new Map<string, { x: number; y: number }>()
  );
  const commitsRef = useRef<CommitRecord[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markerPosition, setMarkerPosition] = useState({ x: 0, y: 0 });
  const [imageComplete, setImageComplete] = useState(false);
  const [readyToAdvance, setReadyToAdvance] = useState(false);
  const finishedRef = useRef(false);
  const progressRef = useRef<InfoTagImageProgress>({
    counted: false,
    acknowledged: false,
  });
  const advancedRef = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const waitingTimerRef = useRef<number>();
  const countdownRef = useRef<number>();
  const wasVisibleRef = useRef(visible);
  useEffect(() => {
    if (
      visible &&
      !wasVisibleRef.current &&
      progressRef.current.counted &&
      targets.length > 0
    ) {
      finishedRef.current = false;
      advancedRef.current = false;
      setImageComplete(false);
      setReadyToAdvance(false);
      setCurrentIndex(targets.length - 1);
    }
    wasVisibleRef.current = visible;
  }, [targets.length, visible]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const loadedTilesRef = useRef(new Set<string>());
  const blobUrlsRef = useRef<string[]>([]);
  const cancelledRef = useRef(false);
  const dragMarkerRef = useRef<maplibregl.Marker | null>(null);
  const tagBadgeMarkerRef = useRef<maplibregl.Marker | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const baseZoomRef = useRef<number | null>(null);
  const [zoomOffset, setZoomOffset] = useState(() => {
    const stored = localStorage.getItem(`infoTagsDefaultZoom-${queueId}`);
    return stored == null ? queueZoom ?? DEFAULT_ZOOM_OFFSET : Number(stored);
  });
  const [hasLocalZoom, setHasLocalZoom] = useState(
    () => localStorage.getItem(`infoTagsDefaultZoom-${queueId}`) != null
  );

  useEffect(() => () => stopHeartbeat?.(), [stopHeartbeat]);

  const clearWaitingTimers = useCallback(() => {
    if (waitingTimerRef.current !== undefined) {
      window.clearTimeout(waitingTimerRef.current);
      waitingTimerRef.current = undefined;
    }
    if (countdownRef.current !== undefined) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = undefined;
    }
  }, []);

  useEffect(() => clearWaitingTimers, [clearWaitingTimers]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      client.models.Image.get(
        { id: imageId },
        { selectionSet: ['id', 'width', 'height'] as const }
      ),
      client.models.ImageFile.imagesByimageId({ imageId }),
      fetchImageAnnotationsWithTags(client, imageId, annotationSetId),
    ])
      .then(([imageResponse, filesResponse, rows]) => {
        if (!mounted || !imageResponse.data) return;
        const jpeg = filesResponse.data?.find(
          (file) => file.type === 'image/jpeg'
        );
        if (!jpeg) throw new Error(`No JPEG source found for image ${imageId}`);
        const categorySet = new Set(categoryIds);
        const work = rows.filter(
          (annotation) =>
            categorySet.has(annotation.categoryId) &&
            !annotation.infoTaggedBy
        );
        const persisted = new Map(
          rows.map((annotation) => [annotation.id, new Set(annotation.tagIds)])
        );
        const ordered = buildTargetTour(
          work,
          imageResponse.data.width,
          imageResponse.data.height
        );
        persistedTagIdsRef.current = persisted;
        persistedPositionsRef.current = new Map(
          ordered.map((annotation) => [
            annotation.id,
            { x: annotation.x, y: annotation.y },
          ])
        );
        setImage(imageResponse.data);
        setSourceKey(jpeg.key);
        setAnnotations(rows);
        setTargets(ordered);
        targetsRef.current = ordered;
        setCurrentIndex(0);
        const first = ordered[0];
        if (first) {
          setMarkerPosition({ x: first.x, y: first.y });
          setSelectedTagIds(new Set(persisted.get(first.id) ?? []));
        }
      })
      .catch((error) => {
        console.error('Failed to load informational tagging image', error);
        if (mounted) {
          setLoadError(
            error?.message ?? 'Failed to load the annotations for this image'
          );
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [annotationSetId, categoryIds, client, imageId]);

  const currentTarget = targets[currentIndex];
  const currentCategory = categories.find(
    (category) => category.id === currentTarget?.categoryId
  );

  const tagNameById = useMemo(
    () => new Map(infoTags.map((tag) => [tag.id, tag.name])),
    [infoTags]
  );
  const namesForAnnotation = useCallback(
    (annotationId: string) =>
      Array.from(persistedTagIdsRef.current.get(annotationId) ?? [])
        .map((tagId) => tagNameById.get(tagId))
        .filter((name): name is string => Boolean(name))
        .sort((a, b) => a.localeCompare(b)),
    [tagNameById]
  );

  useEffect(() => {
    if (!currentTarget) return;
    const position = persistedPositionsRef.current.get(currentTarget.id) ?? {
      x: currentTarget.x,
      y: currentTarget.y,
    };
    setMarkerPosition(position);
    setSelectedTagIds(
      new Set(persistedTagIdsRef.current.get(currentTarget.id) ?? [])
    );
    if (map) {
      map.easeTo({
        center: px2lngLat(
          position.x,
          position.y,
          image?.width ?? 1,
          image?.height ?? 1
        ),
        duration: 350,
      });
    }
  }, [currentTarget, map, image?.width, image?.height]);

  const scale = useMemo(
    () =>
      image ? 0.1 / Math.max(image.width, image.height) : undefined,
    [image]
  );
  const toLngLat = useCallback(
    (x: number, y: number): [number, number] =>
      scale ? [x * scale, -y * scale] : [0, 0],
    [scale]
  );

  useEffect(() => {
    if (!map || !currentTarget) return;
    const source = map.getSource(SOURCE_CURRENT) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { label: currentCategory?.name ?? 'Unknown' },
          geometry: {
            type: 'Point',
            coordinates: toLngLat(markerPosition.x, markerPosition.y),
          },
        },
      ],
    });
    dragMarkerRef.current?.setLngLat(
      toLngLat(markerPosition.x, markerPosition.y)
    );
    tagBadgeMarkerRef.current?.setLngLat(
      toLngLat(markerPosition.x, markerPosition.y)
    );
  }, [
    currentCategory?.name,
    currentTarget,
    map,
    markerPosition,
    toLngLat,
  ]);

  useEffect(() => {
    if (!map) return;
    const targetIds = new Set(targets.map((annotation) => annotation.id));
    const source = map.getSource(SOURCE_ANNOTATIONS) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: annotations.map((annotation) => ({
        type: 'Feature',
        properties: {
          id: annotation.id,
          label:
            categories.find((category) => category.id === annotation.categoryId)
              ?.name ?? 'Unknown',
          state: completedIds.has(annotation.id)
            ? 'completed'
            : targetIds.has(annotation.id)
              ? 'pending'
              : 'context',
          infoTags: JSON.stringify(namesForAnnotation(annotation.id)),
        },
        geometry: {
          type: 'Point',
          coordinates: toLngLat(annotation.x, annotation.y),
        },
      })),
    });
  }, [
    annotations,
    categories,
    completedIds,
    map,
    namesForAnnotation,
    targets,
    toLngLat,
  ]);

  const updateVisibleTiles = useCallback(
    async (instance: maplibregl.Map | null) => {
      if (!instance || !sourceKey || !image || !scale || cancelledRef.current) {
        return;
      }
      const maxDimension = Math.max(image.width, image.height);
      const maxZoom = Math.ceil(Math.log2(maxDimension / TILE_SIZE));
      const pyramidSize = TILE_SIZE * 2 ** maxZoom;
      const currentDegreesPerPixel = 360 / 256 / 2 ** instance.getZoom();
      const targetTilePixelsPerDegree = 1 / (currentDegreesPerPixel * 0.75);
      const target =
        (targetTilePixelsPerDegree * pyramidSize * scale) / TILE_SIZE;
      const zoom = Math.max(
        0,
        Math.min(maxZoom, Math.round(Math.log2(target)))
      );
      const coverage = pyramidSize / 2 ** zoom;
      const columns = Math.ceil(image.width / coverage);
      const rows = Math.ceil(image.height / coverage);
      const bounds = instance.getBounds();

      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const sourceId = `info-tag-tile-${zoom}-${row}-${column}`;
          if (loadedTilesRef.current.has(sourceId)) continue;
          const x0 = column * coverage;
          const y0 = row * coverage;
          const x1 = (column + 1) * coverage;
          const y1 = (row + 1) * coverage;
          const first = toLngLat(x0, y0);
          const second = toLngLat(x1, y1);
          const tileBounds = new maplibregl.LngLatBounds(
            [
              Math.min(first[0], second[0]),
              Math.min(first[1], second[1]),
            ],
            [
              Math.max(first[0], second[0]),
              Math.max(first[1], second[1]),
            ]
          );
          const isVisible =
            bounds.getWest() <= tileBounds.getEast() &&
            bounds.getEast() >= tileBounds.getWest() &&
            bounds.getSouth() <= tileBounds.getNorth() &&
            bounds.getNorth() >= tileBounds.getSouth();
          if (!isVisible) continue;
          loadedTilesRef.current.add(sourceId);
          getTileBlob(
            `slippymaps/${sourceKey}/${zoom}/${row}/${column}.png`
          )
            .then((blob) => {
              if (cancelledRef.current || instance.getSource(sourceId)) return;
              const url = URL.createObjectURL(blob);
              blobUrlsRef.current.push(url);
              instance.addSource(sourceId, {
                type: 'image',
                url,
                coordinates: [
                  toLngLat(x0, y0),
                  toLngLat(x1, y0),
                  toLngLat(x1, y1),
                  toLngLat(x0, y1),
                ],
              });
              instance.addLayer(
                {
                  id: `info-tag-layer-${zoom}-${row}-${column}`,
                  type: 'raster',
                  source: sourceId,
                  paint: { 'raster-fade-duration': 0 },
                },
                LAYER_ANNOTATIONS
              );
            })
            .catch(() => loadedTilesRef.current.delete(sourceId));
        }
      }
    },
    [image, scale, sourceKey, toLngLat]
  );

  useEffect(() => {
    if (!containerRef.current || !image || !sourceKey || !scale) return;
    cancelledRef.current = false;
    loadedTilesRef.current = new Set();
    blobUrlsRef.current = [];
    const firstTarget = targetsRef.current[0];
    const instance = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {},
        layers: [],
      },
      center: toLngLat(
        firstTarget?.x ?? image.width / 2,
        firstTarget?.y ?? image.height / 2
      ),
      zoom: 3,
      minZoom: -20,
      maxZoom: 22,
      renderWorldCopies: false,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    instance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-left'
    );
    instance.touchZoomRotate.disableRotation();
    instance.on('load', () => {
      instance.addSource(SOURCE_CURRENT, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      instance.addSource(SOURCE_ANNOTATIONS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      instance.addLayer({
        id: LAYER_ANNOTATIONS,
        type: 'circle',
        source: SOURCE_ANNOTATIONS,
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'match',
            ['get', 'state'],
            'pending',
            '#ffb300',
            'completed',
            '#00c853',
            '#9e9e9e',
          ],
          'circle-stroke-color': '#000000',
          'circle-stroke-width': 1,
        },
      });
      instance.addLayer({
        id: LAYER_CURRENT_LABEL,
        type: 'symbol',
        source: SOURCE_CURRENT,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 14,
          'text-offset': [0, -2],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-font': ['Open Sans Regular'],
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.8)',
          'text-halo-width': 2,
        },
      });

      const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 8,
      });
      popupRef.current = popup;
      instance.on('mouseenter', LAYER_ANNOTATIONS, (event) => {
        instance.getCanvas().style.cursor = 'pointer';
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const label = escapeHtml(String(feature.properties?.label ?? 'Unknown'));
        const state = String(feature.properties?.state ?? 'context');
        let names: string[] = [];
        try {
          names = JSON.parse(String(feature.properties?.infoTags ?? '[]'));
        } catch {
          names = [];
        }
        const tags = escapeHtml(formatInfoTagsForDisplay(names) || '—');
        popup
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setHTML(
            `<div style="color:#000"><div>${label}</div>` +
              `<div style="font-size:11px;font-weight:600">${escapeHtml(state)}</div>` +
              `<div style="font-size:11px">Tags: ${tags}</div></div>`
          )
          .addTo(instance);
      });
      instance.on('mouseleave', LAYER_ANNOTATIONS, () => {
        instance.getCanvas().style.cursor = '';
        popup.remove();
      });

      // The drag handle is also the active-marker rendering - the annotation
      // being tagged is filtered out of LAYER_ANNOTATIONS so it is drawn once.
      const handle = document.createElement('div');
      applyActiveMarkerStyle(handle);
      const dragMarker = new maplibregl.Marker({
        element: handle,
        draggable: true,
        anchor: 'center',
      })
        .setLngLat(
          toLngLat(
            firstTarget?.x ?? image.width / 2,
            firstTarget?.y ?? image.height / 2
          )
        )
        .addTo(instance);
      dragMarkerRef.current = dragMarker;

      // Selected tags are shown beside the active marker so hotkey users can
      // check what they toggled without looking away from the animal.
      const badges = document.createElement('div');
      applyTagBadgeContainerStyle(badges);
      tagBadgeMarkerRef.current = new maplibregl.Marker({
        element: badges,
        anchor: 'left',
        offset: [ACTIVE_MARKER_SIZE / 2 + 6, 0],
      })
        .setLngLat(
          toLngLat(
            firstTarget?.x ?? image.width / 2,
            firstTarget?.y ?? image.height / 2
          )
        )
        .addTo(instance);

      dragMarker.on('dragend', () => {
        const point = dragMarker.getLngLat();
        setMarkerPosition({
          x: Math.round(point.lng / scale),
          y: Math.round(-point.lat / scale),
        });
      });

      const imageBounds = new maplibregl.LngLatBounds(
        toLngLat(0, image.height),
        toLngLat(image.width, 0)
      );
      instance.fitBounds(imageBounds, { padding: 20, animate: false });
      baseZoomRef.current = instance.getZoom();
      instance.jumpTo({
        center: toLngLat(
          firstTarget?.x ?? image.width / 2,
          firstTarget?.y ?? image.height / 2
        ),
        zoom: instance.getZoom() + zoomOffset,
      });
      setMap(instance);
      updateVisibleTiles(instance);
    });
    instance.on('moveend', () => updateVisibleTiles(instance));
    return () => {
      cancelledRef.current = true;
      dragMarkerRef.current?.remove();
      dragMarkerRef.current = null;
      tagBadgeMarkerRef.current?.remove();
      tagBadgeMarkerRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
      instance.remove();
      setMap(null);
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, [
    image,
    scale,
    sourceKey,
    toLngLat,
    updateVisibleTiles,
    zoomOffset,
  ]);

  // The active annotation is drawn by the drag marker instead, so it must not
  // also be drawn as a plain circle - otherwise the circle would still give
  // its position away while the marker is hidden with Tab.
  useEffect(() => {
    if (!map || !map.getLayer(LAYER_ANNOTATIONS)) return;
    map.setFilter(
      LAYER_ANNOTATIONS,
      currentTarget ? ['!=', ['get', 'id'], currentTarget.id] : null
    );
  }, [currentTarget, map]);

  useEffect(() => {
    const element = tagBadgeMarkerRef.current?.getElement();
    if (!element) return;
    element.replaceChildren(
      ...infoTags
        .filter((tag) => selectedTagIds.has(tag.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((tag) => {
          const badge = document.createElement('span');
          badge.textContent = tag.name;
          applyTagBadgeStyle(badge);
          return badge;
        })
    );
  }, [infoTags, map, selectedTagIds]);

  const [markerHidden, setMarkerHidden] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        setMarkerHidden(true);
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === 'Tab') setMarkerHidden(false);
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      setMarkerHidden(false);
    };
  }, [visible]);

  useEffect(() => {
    if (!map) return;
    const hidden = markerHidden || !currentTarget;
    const element = dragMarkerRef.current?.getElement();
    if (element) element.style.visibility = hidden ? 'hidden' : '';
    const badges = tagBadgeMarkerRef.current?.getElement();
    if (badges) badges.style.visibility = hidden ? 'hidden' : '';
    if (map.getLayer(LAYER_CURRENT_LABEL)) {
      map.setLayoutProperty(
        LAYER_CURRENT_LABEL,
        'visibility',
        hidden ? 'none' : 'visible'
      );
    }
  }, [currentTarget, map, markerHidden]);

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds((current) => {
      const nextSelection = new Set(current);
      if (nextSelection.has(tagId)) nextSelection.delete(tagId);
      else nextSelection.add(tagId);
      return nextSelection;
    });
  }, []);

  const saveDefaultZoom = useCallback(async () => {
    if (!map || baseZoomRef.current == null) return;
    const newOffset = Math.round(map.getZoom() - baseZoomRef.current);
    if (!hasLocalZoom) {
      const isAdmin = adminMemberships?.some(
        (membership) => membership.projectId === projectId
      );
      if (isAdmin) {
        const answer = window.prompt(
          'Set as default zoom for all users on this job? (y/n)'
        );
        if (answer === null) return;
        if (answer.toLowerCase() === 'y') {
          await client.models.Queue.update({ id: queueId, zoom: newOffset });
          setQueueZoom(newOffset);
          return;
        }
      }
      localStorage.setItem(
        `infoTagsDefaultZoom-${queueId}`,
        String(newOffset)
      );
      setHasLocalZoom(true);
      setZoomOffset(newOffset);
      return;
    }
    localStorage.removeItem(`infoTagsDefaultZoom-${queueId}`);
    setHasLocalZoom(false);
    setZoomOffset(queueZoom ?? DEFAULT_ZOOM_OFFSET);
  }, [
    adminMemberships,
    client,
    hasLocalZoom,
    map,
    projectId,
    queueId,
    queueZoom,
    setQueueZoom,
  ]);

  // Nothing is acknowledged until every tag write for the image has landed, so
  // a save that failed leaves the message on the queue to be handed out again.
  const countCompletionRef = useRef(true);
  const finishImage = useCallback(
    (countCompletion = true) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      countCompletionRef.current = countCompletion;
      setImageComplete(true);
      finalizeInfoTagImage({
        commits: commitsRef.current.map((record) => record.promise),
        progress: progressRef.current,
        countCompletion,
        incrementCount: async () =>
          assertNoGraphqlErrors(
            await client.mutations.incrementQueueCount({ id: queueId }),
            'Failed to record queue progress'
          ),
        acknowledge: async () => {
          await ack?.();
        },
      })
        .then(() => {
          setSaveError(null);
          setReadyToAdvance(true);
        })
        .catch((error) => {
          console.error('Failed to finish informational tagging image', error);
          finishedRef.current = false;
          setImageComplete(false);
          setSaveError(
            error?.message ?? 'Failed to save informational tags for this image'
          );
        });
    },
    [ack, client, queueId]
  );

  // An image whose annotations are all tagged already is acknowledged without
  // being counted - but only once it is known to have loaded, otherwise a
  // failed load would look like finished work and drop the queue message.
  useEffect(() => {
    if (!loading && !loadError && image && targets.length === 0) {
      finishImage(false);
    }
  }, [finishImage, image, loadError, loading, targets.length]);

  useEffect(() => {
    if (!readyToAdvance || advancedRef.current) return;

    if (next) {
      clearWaitingTimers();
      setWaiting(false);
      advancedRef.current = true;
      next();
      return;
    }

    if (waitingTimerRef.current !== undefined) return;

    setWaiting(true);
    setSecondsRemaining(60);
    countdownRef.current = window.setInterval(() => {
      setSecondsRemaining((previous) => Math.max(0, previous - 1));
    }, 1000);
    waitingTimerRef.current = window.setTimeout(() => {
      clearWaitingTimers();
      setWaiting(false);
      alert(
        'No new work was loaded. The job appears to be complete. Thank you for your contribution!'
      );
      navigate('/jobs');
    }, 60000);
  }, [clearWaitingTimers, navigate, next, readyToAdvance]);

  const startCommit = useCallback((record: CommitRecord) => {
    record.failed = false;
    record.promise = record.run().catch((error) => {
      record.failed = true;
      throw error;
    });
    // The outcome is inspected when the image is finished; this only keeps the
    // rejection from being reported as unhandled in the meantime.
    record.promise.catch(() => undefined);
  }, []);

  const commitAndAdvance = useCallback(() => {
    if (!currentTarget || finishedRef.current) return;
    const target = currentTarget;
    const before = persistedTagIdsRef.current.get(target.id) ?? new Set<string>();
    const after = new Set(selectedTagIds);
    const position = markerPosition;
    persistedTagIdsRef.current.set(target.id, after);
    persistedPositionsRef.current.set(target.id, position);
    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === target.id
          ? { ...annotation, ...position }
          : annotation
      )
    );

    const record: CommitRecord = {
      run: () =>
        commitInfoTagsForAnnotation(client, {
          annotationId: target.id,
          annotationSetId,
          projectId: target.projectId || projectId!,
          group: group ?? target.group ?? undefined,
          before,
          after,
          position,
          taggedBy: user.userId,
        }),
      promise: Promise.resolve(),
      failed: false,
    };
    commitsRef.current.push(record);
    startCommit(record);

    setCompletedIds((current) => new Set(current).add(target.id));
    if (currentIndex + 1 < targets.length) {
      setCurrentIndex((index) => index + 1);
    } else {
      finishImage();
    }
  }, [
    annotationSetId,
    client,
    currentIndex,
    currentTarget,
    finishImage,
    group,
    markerPosition,
    projectId,
    selectedTagIds,
    startCommit,
    targets.length,
    user.userId,
  ]);

  const retrySave = useCallback(() => {
    setSaveError(null);
    for (const record of commitsRef.current) {
      if (record.failed) startCommit(record);
    }
    finishImage(countCompletionRef.current);
  }, [finishImage, startCommit]);

  const undo = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((index) => index - 1);
      return;
    }
    prev?.();
  }, [currentIndex, prev]);

  useEffect(() => {
    if (!visible) return;
    const keyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
        commitAndAdvance();
        return;
      }
      // A stored shortcutKey may be a combo ('ctrl+h') or a physical key name
      // ('period'), so match through findShortcutMatch rather than event.key.
      const tag = findShortcutMatch(
        event,
        infoTags,
        (candidate) => candidate.shortcutKey
      );
      if (tag) {
        event.preventDefault();
        toggleTag(tag.id);
      }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [commitAndAdvance, infoTags, toggleTag, undo, visible]);

  if (loading || !image || !sourceKey) {
    return (
      <div className='d-flex justify-content-center align-items-center w-100 h-100'>
        {loadError ? (
          <Alert variant='danger' className='mb-0'>
            {loadError}. This image has not been taken off the queue - reload to
            try again.
          </Alert>
        ) : (
          <div className='text-muted'>Loading image annotations...</div>
        )}
      </div>
    );
  }

  return (
    <div className='d-flex flex-column w-100 h-100'>
      <div
        className='d-flex align-items-center justify-content-between py-2'
        style={{ backgroundColor: '#2b3e50', flexShrink: 0 }}
      >
        <div className='d-flex align-items-center gap-3'>
          <Badge bg='info'>{currentCategory?.name ?? 'Info Tags'}</Badge>
          {currentTarget && (
            <Badge bg='secondary'>
              Annotation {currentIndex + 1} of {targets.length} on this image
            </Badge>
          )}
          <span className='text-muted' style={{ fontSize: 12 }}>
            Press shortcut keys to toggle tags · Space to continue · Tip: Hold
            Tab to hide the marker
          </span>
        </div>
        <button
          className='p-0 m-0 border-0 bg-transparent d-flex align-items-center text-white'
          onClick={saveDefaultZoom}
        >
          {hasLocalZoom ? <RotateCcw size={20} /> : <SearchCheck size={20} />}
          <span className='ms-2 d-none d-md-block' style={{ fontSize: 13 }}>
            {hasLocalZoom ? 'Reset zoom' : 'Set as default zoom'}
          </span>
        </button>
      </div>

      {saveError && (
        <Alert
          variant='danger'
          className='mb-0 d-flex align-items-center justify-content-between gap-3'
          style={{ flexShrink: 0 }}
        >
          <span>
            {saveError}. Your tags are not saved yet - this image stays on the
            queue until they are.
          </span>
          <Button variant='light' size='sm' onClick={retrySave}>
            Retry save
          </Button>
        </Alert>
      )}

      <div className='d-flex' style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <div
            ref={containerRef}
            style={{
              width: '100%',
              height: '100%',
              background: '#fff',
              borderRadius: 10,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          />
          {waiting && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 1000,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                borderRadius: 12,
                padding: '20px 32px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  border: '3px solid rgba(255, 255, 255, 0.2)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div
                style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}
              >
                Waiting for new work... ({secondsRemaining}s remaining)
              </div>
            </div>
          )}
        </div>

        {legendCollapsed ? (
          <div
            className='d-flex align-items-center'
            style={{ padding: '0 4px', flexShrink: 0, marginLeft: 12 }}
          >
            <Button
              variant='secondary'
              size='sm'
              onClick={() => setLegendCollapsed(false)}
              style={{ width: 28, height: '100%', padding: 0 }}
              title='Expand legend'
            >
              <ChevronLeft size={18} />
            </Button>
          </div>
        ) : (
          <div
            className='d-flex flex-column'
            style={{
              position: 'relative',
              height: '100%',
              flexShrink: 0,
              marginLeft: 24,
            }}
          >
            <Button
              variant='secondary'
              size='sm'
              onClick={() => setLegendCollapsed(true)}
              style={{
                position: 'absolute',
                left: -16,
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 10,
                width: 32,
                height: 32,
                borderRadius: '50%',
                padding: 0,
              }}
              title='Collapse legend'
            >
              <ChevronRight size={18} />
            </Button>
            <Card
              className='d-flex flex-column h-100 overflow-hidden'
              style={{ width: 280 }}
            >
              <Card.Header>
                <Card.Title className='mb-1'>Info Tags</Card.Title>
                <span className='text-muted' style={{ fontSize: 13 }}>
                  Toggle any number, then press Space
                </span>
              </Card.Header>
              <Card.Body className='d-flex flex-column gap-2 overflow-auto'>
                {infoTags
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((tag) => (
                    <Button
                      key={tag.id}
                      variant={selectedTagIds.has(tag.id) ? 'info' : 'primary'}
                      className='d-flex align-items-center justify-content-between gap-2'
                      onClick={() => toggleTag(tag.id)}
                    >
                      <span>{tag.name}</span>
                      {tag.shortcutKey && (
                        <span>({formatShortcutKey(tag.shortcutKey)})</span>
                      )}
                    </Button>
                  ))}
              </Card.Body>
            </Card>
          </div>
        )}
      </div>

      <div
        className='d-flex align-items-center justify-content-between py-2 mt-2'
        style={{ backgroundColor: '#2b3e50', flexShrink: 0 }}
      >
        <Button
          className='d-flex align-items-center justify-content-center gap-1'
          variant='primary'
          style={{ width: 160 }}
          onClick={undo}
          disabled={!prev && currentIndex === 0}
        >
          <Undo2 size={16} />
          Undo
        </Button>
        <Button
          variant='success'
          style={{ width: 190 }}
          onClick={commitAndAdvance}
          disabled={!currentTarget || imageComplete}
        >
          Continue (Space)
        </Button>
        <Button
          variant='primary'
          style={{ width: 160 }}
          onClick={() => navigate('/jobs')}
        >
          Save &amp; Exit
        </Button>
      </div>
    </div>
  );
}

function px2lngLat(
  x: number,
  y: number,
  width: number,
  height: number
): [number, number] {
  const scale = 0.1 / Math.max(width, height);
  return [x * scale, -y * scale];
}

function escapeHtml(value: string) {
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
