/**
 * What the splash says about a large-file download (2026-10-31). Pure.
 *
 * The bar used to show `bytesStaged / total` and nothing else, and only moved
 * when a whole 8 MiB chunk landed, then sat on its last value through the
 * SHA-256 check and the move into place. Now: live bytes inside a chunk, and
 * a named phase for each step after the last byte arrives.
 */
export type DownloadPhase = 'downloading' | 'verifying' | 'finishing';

export type DownloadProgressView = {
  name: string;
  bytesLoaded: number;
  bytesTotal: number | null;
  phase?: DownloadPhase;
};

const clampPct = (loaded: number, total: number): number =>
  Math.max(0, Math.min(100, Math.floor((loaded * 100) / total)));

/** Bar fill 0-100, or null when the total is unknown. */
export function downloadBarPercent(d: DownloadProgressView): number | null {
  if (!d.bytesTotal || d.bytesTotal <= 0) return null;
  // While finishing, the file is all there: the bar is full, the label says what is happening.
  if (d.phase === 'finishing') return 100;
  return clampPct(d.bytesLoaded, d.bytesTotal);
}

/** The line under "Downloading content". */
export function downloadProgressLabel(
  d: DownloadProgressView,
  fmt: (bytes: number) => string,
): string {
  const pct = downloadBarPercent(d);
  if (d.phase === 'finishing') return `${d.name} — finishing…`;
  if (d.phase === 'verifying') {
    return pct !== null && d.bytesLoaded > 0
      ? `${d.name} — verifying… ${pct}%`
      : `${d.name} — verifying…`;
  }
  if (pct !== null && d.bytesTotal) {
    return `${d.name} — ${pct}% (${fmt(d.bytesLoaded)} of ${fmt(d.bytesTotal)})`;
  }
  return `${d.name} — ${fmt(d.bytesLoaded)} so far`;
}
