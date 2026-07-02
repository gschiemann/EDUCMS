import type { Zone, ResizeHandle, SnapLine } from './types';
import { SNAP_THRESHOLD } from './constants';

interface Rect { x: number; y: number; width: number; height: number }

function collectTargets(
  others: Zone[],
  axis: 'v' | 'h',
  opts?: { gridSize: number; snapGrid: boolean },
): Array<{ pos: number; kind: SnapLine['kind'] }> {
  const result: Array<{ pos: number; kind: SnapLine['kind'] }> = [];
  result.push({ pos: 0, kind: 'canvas' });
  result.push({ pos: 50, kind: 'canvas' });
  result.push({ pos: 100, kind: 'canvas' });
  // A7 — canvas thirds (rule-of-thirds), same 'canvas' kind as the
  // existing 0/50/100 lines so they render with the same purple guide.
  result.push({ pos: 100 / 3, kind: 'canvas' });
  result.push({ pos: 200 / 3, kind: 'canvas' });
  for (const z of others) {
    if (axis === 'v') {
      result.push({ pos: z.x, kind: 'edge' });
      result.push({ pos: z.x + z.width / 2, kind: 'center' });
      result.push({ pos: z.x + z.width, kind: 'edge' });
    } else {
      result.push({ pos: z.y, kind: 'edge' });
      result.push({ pos: z.y + z.height / 2, kind: 'center' });
      result.push({ pos: z.y + z.height, kind: 'edge' });
    }
  }
  // A1 — grid lines become snap TARGETS (within the normal threshold)
  // instead of a pointer-movement pre-quantizer. Only emit them when
  // the grid overlay is visible (opts.snapGrid mirrors `showGrid`),
  // and only at positions actually inside the 0-100 canvas.
  if (opts?.snapGrid && opts.gridSize > 0) {
    for (let p = opts.gridSize; p < 100; p += opts.gridSize) {
      result.push({ pos: p, kind: 'grid' });
    }
  }
  return result;
}

/**
 * A7 — equal-gap candidates. When two OTHER zones on the same axis are
 * already aligned (their far/near edges form a consistent gap), offer a
 * snap target that continues that same gap from the nearest neighbor —
 * so a third element dropped near two evenly-spaced siblings clicks
 * into the same rhythm. Cheap O(n^2) over `others`, which is always a
 * small (single-digit) zone count per template.
 */
function collectEqualGapTargets(
  others: Zone[],
  axis: 'v' | 'h',
): Array<{ pos: number; kind: SnapLine['kind'] }> {
  const result: Array<{ pos: number; kind: SnapLine['kind'] }> = [];
  const span = (z: Zone) => (axis === 'v' ? [z.x, z.x + z.width] : [z.y, z.y + z.height]);
  for (let i = 0; i < others.length; i++) {
    for (let j = 0; j < others.length; j++) {
      if (i === j) continue;
      const a = others[i];
      const b = others[j];
      const [, aEnd] = span(a);
      const [bStart] = span(b);
      const gap = bStart - aEnd;
      if (gap <= 0) continue;
      // Candidate: place the dragged element's near edge so the gap
      // AFTER `b` equals the gap already between `a` and `b`.
      const [, bEnd] = span(b);
      result.push({ pos: bEnd + gap, kind: 'equal-gap' });
    }
  }
  return result;
}

function nearest(value: number, targets: Array<{ pos: number; kind: SnapLine['kind'] }>, threshold: number) {
  let best: { delta: number; pos: number; kind: SnapLine['kind'] } | null = null;
  for (const t of targets) {
    const d = t.pos - value;
    if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) {
      best = { delta: d, pos: t.pos, kind: t.kind };
    }
  }
  return best;
}

/**
 * A1 — grid-visible no longer quantizes pointer movement. `snapMove`
 * now ALWAYS starts from the raw candidate position (1:1 with the
 * pointer) and only ever snaps onto a discrete TARGET — element edges/
 * centers, canvas 0/50/100/thirds, equal-gap positions, and (when the
 * grid overlay is showing) grid line positions — all competing through
 * the same nearest-within-threshold contest. Previously `snapGrid`
 * pre-quantized x/y BEFORE the element-snap pass ran, which (a) made
 * every drag move in visible 5%-of-canvas jumps and (b) meant a
 * neighbor at a non-multiple-of-5 position was mathematically
 * unreachable. The Grid/Magnet toggles keep their existing meaning:
 * `snapGrid` (mirrors `showGrid`) adds grid-line targets to the
 * contest; `snapEnabled` (the Magnet toggle) gates ALL snapping
 * (grid + element + canvas + equal-gap) in one switch, matching prior
 * behavior where disabling Magnet also disabled grid snap.
 */
export function snapMove(
  candidate: Rect,
  others: Zone[],
  opts: { gridSize: number; snapEnabled: boolean; snapGrid: boolean },
): { x: number; y: number; lines: SnapLine[] } {
  let { x, y } = candidate;
  const lines: SnapLine[] = [];

  if (!opts.snapEnabled) return { x, y, lines };

  const vTargets = [
    ...collectTargets(others, 'v', opts),
    ...collectEqualGapTargets(others, 'v'),
  ];
  const hTargets = [
    ...collectTargets(others, 'h', opts),
    ...collectEqualGapTargets(others, 'h'),
  ];

  const candidates = [
    { axis: 'v' as const, value: x, apply: (p: number) => { x = p; } },
    { axis: 'v' as const, value: x + candidate.width / 2, apply: (p: number) => { x = p - candidate.width / 2; } },
    { axis: 'v' as const, value: x + candidate.width, apply: (p: number) => { x = p - candidate.width; } },
    { axis: 'h' as const, value: y, apply: (p: number) => { y = p; } },
    { axis: 'h' as const, value: y + candidate.height / 2, apply: (p: number) => { y = p - candidate.height / 2; } },
    { axis: 'h' as const, value: y + candidate.height, apply: (p: number) => { y = p - candidate.height; } },
  ];

  let bestV: { delta: number; pos: number; kind: SnapLine['kind']; applyIdx: number } | null = null;
  let bestH: { delta: number; pos: number; kind: SnapLine['kind']; applyIdx: number } | null = null;

  candidates.forEach((c, i) => {
    const hit = nearest(c.value, c.axis === 'v' ? vTargets : hTargets, SNAP_THRESHOLD);
    if (!hit) return;
    if (c.axis === 'v') {
      if (!bestV || Math.abs(hit.delta) < Math.abs(bestV.delta)) {
        bestV = { ...hit, applyIdx: i };
      }
    } else if (!bestH || Math.abs(hit.delta) < Math.abs(bestH.delta)) {
      bestH = { ...hit, applyIdx: i };
    }
  });

  if (bestV) {
    const winnerV: { delta: number; pos: number; kind: SnapLine['kind']; applyIdx: number } = bestV;
    candidates[winnerV.applyIdx].apply(winnerV.pos);
    lines.push({ orientation: 'v', position: winnerV.pos, kind: winnerV.kind });
  }
  if (bestH) {
    const winnerH: { delta: number; pos: number; kind: SnapLine['kind']; applyIdx: number } = bestH;
    candidates[winnerH.applyIdx].apply(winnerH.pos);
    lines.push({ orientation: 'h', position: winnerH.pos, kind: winnerH.kind });
  }

  return { x, y, lines };
}

/**
 * A1 — same decoupling as snapMove: the resized edge follows the raw
 * pointer 1:1 and only snaps onto a discrete TARGET (grid lines
 * included, when the grid is visible, as one candidate among many)
 * instead of being pre-quantized to the grid before element snapping
 * runs.
 */
export function snapResize(
  candidate: Rect,
  others: Zone[],
  handle: ResizeHandle,
  opts: { gridSize: number; snapEnabled: boolean; snapGrid: boolean },
): { x: number; y: number; width: number; height: number; lines: SnapLine[] } {
  let { x, y, width, height } = candidate;
  const lines: SnapLine[] = [];
  const vTargets = collectTargets(others, 'v', opts);
  const hTargets = collectTargets(others, 'h', opts);

  const hasE = handle.includes('e');
  const hasW = handle.includes('w');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');

  const tryEdge = (
    axis: 'v' | 'h',
    value: number,
    apply: (p: number) => void,
  ) => {
    if (!opts.snapEnabled) return;
    const hit = nearest(value, axis === 'v' ? vTargets : hTargets, SNAP_THRESHOLD);
    if (hit) {
      apply(hit.pos);
      lines.push({ orientation: axis, position: hit.pos, kind: hit.kind });
    }
  };

  if (hasE) tryEdge('v', x + width, (p) => { width = Math.max(3, p - x); });
  if (hasW) tryEdge('v', x, (p) => { const nx = Math.max(0, Math.min(x + width - 3, p)); width = width + (x - nx); x = nx; });
  if (hasS) tryEdge('h', y + height, (p) => { height = Math.max(3, p - y); });
  if (hasN) tryEdge('h', y, (p) => { const ny = Math.max(0, Math.min(y + height - 3, p)); height = height + (y - ny); y = ny; });

  return { x, y, width, height, lines };
}
