import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { client } from '../stores/appClient';
import type { CategoryType, ImageType } from '../schemaTypes';
import maplibregl from 'maplibre-gl';
import {
  IndividualIdMap,
  type MapMarker,
  type MarkerKind,
  type MapInstanceCallback,
} from './IndividualIdMap';
import type { AnnotationType } from '../schemaTypes';
import type { MatchCandidate, NeighbourPair, PixelTransform } from './types';
import { Button } from 'react-bootstrap';
import { HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { OovPanel } from './components/OovPanel';
import { HelpModal } from './components/HelpModal';
import { isOov } from './utils/identity';

interface Props {
  pair: NeighbourPair;
  imageA: ImageType;
  imageB: ImageType;
  candidates: MatchCandidate[];
  category: CategoryType | null;
  /** Hotkeys are disabled when false. */
  visible: boolean;

  onDrag: (
    candidateKey: string,
    side: 'A' | 'B',
    pos: { x: number; y: number }
  ) => void;
  /** Space press: commit the link and mark `accepted` when allowed. */
  onAccept: (candidateKey: string) => boolean | Promise<boolean>;
  onUnfocus?: () => void;
  /** Harness pre-generates the id so the candidate survives the Munkres rebuild. */
  onPlaceNew?: (
    side: 'A' | 'B',
    pos: { x: number; y: number },
    newAnnotationId: string
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
    value: boolean
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
    clickedAnnotationId: string
  ) => void;
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
    duplicateAnnotationIds = NO_DUPLICATES,
    conflictHighlightAnnotationIds = NO_CONFLICT_HIGHLIGHTS,
    onClearConflictHighlights,
  } = props;

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
    [candidates, activeKey]
  );

  const [sourceKeys, setSourceKeys] = useState<
    [string | undefined, string | undefined]
  >([undefined, undefined]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      [imageA, imageB].map(async (img) => {
        const resp = await (client.models.ImageFile as any).imagesByimageId({
          imageId: img.id,
        });
        const jpg = (resp.data ?? []).find(
          (f: any) => f.type === 'image/jpeg'
        );
        return jpg?.key as string | undefined;
      })
    ).then((keys) => {
      if (!cancelled) setSourceKeys(keys as [string | undefined, string | undefined]);
    });
    return () => {
      cancelled = true;
    };
  }, [imageA.id, imageB.id]);

  const color = category?.color || DEFAULT_COLOR;

  // Hold Tab to peek at the underlying images with every marker hidden.
  const [markersHidden, setMarkersHidden] = useState(false);

  // secondary = real whose objectId points at another row's identity; primary otherwise.
  function classify(real: AnnotationType | undefined, isShadow: boolean): MarkerKind {
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
    [chainViewerBaseHref]
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
        active: c.pairKey === activeKey,
        obscured: c.realA ? !!c.realA.obscured : !!c.obscuredA,
        canMoveToOov: isShadow && !!partnerReal,
        canSplitChain: c.realA ? canSplitChain?.(c.realA.id) ?? false : false,
        duplicateChainMember: c.realA
          ? duplicateAnnotationIds.has(c.realA.id)
          : false,
        conflictHighlight: c.realA
          ? conflictHighlightAnnotationIds.has(c.realA.id)
          : false,
        chainViewerHref: chainViewerHrefFor(chainAnnotation),
        infoTags: (c.realA as (AnnotationType & { infoTags?: string[] }) | undefined)
          ?.infoTags,
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
        status: 'pending',
        kind: classify(a, false),
        identityKey: a.objectId ?? a.id,
        infoTags: (a as AnnotationType & { infoTags?: string[] }).infoTags,
        active: false,
        obscured: !!a.obscured,
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
    color,
    foreignAnnotations,
    imageA.id,
    categoryColors,
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
        active: c.pairKey === activeKey,
        obscured: c.realB ? !!c.realB.obscured : !!c.obscuredB,
        canMoveToOov: isShadow && !!partnerReal,
        canSplitChain: c.realB ? canSplitChain?.(c.realB.id) ?? false : false,
        duplicateChainMember: c.realB
          ? duplicateAnnotationIds.has(c.realB.id)
          : false,
        conflictHighlight: c.realB
          ? conflictHighlightAnnotationIds.has(c.realB.id)
          : false,
        chainViewerHref: chainViewerHrefFor(chainAnnotation),
        infoTags: (c.realB as (AnnotationType & { infoTags?: string[] }) | undefined)
          ?.infoTags,
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
        status: 'pending',
        kind: classify(a, false),
        identityKey: a.objectId ?? a.id,
        infoTags: (a as AnnotationType & { infoTags?: string[] }).infoTags,
        active: false,
        obscured: !!a.obscured,
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
    color,
    foreignAnnotations,
    imageB.id,
    categoryColors,
    canSplitChain,
    duplicateAnnotationIds,
    conflictHighlightAnnotationIds,
    chainViewerHrefFor,
  ]);

  // Dragging a marker also focuses it — acting on any marker moves the
  // active state to that marker. Informational markers can't be focused, so
  // dragging one only repositions it.
  const handleDragA = useCallback(
    (candidateKey: string, x: number, y: number) => {
      if (!foreignById.has(candidateKey)) setActiveKey(candidateKey);
      onDrag(candidateKey, 'A', { x, y });
    },
    [onDrag, foreignById]
  );
  const handleDragB = useCallback(
    (candidateKey: string, x: number, y: number) => {
      if (!foreignById.has(candidateKey)) setActiveKey(candidateKey);
      onDrag(candidateKey, 'B', { x, y });
    },
    [onDrag, foreignById]
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
    []
  );
  const onMapInstance1: MapInstanceCallback = useCallback(
    (map, px2lngLat, lngLat2px) => {
      const wasNull = mapsRef.current[1] === null;
      mapsRef.current[1] = map ? { map, px2lngLat, lngLat2px } : null;
      if (wasNull !== (map === null)) setMapsTick((t) => t + 1);
    },
    []
  );

  useEffect(() => {
    const a = mapsRef.current[0];
    const b = mapsRef.current[1];
    if (!a || !b) return;

    // src=0 means A drives B (forward); src=1 means B drives A (backward).
    const transforms: [PixelTransform, PixelTransform] = [pair.forward, pair.backward];

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
      const aOutside =
        !!(a && cand.posA &&
          !a.map
            .getBounds()
            .contains(a.px2lngLat(cand.posA.x, cand.posA.y)));
      const bOutside =
        !!(b && cand.posB &&
          !b.map
            .getBounds()
            .contains(b.px2lngLat(cand.posB.x, cand.posB.y)));
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
    [candidates]
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
    [activeKey, candidates]
  );

  const handleSpace = useCallback(async () => {
    if (!activeCandidate) {
      // Nothing focused → focus the first non-accepted, non-informational.
      const next = candidates.find(
        (c) => c.status !== 'accepted' && !c.informational
      );
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
      const remaining = linkable.filter(
        (c) => c.status !== 'accepted' && c.pairKey !== activeCandidate.pairKey
      );
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
    if (conflictHighlightAnnotationIds.size > 0) {
      onClearConflictHighlights?.();
    }
    if (activeKey) {
      setActiveKey(null);
      onUnfocus?.();
    }
  }, [
    activeKey,
    onUnfocus,
    conflictHighlightAnnotationIds,
    onClearConflictHighlights,
  ]);

  useHotkeys('Space', handleSpace, { enabled: visible, preventDefault: true }, [
    handleSpace,
  ]);
  useHotkeys('Escape', handleEscape, { enabled: visible }, [handleEscape]);
  useHotkeys('ArrowRight', () => advanceFocus(1), { enabled: visible }, [
    advanceFocus,
  ]);
  useHotkeys('ArrowLeft', () => advanceFocus(-1), { enabled: visible }, [
    advanceFocus,
  ]);
  useHotkeys(
    'Ctrl+ArrowRight',
    () => onRequestNextPair?.(),
    { enabled: visible && !!onRequestNextPair },
    [onRequestNextPair]
  );
  useHotkeys(
    'Ctrl+ArrowLeft',
    () => onRequestPrevPair?.(),
    { enabled: visible && !!onRequestPrevPair },
    [onRequestPrevPair]
  );
  // Hide markers while Tab is held; show them again on release.
  useHotkeys(
    'Tab',
    (e) => setMarkersHidden(e.type === 'keydown'),
    { enabled: visible, keydown: true, keyup: true, preventDefault: true },
    []
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
      // Don't activate informational candidates — no partner to lock/accept.
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.informational) return;
      setActiveKey(candidateKey);
    },
    [candidates, foreignById]
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
    [activeKey, category, onPlaceNew, onUnfocus]
  );

  const handleMapClickA = useCallback(
    (x: number, y: number) => placeFromClick('A', { x, y }),
    [placeFromClick]
  );
  const handleMapClickB = useCallback(
    (x: number, y: number) => placeFromClick('B', { x, y }),
    [placeFromClick]
  );

  // Track which side initiated the hover so the other map shows a passive popup.
  const [hover, setHover] = useState<{ side: 'A' | 'B'; key: string } | null>(
    null
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
    [candidates, onDelete, foreignById]
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
    [candidates, onDelete, foreignById]
  );

  const handleSplitChainA = useCallback(
    (candidateKey: string) => {
      if (foreignById.has(candidateKey)) return;
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realA) onSplitChain?.(c.realA.id);
    },
    [candidates, onSplitChain, foreignById]
  );
  const handleSplitChainB = useCallback(
    (candidateKey: string) => {
      if (foreignById.has(candidateKey)) return;
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realB) onSplitChain?.(c.realB.id);
    },
    [candidates, onSplitChain, foreignById]
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
    [candidates, onChangeLabel, foreignById]
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
    [candidates, onChangeLabel, foreignById]
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
    [candidates, onToggleObscured, onSetProposedObscured, foreignById]
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
    [candidates, onToggleObscured, onSetProposedObscured, foreignById]
  );

  const handleMoveToOovA = useCallback(
    (candidateKey: string) => onMoveToOov?.(candidateKey, 'A'),
    [onMoveToOov]
  );
  const handleMoveToOovB = useCallback(
    (candidateKey: string) => onMoveToOov?.(candidateKey, 'B'),
    [onMoveToOov]
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
    [activeCandidate, candidates, onManualLinkRequest]
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
    [activeCandidate, candidates, onManualLinkRequest]
  );

  // OOV candidates split by side; the partner (if any) renders normally on the other map.
  const oovCandidatesA = useMemo(
    () => candidates.filter((c) => c.oovSide === 'A'),
    [candidates]
  );
  const oovCandidatesB = useMemo(
    () => candidates.filter((c) => c.oovSide === 'B'),
    [candidates]
  );

  // Panel cards reuse the map-side ctrl-click handlers (identical geometry).
  const handleCardDeleteA = useCallback(
    (candidateKey: string) => {
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realA) onDelete?.(c.realA.id);
    },
    [candidates, onDelete]
  );
  const handleCardDeleteB = useCallback(
    (candidateKey: string) => {
      const c = candidates.find((cc) => cc.pairKey === candidateKey);
      if (c?.realB) onDelete?.(c.realB.id);
    },
    [candidates, onDelete]
  );

  const activeAnchorA = activeCandidate?.posA ?? null;
  const activeAnchorB = activeCandidate?.posB ?? null;

  return (
    <div className='w-100 h-100 d-flex flex-column gap-2'>
      <div className='d-flex flex-row gap-2 w-100' style={{ flex: 1, minHeight: 0 }}>
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
          />
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <IndividualIdMap
            image={imageB}
            sourceKey={sourceKeys[1]}
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
      <PairToolbar
        active={activeCandidate}
        // Counts exclude informational markers.
        candidatesCount={
          candidates.filter((c) => !c.informational).length
        }
        acceptedCount={
          candidates.filter(
            (c) => c.status === 'accepted' && !c.informational
          ).length
        }
        onPrev={onRequestPrevPair}
        onNext={onRequestNextPair}
        leniency={leniency}
        onLeniencyChange={onLeniencyChange}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        shareHref={shareHref}
        editHomographyHref={editHomographyHref}
      />
    </div>
  );
}

function PairToolbar({
  active,
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
}: {
  active: MatchCandidate | null;
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
}) {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const status = active
    ? active.status === 'pending'
      ? 'Press Space to accept the link.'
      : 'Already linked. Use ←/→ to focus another candidate.'
    : candidatesCount === 0
    ? 'No matches in this pair.'
    : 'Click or use ←/→ to focus a candidate, then Space.';

  return (
    <div
      className='d-flex flex-row align-items-center justify-content-between gap-2 px-3 py-3'
      style={{
        background: '#4E5D6C',
        color: '#f8f9fa',
        fontSize: 12,
        position: 'relative',
      }}
    >
      <div className='d-flex flex-row gap-2 align-items-center'>
        <span
          style={{
            borderRight: '1px solid rgba(255, 255, 255, 0.25)',
            paddingRight: 8,
            marginRight: 4,
            display: 'flex',
          }}
        >
          <Button
            size='sm'
            variant='info'
            onClick={() => setHelpOpen(true)}
            title='How ChainLinker works'
          >
            <HelpCircle size={16} style={{ verticalAlign: 'middle' }} />
          </Button>
        </span>
        <Button
          size='sm'
          variant='outline-light'
          onClick={() => onCollapsedChange(!collapsed)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▴' : '▾'}
        </Button>
        {onPrev && (
          <Button
            onClick={onPrev}
            title='Previous image pair (Ctrl+←)'
            size='sm'
          >
            ←
          </Button>
        )}
        {onNext && (
          <Button
            size='sm'
            onClick={onNext}
            title='Next image pair (Ctrl+→)'
          >
            →
          </Button>
        )}
        {!collapsed && (
          <span style={{ opacity: 0.85 }}>
            {acceptedCount} / {candidatesCount} accepted
          </span>
        )}
      </div>
      <div
        className='d-flex flex-row gap-2 align-items-center'
        title='Munkres only proposes a match if the projected distance to a partner is below this many image pixels. The active marker shows a ring at this radius.'
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        <label
          htmlFor='ii-leniency'
          style={{ opacity: 0.8, fontSize: 11, marginBottom: 0 }}
        >
          Pairing radius
        </label>
        <input
          id='ii-leniency'
          type='range'
          min={0}
          max={1000}
          step={10}
          value={leniency}
          onChange={(e) => onLeniencyChange(parseInt(e.target.value, 10))}
          style={{ width: 140 }}
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
            width: 60,
            background: '#3B4753',
            color: '#f8f9fa',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            borderRadius: 4,
            fontSize: 12,
            padding: '2px 4px',
            fontVariantNumeric: 'tabular-nums',
          }}
        />
        <span style={{ opacity: 0.85, fontSize: 11 }}>px</span>
      </div>
      {/* Always render the spacer so Share/Save stay right-aligned when collapsed. */}
      <span style={{ flex: 1, textAlign: 'right' }}>{!collapsed && status}</span>
      {editHomographyHref && (
        <Button
          size='sm'
          variant='outline-light'
          onClick={() => navigate(editHomographyHref)}
          title='Edit the homography for this image pair'
        >
          Edit homography
        </Button>
      )}
      <Button
        size='sm'
        variant='outline-light'
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
        {shareCopied ? 'Copied!' : 'Share'}
      </Button>
      <Button
        size='sm'
        onClick={() => {
          navigate('/jobs');
          }
        }
        >
        Save & Exit
      </Button>
      <HelpModal show={helpOpen} onHide={() => setHelpOpen(false)} />
    </div>
  );
}
