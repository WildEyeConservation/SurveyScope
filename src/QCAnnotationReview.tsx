import {
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Badge, Button, Card } from 'react-bootstrap';
import { ChevronLeft, ChevronRight, Undo2, SearchCheck, RotateCcw } from 'lucide-react';
import { GlobalContext, UserContext } from './Context';
import { applyActiveMarkerStyle } from './activeMarkerStyle';
import { getTileBlob } from './StorageLayer';
import type { Schema } from './amplify/client-schema';
import {
  fetchInfoTagDataForSet,
  formatInfoTagsForDisplay,
  infoTagNamesFor,
} from './infoTags';
import { findShortcutMatch, formatShortcutKey } from './utils/hotkeys';

// ── Constants ──

const TILE_SIZE = 256;
const SOURCE_MARKER = 'qc-marker';
const LAYER_MARKER_LABEL = 'qc-marker-label';
const SOURCE_OTHER_ANNOTATIONS = 'qc-other-annotations';
const LAYER_OTHER_ANNOTATIONS = 'qc-other-annotations-circles';

type CategoryOption = {
  id: string;
  name: string;
  shortcutKey: string | null;
};

type AnnotationData = {
  id: string;
  annotationSetId: string;
  imageId: string;
  categoryId: string;
  x: number;
  y: number;
};

type QCReviewProps = {
  // From SQS message body (spread by TaskBuffer)
  annotation: AnnotationData;
  queueId: string;
  message_id: string;
  ack?: () => Promise<void>;
  next?: () => void;
  prev?: () => void;
  visible: boolean;
  // Passed through by TaskBuffer from QCReviewTask
  categories: CategoryOption[];
  setCategories: React.Dispatch<React.SetStateAction<CategoryOption[]>>;
  projectId?: string;
  annotationSetId?: string;
  group?: string;
  queueZoom: number | null;
  setQueueZoom: (zoom: number | null) => void;
  adminMemberships?: { projectId: string; queueId: string }[];
  legendCollapsed: boolean;
  setLegendCollapsed: (collapsed: boolean) => void;
};

const DEFAULT_ZOOM_OFFSET = 6;

export default function QCAnnotationReview({
  annotation,
  queueId,
  ack,
  next,
  prev,
  visible,
  categories,
  setCategories,
  projectId,
  annotationSetId,
  group,
  queueZoom,
  setQueueZoom,
  adminMemberships,
  legendCollapsed,
  setLegendCollapsed,
}: QCReviewProps) {
  const { client } = useContext(GlobalContext)!;
  const { user } = useContext(UserContext)!;
  const navigate = useNavigate();

  // ── Image data ──
  const [image, setImage] = useState<Schema['Image']['type'] | null>(null);
  const [sourceKey, setSourceKey] = useState<string | undefined>(undefined);

  // ── MapLibre state ──
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const loadedTilesRef = useRef<Set<string>>(new Set());
  const blobUrlsRef = useRef<string[]>([]);
  const cancelledRef = useRef(false);
  const mainMarkerRef = useRef<maplibregl.Marker | null>(null);
  const hoverPopupRef = useRef<maplibregl.Popup | null>(null);

  // ── Marker position (draggable) ──
  const [markerPosition, setMarkerPosition] = useState<{ x: number; y: number }>({
    x: annotation.x,
    y: annotation.y,
  });

  // ── Other annotations on this image ──
  const [otherAnnotations, setOtherAnnotations] = useState<
    Array<{
      id: string;
      x: number;
      y: number;
      categoryId: string;
      reviewed: boolean;
      infoTags: string[];
    }>
  >([]);
  const [hasInfoTags, setHasInfoTags] = useState(false);
  const hasInfoTagsRef = useRef(false);
  useEffect(() => {
    hasInfoTagsRef.current = hasInfoTags;
  }, [hasInfoTags]);

  // ── Zoom state ──
  const baseZoomRef = useRef<number | null>(null);
  const [zoomOffset, setZoomOffset] = useState<number>(() => {
    if (queueId) {
      const stored = localStorage.getItem(`qcDefaultZoom-${queueId}`);
      if (stored != null) return Number(stored);
    }
    return queueZoom ?? DEFAULT_ZOOM_OFFSET;
  });
  const [hasLocalZoom, setHasLocalZoom] = useState<boolean>(() => {
    return queueId ? localStorage.getItem(`qcDefaultZoom-${queueId}`) != null : false;
  });

  // ── UI state ──
  const [hideMarker, setHideMarker] = useState(false);

  // ── Review state (tracks what the user chose, persists across undo) ──
  const [reviewedCatId, setReviewedCatId] = useState<string | null>(null);

  // ── Waiting state for empty queue ──
  const [waiting, setWaiting] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const waitingTimerRef = useRef<number | undefined>(undefined);
  const countdownRef = useRef<number | undefined>(undefined);

  // When next becomes available while waiting, cancel the timer.
  useEffect(() => {
    if (next && waiting) {
      if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      waitingTimerRef.current = undefined;
      countdownRef.current = undefined;
      setWaiting(false);
      setSecondsRemaining(60);
    }
  }, [next, waiting]);

  useEffect(() => {
    return () => {
      if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // The label to display: if reviewed, show the reviewed category; otherwise original.
  const displayCategoryId = reviewedCatId ?? annotation.categoryId;
  const displayCategory = categories.find((c) => c.id === displayCategoryId);

  // ── False Positive logic ──
  const existingFpCategory = useMemo(
    () => categories.find((c) => c.name.trim().toLowerCase() === 'false positive'),
    [categories]
  );
  const fpHotkey = existingFpCategory ? existingFpCategory.shortcutKey : '+';
  const fpLabel = `False Positive (${fpHotkey ? formatShortcutKey(fpHotkey) : '+/='})`;
  const [creatingFp, setCreatingFp] = useState(false);

  // Filter false positive category from legend if it exists
  const legendCategories = useMemo(
    () =>
      existingFpCategory
        ? categories.filter((c) => c.id !== existingFpCategory.id)
        : categories,
    [categories, existingFpCategory]
  );

  // ── Reset marker position when the annotation changes ──
  useEffect(() => {
    setMarkerPosition({ x: annotation.x, y: annotation.y });
  }, [annotation.id, annotation.x, annotation.y]);

  // ── Fetch other annotations on the same image ──
  useEffect(() => {
    if (!annotation.imageId || !annotation.annotationSetId) return;
    let mounted = true;
    Promise.all([
      client.models.Annotation.annotationsByImageIdAndSetId(
        { imageId: annotation.imageId, setId: { eq: annotation.annotationSetId } },
        {
          limit: 10000,
          selectionSet: ['id', 'x', 'y', 'categoryId', 'reviewedBy'],
        }
      ),
      fetchInfoTagDataForSet(client, annotation.annotationSetId),
    ]).then(([{ data }, infoTagData]) => {
      if (!mounted || !data) return;
      setHasInfoTags(infoTagData.nameById.size > 0);
      setOtherAnnotations(
        data
          .filter((a) => a.id !== annotation.id)
          .map((a) => ({
            id: a.id,
            x: a.x,
            y: a.y,
            categoryId: a.categoryId,
            reviewed: !!a.reviewedBy,
            infoTags: infoTagNamesFor(infoTagData, a.id),
          }))
      );
    });
    return () => {
      mounted = false;
    };
  }, [annotation.id, annotation.imageId, annotation.annotationSetId, client]);

  // ── Fetch image + sourceKey ──
  useEffect(() => {
    if (!annotation.imageId) return;
    let mounted = true;

    client.models.Image.get(
      { id: annotation.imageId },
      { selectionSet: ['id', 'width', 'height'] }
    ).then(({ data }) => {
      if (!mounted || !data) return;
      setImage(data);
    });

    client.models.ImageFile.imagesByimageId({ imageId: annotation.imageId }).then(
      ({ data }) => {
        if (!mounted) return;
        const jpeg = data?.find((f) => f.type === 'image/jpeg');
        if (jpeg) setSourceKey(jpeg.key);
      }
    );

    return () => {
      mounted = false;
    };
  }, [annotation.imageId, client]);

  // ── MapLibre coordinate helpers ──
  const scale = useMemo(
    () =>
      image ? 0.1 / Math.max(image.width, image.height) : undefined,
    [image]
  );

  const px2lngLat = useCallback(
    (x: number, y: number): [number, number] =>
      scale ? [x * scale, -y * scale] : [0, 0],
    [scale]
  );

  // ── Update main marker position + label on state changes ──
  useEffect(() => {
    if (!map || !scale) return;
    const source = map.getSource(SOURCE_MARKER) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { label: displayCategory?.name ?? 'Unknown' },
          geometry: {
            type: 'Point',
            coordinates: px2lngLat(markerPosition.x, markerPosition.y),
          },
        },
      ],
    });
    if (mainMarkerRef.current) {
      mainMarkerRef.current.setLngLat(px2lngLat(markerPosition.x, markerPosition.y));
    }
  }, [map, scale, displayCategoryId, markerPosition, px2lngLat, displayCategory?.name]);

  // ── Sync other-annotations source data ──
  useEffect(() => {
    if (!map || !scale) return;
    const source = map.getSource(SOURCE_OTHER_ANNOTATIONS) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: otherAnnotations.map((a) => ({
        type: 'Feature',
        properties: {
          label: categories.find((c) => c.id === a.categoryId)?.name ?? 'Unknown',
          reviewed: a.reviewed,
          infoTags: JSON.stringify(a.infoTags),
        },
        geometry: {
          type: 'Point',
          coordinates: px2lngLat(a.x, a.y),
        },
      })),
    });
  }, [map, otherAnnotations, categories, px2lngLat, scale]);

  // ── Tile loading ──
  const updateVisibleTiles = useCallback(
    async (m: maplibregl.Map | null) => {
      if (!m || !sourceKey || !image || cancelledRef.current || !scale) return;

      const maxDim = Math.max(image.width, image.height);
      const maxZ = Math.ceil(Math.log2(maxDim / TILE_SIZE));
      const pyramidSize = TILE_SIZE * Math.pow(2, maxZ);

      const mapZoom = m.getZoom();
      const degPerPxAtZoom0 = 360 / 256;
      const currentDegPerPx = degPerPxAtZoom0 / Math.pow(2, mapZoom);
      const targetTilePxPerDeg = 1 / (currentDegPerPx * 0.75);
      const target2z = (targetTilePxPerDeg * pyramidSize * scale) / TILE_SIZE;
      const z = Math.max(0, Math.min(maxZ, Math.round(Math.log2(target2z))));

      const tileCoverage = pyramidSize / Math.pow(2, z);
      const cols = Math.ceil(image.width / tileCoverage);
      const rows = Math.ceil(image.height / tileCoverage);
      const bounds = m.getBounds();

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const sourceId = `tile-${z}-${row}-${col}`;
          if (loadedTilesRef.current.has(sourceId)) continue;

          const x0 = col * tileCoverage;
          const y0 = row * tileCoverage;
          const x1 = (col + 1) * tileCoverage;
          const y1 = (row + 1) * tileCoverage;

          const c1 = px2lngLat(x0, y0);
          const c2 = px2lngLat(x1, y1);
          const tileBounds = new maplibregl.LngLatBounds(
            [Math.min(c1[0], c2[0]), Math.min(c1[1], c2[1])],
            [Math.max(c1[0], c2[0]), Math.max(c1[1], c2[1])]
          );

          const isVisible =
            bounds &&
            bounds.getWest() <= tileBounds.getEast() &&
            bounds.getEast() >= tileBounds.getWest() &&
            bounds.getSouth() <= tileBounds.getNorth() &&
            bounds.getNorth() >= tileBounds.getSouth();

          if (isVisible) {
            loadedTilesRef.current.add(sourceId);
            const path = `slippymaps/${sourceKey}/${z}/${row}/${col}.png`;
            getTileBlob(path)
              .then((blob) => {
                if (cancelledRef.current) return;
                const url = URL.createObjectURL(blob);
                blobUrlsRef.current.push(url);

                if (m.getSource(sourceId)) return;
                m.addSource(sourceId, {
                  type: 'image',
                  url,
                  coordinates: [
                    px2lngLat(x0, y0),
                    px2lngLat(x1, y0),
                    px2lngLat(x1, y1),
                    px2lngLat(x0, y1),
                  ],
                });

                let beforeId: string = LAYER_MARKER_LABEL;
                const layers = m.getStyle().layers || [];
                for (const layer of layers) {
                  if (layer.id.startsWith('layer-')) {
                    const layerZ = parseInt(layer.id.split('-')[1], 10);
                    if (layerZ > z) {
                      beforeId = layer.id;
                      break;
                    }
                  }
                }

                m.addLayer(
                  {
                    id: `layer-${z}-${row}-${col}`,
                    type: 'raster',
                    source: sourceId,
                    paint: { 'raster-fade-duration': 0 },
                  },
                  beforeId
                );
              })
              .catch(() => {
                loadedTilesRef.current.delete(sourceId);
              });
          }
        }
      }
    },
    [sourceKey, image, px2lngLat, scale]
  );

  // ── Initialize map ──
  useEffect(() => {
    if (!containerRef.current || !image || !sourceKey || !scale) return;
    cancelledRef.current = false;
    loadedTilesRef.current = new Set();
    blobUrlsRef.current = [];

    const m = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {},
        layers: [],
      },
      center: px2lngLat(annotation.x, annotation.y),
      zoom: 3,
      minZoom: -20,
      maxZoom: 22,
      renderWorldCopies: false,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
    });

    m.addControl(
      new maplibregl.NavigationControl({
        showCompass: false,
        showZoom: true,
        visualizePitch: false,
      }),
      'top-left'
    );

    m.touchZoomRotate.disableRotation();

    m.on('load', () => {
      // Annotation marker source + layers
      m.addSource(SOURCE_MARKER, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                label: displayCategory?.name ?? 'Unknown',
              },
              geometry: {
                type: 'Point',
                coordinates: px2lngLat(annotation.x, annotation.y),
              },
            },
          ],
        },
      });

      m.addLayer({
        id: LAYER_MARKER_LABEL,
        type: 'symbol',
        source: SOURCE_MARKER,
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

      // Other annotations source + layer (read-only, hover tooltip).
      m.addSource(SOURCE_OTHER_ANNOTATIONS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      m.addLayer({
        id: LAYER_OTHER_ANNOTATIONS,
        type: 'circle',
        source: SOURCE_OTHER_ANNOTATIONS,
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'case',
            ['get', 'reviewed'], '#00c853',
            '#ff1744',
          ],
          'circle-stroke-color': '#000000',
          'circle-stroke-width': 1,
        },
      });

      const hoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 8,
      });
      hoverPopupRef.current = hoverPopup;

      m.on('mouseenter', LAYER_OTHER_ANNOTATIONS, (e) => {
        m.getCanvas().style.cursor = 'pointer';
        const feat = e.features?.[0];
        if (!feat) return;
        if (feat.geometry.type !== 'Point') return;
        const coords = feat.geometry.coordinates.slice() as [number, number];
        const label = String(feat.properties?.label ?? '');
        const escaped = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const reviewed = !!feat.properties?.reviewed;
        const statusColor = reviewed ? '#00c853' : '#ff1744';
        const statusText = reviewed ? 'Reviewed' : 'Unreviewed';
        let infoTagNames: string[] = [];
        try {
          infoTagNames = JSON.parse(
            String(feat.properties?.infoTags ?? '[]')
          );
        } catch {
          infoTagNames = [];
        }
        const tagText = formatInfoTagsForDisplay(infoTagNames) || '—';
        const escapedTags = tagText
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        hoverPopup
          .setLngLat(coords)
          .setHTML(
            `<div style="color:#000"><div>${escaped}</div>` +
            `<div style="color:${statusColor};font-weight:600;font-size:11px">${statusText}</div>` +
            `${hasInfoTagsRef.current ? `<div style="font-size:11px">Tags: ${escapedTags}</div>` : ''}</div>`
          )
          .addTo(m);
      });
      m.on('mouseleave', LAYER_OTHER_ANNOTATIONS, () => {
        m.getCanvas().style.cursor = '';
        hoverPopup.remove();
      });

      // The active-marker ring, which doubles as the drag handle for moving
      // the annotation.
      const handleEl = document.createElement('div');
      applyActiveMarkerStyle(handleEl);
      const mainMarker = new maplibregl.Marker({
        element: handleEl,
        draggable: true,
        anchor: 'center',
      })
        .setLngLat(px2lngLat(annotation.x, annotation.y))
        .addTo(m);
      mainMarkerRef.current = mainMarker;

      mainMarker.on('drag', () => {
        const ll = mainMarker.getLngLat();
        const src = m.getSource(SOURCE_MARKER) as
          | maplibregl.GeoJSONSource
          | undefined;
        if (!src) return;
        src.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { label: displayCategory?.name ?? 'Unknown' },
              geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
            },
          ],
        });
      });
      mainMarker.on('dragend', () => {
        if (!scale) return;
        const ll = mainMarker.getLngLat();
        setMarkerPosition({
          x: Math.round(ll.lng / scale),
          y: Math.round(-ll.lat / scale),
        });
      });

      // Compute the zoom level that fits the whole image, then add the offset.
      const imageBounds = new maplibregl.LngLatBounds(
        px2lngLat(0, image.height),
        px2lngLat(image.width, 0)
      );
      // Temporarily fit to get the base zoom, then override.
      m.fitBounds(imageBounds, { padding: 20, animate: false });
      const baseZoom = m.getZoom();
      baseZoomRef.current = baseZoom;
      const targetZoom = baseZoom + zoomOffset;

      m.jumpTo({
        center: px2lngLat(annotation.x, annotation.y),
        zoom: targetZoom,
      });

      updateVisibleTiles(m);
      setMap(m);
    });

    const onMoveEnd = () => updateVisibleTiles(m);
    m.on('moveend', onMoveEnd);

    return () => {
      cancelledRef.current = true;
      if (mainMarkerRef.current) {
        mainMarkerRef.current.remove();
        mainMarkerRef.current = null;
      }
      if (hoverPopupRef.current) {
        hoverPopupRef.current.remove();
        hoverPopupRef.current = null;
      }
      m.remove();
      setMap(null);
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [image?.id, sourceKey, scale, zoomOffset]);

  // ── Toggle marker visibility on Tab hold ──
  useEffect(() => {
    if (!map || !visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setHideMarker(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Tab') setHideMarker(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      setHideMarker(false);
    };
  }, [map, visible]);

  // The marker is an HTML element rather than a map layer, so the peek hides
  // the element itself alongside the label layer.
  useEffect(() => {
    if (!map) return;
    const element = mainMarkerRef.current?.getElement();
    if (element) element.style.visibility = hideMarker ? 'hidden' : '';
    if (map.getLayer(LAYER_MARKER_LABEL)) {
      map.setLayoutProperty(
        LAYER_MARKER_LABEL,
        'visibility',
        hideMarker ? 'none' : 'visible'
      );
    }
  }, [hideMarker, map]);

  // ── Save helpers ──

  const incrementObservedCount = useCallback(async () => {
    if (!queueId) return;
    try {
      await client.mutations.incrementQueueCount({ id: queueId });
    } catch (err) {
      console.error('Failed to increment observedCount', err);
    }
  }, [client, queueId]);

  const fetchExistingReviewer = useCallback(async (): Promise<string | null> => {
    try {
      const { data } = await client.models.Annotation.get(
        { id: annotation.id },
        { selectionSet: ['id', 'reviewedBy'] }
      );
      return data?.reviewedBy ?? null;
    } catch {
      return null;
    }
  }, [client, annotation.id]);

  // The SQS message must only be deleted once the review is durably stored.
  // Acknowledging alongside the write meant a failed write still discarded the
  // task, losing the review silently instead of letting it be redelivered.
  const commitReview = useCallback(
    async (reviewCatId: string) => {
      const existingReviewer = await fetchExistingReviewer();
      // Re-review by the same user is legitimate (an undo, or a redelivery
      // after a failed acknowledgement); another user's review is not.
      if (existingReviewer && existingReviewer !== user.userId) {
        await ack?.();
        return;
      }

      const { data, errors } = await client.models.Annotation.update({
        id: annotation.id,
        reviewCatId,
        reviewedBy: user.userId,
        x: markerPosition.x,
        y: markerPosition.y,
      });
      // The client resolves with errors rather than throwing, so an unchecked
      // await would look identical to a successful save.
      if (!data) {
        throw new Error(
          `Failed to save review: ${
            errors?.map((error) => error.message).join('; ') ||
            'no row returned'
          }`
        );
      }

      // Queue progress counts each annotation once; a re-review must not
      // advance it again.
      if (!existingReviewer) {
        await incrementObservedCount();
      }

      await ack?.();
    },
    [
      client,
      annotation.id,
      ack,
      user.userId,
      markerPosition,
      fetchExistingReviewer,
      incrementObservedCount,
    ]
  );

  const handleApprove = useCallback(() => {

    setReviewedCatId(annotation.categoryId);

    // Navigation still is not blocked on the network; the commit runs in the
    // background, but its steps are ordered so a failure leaves the task on
    // the queue to be redelivered.
    void commitReview(annotation.categoryId).catch((err) =>
      console.error('Failed to approve annotation', err)
    );

    if (next) {
      next();
    } else {
      startWaiting();
    }
  }, [annotation, commitReview, next]);

  const handleRelabel = useCallback(
    (newCategoryId: string) => {

      setReviewedCatId(newCategoryId);

      void commitReview(newCategoryId).catch((err) =>
        console.error('Failed to relabel annotation', err)
      );

      if (next) {
        next();
      } else {
        startWaiting();
      }
    },
    [commitReview, next]
  );

  const startWaiting = useCallback(() => {
    if (waiting || waitingTimerRef.current) return;
    setWaiting(true);
    setSecondsRemaining(60);
    countdownRef.current = window.setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    waitingTimerRef.current = window.setTimeout(() => {
      setWaiting(false);
      waitingTimerRef.current = undefined;
      if (countdownRef.current) clearInterval(countdownRef.current);
      alert(
        'No new work was loaded. The job appears to be complete. Thank you for your contribution!'
      );
      navigate('/surveys');
    }, 60000);
  }, [waiting, navigate]);

  const saveDefaultZoom = useCallback(async () => {
    if (!map) return;
    const currentZoom = map.getZoom();
    const base = baseZoomRef.current;
    if (base == null) return;
    const newOffset = Math.round(currentZoom - base);

    if (!hasLocalZoom) {
      // Check if admin on this project — offer to save for everyone
      const isAdmin = adminMemberships?.some(
        (m) => m.projectId === projectId
      );
      if (isAdmin) {
        const result = window.prompt(
          'Set as default zoom for all users on this job? (y/n)'
        );
        if (result === null) return;
        if (result?.toLowerCase() === 'y') {
          await client.models.Queue.update({
            id: queueId,
            zoom: newOffset,
          });
          setQueueZoom(newOffset);
          alert(
            'Default zoom updated for all users. Save & Exit for changes to take effect.'
          );
          return;
        }
      }
    }

    if (hasLocalZoom) {
      // Reset personal zoom
      localStorage.removeItem(`qcDefaultZoom-${queueId}`);
      setHasLocalZoom(false);
      setZoomOffset(queueZoom ?? DEFAULT_ZOOM_OFFSET);
    } else {
      // Save personal zoom
      localStorage.setItem(`qcDefaultZoom-${queueId}`, String(newOffset));
      setHasLocalZoom(true);
      setZoomOffset(newOffset);
    }
  }, [map, hasLocalZoom, adminMemberships, projectId, client, queueId, queueZoom, setQueueZoom]);

  const handleFalsePositive = useCallback(async () => {
    let fpCatId: string;

    if (existingFpCategory) {
      fpCatId = existingFpCategory.id;
    } else {
      if (!projectId || !annotationSetId) {
        console.error('Cannot create False Positive category: missing projectId or annotationSetId');
        return;
      }
      if (creatingFp) return;
      setCreatingFp(true);
      try {
        const { data } = await client.models.Category.create({
          projectId,
          annotationSetId,
          name: 'False Positive',
          shortcutKey: '+',
          color: '#888888',
          group,
        });
        if (data) {
          fpCatId = data.id;
          setCategories((prev) => [
            ...prev,
            { id: data.id, name: 'False Positive', shortcutKey: '+' },
          ]);
        } else {
          setCreatingFp(false);
          return;
        }
      } catch (err) {
        console.error('Failed to create False Positive category', err);
        setCreatingFp(false);
        return;
      }
      setCreatingFp(false);
    }

    setReviewedCatId(fpCatId);

    void commitReview(fpCatId).catch((err) =>
      console.error('Failed to mark as false positive', err)
    );

    if (next) {
      next();
    } else {
      startWaiting();
    }
  }, [
    existingFpCategory, projectId, annotationSetId, creatingFp,
    client, group, commitReview, next,
    setCategories, startWaiting,
  ]);

  // ── Hotkey handling ──
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {

      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const key = e.key;

      // Arrow left = undo (go back)
      if (key === 'ArrowLeft') {
        e.preventDefault();
        prev?.();
        return;
      }

      // Check if key matches a category shortcutKey. Matching goes through
      // findShortcutMatch because a stored shortcutKey may be a combo
      // ('ctrl+h') or a physical key name ('period'), neither of which can be
      // compared against event.key directly.
      const matchingCategory = findShortcutMatch(
        e,
        categories,
        (c) => c.shortcutKey
      );
      if (matchingCategory) {
        e.preventDefault();
        if (matchingCategory.id === annotation.categoryId) {
          handleApprove(); // Confirmed correct
        } else {
          handleRelabel(matchingCategory.id); // Fix: relabel
        }
        return;
      }

      // "=" and "+" always triggers false positive (never a valid category shortcut)
      if (key === '=' || (key === '+' && !existingFpCategory)) {
        e.preventDefault();
        handleFalsePositive();
        return;
      }

      // Spacebar = approve (reserved, never a category shortcut)
      if (key === ' ') {
        e.preventDefault();
        handleApprove();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    visible,
    categories,
    annotation.categoryId,
    handleApprove,
    handleRelabel,
    handleFalsePositive,
    existingFpCategory,
    prev,
  ]);

  // ── Render ──

  if (!image || !sourceKey) {
    return (
      <div className='d-flex justify-content-center align-items-center w-100 h-100'>
        <div className='text-muted'>Loading image...</div>
      </div>
    );
  }

  return (
    <div className='d-flex flex-column w-100 h-100'>
      {/* Header bar */}
      <div
        className='d-flex align-items-center justify-content-between py-2'
        style={{
          backgroundColor: '#2b3e50',
          flexShrink: 0,
        }}
      >
        <div className='d-flex align-items-center gap-3'>
          <Badge bg='info'>
            {displayCategory?.name ?? 'Unknown'}
          </Badge>
          {reviewedCatId && (
            <Badge bg='success' style={{ fontSize: '11px' }}>
              Reviewed
            </Badge>
          )}
          <span className='text-muted' style={{ fontSize: '12px' }}>
            Tip: Hold Tab to hide the marker
          </span>
        </div>
        <button
          className='p-0 m-0 border-0 bg-transparent d-flex align-items-center text-white'
          onClick={saveDefaultZoom}
        >
          {hasLocalZoom ? <RotateCcw size={20} /> : <SearchCheck size={20} />}
          <span className='ms-2 mb-0 d-none d-md-block' style={{ fontSize: '13px' }}>
            {hasLocalZoom ? 'Reset zoom' : 'Set as default zoom'}
          </span>
        </button>
      </div>

      {/* Map + side legend */}
      <div className='d-flex' style={{ flex: 1, overflow: 'hidden' }}>
        {/* Map container */}
        <div style={{ flex: 1, position: 'relative' }}>
          <div
            ref={containerRef}
            style={{
              width: '100%',
              height: '100%',
              background: '#ffffff',
              borderRadius: 10,
              overflow: 'hidden',
              border: '1px solid rgba(255, 255, 255, 0.1)',
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
                borderRadius: '12px',
                padding: '20px 32px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  border: '3px solid rgba(255, 255, 255, 0.2)',
                  borderTopColor: '#fff',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ color: '#fff', fontSize: '14px', textAlign: 'center' }}>
                Waiting for new work... ({secondsRemaining}s remaining)
              </div>
            </div>
          )}
        </div>

        {/* Collapsible side legend */}
        {legendCollapsed ? (
          <div className='d-flex align-items-center' style={{ padding: '0 4px', flexShrink: 0, height: '100%', marginLeft: '12px' }}>
            <Button
              variant='secondary'
              size='sm'
              onClick={() => setLegendCollapsed(false)}
              className='d-flex align-items-center justify-content-center'
              style={{
                width: '28px',
                height: '100%',
                borderRadius: '4px',
                padding: 0,
              }}
              title='Expand legend'
            >
              <ChevronLeft size={18} />
            </Button>
          </div>
        ) : (
          <div className='d-flex flex-column' style={{ position: 'relative', height: '100%', flexShrink: 0, marginLeft: '24px' }}>
            <Button
              variant='secondary'
              size='sm'
              onClick={() => setLegendCollapsed(true)}
              className='d-flex align-items-center justify-content-center'
              style={{
                position: 'absolute',
                left: '-16px',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 10,
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                padding: 0,
              }}
              title='Collapse legend'
            >
              <ChevronRight size={18} />
            </Button>

            <Card className='d-flex flex-column h-100 overflow-hidden' style={{ width: '280px' }}>
              <Card.Header>
                <Card.Title className='d-flex flex-row align-items-center gap-2 mb-2'>
                  <span>Legend</span>
                </Card.Title>
                <span className='text-muted' style={{ fontSize: '14px' }}>
                  Press a shortcut key to approve or fix
                </span>
              </Card.Header>
              <Card.Body className='d-flex flex-column gap-2 overflow-auto'>
                {legendCategories
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((cat) => (
                    <Button
                      variant={cat.id === displayCategoryId ? 'info' : 'primary'}
                      key={cat.id}
                      className='d-flex flex-row align-items-center justify-content-between gap-2'
                      onClick={() => {
                        if (cat.id === annotation.categoryId) {
                          handleApprove();
                        } else {
                          handleRelabel(cat.id);
                        }
                      }}

                    >
                      <div>{cat.name}</div>
                      {cat.shortcutKey && (
                        <div>({formatShortcutKey(cat.shortcutKey)})</div>
                      )}
                    </Button>
                  ))}
              </Card.Body>
            </Card>
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div
        className='d-flex align-items-center justify-content-between py-2 mt-2'
        style={{
          backgroundColor: '#2b3e50',
          flexShrink: 0,
        }}
      >
        <div className='d-flex align-items-center gap-2'>
          <Button
            className='d-flex align-items-center justify-content-center gap-1'
            variant='primary'
            style={{ width: 160 }}
            onClick={prev}
            disabled={!prev}
          >
            <Undo2 size={16} />
            <span>Undo</span>
          </Button>
        </div>
        <div className='d-flex align-items-center gap-2'>
          <Button
            variant='success'
            style={{ width: 160 }}
            onClick={handleApprove}
          >
            Approve (Space)
          </Button>
          <Button
            variant='warning'
            style={{ width: 200 }}
            onClick={handleFalsePositive}
          >
            {fpLabel}
          </Button>
        </div>
        <div className='d-flex align-items-center gap-2'>
          <Button
            variant='primary'
            style={{ width: 160 }}
            onClick={() => navigate('/jobs')}

          >
            Save &amp; Exit
          </Button>
        </div>
      </div>
    </div>
  );
}
