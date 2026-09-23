/**
 * Rectangle math and the text-overlap finder. Pure; units are whatever the
 * caller passes (canvas px in production).
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bt = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || bt <= y) return null;
  return { x, y, w: r - x, h: bt - y };
}

export function area(b: Box): number {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

export function union(boxes: Box[]): Box | null {
  let x = Infinity;
  let y = Infinity;
  let r = -Infinity;
  let bt = -Infinity;
  for (const b of boxes) {
    if (b.w <= 0 || b.h <= 0) continue;
    x = Math.min(x, b.x);
    y = Math.min(y, b.y);
    r = Math.max(r, b.x + b.w);
    bt = Math.max(bt, b.y + b.h);
  }
  return Number.isFinite(x) ? { x, y, w: r - x, h: bt - y } : null;
}

export function scaleBox(b: Box, kx: number, ky: number): Box {
  return { x: b.x * kx, y: b.y * ky, w: b.w * kx, h: b.h * ky };
}

/** A run of text: one element's visible glyph boxes (one per line fragment). */
export interface TextRun {
  id: number;
  boxes: Box[];
}

export interface OverlapPair {
  a: number;
  b: number;
  /** The largest single glyph-box intersection between the two runs. */
  w: number;
  h: number;
}

/**
 * Every pair of runs whose glyph boxes intersect by MORE than `minPx` on BOTH
 * axes. Line fragments are compared individually rather than as one union box
 * so that inline siblings ("Hello <b>world</b> again") never read as a
 * collision just because one wraps around the other.
 */
export function findOverlaps(runs: TextRun[], minPx = 6): OverlapPair[] {
  const prepared = runs
    .map((run) => ({ run, bounds: union(run.boxes) }))
    .filter((p): p is { run: TextRun; bounds: Box } => p.bounds !== null);
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < prepared.length; i += 1) {
    const A = prepared[i] as { run: TextRun; bounds: Box };
    for (let j = i + 1; j < prepared.length; j += 1) {
      const B = prepared[j] as { run: TextRun; bounds: Box };
      if (!intersect(A.bounds, B.bounds)) continue;
      let best: Box | null = null;
      for (const ra of A.run.boxes) {
        for (const rb of B.run.boxes) {
          const hit = intersect(ra, rb);
          if (!hit || hit.w <= minPx || hit.h <= minPx) continue;
          if (!best || area(hit) > area(best)) best = hit;
        }
      }
      if (best) pairs.push({ a: A.run.id, b: B.run.id, w: best.w, h: best.h });
    }
  }
  return pairs;
}
