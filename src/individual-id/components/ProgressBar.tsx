import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PairCompletionState } from '../types';
import { completionColor } from '../utils/completion';
import type { Lane } from '../utils/lanes';

interface Props {
  /** Completion state for each pair, in flat (global) display order. */
  states: PairCompletionState[];
  /**
   * Stacked rows: one per camera, plus a dedicated overlap row for every
   * pair of cameras that share cross-camera pairs. `entries` index into
   * `states`; clicking a slot jumps to that flat index.
   */
  lanes: Lane[];
  /** Flat index of the pair currently being worked on. */
  activeIndex: number;
  /** Which lane the prev/next arrows are walking. */
  activeLane: number;
  /** Click a slot to jump to that pair, carrying the lane it was clicked in. */
  onJump: (index: number, lane: number) => void;
  /**
   * "Simple view" collapses each lane to just the pairs still needing
   * attention plus their nearest neighbours. The toggle lives here, on the
   * progress bar it controls; the harness owns the state and the filtering.
   */
  simpleView: boolean;
  onSimpleViewChange: (next: boolean) => void;
}

const HEIGHT = 22;
const PADDING_X = 12;

/**
 * Canvas-based bar for one camera lane. Scales to any number of pairs:
 *
 *   - Plenty of room (slot >= 8px) → filled circles.
 *   - Less room (slot >= 1.5px) → thin filled bars.
 *   - Less than 1.5px per pair → quantise: each on-screen column is a bucket
 *     of pairs, coloured by the worst (yellow > green) state so a single
 *     incomplete pair is never visually swallowed.
 *
 * `activeLocal` is the position of the globally-active pair within THIS
 * lane's entries, or -1 if it isn't in this lane. The white marker is drawn
 * whenever it is present.
 */
function LaneBar({
  states,
  activeLocal,
  onPick,
  onHover,
}: {
  states: PairCompletionState[];
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
  const slotWidth = states.length > 0 ? innerWidth / states.length : 0;

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

    if (states.length === 0 || slotWidth <= 0) return;

    if (slotWidth >= 8) {
      const radius = Math.min(8, slotWidth / 2 - 1);
      states.forEach((s, i) => {
        const cx = PADDING_X + i * slotWidth + slotWidth / 2;
        const cy = HEIGHT / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = completionColor(s);
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
      states.forEach((s, i) => {
        const x = PADDING_X + i * slotWidth;
        ctx.fillStyle = completionColor(s);
        ctx.fillRect(x, top, barW, barH);
      });
      if (activeLocal >= 0 && activeLocal < states.length) {
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
      const perColPriority = new Array(cols).fill(0) as number[]; // 0 empty, 1 green, 2 yellow
      for (let i = 0; i < states.length; i++) {
        const col = Math.min(cols - 1, Math.floor((i / states.length) * cols));
        const priority = states[i].status === 'incomplete' ? 2 : 1;
        if (priority > perColPriority[col]) {
          perColPriority[col] = priority;
          perCol[col] = completionColor(states[i]);
        }
      }
      for (let col = 0; col < cols; col++) {
        if (perColPriority[col] === 0) continue;
        ctx.fillStyle = perCol[col];
        ctx.fillRect(PADDING_X + col, top, 1, barH);
      }
      if (activeLocal >= 0 && activeLocal < states.length) {
        const x = PADDING_X + Math.floor((activeLocal / states.length) * cols);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 0.5, top - 1.5, 2, barH + 3);
      }
    }
  }, [states, slotWidth, innerWidth, width, activeLocal]);

  const xToIndex = (clientX: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas || states.length === 0 || slotWidth <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left - PADDING_X;
    if (x < 0) return null;
    const i = Math.floor(x / slotWidth);
    return i >= 0 && i < states.length ? i : null;
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
 * Multi-camera progress bar. Renders one {@link LaneBar} per row, stacked.
 * Same-camera pairs sit in their camera's row; cross-camera pairs get their
 * own overlap row (italic label) between the two camera rows they join. The
 * row the prev/next arrows follow (`activeLane`) is highlighted; others dim.
 *
 * A single row renders exactly like the original single-bar progress bar.
 */
export function ProgressBar({
  states,
  lanes,
  activeIndex,
  activeLane,
  onJump,
  simpleView,
  onSimpleViewChange,
}: Props) {
  const [hover, setHover] = useState<{ lane: number; local: number } | null>(
    null,
  );

  const acceptedCount = useMemo(
    () =>
      states.reduce(
        (n, s) => n + (s.status === 'complete' || s.status === 'empty' ? 1 : 0),
        0,
      ),
    [states],
  );

  const multi = lanes.length > 1;

  const headerLeft = (() => {
    if (hover) {
      const lane = lanes[hover.lane];
      const within = `Pair ${hover.local + 1} / ${lane.entries.length}`;
      return multi ? `${lane.label} · ${within}` : within;
    }
    return `${acceptedCount} / ${states.length} done`;
  })();

  return (
    <div
      style={{
        // Same colour as the toolbar above; a 1px top border gives the
        // sense of two sections within one bar.
        background: '#4E5D6C',
        borderTop: '1px solid rgba(0, 0, 0, 0.25)',
        color: '#f8f9fa',
        userSelect: 'none',
      }}
      className='flex w-full flex-col pt-2 pb-4'
    >
      <div
        className='flex flex-row items-center px-4 pb-1'
        style={{ fontSize: 11 }}
      >
        <span style={{ flex: 1, opacity: 0.85 }}>{headerLeft}</span>
        <span style={{ flex: 1, textAlign: 'center', opacity: 0.75 }}>
          click to jump
        </span>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <div
            className='flex items-center gap-2'
            title='Simple view: show only pairs that still need attention plus their 3 nearest neighbours on each side. Turn off to see every pair.'
            style={{ fontSize: 11 }}
          >
            <Switch
              id='ii-simple-view'
              checked={simpleView}
              onCheckedChange={(c) => onSimpleViewChange(c === true)}
            />
            <Label htmlFor='ii-simple-view' className='mb-0'>
              Simple view
            </Label>
          </div>
        </div>
      </div>

      <div className='flex flex-col' style={{ gap: multi ? 6 : 0 }}>
        {lanes.map((lane, laneIdx) => {
          const laneStates = lane.entries.map((i) => states[i]);
          // Simple view can filter a lane down to nothing — don't render an
          // empty bar/label for it.
          if (laneStates.length === 0) return null;
          const activeLocal = lane.entries.indexOf(activeIndex);
          const isActiveLane = laneIdx === activeLane;
          const laneDone = laneStates.reduce(
            (n, s) =>
              n + (s.status === 'complete' || s.status === 'empty' ? 1 : 0),
            0,
          );
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
                  <span style={{ opacity: 0.6 }}>
                    {laneDone} / {lane.entries.length}
                  </span>
                </div>
              )}
              <LaneBar
                states={laneStates}
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
