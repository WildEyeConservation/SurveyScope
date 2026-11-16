import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useQueries } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Ghost,
  HelpCircle,
  LassoSelect,
  PencilRuler,
  Settings2,
  Share2,
} from 'lucide-react';
import * as maplibregl from 'maplibre-gl';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useNavigate } from 'react-router-dom';
import { isMarkedOutside } from '../annotationBoundary';
import { GlobalContext } from '../Context';
import type { AnnotationType, CategoryType, ImageType } from '../schemaTypes';
import { WaitingOverlay } from '../useAckOnTimeout';
import { HelpModal } from './components/HelpModal';
import { OovPanel } from './components/OovPanel';
import {
  IndividualIdMap,
  type MapInstanceCallback,
  type MapMarker,
  type MarkerKind,
} from './IndividualIdMap';
import type { MatchCandidate, NeighbourPair, PixelTransform } from './types';
import {
  herdSpares,
  matchSelection,
  selectHerd,
  type HerdProposalUpdate,
  type Lasso,
} from './utils/groupLink';
import { isOov } from './utils/identity';
import { imageSourceQuery } from './utils/imageSource';
import { pairTilePoints } from './utils/tiles';

interface Props {
  pair: NeighbourPair;
  imageA: ImageType;
  imageB: ImageType;
  candidates: MatchCandidate[];
  category: CategoryType | null;
  /** Hotkeys are disabled when false. */
  visible: boolean;
  /** Fires once both images' initial tiles have loaded. */
  onImagesReady?: () => void;

  onDrag: (
    candidateKey: string,
    side: 'A' | 'B',
    pos: { x: number; y: number },
  ) => void;
  /** Space press: commit the link and mark `accepted` when allowed. */
  onAccept: (candidateKey: string) => boolean | Promise<boolean>;
  onUnfocus?: () => void;
  /** Harness pre-generates the id so the candidate survives the Munkres rebuild. */
  onPlaceNew?: (
    side: 'A' | 'B',
    pos: { x: number; y: number },
    newAnnotationId: string,
  ) => void;
  onDelete?: (annotationId: string) => void;
  onSplitChain?: (annotationId: string) => void;
  canSplitChain?: (annotationId: string) => boolean;
  onChangeLabel?: (annotationId: string, currentCategoryId: string) => void;
  onToggleObscured?: (annotationId: string) => void;
  /** Obscured intent for a shadow side; stamped onto the row created at accept. */
  onSetProposedObscured?: (
    candidateKey: string,
    side: 'A' | 'B',
    value: boolean,
  ) => void;
  /**
   * User clicked "Move to OOV" on a shadow whose candidate has a real
   * partner on the other side. Materialises a terminus OOV chain-linked to
   * that partner so neighbouring pairs don't nag for further linking.
   */
  onMoveToOov?: (candidateKey: string, side: 'A' | 'B') => void;
  /** Args: active candidate's real id opposite the click, then the ctrl-clicked real id. */
  onManualLinkRequest?: (
    activeAnnotationId: string,
    clickedAnnotationId: string,
  ) => void;
  /** null discards proposals; omit to hide the tool. */
  onProposeHerd?: (update: HerdProposalUpdate) => void;
  herdLassos?: [Lasso, Lasso][];
  onAllAccepted?: () => void;
  /** Omit to hide the prev button + Ctrl+← shortcut (used by single-pair mode). */
  onRequestPrevPair?: () => void;
  /** Omit to hide the next button + Ctrl+→ shortcut (used by single-pair mode). */
  onRequestNextPair?: () => void;
  leniency: number;
  onLeniencyChange: (next: number) => void;
  /** Also gates the progress bar; owned by the harness. */
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
  /** Copied to the clipboard when the toolbar's Share button is clicked. */
  shareHref?: string;
  /**
   * When set, the toolbar shows an "Edit homography" button that navigates
   * to this URL. Omit to hide the button.
   */
  editHomographyHref?: string;
  /** Base path for Chain Viewer links, without the `?chain=` query. */
  chainViewerBaseHref?: string;
  /**
   * Annotations from OTHER categories on these two images. Rendered as
   * read-only informational markers — never candidates, never accepted.
   */
  foreignAnnotations?: AnnotationType[];
  /** categoryId → marker colour, used to colour the informational markers. */
  categoryColors?: Record<string, string>;
  /** categoryId → label name. */
  categoryNames?: Record<string, string>;
  /** Real annotation ids that violate the one-chain-member-per-image invariant. */
  duplicateAnnotationIds?: Set<string>;
  /** Real annotation ids from the last blocked chain-merge conflict. */
  conflictHighlightAnnotationIds?: Set<string>;
  /** Clears temporary conflict highlighting, normally on Escape. */
  onClearConflictHighlights?: () => void;
}

const DEFAULT_COLOR = '#3498db';
// Stable empty list passed while Tab is held, so the maps clear their markers.
const NO_MARKERS: MapMarker[] = [];

// Image-pixel squared distance between two candidates. Uses whichever sides
// both have positions on (separate coordinate spaces, so we never mix A and
// B); returns Infinity when no side has both — those sort last for "nearest".
function candidateDistanceSq(a: MatchCandidate, b: MatchCandidate): number {
  let best = Infinity;
  if (a.posA && b.posA) {
    const dx = a.posA.x - b.posA.x;
    const dy = a.posA.y - b.posA.y;
    best = Math.min(best, dx * dx + dy * dy);
  }
  if (a.posB && b.posB) {
    const dx = a.posB.x - b.posB.x;
    const dy = a.posB.y - b.posB.y;
    best = Math.min(best, dx * dx + dy * dy);
  }
  return best;
}
// Stable empty defaults so the optional props don't churn memo identities.
const NO_FOREIGN: AnnotationType[] = [];
const NO_COLORS: Record<string, string> = {};
const NO_NAMES: Record<string, string> = {};
const HIDE_SHADOWS_KEY = 'individual-id-hide-shadows';
const NO_DUPLICATES: Set<string> = new Set();
const NO_CONFLICT_HIGHLIGHTS: Set<string> = new Set();

// Two-map workspace: renders both maps + markers and the keyboard flow.
// Never writes the DB and never persists across mounts — the harness owns both.
export function IndividualIdMapPair(props: Props) {
  const {
    pair,
    imageA,
    imageB,
    candidates,
    category,
    visible,
    onImagesReady,
    onDrag,
    onAccept,
    onUnfocus,
    onPlaceNew,
    onDelete,
    onSplitChain,
    canSplitChain,
    onChangeLabel,
    onToggleObscured,
    onSetProposedObscured,
    onMoveToOov,
    onManualLinkRequest,
    onProposeHerd,
    herdLassos,
    onAllAccepted,
    onRequestPrevPair,
    onRequestNextPair,
    leniency,
    onLeniencyChange,
    collapsed,
    onCollapsedChange,
    shareHref,
    editHomographyHref,
    chainViewerBaseHref,
    foreignAnnotations = NO_FOREIGN,
    categoryColors = NO_COLORS,
    categoryNames = NO_NAMES,
    duplicateAnnotationIds = NO_DUPLICATES,
    conflictHighlightAnnotationIds = NO_CONFLICT_HIGHLIGHTS,
    onClearConflictHighlights,
  } = props;
  const { client } = useContext(GlobalContext)!;

  // Nothing is focused on load — the user selects a candidate themselves
  // (click a marker, arrow keys, or Space).
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const pairKey = `${pair.image1Id}__${pair.image2Id}`;

  // If the active candidate disappears (e.g. rejected / removed), clear focus.
  useEffect(() => {
    if (activeKey && !candidates.some((c) => c.pairKey === activeKey)) {
      setActiveKey(null);
    }
  }, [activeKey, candidates]);

  // Watch `candidates` post-render (not Space's accept branch) so the harness
  // has recomputed before we fire — avoids a stale "earlier pair incomplete?"
  // read. sawIncompleteRef limits firing to the user's own incomplete→complete.
  const sawIncompleteRef = useRef(false);
  useEffect(() => {
    sawIncompleteRef.current = false;
  }, [pairKey]);
  useEffect(() => {
    const linkable = candidates.filter((c) => !c.informational);
    if (linkable.length === 0) return; // nothing to track on an empty pair
    const allAccepted = linkable.every((c) => c.status === 'accepted');
    if (!allAccepted) {
      sawIncompleteRef.current = true;
      return;
    }
    if (sawIncompleteRef.current) {
      sawIncompleteRef.current = false;
      onAllAccepted?.();
    }
  }, [candidates, onAllAccepted]);

  const activeCandidate = useMemo(
    () => candidates.find((c) => c.pairKey === activeKey) ?? null,
    [candidates, activeKey],
  );

  const [lassoMode, setLassoMode] = useState(false);
  const [lassoA, setLassoA] = useState<Lasso | null>(null);
  const [lassoB, setLassoB] = useState<Lasso | null>(null);
  const herd = useMemo(
    () =>
      lassoMode ? selectHerd(candidates, lassoA ?? [], lassoB ?? []) : null,
    [lassoMode, candidates, lassoA, lassoB],
  );
  const pendingProposals = useMemo(
    () => candidates.filter((c) => c.herdProposed && c.status !== 'accepted'),
    [candidates],
  );
  const spares = useMemo(
    () => herdSpares(candidates, herdLassos ?? []),
    [herdLassos, candidates],
  );
  const startLasso = useCallback(() => {
    setActiveKey(null);
    setLassoMode(true);
  }, []);
  const stopLasso = useCallback(() => {
    setLassoMode(false);
    setLassoA(null);
    setLassoB(null);
  }, []);
  const pairHerd = useCallback(
    (lassos: [Lasso, Lasso]) => {
      if (!onProposeHerd) return;
      const pairs = matchSelection(
        selectHerd(candidates, ...lassos),
        pair.forward,
      );
      onProposeHerd({
        pairs: pairs.map(([a, b, uncertain]) => [a.id, b.id, uncertain]),
        lassos,
      });
    },
    [candidates, onProposeHerd, pair.forward],
  );
  const proposeHerd = useCallback(() => {
    if (!lassoA || !lassoB) return;
    pairHerd([lassoA, lassoB]);
    stopLasso();
  }, [lassoA, lassoB, pairHerd, stopLasso]);

  const sourceQueries = useQueries({
    queries: [
      imageSourceQuery(client, imageA),
      imageSourceQuery(client, imageB),
    ],
  });
  const sourceKeys = sourceQueries.map((query) => query.data ?? undefined);

  const color = category?.color || DEFAULT_COLOR;

  const [countA, countB] = useMemo(() => {
    const a = new Set<string>();
    const b = new Set<string>();
    for (const c of candidates) {
      if (c.realA && !isOov(c.realA)) a.add(c.realA.id);
      if (c.realB && !isOov(c.realB)) b.add(c.realB.id);
    }
    return [a.size, b.size];
  }, [candidates]);
  const countLabel = (n: number) => `${n} ${category?.name ?? 'annotations'}`;

  // Hold Tab to peek at the underlying images with every marker hidden.
  const [markersHidden, setMarkersHidden] = useState(false);
  const [shadowsHidden, setShadowsHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_SHADOWS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleShadows = useCallback(() => {
    setShadowsHidden((prev) => {
      try {
        localStorage.setItem(HIDE_SHADOWS_KEY, prev ? '0' : '1');
      } catch {
        // Preference just won't persist.
      }
      return !prev;
    });
  }, []);

  // secondary = real whose objectId points at another row's identity; primary otherwise.
  function classify(
    real: AnnotationType | undefined,
    isShadow: boolean,
  ): MarkerKind {
    if (isShadow || !real) return 'shadow';
    if (real.objectId && real.objectId !== real.id) return 'secondary';
    return 'primary';
  }

  const chainViewerHrefFor = useCallback(
    (annotation: AnnotationType | null | undefined) => {
      if (!annotation || !chainViewerBaseHref) return undefined;
      const chainId = annotation.objectId ?? annotation.id;
      const params = new URLSearchParams({ chain: chainId });
      return `${chainViewerBaseHref}?${params.toString()}`;
    },
    [chainViewerBaseHref],
  );

  // Lookup for routing marker handlers — informational markers are keyed by
  // their annotation id rather than a candidate pairKey.
  const foreignById = useMemo(() => {
    const m = new Map<string, AnnotationType>();
    for (const a of foreignAnnotations) m.set(a.id, a);
    return m;
  }, [foreignAnnotations]);

  const markersA: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    for (const c of candidates) {
      if (!c.posA) continue;
      const isShadow = !c.realA || c.isShadowA;
      // The selected candidate's shadow stays, so Space never creates an unseen annotation.
      if (shadowsHidden && isShadow && c.pairKey !== activeKey) continue;
      const partnerReal = c.realB && !isOov(c.realB) ? c.realB : null;
      const chainAnnotation = c.realA ?? partnerReal;
      out.push({
        candidateKey: c.pairKey,
        side: 'A',
        x: c.posA.x,
        y: c.posA.y,
        color,
        status: c.status,
        kind: classify(c.realA, c.isShadowA),
        identityKey: c.identityKey,
        categoryName: category?.name,
        active: c.pairKey === activeKey,
        obscured: c.realA ? !!c.realA.obscured : !!c.obscuredA,
        uncertain: !!c.uncertain && c.status !== 'accepted',
        outside: isMarkedOutside(c.realA),
        canMoveToOov: isShadow && !!partnerReal,
        canSplitChain: c.realA ? (canSplitChain?.(c.realA.id) ?? false) : false,
        duplicateChainMember: c.realA
          ? duplicateAnnotationIds.has(c.realA.id)
          : false,
        conflictHighlight: c.realA
          ? conflictHighlightAnnotationIds.has(c.realA.id)
          : false,
        chainViewerHref: chainViewerHrefFor(chainAnnotation),
        infoTags: (
          c.realA as (AnnotationType & { infoTags?: string[] }) | undefined
        )?.infoTags,
      });
    }
    // Informational markers for annotations belonging to other categories.
    for (const a of foreignAnnotations) {
      if (a.imageId !== imageA.id) continue;
      out.push({
        candidateKey: a.id,
        side: 'A',
        x: a.x,
        y: a.y,
        color: categoryColors[a.categoryId] ?? DEFAULT_COLOR,
        categoryName: categoryNames[a.categoryId],
        status: 'pending',
        kind: classify(a, false),
        identityKey: a.objectId ?? a.id,
        infoTags: (a as AnnotationType & { infoTags?: string[] }).infoTags,
        active: false,
        obscured: !!a.obscured,
        outside: isMarkedOutside(a),
        foreign: true,
        canSplitChain: false,
        duplicateChainMember: duplicateAnnotationIds.has(a.id),
        conflictHighlight: conflictHighlightAnnotationIds.has(a.id),
        chainViewerHref: chainViewerHrefFor(a),
      });
    }
    return out;
  }, [
    candidates,
    activeKey,
    shadowsHidden,
    color,
    foreignAnnotations,
    imageA.id,
    categoryColors,
    categoryNames,
    category?.name,
    canSplitChain,
    duplicateAnnotationIds,
    conflictHighlightAnnotationIds,
    chainViewerHrefFor,
  ]);

  const markersB: MapMarker[] = useMemo(() => {
    const out: MapMarker[] = [];
    for (const c of candidates) {
      if (!c.posB) continue;
      const isShadow = !c.realB || c.isShadowB;
      if (shadowsHidden && isShadow && c.pairKey !== activeKey) continue;
      const partnerReal = c.realA && !isOov(c.realA) ? c.realA : null;
      const chainAnnotation = c.realB ?? partnerReal;
      out.push({
        candidateKey: c.pairKey,
        side: 'B',
        x: c.posB.x,
        y: c.posB.y,
        color,
        status: c.status,
        kind: classify(c.realB, c.isShadowB),
        identityKey: c.identityKey,
        categoryName: category?.name,
        active: c.pairKey === activeKey,
        obscured: c.realB ? !!c.realB.obscured : !!c.obscuredB,
        uncertain: !!c.uncertain && c.status !== 'accepted',
        outside: isMarkedOutside(c.realB),
        canMoveToOov: isShadow && !!partnerReal,
        canSplitChain: c.realB ? (canSplitChain?.(c.realB.id) ?? false) : false,
        duplicateChainMember: c.realB
          ? duplicateAnnotationIds.has(c.realB.id)
          : false,
        conflictHighlight: c.realB
          ? conflictHighlightAnnotationIds.has(c.realB.id)
          : false,
        chainViewerHref: chainViewerHrefFor(chainAnnotation),
        infoTags: (
          c.realB as (AnnotationType & { infoTags?: string[] }) | undefined
        )?.infoTags,
      });
    }
    // Informational markers for annotations belonging to other categories.
    for (const a of foreignAnnotations) {
      if (a.imageId !== imageB.id) continue;
      out.push({
        candidateKey: a.id,
        side: 'B',
        x: a.x,
        y: a.y,
        color: categoryColors[a.categoryId] ?? DEFAULT_COLOR,
        categoryName: categoryNames[a.categoryId],
        status: 'pending',
        kind: classify(a, false),
        identityKey: a.objectId ?? a.id,
        infoTags: (a as AnnotationType & { infoTags?: string[] }).infoTags,
        active: false,
        obscured: !!a.obscured,
        outside: isMarkedOutside(a),
        foreign: true,
        canSplitChain: false,
        duplicateChainMember: duplicateAnnotationIds.has(a.id),
        conflictHighlight: conflictHighlightAnnotationIds.has(a.id),
        chainViewerHref: chainViewerHrefFor(a),
      });
    }
    return out;
  }, [
    candidates,
    activeKey,
    shadowsHidden,
    color,
    foreignAnnotations,
    imageB.id,
    categoryColors,
    categoryNames,
    category?.name,
    canSplitChain,
    duplicateAnnotationIds,
    conflictHighlightAnnotationIds,
    chainViewerHrefFor,
  ]);

  const tilePointsA = useMemo(
    () => pairTilePoints(candidates, 'A', imageA.id, foreignAnnotations),
    [candidates, imageA.id, foreignAnnotations],
  );
  const tilePointsB = useMemo(
    () => pairTilePoints(candidates, 'B', imageB.id, foreignAnnotations),
    [candidates, imageB.id, foreignAnnotations],
  );

  const [imagesReady, setImagesReady] = useState(false);
  const readySidesRef = useRef<Set<'A' | 'B'>>(new Set());
  const onImagesReadyRef = useRef(onImagesReady);
  onImagesReadyRef.current = onImagesReady;
  const markSideReady = useCallback((side: 'A' | 'B') => {
    const sides = readySidesRef.current;
    if (sides.has(side)) return;
    sides.add(side);
    if (sides.size === 2) {
      setImagesReady(true);
      onImagesReadyRef.current?.();
    }
  }, []);
  // Linking hotkeys wait for the imagery; pair navigation stays available.
  const interactive = visible && imagesReady;
  const handleSideReadyA = useCallback(
    () => markSideReady('A'),
    [markSideReady],
  );
  const handleSideReadyB = useCallback(
    () => markSideReady('B'),
    [markSideReady],
  );

  // Dragging a marker also focuses it — acting on any marker moves the
  // active state to that marker. Other-category markers can't be focused, so
  // dragging one only repositions it.
  const handleDragA = useCallback(
    (candidateKey: string, x: number, y: number) => {
      if (!foreignById.has(candidateKey)) setActiveKey(candidateKey);
      onDrag(candidateKey, 'A', { x, y });
    },
    [onDrag, foreignById],
  );
  const handleDragB = useCallback(
    (candidateKey: string, x: number, y: number) => {
      if (!foreignById.has(candidateKey)) setActiveKey(candidateKey);
      onDrag(candidateKey, 'B', { x, y });
    },
    [onDrag, foreignById],
  );

  // Slave the other map via the homography on move/zoom; isSyncingRef breaks the feedback loop.
  type MapHandle = {
    map: maplibregl.Map;
    px2lngLat: (x: number, y: number) => [number, number];
    lngLat2px: (lng: number, lat: number) => { x: number; y: number };
  };
  const mapsRef = useRef<[MapHandle | null, MapHandle | null]>([null, null]);
  const [mapsTick, setMapsTick] = useState(0);
  const isSyncingRef = useRef(false);

  const onMapInstance0: MapInstanceCallback = useCallback(
    (map, px2lngLat, lngLat2px) => {
      const wasNull = mapsRef.current[0] === null;
      mapsRef.current[0] = map ? { map, px2lngLat, lngLat2px } : null;
      if (wasNull !== (map === null)) setMapsTick((t) => t + 1);
    },
    [],
  );
  const onMapInstance1: MapInstanceCallback = useCallback(
    (map, px2lngLat, lngLat2px) => {
      const wasNull = mapsRef.current[1] === null;
      mapsRef.current[1] = map ? { map, px2lngLat, lngLat2px } : null;
      if (wasNull !== (map === null)) setMapsTick((t) => t + 1);
    },
    [],
  );

  useEffect(() => {
    const a = mapsRef.current[0];
    const b = mapsRef.current[1];
    if (!a || !b) return;

    // src=0 means A drives B (forward); src=1 means B drives A (backward).
    const transforms: [PixelTransform, PixelTransform] = [
      pair.forward,
      pair.backward,
    ];

    const sync = (srcIdx: 0 | 1) => {
      if (isSyncingRef.current) return;
      const src = mapsRef.current[srcIdx];
      const tgt = mapsRef.current[1 - srcIdx];
      if (!src || !tgt) return;
      const tf = transforms[srcIdx];

      const c = src.map.getCenter();
      const srcPx = src.lngLat2px(c.lng, c.lat);
      const tgtPx = tf([srcPx.x, srcPx.y]);
      const targetLngLat = tgt.px2lngLat(tgtPx[0], tgtPx[1]);

      // Match zoom via the homography's local-derivative scale (handles non-uniform transforms).
      const probe = tf([srcPx.x + 100, srcPx.y]);
      const dx = probe[0] - tgtPx[0];
      const dy = probe[1] - tgtPx[1];
      const scaleRatio = Math.sqrt(dx * dx + dy * dy) / 100;
      const targetZoom = src.map.getZoom() - Math.log2(scaleRatio || 1);

      isSyncingRef.current = true;
      try {
        tgt.map.jumpTo({
          center: targetLngLat,
          zoom: targetZoom,
        });
      } finally {
        // Release next frame so the target's move/zoom doesn't re-enter sync.
        requestAnimationFrame(() => {
          isSyncingRef.current = false;
        });
      }
    };

    const aMove = () => sync(0);
    const bMove = () => sync(1);
    a.map.on('move', aMove);
    b.map.on('move', bMove);
    return () => {
      a.map.off('move', aMove);
      b.map.off('move', bMove);
    };
  }, [mapsTick, pair.forward, pair.backward]);

  // Imperative pan so it can fire on gestures that don't change activeKey (Space-lock, first activation).
  const focusPanTimeoutRef = useRef<number | null>(null);
  const panToCandidate = useCallback(
    (key: string) => {
      const cand = candidates.find((c) => c.pairKey === key);
      if (!cand || cand.informational) return;
      const a = mapsRef.current[0];
      const b = mapsRef.current[1];

      // Only pan when the candidate sits outside the current viewport on at
      // least one map. Re-centring on every focus change is disruptive when
      // the user is working a cluster of nearby annotations (the new marker
      // is already on screen). A candidate far away — typically a different
      // herd — fails this check and the pan fires as before.
      const aOutside = !!(
        a &&
        cand.posA &&
        !a.map.getBounds().contains(a.px2lngLat(cand.posA.x, cand.posA.y))
      );
      const bOutside = !!(
        b &&
        cand.posB &&
        !b.map.getBounds().contains(b.px2lngLat(cand.posB.x, cand.posB.y))
      );
      if (!aOutside && !bOutside) return;

      // Suppress sync during the pan so B doesn't mid-animation jump off A's centre.
      isSyncingRef.current = true;
      try {
        if (a && cand.posA) {
          a.map.easeTo({
            center: a.px2lngLat(cand.posA.x, cand.posA.y),
            duration: 250,
          });
        }
        if (b && cand.posB) {
          b.map.easeTo({
            center: b.px2lngLat(cand.posB.x, cand.posB.y),
            duration: 250,
          });
        }
      } catch {
        /* maps removed mid-pan; ignore */
      }
      if (focusPanTimeoutRef.current != null) {
        window.clearTimeout(focusPanTimeoutRef.current);
      }
      focusPanTimeoutRef.current = window.setTimeout(() => {
        isSyncingRef.current = false;
        focusPanTimeoutRef.current = null;
      }, 320);
    },
    [candidates],
  );

  // Pan on active-candidate transitions; skip the first activation so initial framing wins.
  const prevActiveKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // First activation on a new pair shouldn't pan.
    prevActiveKeyRef.current = null;
  }, [pairKey]);
  useEffect(() => {
    const prev = prevActiveKeyRef.current;
    prevActiveKeyRef.current = activeKey;
    if (!activeKey) return; // deselect → no pan
    if (!prev) return; // initial activation on this pair → no pan
    if (prev === activeKey) return;

    panToCandidate(activeKey);
    // Pan only on real active-key transitions, not every Munkres rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  // Informational candidates are skipped by navigation and Space (hover popup still works).
  const advanceFocus = useCallback(
    (direction: 1 | -1) => {
      const focusable = candidates.filter((c) => !c.informational);
      if (focusable.length === 0) return;
      const currentIdx = activeKey
        ? focusable.findIndex((c) => c.pairKey === activeKey)
        : -1;
      // currentIdx may be -1 after a final accept.
      let nextIdx: number;
      if (currentIdx === -1) {
        nextIdx = direction === 1 ? 0 : focusable.length - 1;
      } else {
        nextIdx =
          (currentIdx + direction + focusable.length) % focusable.length;
      }
      setActiveKey(focusable[nextIdx]?.pairKey ?? null);
    },
    [activeKey, candidates],
  );

  const handleSpace = useCallback(async () => {
    if (!activeCandidate) {
      // Nothing focused → focus the first non-accepted, non-informational.
      const open = candidates.filter(
        (c) => c.status !== 'accepted' && !c.informational,
      );
      const next = open.find((c) => !c.uncertain) ?? open[0];
      if (next) {
        setActiveKey(next.pairKey);
        panToCandidate(next.pairKey);
      }
      return;
    }
    // Informational can't be linked — Space skips ahead so the flow doesn't get stuck.
    if (activeCandidate.informational) {
      advanceFocus(1);
      return;
    }
    // OOV has no positional partner — Space skips; linking is via Ctrl/⌘+click.
    if (activeCandidate.oovSide) {
      advanceFocus(1);
      return;
    }
    if (activeCandidate.status === 'pending') {
      // Experiment: skip the intermediate "lock" step — Space on a pending
      // candidate accepts the link directly.
      const accepted = await onAccept(activeCandidate.pairKey);
      if (!accepted) return;
      // Advance focus within this pair; onAllAccepted is fired by the effect, not here (stale-read race).
      const linkable = candidates.filter((c) => !c.informational);
      const open = linkable.filter(
        (c) => c.status !== 'accepted' && c.pairKey !== activeCandidate.pairKey,
      );
      const remaining = open.some((c) => !c.uncertain)
        ? open.filter((c) => !c.uncertain)
        : open;
      if (remaining.length === 0) {
        setActiveKey(null);
      } else {
        // Pick the spatially nearest remaining linkable to the just-accepted
        // candidate. Working through a cluster of animals stays local instead
        // of hopping to whatever was next in Munkres' array order, which often
        // sits far away on the image.
        let nearest = remaining[0];
        let bestSq = candidateDistanceSq(activeCandidate, nearest);
        for (let i = 1; i < remaining.length; i++) {
          const d = candidateDistanceSq(activeCandidate, remaining[i]);
          if (d < bestSq) {
            bestSq = d;
            nearest = remaining[i];
          }
        }
        setActiveKey(nearest.pairKey);
        // Pan explicitly instead of leaning on the active-key effect. The
        // just-accepted candidate's pairKey changes the moment its link is
        // written (it gains an objectId), so `activeKey` briefly points at a
        // stale key and the cleanup effect nulls it — which makes the pan
        // effect treat this as an initial activation and skip panning. The
        // viewport check inside panToCandidate still suppresses the pan when
        // `nearest` is already on screen.
        panToCandidate(nearest.pairKey);
      }
      return;
    }
    if (activeCandidate.status === 'accepted') {
      advanceFocus(1);
    }
  }, [
    activeCandidate,
    candidates,
    onAccept,
    onAllAccepted,
    advanceFocus,
    panToCandidate,
  ]);

  const handleEscape = useCallback(() => {
    // Terra-draw cancels the shape being drawn; finished lassos stay until Cancel.
    if (lassoMode) return;
    if (conflictHighlightAnnotationIds.size > 0) {
      onClearConflictHighlights?.();
    }
    if (activeKey) {
      setActiveKey(null);
      onUnfocus?.();
    }
  }, [
    lassoMode,
    activeKey,
    onUnfocus,
    conflictHighlightAnnotationIds,
    onClearConflictHighlights,
  ]);

  useHotkeys(
    'Space',
    handleSpace,
    { enabled: interactive, preventDefault: true },
    [handleSpace],
  );
  useHotkeys('Escape', handleEscape, { enabled: interactive }, [handleEscape]);
  useHotkeys('ArrowRight', () => advanceFocus(1), { enabled: interactive }, [
    advanceFocus,
  ]);
  useHotkeys('ArrowLeft', () => advanceFocus(-1), { enabled: interactive }, [
    advanceFocus,
  ]);
  useHotkeys(
    'Ctrl+ArrowRight',
    () => onRequestNextPair?.(),
    { enabled: visible && !!onRequestNextPair },
    [onRequestNextPair],
  );
  useHotkeys(
    'Ctrl+ArrowLeft',
    () => onRequestPrevPair?.(),
    { enabled: visible && !!onRequestPrevPair },
    [onRequestPrevPair],
  );
  // Hide markers while Tab is held; show them again on release.
  useHotkeys(
    'Tab',
    (e) => setMarkersHidden(e.type === 'keydown'),
    { enabled: interactive, keydown: true, keyup: true, preventDefault: true },
    [],
  );
  // A keyup can be missed if focus leaves the window mid-hold, or if the
  // pair stops being visible — reset so markers don't stay stuck hidden.
  useEffect(() => {
    if (!visible) {
      setMarkersHidden(false);
      return;
    }
    const reset = () => setMarkersHidden(false);
    window.addEventListener('blur', reset);
    return () => window.removeEventListener('blur', reset);
  }, [visible]);

  const handleMarkerClick = useCallback(
    (candidateKey: string) => {
      // Other-category markers aren't part of the workflow — not focusable.
      if (foreignById.has(candidateKey)) return;
      // Out-of-overlap markers stay selectable for manual linking; navigation skips them.
      setActiveKey(candidateKey);
    },
    [foreignById],
  );

  // Empty-map click places a new annotation and makes it the active marker
  // (the id is pre-generated so the candidate survives the Munkres rebuild).
  const placeFromClick = useCallback(
    (clickedSide: 'A' | 'B', pos: { x: number; y: number }) => {
      if (!category || !onPlaceNew) {
        // Can't create here — just drop focus off the active marker.
        if (activeKey) {
          setActiveKey(null);
          onUnfocus?.();
        }
        return;
      }
      const newId = crypto.randomUUID();
      onPlaceNew(clickedSide, pos, newId);
      setActiveKey(newId);
    },
    [activeKey, category, onPlaceNew, onUnfocus],
  );

  const handleMapClickA = useCallback(
    (x: number, y: number) => placeFromClick('A', { x, y }),
    [placeFromClick],
  );
  const handleMapClickB = useCallback(
    (x: number, y: number) => placeFromClick('B', { x, y }),
    [placeFromClick],
  );

  // Track which side initiated the hover so the other map shows a passive popup.
  const [hover, setHover] = useState<{ side: 'A' | 'B'; key: string } | null>(
    null,
  );
  const handleHoverA = useCallback((key: string | null) => {
    setHover(key ? { side: 'A', key } : null);
  }, []);
  const handleHoverB = useCallback((key: string | null) => {
    setHover(key ? { side: 'B', key } : null);
  }, []);
  const passiveForA = hover && hover.side === 'B' ? hover.key : null;
  const passiveForB = hover && hover.side === 'A' ? hover.key : null;

  const handleDeleteA = useCallback(
    (candidateKey: string) => {
      const foreign = foreignById.get(candidateKey);
      if (foreign) {
        onDelete?.(foreign.id);
        return;
      }
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realA) onDelete?.(c.realA.id);
    },
    [candidates, onDelete, foreignById],
  );
  const handleDeleteB = useCallback(
    (candidateKey: string) => {
      const foreign = foreignById.get(candidateKey);
      if (foreign) {
        onDelete?.(foreign.id);
        return;
      }
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realB) onDelete?.(c.realB.id);
    },
    [candidates, onDelete, foreignById],
  );

  const handleSplitChainA = useCallback(
    (candidateKey: string) => {
      if (foreignById.has(candidateKey)) return;
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realA) onSplitChain?.(c.realA.id);
    },
    [candidates, onSplitChain, foreignById],
  );
  const handleSplitChainB = useCallback(
    (candidateKey: string) => {
      if (foreignById.has(candidateKey)) return;
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realB) onSplitChain?.(c.realB.id);
    },
    [candidates, onSplitChain, foreignById],
  );

  const handleChangeLabelA = useCallback(
    (candidateKey: string) => {
      const foreign = foreignById.get(candidateKey);
      if (foreign) {
        onChangeLabel?.(foreign.id, foreign.categoryId);
        return;
      }
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realA) onChangeLabel?.(c.realA.id, c.realA.categoryId);
    },
    [candidates, onChangeLabel, foreignById],
  );
  const handleChangeLabelB = useCallback(
    (candidateKey: string) => {
      const foreign = foreignById.get(candidateKey);
      if (foreign) {
        onChangeLabel?.(foreign.id, foreign.categoryId);
        return;
      }
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realB) onChangeLabel?.(c.realB.id, c.realB.categoryId);
    },
    [candidates, onChangeLabel, foreignById],
  );

  const handleToggleObscuredA = useCallback(
    (candidateKey: string) => {
      const foreign = foreignById.get(candidateKey);
      if (foreign) {
        onToggleObscured?.(foreign.id);
        return;
      }
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (!c) return;
      // Real → live DB toggle; shadow → in-memory intent applied at accept.
      if (c.realA) onToggleObscured?.(c.realA.id);
      else onSetProposedObscured?.(c.pairKey, 'A', !c.obscuredA);
    },
    [candidates, onToggleObscured, onSetProposedObscured, foreignById],
  );
  const handleToggleObscuredB = useCallback(
    (candidateKey: string) => {
      const foreign = foreignById.get(candidateKey);
      if (foreign) {
        onToggleObscured?.(foreign.id);
        return;
      }
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (!c) return;
      if (c.realB) onToggleObscured?.(c.realB.id);
      else onSetProposedObscured?.(c.pairKey, 'B', !c.obscuredB);
    },
    [candidates, onToggleObscured, onSetProposedObscured, foreignById],
  );

  const handleMoveToOovA = useCallback(
    (candidateKey: string) => onMoveToOov?.(candidateKey, 'A'),
    [onMoveToOov],
  );
  const handleMoveToOovB = useCallback(
    (candidateKey: string) => onMoveToOov?.(candidateKey, 'B'),
    [onMoveToOov],
  );

  // Ctrl+click a real marker on the other image to link it with the active
  // candidate's real on the opposite side — only when that side is a
  // shadow/informational proposal, never breaking an existing real↔real link.
  const handleCtrlClickA = useCallback(
    (candidateKey: string) => {
      if (!activeCandidate || activeCandidate.pairKey === candidateKey) return;
      const clicked = candidates.find((c) => c.pairKey === candidateKey);
      if (!clicked?.realA) return; // clicked a shadow, nothing to link
      // Anchor = active's real on B; A side must be a shadow/informational.
      if (!activeCandidate.realB) return;
      if (activeCandidate.realA && !activeCandidate.informational) return;
      onManualLinkRequest?.(activeCandidate.realB.id, clicked.realA.id);
    },
    [activeCandidate, candidates, onManualLinkRequest],
  );
  const handleCtrlClickB = useCallback(
    (candidateKey: string) => {
      if (!activeCandidate || activeCandidate.pairKey === candidateKey) return;
      const clicked = candidates.find((c) => c.pairKey === candidateKey);
      if (!clicked?.realB) return;
      if (!activeCandidate.realA) return;
      if (activeCandidate.realB && !activeCandidate.informational) return;
      onManualLinkRequest?.(activeCandidate.realA.id, clicked.realB.id);
    },
    [activeCandidate, candidates, onManualLinkRequest],
  );

  // OOV candidates split by side; the partner (if any) renders normally on the other map.
  const oovCandidatesA = useMemo(
    () => candidates.filter((c) => c.oovSide === 'A'),
    [candidates],
  );
  const oovCandidatesB = useMemo(
    () => candidates.filter((c) => c.oovSide === 'B'),
    [candidates],
  );

  // Panel cards reuse the map-side ctrl-click handlers (identical geometry).
  const handleCardDeleteA = useCallback(
    (candidateKey: string) => {
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realA) onDelete?.(c.realA.id);
    },
    [candidates, onDelete],
  );
  const handleCardDeleteB = useCallback(
    (candidateKey: string) => {
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realB) onDelete?.(c.realB.id);
    },
    [candidates, onDelete],
  );

  const activeAnchorA = activeCandidate?.posA ?? null;
  const activeAnchorB = activeCandidate?.posB ?? null;

  return (
    <div className='flex h-full w-full flex-col gap-2'>
      <div
        className='flex w-full flex-row gap-2'
        style={{ flex: 1, minHeight: 0, position: 'relative' }}
      >
        {!imagesReady && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 1000,
              backgroundColor: 'rgba(0, 0, 0, 0.35)',
            }}
          >
            <WaitingOverlay message='Loading images…' />
          </div>
        )}
        <OovPanel
          side='A'
          candidates={oovCandidatesA}
          category={category}
          activeKey={activeKey}
          passiveHoverKey={passiveForA}
          onActivate={handleMarkerClick}
          onCtrlClick={handleCtrlClickA}
          onHoverChange={handleHoverA}
          onDelete={handleCardDeleteA}
        />
        <div style={{ flex: 1, minHeight: 0 }}>
          <IndividualIdMap
            image={imageA}
            sourceKey={sourceKeys[0]}
            priorityTilePoints={tilePointsA}
            markers={markersHidden ? NO_MARKERS : markersA}
            onMarkerDrag={handleDragA}
            onMarkerClick={handleMarkerClick}
            onMapClick={handleMapClickA}
            onMapInstance={onMapInstance0}
            passiveHoverKey={passiveForA}
            onHoverChange={handleHoverA}
            onMarkerDelete={handleDeleteA}
            onMarkerSplitChain={handleSplitChainA}
            onMarkerChangeLabel={handleChangeLabelA}
            onMarkerToggleObscured={handleToggleObscuredA}
            onMarkerMoveToOov={handleMoveToOovA}
            onMarkerCtrlClick={handleCtrlClickA}
            leniency={leniency}
            // Tab-to-peek also clears the leniency ring + homography overlay.
            leniencyAnchor={markersHidden ? null : activeAnchorA}
            // Side A's overlay traces image B's bounds projected onto A.
            previewTransform={markersHidden ? undefined : pair.backward}
            otherImage={imageB}
            onInitialTilesLoaded={handleSideReadyA}
            badge={countLabel(countA)}
            lassoMode={lassoMode}
            lasso={lassoA}
            onLassoDrawn={setLassoA}
          />
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <IndividualIdMap
            image={imageB}
            sourceKey={sourceKeys[1]}
            priorityTilePoints={tilePointsB}
            markers={markersHidden ? NO_MARKERS : markersB}
            onMarkerDrag={handleDragB}
            onMarkerClick={handleMarkerClick}
            onMapClick={handleMapClickB}
            onMapInstance={onMapInstance1}
            passiveHoverKey={passiveForB}
            onHoverChange={handleHoverB}
            onMarkerDelete={handleDeleteB}
            onMarkerSplitChain={handleSplitChainB}
            onMarkerChangeLabel={handleChangeLabelB}
            onMarkerToggleObscured={handleToggleObscuredB}
            onMarkerMoveToOov={handleMoveToOovB}
            onMarkerCtrlClick={handleCtrlClickB}
            leniency={leniency}
            // Tab-to-peek also clears the leniency ring + homography overlay.
            leniencyAnchor={markersHidden ? null : activeAnchorB}
            // Side B's overlay traces image A's bounds projected onto B.
            previewTransform={markersHidden ? undefined : pair.forward}
            otherImage={imageA}
            onInitialTilesLoaded={handleSideReadyB}
            badge={countLabel(countB)}
            lassoMode={lassoMode}
            lasso={lassoB}
            onLassoDrawn={setLassoB}
          />
        </div>
        <OovPanel
          side='B'
          candidates={oovCandidatesB}
          category={category}
          activeKey={activeKey}
          passiveHoverKey={passiveForB}
          onActivate={handleMarkerClick}
          onCtrlClick={handleCtrlClickB}
          onHoverChange={handleHoverB}
          onDelete={handleCardDeleteB}
        />
      </div>
      {(herd || (herdLassos && pendingProposals.length > 0)) && (
        <HerdPairingBar
          herd={herd}
          lassoA={lassoA}
          lassoB={lassoB}
          pending={pendingProposals.length}
          uncertain={pendingProposals.filter((c) => c.uncertain).length}
          spares={spares}
          canDrop={
            !!activeCandidate?.herdProposed &&
            activeCandidate.status !== 'accepted'
          }
          onDrop={() =>
            activeCandidate?.realA &&
            onProposeHerd?.({ drop: activeCandidate.realA.id })
          }
          onRepair={() => herdLassos?.forEach(pairHerd)}
          onCancel={stopLasso}
          onConfirm={proposeHerd}
          onDiscard={() => onProposeHerd?.(null)}
        />
      )}
      <PairToolbar
        // Counts exclude informational markers.
        candidatesCount={candidates.filter((c) => !c.informational).length}
        acceptedCount={
          candidates.filter((c) => c.status === 'accepted' && !c.informational)
            .length
        }
        onPrev={onRequestPrevPair}
        onNext={onRequestNextPair}
        leniency={leniency}
        onLeniencyChange={onLeniencyChange}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        shareHref={shareHref}
        editHomographyHref={editHomographyHref}
        shadowsHidden={shadowsHidden}
        onShadowsToggle={toggleShadows}
        herdPairingActive={lassoMode}
        onHerdPairingToggle={
          onProposeHerd ? (lassoMode ? stopLasso : startLasso) : undefined
        }
      />
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function HerdPairingBar({
  herd,
  lassoA,
  lassoB,
  pending,
  uncertain,
  spares,
  canDrop,
  onDrop,
  onRepair,
  onCancel,
  onConfirm,
  onDiscard,
}: {
  herd: ReturnType<typeof selectHerd> | null;
  lassoA: Lasso | null;
  lassoB: Lasso | null;
  pending: number;
  uncertain: number;
  spares: { a: number; b: number };
  canDrop: boolean;
  onDrop: () => void;
  onRepair: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const barStyle = {
    background: '#3B4753',
    color: '#f8f9fa',
    borderTop: '1px solid rgba(255, 255, 255, 0.15)',
  };
  if (herd) {
    const side = (lasso: Lasso | null, n: number) =>
      lasso ? plural(n, 'unlinked animal') : 'no lasso yet';
    return (
      <div
        className='flex flex-row items-center gap-3 px-4 py-2 text-sm'
        style={barStyle}
      >
        <Button
          size='sm'
          variant='ghost'
          className='mr-auto h-[31px] text-white'
          onClick={onCancel}
        >
          Cancel
        </Button>
        <span>
          Click to place points around the herd on each image · double-click or
          Enter to close. Left: {side(lassoA, herd.freeA.length)} · Right:{' '}
          {side(lassoB, herd.freeB.length)}
          {herd.anchors.length > 0 &&
            ` · ${plural(herd.anchors.length, 'existing link')} kept`}
        </span>
        <Button
          size='sm'
          className='h-[31px]'
          disabled={
            !lassoA || !lassoB || !herd.freeA.length || !herd.freeB.length
          }
          onClick={onConfirm}
        >
          Propose pairs
        </Button>
      </div>
    );
  }
  const spare = [
    spares.a > 0 && `${spares.a} on the left`,
    spares.b > 0 && `${spares.b} on the right`,
  ].filter(Boolean);
  return (
    <div
      className='flex flex-row items-center gap-3 px-4 py-2 text-sm'
      style={barStyle}
    >
      <span className='mr-auto'>
        {plural(pending, 'proposed pair')} to accept with Space
        {uncertain > 0 &&
          ` (${uncertain} uncertain, dashed amber border, visited last)`}
        .{spare.length > 0 && ` No partner (spare): ${spare.join(', ')}.`}
      </span>
      <Button
        size='sm'
        variant='outline-light'
        className='h-[31px]'
        disabled={!canDrop}
        onClick={onDrop}
        title='Return the selected pair to normal matching'
      >
        Drop selected proposal
      </Button>
      <Button
        size='sm'
        variant='outline-light'
        className='h-[31px]'
        onClick={onRepair}
        title='Pair again only the animals you have not accepted yet'
      >
        Re-pair the rest
      </Button>
      <Button size='sm' className='h-[31px]' onClick={onDiscard}>
        Discard proposals
      </Button>
    </div>
  );
}

function PairToolbar({
  candidatesCount,
  acceptedCount,
  onPrev,
  onNext,
  leniency,
  onLeniencyChange,
  collapsed,
  onCollapsedChange,
  shareHref,
  editHomographyHref,
  shadowsHidden,
  onShadowsToggle,
  herdPairingActive,
  onHerdPairingToggle,
}: {
  candidatesCount: number;
  acceptedCount: number;
  onPrev?: () => void;
  onNext?: () => void;
  leniency: number;
  onLeniencyChange: (next: number) => void;
  collapsed: boolean;
  onCollapsedChange: (next: boolean) => void;
  shareHref?: string;
  editHomographyHref?: string;
  shadowsHidden: boolean;
  onShadowsToggle: () => void;
  herdPairingActive: boolean;
  onHerdPairingToggle?: () => void;
}) {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  return (
    <div
      className='flex flex-col gap-2 px-4 py-4'
      style={{
        background: '#4E5D6C',
        color: '#f8f9fa',
        fontSize: 12,
        position: 'relative',
      }}
    >
      <div className='flex flex-row items-center justify-between gap-2'>
        <div className='flex flex-row items-center gap-2'>
          <span
            style={{
              borderRight: '1px solid rgba(255, 255, 255, 0.25)',
              paddingRight: 8,
              marginRight: 4,
              display: 'flex',
            }}
          >
            <Button
              size='icon-sm'
              variant='info'
              onClick={() => setHelpOpen(true)}
              title='How ChainLinker works'
              aria-label='How ChainLinker works'
            >
              <HelpCircle size={16} />
            </Button>
          </span>
          <Button
            size='icon-sm'
            variant='outline-light'
            onClick={() => onCollapsedChange(!collapsed)}
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>
          {onPrev && (
            <Button
              size='icon-sm'
              onClick={onPrev}
              title='Previous image pair (Ctrl+←)'
              aria-label='Previous image pair'
            >
              <ArrowLeft size={16} />
            </Button>
          )}
          {onNext && (
            <Button
              size='icon-sm'
              onClick={onNext}
              title='Next image pair (Ctrl+→)'
              aria-label='Next image pair'
            >
              <ArrowRight size={16} />
            </Button>
          )}
          {!collapsed && (
            <span className='text-sm font-medium'>
              {acceptedCount} of {candidatesCount}{' '}
              {candidatesCount === 1 ? 'match' : 'matches'} accepted
            </span>
          )}
        </div>
        <div className='flex flex-row items-center gap-2'>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size='icon-sm'
                variant='outline-light'
                title='Pairing settings'
                aria-label='Pairing settings'
              >
                <Settings2 size={16} />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side='top'
              align='end'
              className='flex w-80 flex-col gap-2'
            >
              <label htmlFor='ii-leniency' className='mb-0 font-semibold'>
                Pairing radius
              </label>
              <div className='flex items-center gap-2'>
                <input
                  id='ii-leniency'
                  type='range'
                  min={0}
                  max={1000}
                  step={10}
                  value={leniency}
                  onChange={(e) =>
                    onLeniencyChange(parseInt(e.target.value, 10))
                  }
                  className='min-w-0 flex-1'
                />
                <input
                  type='number'
                  aria-label='Pairing radius in pixels'
                  min={0}
                  max={1000}
                  step={1}
                  value={leniency}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isNaN(n)) return;
                    onLeniencyChange(Math.max(0, Math.min(1000, n)));
                  }}
                  style={{
                    width: 64,
                    background: '#3B4753',
                    color: '#f8f9fa',
                    border: '1px solid rgba(255, 255, 255, 0.25)',
                    borderRadius: 4,
                    fontSize: 12,
                    padding: '2px 4px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                />
                <span className='text-xs'>px</span>
              </div>
              <p className='mb-0 text-xs text-muted-foreground'>
                A match is only proposed when its partner projects within this
                many image pixels. The active marker shows a ring at this
                radius.
              </p>
            </PopoverContent>
          </Popover>
          <Button
            size='icon-sm'
            variant={shadowsHidden ? 'light' : 'outline-light'}
            onClick={onShadowsToggle}
            title={
              shadowsHidden
                ? 'Show shadow markers'
                : 'Hide shadow markers (the selected one stays visible)'
            }
            aria-label='Hide shadow markers'
            aria-pressed={shadowsHidden}
          >
            <Ghost size={16} />
          </Button>
          {onHerdPairingToggle && (
            <Button
              size='icon-sm'
              variant={herdPairingActive ? 'light' : 'outline-light'}
              onClick={onHerdPairingToggle}
              title='Pair a herd that moved between the images'
              aria-label='Pair a herd'
              aria-pressed={herdPairingActive}
            >
              <LassoSelect size={16} />
            </Button>
          )}
          {editHomographyHref && (
            <Button
              size='icon-sm'
              variant='outline-light'
              onClick={() => navigate(editHomographyHref)}
              title='Edit the homography for this image pair'
              aria-label='Edit homography'
            >
              <PencilRuler size={16} />
            </Button>
          )}
          <Button
            size='icon-sm'
            variant='outline-light'
            aria-label='Copy a link to this pair'
            onClick={async () => {
              // shareHref is a route path; expand to an absolute URL so the
              // clipboard payload is openable outside this tab.
              const absolute = shareHref
                ? new URL(shareHref, window.location.origin).toString()
                : window.location.href;
              try {
                await navigator.clipboard.writeText(absolute);
                setShareCopied(true);
                window.setTimeout(() => setShareCopied(false), 1500);
              } catch (err) {
                console.error('Failed to copy share link', err);
              }
            }}
            title={shareCopied ? 'Link copied' : 'Copy a link to this pair'}
          >
            {shareCopied ? <Check size={16} /> : <Share2 size={16} />}
          </Button>
          <Button
            size='sm'
            className='h-[31px]'
            onClick={() => navigate('/jobs')}
          >
            Save & Exit
          </Button>
        </div>
      </div>
      <HelpModal show={helpOpen} onHide={() => setHelpOpen(false)} />
    </div>
  );
}
