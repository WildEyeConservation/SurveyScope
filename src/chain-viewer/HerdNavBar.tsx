import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lane } from '../individual-id/utils/lanes';
import { disjoint } from './utils/herdRuns';

interface Props {
  /**
   * Per flat-pair-index set of chain ids (objectId ?? id) present across the
   * pair's two images. Drives the run-grouping colours.
   */
  chainSets: Set<string>[];
  /** Chain-connected herd id for each flat pair index. */
  herdIds: string[];
  /** Stacked rows from buildLanes; entries index into chainSets. */
  lanes: Lane[];
  activeIndex: number;
  activeLane: number;
  onJump: (index: number, lane: number) => void;
}

const HEIGHT = 22;
const PADDING_X = 12;
const EMPTY_COLOR = '#6b7785';
// Cycled per run so adjacent groups of chain-sharing pairs read as distinct
// blocks ("those ten are linked").
const PALETTE = [
  '#5dade2',
  '#58d68d',
  '#f5b041',
  '#bb8fce',
  '#ec7063',
  '#48c9b0',
  '#f7dc6f',
  '#dc7633',
];

/**
 * Walk a lane's pairs in order; start a new colour run whenever a pair shares
 * no chain with the previous one. Returns a colour per local entry.
 */
function runColorsForLane(
  entries: number[],
  chainSets: Set<string>[],
  herdIds: string[]
): string[] {
  const colors: string[] = [];
  let runIdx = 0;
  let prev: Set<string> | null = null;
  let prevHerdId: string | null = null;
  for (const flat of entries) {
    const cur = chainSets[flat] ?? new Set<string>();
    const herdId = herdIds[flat] ?? null;
    if (cur.size === 0) {
      colors.push(EMPTY_COLOR);
      prev = null;
      continue;
    }
    if (
      prev !== null &&
      (herdId !== prevHerdId || (herdId === null && disjoint(prev, cur)))
    ) {
      runIdx++;
    }
    colors.push(PALETTE[runIdx % PALETTE.length]);
    prev = cur;
    prevHerdId = herdId;
  }
  return colors;
}

/**
 * Canvas bar for one lane. Same three density regimes as the ChainLinker
 * progress bar (circles → bars → quantised columns), but slots are coloured by
 * chain-run grouping rather than completion state.
 */
function LaneBar({
  colors,
  activeLocal,
  onPick,
  onHover,
}: {
  colors: string[];
  activeLocal: number;
  onPick: (local: number) => void;
  onHover: (local: number | null) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    setWidth(Math.floor(wrap.getBoundingClientRect().width));
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0].contentRect.width));
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const innerWidth = Math.max(0, width - 2 * PADDING_X);
  const slotWidth = colors.length > 0 ? innerWidth / colors.length : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, width) * dpr;
    canvas.height = HEIGHT * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${HEIGHT}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    if (colors.length === 0 || slotWidth <= 0) return;

    if (slotWidth >= 8) {
      const radius = Math.min(8, slotWidth / 2 - 1);
      colors.forEach((c, i) => {
        const cx = PADDING_X + i * slotWidth + slotWidth / 2;
        const cy = HEIGHT / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
        if (i === activeLocal) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    } else if (slotWidth >= 1.5) {
      const barW = Math.max(1, slotWidth - 0.5);
      const top = 4;
      const barH = HEIGHT - 8;
      colors.forEach((c, i) => {
        const x = PADDING_X + i * slotWidth;
        ctx.fillStyle = c;
        ctx.fillRect(x, top, barW, barH);
      });
      if (activeLocal >= 0 && activeLocal < colors.length) {
        const x = PADDING_X + activeLocal * slotWidth;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 0.5, top - 1.5, barW + 1, barH + 3);
      }
    } else {
      const cols = Math.max(1, Math.floor(innerWidth));
      const top = 4;
      const barH = HEIGHT - 8;
      const perCol = new Array(cols).fill('') as string[];
      for (let i = 0; i < colors.length; i++) {
        const col = Math.min(cols - 1, Math.floor((i / colors.length) * cols));
        // Last writer wins — fine for a coarse overview at this density.
        perCol[col] = colors[i];
      }
      for (let col = 0; col < cols; col++) {
        if (!perCol[col]) continue;
        ctx.fillStyle = perCol[col];
        ctx.fillRect(PADDING_X + col, top, 1, barH);
      }
      if (activeLocal >= 0 && activeLocal < colors.length) {
        const x = PADDING_X + Math.floor((activeLocal / colors.length) * cols);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 0.5, top - 1.5, 2, barH + 3);
      }
    }
  }, [colors, slotWidth, innerWidth, width, activeLocal]);

  const xToIndex = (clientX: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas || colors.length === 0 || slotWidth <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left - PADDING_X;
    if (x < 0) return null;
    const i = Math.floor(x / slotWidth);
    return i >= 0 && i < colors.length ? i : null;
  };

  return (
    <div ref={wrapperRef} className='w-full'>
      <canvas
        ref={canvasRef}
        onMouseMove={(e) => onHover(xToIndex(e.clientX))}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => {
          const i = xToIndex(e.clientX);
          if (i !== null) onPick(i);
        }}
        style={{ display: 'block', cursor: 'pointer' }}
      />
    </div>
  );
}

/**
 * Herd-view navigation bar: one {@link LaneBar} per camera row (plus overlap
 * rows), stacked. Pairs are coloured by chain-run grouping so contiguous runs
 * of pairs sharing the same individuals read as one block. Click a slot to
 * jump to that pair.
 */
export function HerdNavBar({
  chainSets,
  herdIds,
  lanes,
  activeIndex,
  activeLane,
  onJump,
}: Props) {
  const [hover, setHover] = useState<{ lane: number; local: number } | null>(
    null
  );

  const colorsByLane = useMemo(
    () =>
      lanes.map((lane) =>
        runColorsForLane(lane.entries, chainSets, herdIds)
      ),
    [lanes, chainSets, herdIds]
  );

  const multi = lanes.length > 1;
  const totalPairs = useMemo(
    () => lanes.reduce((n, l) => n + l.entries.length, 0),
    [lanes]
  );

  const headerLeft = (() => {
    if (hover) {
      const lane = lanes[hover.lane];
      const within = `Pair ${hover.local + 1} / ${lane.entries.length}`;
      return multi ? `${lane.label} · ${within}` : within;
    }
    return `${totalPairs} pair${totalPairs === 1 ? '' : 's'} with animals`;
  })();

  return (
    <div
      style={{
        background: '#4E5D6C',
        borderTop: '1px solid rgba(0, 0, 0, 0.25)',
        color: '#f8f9fa',
        userSelect: 'none',
      }}
      className='w-full flex flex-col pt-2 pb-4'
    >
      <div
        className='flex flex-row items-center px-4 pb-1'
        style={{ fontSize: 11 }}
      >
        <span style={{ flex: 1, opacity: 0.85 }}>{headerLeft}</span>
        <span style={{ flex: 1, textAlign: 'right', opacity: 0.75 }}>
          click to jump
        </span>
      </div>

      <div className='flex flex-col' style={{ gap: multi ? 6 : 0 }}>
        {lanes.map((lane, laneIdx) => {
          const colors = colorsByLane[laneIdx];
          if (colors.length === 0) return null;
          const activeLocal = lane.entries.indexOf(activeIndex);
          const isActiveLane = laneIdx === activeLane;
          return (
            <div
              key={lane.key}
              style={{
                borderLeft: multi
                  ? `3px solid ${isActiveLane ? '#f8f9fa' : 'transparent'}`
                  : undefined,
              }}
            >
              {multi && (
                <div
                  className='flex flex-row items-center px-4'
                  style={{ fontSize: 11, opacity: 0.85, gap: 6 }}
                >
                  <span
                    style={{
                      fontWeight: isActiveLane ? 600 : 400,
                      fontStyle: lane.kind === 'overlap' ? 'italic' : 'normal',
                    }}
                  >
                    {lane.label}
                  </span>
                  <span style={{ opacity: 0.6 }}>{lane.entries.length}</span>
                </div>
              )}
              <LaneBar
                colors={colors}
                activeLocal={activeLocal}
                onHover={(local) =>
                  setHover(local === null ? null : { lane: laneIdx, local })
                }
                onPick={(local) => onJump(lane.entries[local], laneIdx)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
