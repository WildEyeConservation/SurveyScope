import * as maplibregl from 'maplibre-gl';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Spinner } from '@/components/ui/spinner';
import 'maplibre-gl/dist/maplibre-gl.css';

import { isHotkeyPressed } from 'react-hotkeys-hook';
import { isOnEffort } from '../../shared/boundaryStatus';
import { canMarkOutsideBoundary, isMarkedOutside } from '../annotationBoundary';
import type {
  AnnotationImage,
  AnnotationLocation,
  NeighbourImageLookup,
  OtherViewsHandler,
  OtherViewsTarget,
  ViewerFocus,
} from '../annotationTypes';
import ChangeCategoryModal from '../ChangeCategoryModal';
import { ImageContext, ManagementContext, ProjectContext } from '../Context';
import { NavButtons } from '../NavButtons';
import type { CategoryType, ExtendedAnnotationType } from '../schemaTypes';
import {
  PaletteViewerContext,
  useViewerHotkeys,
} from '../species-notebook/paletteViewer';
import {
  clearViewerZoom,
  reportViewerZoom,
  scaleFromZoom,
} from '../species-notebook/viewerZoom';
import useImageMenuItems from '../useImageMenuItems';
import { isWithinLocationBounds, resolveCategoryIdForSet } from '../utils';
import {
  canonicalHotkeyFromParsed,
  normalizeShortcutKey,
} from '../utils/hotkeys';
import {
  buildAnnotationFeatureCollection,
  buildAnnotationPopupLines,
  isFalseNegative,
  type AnnotationFeatureProperties,
} from './annotationFeatures';
import {
  addAnnotationMarkerLayers,
  ANNOTATION_MARKER_LAYERS,
  registerAnnotationMarkerImages,
} from './annotationMarkerLayers';
import {
  buildAnnotationMenuItems,
  buildImageMenuItems,
} from './annotationMenus';
import {
  AnnotationLegendOverlay,
  ContextMenuOverlay,
  ImageFileStatusOverlay,
  type MenuState,
} from './AnnotatorOverlays';
import {
  addImageTiles,
  createImageMap,
  fitPxBounds,
  makeProjection,
  mapZoomToStoredZoom,
  storedZoomToMapZoom,
} from './imageTiles';
import MapRotateControl from './MapRotateControl';
import { useNeighbourOverlaps } from './neighbourOverlapLayers';
import { setAnnotatorViewport } from './prefetchTask';
import useImageFileSource from './useImageFileSource';
import { defaultViewBoundsScale } from './viewTiles';

/*
MapLibre-based image viewer for the species-labelling workflow, including
image tiles, annotations, location bounds, hotkeys, zoom tracking and legend.

Tiling: the image is mapped onto the full mercator world square, so the
existing slippy pyramid (slippymaps/{key}/{z}/{row}/{col}.png) aligns exactly
with MapLibre's native tile grid. A custom `detweb://` protocol feeds tiles
from getTileBlob (S3 + on-demand Lambda generation + localforage cache), and
MapLibre handles fading, retention and overzoom natively.

Stored zoom parity: saved default zooms use the image pyramid's level
numbering. MapLibre's native zoom is one level lower, so convert on the way in
(zoom - 1) and out (zoom + 1).
*/

const SOURCE_ANNOTATIONS = 'annotations';
const LAYER_ACTIVE = ANNOTATION_MARKER_LAYERS.active;
const LAYER_OUTLINES = ANNOTATION_MARKER_LAYERS.outlines;
const LAYER_CIRCLES = ANNOTATION_MARKER_LAYERS.circles;
const LAYER_ICONS = ANNOTATION_MARKER_LAYERS.icons;
const LAYER_STATUS_ICONS = ANNOTATION_MARKER_LAYERS.statusIcons;
const SOURCE_LOCATION = 'location-rect';
const LAYER_LOCATION = 'location-rect-line';
const POPUP_GRACE_MS = 300;
const POPUP_EVENTS = [
  'mousedown',
  'mouseup',
  'mousemove',
  'click',
  'dblclick',
  'contextmenu',
  'mouseover',
  'mouseout',
] as const;

const otherViewsTarget = (a: ExtendedAnnotationType): OtherViewsTarget => ({
  id: a.id,
  imageId: a.imageId,
  objectId: a.objectId ?? null,
  categoryId: a.categoryId,
  x: a.x,
  y: a.y,
});

// Unsnapped, so images of other sizes open at the same magnification.
function centreAt(
  map: maplibregl.Map,
  center: maplibregl.LngLatLike,
  zoom: number,
) {
  const snap = map.getZoomSnap();
  map.setZoomSnap(0);
  map.jumpTo({ center, zoom });
  map.setZoomSnap(snap);
}

export interface MapLibreAnnotatorProps {
  image: AnnotationImage;
  location: AnnotationLocation;
  visible: boolean;
  /** Default zoom using the persisted image-pyramid scale. */
  zoom?: number;
  viewBoundsScale?: number;
  next?: () => void;
  prev?: () => void;
  hideNavButtons?: boolean;
  stats?: Record<string, number>;
  isTest?: boolean;
  allowOutside?: boolean;
  /** Set annotations are written to (the ephemeral test set during tests). */
  setId: string;
  /** Source tag for created annotations. */
  source: string;
  /** Categories for legend, hotkeys and marker colours (already filtered to the real set). */
  categories: CategoryType[];
  hideFnAnnotations?: boolean;
  /** Read-only markers outside the working set. */
  readonlyAnnotations?: ExtendedAnnotationType[] | null;
  /** Force the on-map legend visible (used when the side legend is collapsed). */
  showMapLegend?: boolean;
  /** Informational tag names per annotation id, shown in the hover popup. */
  infoTags?: Map<string, string[]>;
  /** Fill the container with no frame or task outline. */
  embedded?: boolean;
  /** False leaves adding marks to the category hotkeys. */
  clickToCreate?: boolean;
  otherViews?: OtherViewsHandler;
  neighbourOverlaps?: NeighbourImageLookup;
  /** Centres on this point whenever `seq` changes, at `zoom` if given. */
  focus?: ViewerFocus;
  bearing?: number;
  onBearingChange?: (bearing: number) => void;
}

export default function MapLibreAnnotator(props: MapLibreAnnotatorProps) {
  const {
    image,
    location,
    visible,
    zoom,
    viewBoundsScale,
    next,
    prev,
    hideNavButtons,
    stats,
    isTest,
    allowOutside,
    setId,
    source,
    categories,
    hideFnAnnotations,
    readonlyAnnotations,
    showMapLegend,
    infoTags,
    embedded,
    clickToCreate = true,
    otherViews,
    neighbourOverlaps,
    focus,
    bearing,
    onBearingChange,
  } = props;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const palette = useContext(PaletteViewerContext);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const bearingRef = useRef(bearing);
  bearingRef.current = bearing;
  const onBearingChangeRef = useRef(onBearingChange);
  onBearingChangeRef.current = onBearingChange;

  const {
    annotationsHook,
    setVisibleTimestamp,
    setFullyLoadedTimestamp,
    setZoom,
  } = useContext(ImageContext)!;
  const { allUsers } = useContext(ManagementContext)!;
  const {
    project,
    currentCategory,
    setCurrentCategory,
    categoriesHook: { data: projectCategories },
  } = useContext(ProjectContext)!;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const popupAnnotationIdRef = useRef<string | null>(null);
  const popupCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otherViewsRef = useRef(otherViews);
  otherViewsRef.current = otherViews;
  const [mapReady, setMapReady] = useState(false);
  const [fullyLoaded, setFullyLoaded] = useState(false);
  const [canAdvance, setCanAdvance] = useState(false);
  const [markersHidden, setMarkersHidden] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [categoryModalAnnotation, setCategoryModalAnnotation] =
    useState<ExtendedAnnotationType | null>(null);

  // Refs for values read inside imperative map handlers
  const cursorPxRef = useRef({ x: 0, y: 0 });
  const mouseOverMapRef = useRef(false);
  const hoveredIdRef = useRef<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dragPositionRef = useRef<{ x: number; y: number } | null>(null);
  const annotationsRef = useRef<ExtendedAnnotationType[]>([]);
  const readonlyAnnotationsRef = useRef<ExtendedAnnotationType[]>([]);

  const {
    imageFiles,
    loading: imageFilesLoading,
    sourceKey,
  } = useImageFileSource(image.id, location?.id);

  const projection = useMemo(
    () => makeProjection(image.width, image.height),
    [image.width, image.height],
  );
  const { px2lngLat, lngLat2px } = projection;

  const locationBounds =
    !allowOutside && location?.width && location?.height
      ? {
          x: location.x,
          y: location.y,
          width: location.width,
          height: location.height,
        }
      : undefined;
  const writeBounds = allowOutside
    ? {
        x: image.width / 2,
        y: image.height / 2,
        width: image.width,
        height: image.height,
      }
    : locationBounds;

  const menuItems = useImageMenuItems({
    image,
    location,
    sourceKey,
    isTest,
    stats,
  });
  const menuItemsRef = useRef(menuItems);
  menuItemsRef.current = menuItems;
  const locationBoundsRef = useRef(locationBounds);
  locationBoundsRef.current = locationBounds;
  const writeBoundsRef = useRef(writeBounds);
  writeBoundsRef.current = writeBounds;
  // Read at hover time so tags arriving later show up without rebinding the
  // map's interaction handlers.
  const infoTagsRef = useRef(infoTags);
  infoTagsRef.current = infoTags;
  const outsideRef = useRef(false);
  outsideRef.current = !isOnEffort(image.boundaryStatus);

  const annotations = useMemo(
    () =>
      ((annotationsHook.data ?? []) as ExtendedAnnotationType[])
        .filter((annotation) => annotation.setId === setId)
        .filter(
          (annotation) => !(hideFnAnnotations && isFalseNegative(annotation)),
        ),
    [annotationsHook.data, setId, hideFnAnnotations],
  );
  annotationsRef.current = annotations;

  const shownReadonlyAnnotations = useMemo(
    () => readonlyAnnotations ?? [],
    [readonlyAnnotations],
  );
  readonlyAnnotationsRef.current = shownReadonlyAnnotations;

  const cancelPopupClose = useCallback(() => {
    if (popupCloseTimerRef.current) clearTimeout(popupCloseTimerRef.current);
    popupCloseTimerRef.current = null;
  }, []);
  const closePopup = useCallback(() => {
    cancelPopupClose();
    popupRef.current?.remove();
    popupRef.current = null;
    popupAnnotationIdRef.current = null;
  }, [cancelPopupClose]);
  // With an action in it, the popup lingers so the pointer can reach it.
  const schedulePopupClose = useCallback(() => {
    if (!otherViewsRef.current) return closePopup();
    if (!popupCloseTimerRef.current)
      popupCloseTimerRef.current = setTimeout(closePopup, POPUP_GRACE_MS);
  }, [closePopup]);
  const openOtherViews = useCallback(
    (annotation: ExtendedAnnotationType) => {
      closePopup();
      otherViewsRef.current?.open(otherViewsTarget(annotation));
    },
    [closePopup],
  );

  const categoryColor = useCallback(
    (categoryId: string) =>
      categories?.find((c) => c.id === categoryId)?.color ?? 'red',
    [categories],
  );
  const categoryName = useCallback(
    (categoryId: string) =>
      categories?.find((c) => c.id === categoryId)?.name ?? 'Unknown',
    [categories],
  );

  // No image files: nothing will ever load, so unblock the task lifecycle
  useEffect(() => {
    if (!imageFilesLoading && imageFiles.length === 0 && !fullyLoaded) {
      setFullyLoaded(true);
    }
  }, [imageFiles.length, imageFilesLoading, fullyLoaded]);

  const buildFeatureCollection = useCallback((): GeoJSON.FeatureCollection => {
    return buildAnnotationFeatureCollection({
      annotations: annotationsRef.current,
      readonlyAnnotations: readonlyAnnotationsRef.current,
      draggedAnnotationId: draggingIdRef.current,
      dragPosition: dragPositionRef.current,
      locationBounds: locationBoundsRef.current,
      px2lngLat,
      categoryColor,
      plainFalseNegatives: Boolean(palette),
    });
  }, [px2lngLat, categoryColor, palette]);

  const refreshAnnotationSource = useCallback(() => {
    const src = mapRef.current?.getSource(SOURCE_ANNOTATIONS) as
      maplibregl.GeoJSONSource | undefined;
    src?.setData(buildFeatureCollection());
  }, [buildFeatureCollection]);

  // ── Map construction ──
  useEffect(() => {
    if (!containerRef.current || !sourceKey) return;

    const map = createImageMap(containerRef.current, projection);
    mapRef.current = map;
    if (bearingRef.current) map.setBearing(bearingRef.current);
    map.on('rotateend', () => onBearingChangeRef.current?.(map.getBearing()));
    map.setZoomSnap(1);
    map.addControl(
      new maplibregl.NavigationControl({
        showCompass: false,
        showZoom: true,
      }),
      'top-left',
    );
    map.addControl(new MapRotateControl(), 'top-left');

    const unregisterMarkerImages = registerAnnotationMarkerImages(map);

    map.on('load', () => {
      // Frame first so the only tiles requested are the ones shown.
      if (map.getContainer().clientWidth) {
        map.resize();
        fitInitialView(map);
        if (embedded) embeddedFittedRef.current = true;
      }
      addImageTiles(map, sourceKey, image, projection, location?.id);

      // Location rectangle (task bounds)
      if (!embedded && location?.width && location?.height) {
        const x0 = location.x - location.width / 2;
        const y0 = location.y - location.height / 2;
        const x1 = location.x + location.width / 2;
        const y1 = location.y + location.height / 2;
        map.addSource(SOURCE_LOCATION, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                px2lngLat(x0, y0),
                px2lngLat(x1, y0),
                px2lngLat(x1, y1),
                px2lngLat(x0, y1),
                px2lngLat(x0, y0),
              ],
            },
            properties: {},
          },
        });
        map.addLayer({
          id: LAYER_LOCATION,
          type: 'line',
          source: SOURCE_LOCATION,
          paint: { 'line-color': 'blue', 'line-width': 2 },
        });
      }

      map.addSource(SOURCE_ANNOTATIONS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      addAnnotationMarkerLayers(map, SOURCE_ANNOTATIONS);

      refreshAnnotationSource();
      setMapReady(true);
      map.once('idle', () => setFullyLoaded(true));
    });

    map.on('zoomend', (e) => {
      // Report using the persisted scale so existing default zooms stay stable.
      setZoom(mapZoomToStoredZoom(map.getZoom()));
      if (!visibleRef.current) return;
      const inPalette = paletteRef.current;
      if (!inPalette) reportViewerZoom(mapRef, map.getZoom(), image);
      else if (e.originalEvent)
        inPalette.onUserZoom(
          scaleFromZoom(map.getZoom(), image.width, image.height),
        );
    });

    return () => {
      unregisterMarkerImages();
      closePopup();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      setFullyLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, image.id]);

  // ── Initial view ──
  const fitInitialView = (map: maplibregl.Map) => {
    if (focus?.zoom != null) {
      centreAt(map, px2lngLat(focus.x, focus.y), focus.zoom);
    } else if (zoom != null) {
      map.jumpTo({
        center: px2lngLat(
          location?.x ?? image.width / 2,
          location?.y ?? image.height / 2,
        ),
        zoom: storedZoomToMapZoom(zoom),
      });
    } else {
      const scale = viewBoundsScale ?? defaultViewBoundsScale(location);
      const hasBounds = location?.x && location?.width && location?.height;
      // Not clamped to the image, so edge locations stay centred.
      const left = hasBounds ? location.x - location.width * scale : 0;
      const top = hasBounds ? location.y - location.height * scale : 0;
      const right = hasBounds
        ? location.x + location.width * scale
        : image.width;
      const bottom = hasBounds
        ? location.y + location.height * scale
        : image.height;
      fitPxBounds(map, projection, left, top, right, bottom);
    }
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || embedded) return;
    fitInitialView(map);
    // Reapply when a default changes while this buffered workspace is already
    // mounted. Other inputs are fixed for the lifetime of this map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, zoom]);

  const embeddedFittedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady) embeddedFittedRef.current = false;
    if (!embedded || !map || !mapReady || embeddedFittedRef.current) return;
    // A hidden tab has no size to fit to; retry once it is shown.
    if (!map.getContainer().clientWidth) return;
    embeddedFittedRef.current = true;
    map.resize();
    fitInitialView(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, mapReady, visible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || bearing == null) return;
    if (Math.abs(map.getBearing() - bearing) % 360 > 0.5)
      map.setBearing(bearing);
  }, [mapReady, bearing]);

  const appliedFocusRef = useRef<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady) appliedFocusRef.current = null;
    if (!map || !mapReady || !focus || appliedFocusRef.current === focus.seq)
      return;
    if (!map.getContainer().clientWidth) return;
    appliedFocusRef.current = focus.seq;
    if (focus.zoom != null) {
      centreAt(map, px2lngLat(focus.x, focus.y), focus.zoom);
      return;
    }
    const half = Math.min(image.width, image.height) / 8;
    fitPxBounds(
      map,
      projection,
      focus.x - half,
      focus.y - half,
      focus.x + half,
      focus.y + half,
    );
  }, [
    mapReady,
    focus,
    visible,
    image.width,
    image.height,
    projection,
    px2lngLat,
  ]);

  // ── Annotation data sync ──
  useEffect(() => {
    if (mapReady) refreshAnnotationSource();
  }, [
    annotations,
    shownReadonlyAnnotations,
    mapReady,
    refreshAnnotationSource,
  ]);

  useNeighbourOverlaps(
    mapReady ? mapRef.current : null,
    image,
    px2lngLat,
    palette ? undefined : neighbourOverlaps,
  );

  // ── Interactions ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const featureAt = (point: maplibregl.Point) => {
      if (!map.getLayer(LAYER_CIRCLES)) return undefined;
      return map.queryRenderedFeatures(point, { layers: [LAYER_CIRCLES] })[0];
    };
    const annotationById = (id: string) =>
      annotationsRef.current.find((a) => a.id === id);
    // Only for display; read-only features never reach a write handler.
    const displayedAnnotationById = (id: string) =>
      annotationById(id) ??
      readonlyAnnotationsRef.current.find((a) => a.id === id);
    const featureProperties = (
      feature?: maplibregl.MapGeoJSONFeature,
    ): AnnotationFeatureProperties | undefined =>
      feature?.properties as AnnotationFeatureProperties | undefined;

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const px = lngLat2px(e.lngLat.lng, e.lngLat.lat);
      cursorPxRef.current = px;

      if (draggingIdRef.current) {
        dragPositionRef.current = px;
        refreshAnnotationSource();
        return;
      }

      const feature = featureAt(e.point);
      map.getCanvas().style.cursor = feature ? 'pointer' : '';
      const id = featureProperties(feature)?.id ?? null;
      if (id !== hoveredIdRef.current) {
        hoveredIdRef.current = id;
        const annotation = id ? displayedAnnotationById(id) : undefined;
        if (!annotation || paletteRef.current) {
          schedulePopupClose();
        } else if (popupAnnotationIdRef.current === id) {
          cancelPopupClose();
        } else {
          closePopup();
          const div = document.createElement('div');
          div.style.color = '#212529';
          div.style.fontSize = '13px';
          div.style.lineHeight = '1.5';
          div.style.whiteSpace = 'nowrap';
          const lines = buildAnnotationPopupLines(
            annotation,
            categoryName,
            allUsers,
            infoTagsRef.current?.get(annotation.id),
            outsideRef.current || isMarkedOutside(annotation),
          );
          lines.forEach((text) => {
            const row = document.createElement('div');
            row.textContent = text;
            div.appendChild(row);
          });
          const views = otherViewsRef.current;
          if (views) {
            div.appendChild(
              otherViewsRow(views.describe(otherViewsTarget(annotation)), () =>
                openOtherViews(annotation),
              ),
            );
          }
          const popup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false,
            maxWidth: '360px',
            offset: 12,
          })
            .setLngLat(
              (feature!.geometry as GeoJSON.Point).coordinates as [
                number,
                number,
              ],
            )
            .setDOMContent(div)
            .addTo(map);
          popupRef.current = popup;
          popupAnnotationIdRef.current = annotation.id;
          if (views) {
            const el = popup.getElement();
            for (const type of POPUP_EVENTS)
              el.addEventListener(type, (event) => event.stopPropagation());
            el.addEventListener('mouseenter', cancelPopupClose);
            el.addEventListener('mouseleave', () => {
              hoveredIdRef.current = null;
              schedulePopupClose();
            });
          }
        }
      }
    };

    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (e.originalEvent.button !== 0) return;
      const feature = featureAt(e.point);
      const properties = featureProperties(feature);
      if (!properties || properties.readonly || paletteRef.current) return;
      e.preventDefault(); // keep the map from panning
      draggingIdRef.current = properties.id;
      dragPositionRef.current = lngLat2px(e.lngLat.lng, e.lngLat.lat);
      map.getCanvas().style.cursor = 'grabbing';
    };

    const onMouseUp = () => {
      const id = draggingIdRef.current;
      const pos = dragPositionRef.current;
      draggingIdRef.current = null;
      dragPositionRef.current = null;
      map.getCanvas().style.cursor = '';
      if (!id || !pos) return;
      const annotation = annotationById(id);
      if (!annotation) return;
      const x = Math.round(pos.x);
      const y = Math.round(pos.y);
      const bounds = writeBoundsRef.current;
      if (bounds && !isWithinLocationBounds({ x, y }, bounds)) {
        refreshAnnotationSource(); // revert
        return;
      }
      if (x !== annotation.x || y !== annotation.y) {
        annotationsHook.update({ ...annotation, x, y });
      } else {
        refreshAnnotationSource();
      }
    };

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (menu) {
        setMenu(null);
        return;
      }
      if (!clickToCreate) return;
      if (featureAt(e.point)) return; // clicks on markers never create
      const px = lngLat2px(e.lngLat.lng, e.lngLat.lat);
      const xy = { x: Math.round(px.x), y: Math.round(px.y) };
      const bounds = writeBoundsRef.current;
      if (bounds && !isWithinLocationBounds(xy, bounds)) return;
      if (!currentCategory || !source || !project) return;
      annotationsHook.create({
        imageId: image.id,
        setId,
        projectId: project.id,
        x: xy.x,
        y: xy.y,
        // Test marks must retain the labels shown in the legend.
        categoryId: resolveCategoryIdForSet(
          currentCategory,
          [...(categories ?? []), ...(projectCategories ?? [])],
          categories?.[0]?.annotationSetId ?? location.annotationSetId,
        ),
        source,
        obscured: false,
        group: project.organizationId,
      });
    };

    const onContextMenu = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      if (paletteRef.current) return;
      const feature = featureAt(e.point);
      if (feature) {
        const properties = featureProperties(feature);
        if (!properties) return;
        const annotation = displayedAnnotationById(properties.id);
        if (!annotation) return;
        const items = buildAnnotationMenuItems({
          annotation,
          readonly: properties.readonly || !annotationById(properties.id),
          canMarkOutside: canMarkOutsideBoundary() && !outsideRef.current,
          onDelete: annotationsHook.delete,
          onUpdate: annotationsHook.update,
          onChangeCategory: setCategoryModalAnnotation,
        });
        if (otherViewsRef.current)
          items.push({
            text: 'View in other images',
            callback: () => openOtherViews(annotation),
          });
        closePopup();
        setMenu({ x: e.point.x, y: e.point.y, items });
      } else {
        const items = buildImageMenuItems(
          menuItemsRef.current,
          location.confidence,
        );
        setMenu({ x: e.point.x, y: e.point.y, items });
      }
    };

    const onMouseOver = () => {
      mouseOverMapRef.current = true;
    };
    const onMouseOut = (e: maplibregl.MapMouseEvent) => {
      mouseOverMapRef.current = false;
      map.getCanvas().style.cursor = '';
      hoveredIdRef.current = null;
      const into = e.originalEvent.relatedTarget as Node | null;
      if (into && popupRef.current?.getElement().contains(into))
        cancelPopupClose();
      else schedulePopupClose();
    };

    map.on('mousemove', onMouseMove);
    map.on('mousedown', onMouseDown);
    map.on('mouseup', onMouseUp);
    map.on('click', onClick);
    map.on('contextmenu', onContextMenu);
    map.on('mouseover', onMouseOver);
    map.on('mouseout', onMouseOut);
    return () => {
      map.off('mousemove', onMouseMove);
      map.off('mousedown', onMouseDown);
      map.off('mouseup', onMouseUp);
      map.off('click', onClick);
      map.off('contextmenu', onContextMenu);
      map.off('mouseover', onMouseOver);
      map.off('mouseout', onMouseOut);
    };
  }, [
    mapReady,
    menu,
    clickToCreate,
    currentCategory,
    projectCategories,
    categories,
    source,
    setId,
    project,
    image.id,
    location?.annotationSetId,
    location?.confidence,
    annotationsHook,
    lngLat2px,
    refreshAnnotationSource,
    categoryName,
    allUsers,
    closePopup,
    cancelPopupClose,
    schedulePopupClose,
    openOtherViews,
  ]);

  // ── Marker visibility (Tab to peek underneath) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const visibility = markersHidden ? 'none' : 'visible';
    [
      LAYER_ACTIVE,
      LAYER_OUTLINES,
      LAYER_CIRCLES,
      LAYER_ICONS,
      LAYER_STATUS_ICONS,
      LAYER_LOCATION,
    ].forEach((layer) => {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, 'visibility', visibility);
      }
    });
  }, [markersHidden, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (visible && map && mapReady && !palette)
      reportViewerZoom(mapRef, map.getZoom(), image);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mapReady]);
  useEffect(() => () => clearViewerZoom(mapRef), []);

  // ── Task lifecycle: timestamps + advance gating ──
  useEffect(() => {
    if (visible) {
      setVisibleTimestamp(Date.now());
      mapRef.current?.resize();
      const container = containerRef.current;
      if (container)
        setAnnotatorViewport(container.clientWidth, container.clientHeight);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (fullyLoaded) {
      setFullyLoadedTimestamp(Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullyLoaded]);

  useEffect(() => {
    if (visible && fullyLoaded) {
      const timer = setTimeout(() => setCanAdvance(true), 100);
      return () => clearTimeout(timer);
    }
  }, [visible, fullyLoaded]);

  // ── Hotkeys ──
  useViewerHotkeys(
    'RightArrow',
    next ?? (() => {}),
    {
      enabled: canAdvance && visible,
    },
    [next],
  );
  useViewerHotkeys('LeftArrow', prev ?? (() => {}), { enabled: visible }, [
    prev,
  ]);

  useViewerHotkeys(
    'Tab',
    (event) => {
      event.preventDefault();
      setMarkersHidden(isHotkeyPressed('Tab'));
    },
    { keyup: true, keydown: true, enabled: visible },
  );

  useViewerHotkeys(
    'Backspace',
    () => {
      const id = hoveredIdRef.current;
      if (!id) return;
      const annotation = annotationsRef.current.find((a) => a.id === id);
      if (!annotation) return;
      if (
        locationBoundsRef.current &&
        !isWithinLocationBounds(annotation, locationBoundsRef.current)
      ) {
        return;
      }
      annotationsHook.delete(annotation);
    },
    { enabled: visible && !palette },
    [annotationsHook],
  );

  const hotkeyCategories = useMemo(
    () => (categories ?? []).filter((c) => c.shortcutKey),
    [categories],
  );
  const categoryByHotkey = useMemo(() => {
    const map = new Map<string, CategoryType>();
    for (const category of hotkeyCategories) {
      const key = normalizeShortcutKey(category.shortcutKey);
      // First one wins, matching the previous find() semantics on duplicates.
      if (key && !map.has(key)) map.set(key, category);
    }
    return map;
  }, [hotkeyCategories]);
  const hotkeys = hotkeyCategories.map((c) => c.shortcutKey!).join(',');

  const enterIsLabel = categoryByHotkey.has(normalizeShortcutKey('enter'));
  useViewerHotkeys(
    'enter',
    (event) => {
      const id = hoveredIdRef.current ?? popupAnnotationIdRef.current;
      const annotation = id
        ? (annotationsRef.current.find((a) => a.id === id) ??
          readonlyAnnotationsRef.current.find((a) => a.id === id))
        : undefined;
      if (!annotation) return;
      event.preventDefault();
      openOtherViews(annotation);
    },
    { enabled: visible && !!otherViews && !enterIsLabel },
    [openOtherViews],
  );
  useViewerHotkeys(
    hotkeys || 'f24',
    (event, hotkeysEvent) => {
      if (event.repeat) return;
      if (!mouseOverMapRef.current) return;
      // Resolve from the hotkey that actually matched rather than event.key:
      // event.key cannot represent a combo ('ctrl+h'), does not match recorded
      // physical key names ('period'), and diverges from them on non-US layouts.
      const category = categoryByHotkey.get(
        canonicalHotkeyFromParsed(hotkeysEvent),
      );
      if (!category) return;
      event.preventDefault();
      event.stopPropagation();
      const x = Math.round(cursorPxRef.current.x);
      const y = Math.round(cursorPxRef.current.y);
      const bounds = writeBoundsRef.current;
      if (bounds && !isWithinLocationBounds({ x, y }, bounds)) return;
      annotationsHook.create({
        categoryId: category.id,
        setId,
        imageId: image.id,
        x,
        y,
        projectId: project.id,
        source,
        group: project.organizationId,
      });
      setCurrentCategory(category);
    },
    {
      keydown: true,
      keyup: false,
      enabled: visible && hotkeys.length > 0 && !palette,
    },
    [categoryByHotkey, annotationsHook, setId, image.id, source, project],
  );

  return (
    <div className='flex h-full w-full flex-col items-stretch gap-4'>
      <div
        className='flex h-full w-full flex-col items-stretch'
        style={{
          visibility: visible && fullyLoaded ? 'visible' : 'hidden',
          position: 'relative',
        }}
      >
        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: embedded ? 0 : 10,
            overflow: 'hidden',
            background: palette ? '#1f2933' : '#ffffff',
            border: embedded ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
          }}
        />

        {embedded && visible && !fullyLoaded && (
          <div
            className='absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground'
            style={{ visibility: 'visible' }}
          >
            <Spinner size='sm' />
            Loading image...
          </div>
        )}

        <ImageFileStatusOverlay
          loading={imageFilesLoading}
          fileCount={imageFiles.length}
          imageId={image.id}
        />

        {!palette && (
          <AnnotationLegendOverlay
            categories={categories}
            currentCategoryId={currentCategory?.id}
            forceVisible={showMapLegend}
            onSelectCategory={setCurrentCategory}
          />
        )}

        <ContextMenuOverlay menu={menu} onClose={() => setMenu(null)} />

        <ChangeCategoryModal
          show={categoryModalAnnotation !== null}
          onClose={() => setCategoryModalAnnotation(null)}
          categories={categories}
          currentCategoryId={categoryModalAnnotation?.categoryId}
          onSelectCategory={(categoryId: string) => {
            if (categoryModalAnnotation) {
              annotationsHook.update({
                id: categoryModalAnnotation.id,
                categoryId,
              });
            }
          }}
        />
      </div>

      {(next || prev) && fullyLoaded && !hideNavButtons && (
        <NavButtons prev={prev} next={canAdvance ? next : undefined} />
      )}
    </div>
  );
}

function otherViewsRow(
  info: { label: string; linked: boolean },
  onOpen: () => void,
): HTMLDivElement {
  const row = document.createElement('div');
  row.style.cssText =
    'margin-top:8px;padding-top:8px;border-top:1px solid #dee2e6';
  const button = document.createElement('button');
  button.type = 'button';
  button.title = 'Enter';
  button.style.cssText =
    'display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;padding:6px 10px;font-size:13px;font-weight:600;line-height:1.2;cursor:pointer;border:0;background:#df6919;color:#fff';
  const hint = document.createElement('span');
  hint.textContent = '↵';
  hint.style.cssText = 'opacity:.7;font-weight:400';
  button.append(info.label, hint);
  button.addEventListener('mouseenter', () => {
    button.style.background = '#c45a12';
  });
  button.addEventListener('mouseleave', () => {
    button.style.background = '#df6919';
  });
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onOpen();
  });
  row.appendChild(button);
  return row;
}
