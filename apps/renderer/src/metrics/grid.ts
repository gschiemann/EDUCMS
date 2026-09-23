/**
 * Dead-space measurement: split the frame into a grid (16 × 9 for a 16:9
 * board) and count the cells that are one flat colour with no text or image
 * on them. Greg's "sparse" boards are exactly the ones where a third or more
 * of the canvas is a flat void; the rubric's target is a ratio ≤ 0.35, and a
 * single connected void over ~12 % of the canvas reads as unfinished.
 *
 * "Flat" is measured, not assumed: the largest per-channel standard
 * deviation of the cell's pixels must be ≤ `flatStdDev` (3 of 255 by default
 * — gradient dithering passes, a photo or a texture does not).
 */
import { clampRect, type PixelImage, type PxRect } from './pixels.js';

export interface GridResult {
  cols: number;
  rows: number;
  emptyCells: number;
  ratio: number;
  largestVoidCells: number;
  largestVoidPct: number;
  /** One string per row, '.' empty, '#' used. */
  map: string[];
}

export interface GridOptions {
  cols?: number;
  rows?: number;
  /** Text / image boxes in IMAGE pixels. A cell touched by one is used. */
  occupied?: PxRect[];
  flatStdDev?: number;
  maxSamplesPerCell?: number;
}

/** Largest per-channel standard deviation over a cell (sampled). */
export function cellFlatness(img: PixelImage, cell: PxRect, maxSamples = 1600): number {
  const b = clampRect(img, cell);
  if (!b) return 0;
  const area = (b.x1 - b.x0) * (b.y1 - b.y0);
  const stride = Math.max(1, Math.ceil(Math.sqrt(area / maxSamples)));
  const { data, width, channels } = img;
  let n = 0;
  const sum = [0, 0, 0];
  const sq = [0, 0, 0];
  for (let y = b.y0; y < b.y1; y += stride) {
    for (let x = b.x0; x < b.x1; x += stride) {
      const i = (y * width + x) * channels;
      for (let c = 0; c < 3; c += 1) {
        const v = data[i + c] as number;
        sum[c] = (sum[c] as number) + v;
        sq[c] = (sq[c] as number) + v * v;
      }
      n += 1;
    }
  }
  if (n === 0) return 0;
  let worst = 0;
  for (let c = 0; c < 3; c += 1) {
    const mean = (sum[c] as number) / n;
    const variance = Math.max(0, (sq[c] as number) / n - mean * mean);
    worst = Math.max(worst, Math.sqrt(variance));
  }
  return worst;
}

function touches(cell: PxRect, r: PxRect): boolean {
  const ix = Math.min(cell.x + cell.w, r.x + r.w) - Math.max(cell.x, r.x);
  const iy = Math.min(cell.y + cell.h, r.y + r.h) - Math.max(cell.y, r.y);
  // A sliver of a neighbour's box (anti-aliasing, a rounded ink estimate) is
  // not "something on this cell"; a few pixels of real overlap is.
  return ix >= 3 && iy >= 3;
}

/** Size of the largest 4-connected group of `true` cells. */
export function largestComponent(empty: boolean[], cols: number, rows: number): number {
  const seen = new Uint8Array(empty.length);
  let best = 0;
  for (let start = 0; start < empty.length; start += 1) {
    if (!empty[start] || seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      size += 1;
      const x = i % cols;
      const y = Math.floor(i / cols);
      const next = [
        x > 0 ? i - 1 : -1,
        x < cols - 1 ? i + 1 : -1,
        y > 0 ? i - cols : -1,
        y < rows - 1 ? i + cols : -1,
      ];
      for (const j of next) {
        if (j >= 0 && empty[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

export function gridEmptiness(img: PixelImage, opts: GridOptions = {}): GridResult {
  const cols = opts.cols ?? 16;
  const rows = opts.rows ?? 9;
  const occupied = opts.occupied ?? [];
  const flatStdDev = opts.flatStdDev ?? 3;
  const cellW = img.width / cols;
  const cellH = img.height / rows;
  const empty: boolean[] = [];
  const map: string[] = [];
  for (let y = 0; y < rows; y += 1) {
    let line = '';
    for (let x = 0; x < cols; x += 1) {
      const cell: PxRect = { x: x * cellW, y: y * cellH, w: cellW, h: cellH };
      const flat = cellFlatness(img, cell, opts.maxSamplesPerCell) <= flatStdDev;
      const used = !flat || occupied.some((r) => touches(cell, r));
      empty.push(!used);
      line += used ? '#' : '.';
    }
    map.push(line);
  }
  const emptyCells = empty.filter(Boolean).length;
  const total = cols * rows;
  const largest = largestComponent(empty, cols, rows);
  return {
    cols,
    rows,
    emptyCells,
    ratio: emptyCells / total,
    largestVoidCells: largest,
    largestVoidPct: largest / total,
    map,
  };
}
