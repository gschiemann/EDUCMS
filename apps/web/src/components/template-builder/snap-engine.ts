import type { Zone, ResizeHandle, SnapLine } from './types';
import { SNAP_THRESHOLD } from './constants';

interface Rect { x: number; y: number; width: number; height: number }

function collectTargets(others: Zone[], axis: 'v' | 'h'): Array<{ pos: number; kind: SnapLine['kind'] }> {
  const result: Array<{ pos: number; kind: SnapLine['kind'] }> = [];
  result.push({ pos: 0, kind: 'canvas' });
  result.push({ pos: 50, kind: 'canvas' });
  result.push({ pos: 100, kind: 'canvas' });
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

function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

export function snapMove(
  candidate: Rect,
  others: Zone[],
  opts: { gridSize: number; snapEnabled: boolean; snapGrid: boolean },
): { x: number; y: number; lines: SnapLine[] } {
  let { x, y } = candidate;
  const lines: SnapLine[] = [];

  if (opts.snapGrid && opts.gridSize > 0) {
    x = snapToGrid(x, opts.gridSize);
    y = snapToGrid(y, opts.gridSize);
  }

  if (!opts.snapEnabled) return { x, y, lines };

  const vTargets = collectTargets(others, 'v');
  const hTargets = collectTargets(others, 'h');

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

export function snapResize(
  candidate: Rect,
  others: Zone[],
  handle: ResizeHandle,
  opts: { gridSize: number; snapEnabled: boolean; snapGrid: boolean },
): { x: number; y: number; width: number; height: number; lines: SnapLine[] } {
  let { x, y, width, height } = candidate;
  const lines: SnapLine[] = [];
  const vTargets = collectTargets(others, 'v');
  const hTargets = collectTargets(others, 'h');

  const hasE = handle.includes('e');
  const hasW = handle.includes('w');
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');

  const tryEdge = (
    axis: 'v' | 'h',
    value: number,
    apply: (p: number) => void,
  ) => {
    if (opts.snapGrid && opts.gridSize > 0) {
      const grid = snapToGrid(value, opts.gridSize);
      if (Math.abs(grid - value) <= opts.gridSize / 2) {
        apply(grid);
        value = grid;
      }
    }
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
