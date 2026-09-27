/**
 * contentDownload.ts — what a screen says about the file it is downloading
 * (2026-09-27, download visibility).
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * A file of 8 MiB or more plays only once it is COMPLETELY on the screen
 * (readiness-gated playback, CLAUDE.md player rule 17: never streamed from
 * origin, never a lower-resolution stand-in). While it downloads, the glass
 * shows one of two things:
 *   • nothing to keep → the player's own "Downloading content" splash, proved
 *     as `idle:content-downloading`;
 *   • previous content → it KEEPS playing, the new playlist held back until one
 *     of its files is complete. The proof is still the old `pl:` signature.
 * The dashboard could tell neither from "nothing scheduled" / "current". The
 * player now reports the download inside the cache report it already sends
 * each telemetry tick (`Screen.lastCacheReport.downloading`, written by
 * apps/api/src/telemetry/cache-report.ts):
 *   { file, bytesLoaded, bytesTotal, deferredCommit }
 *
 * ── The rules this module keeps ──────────────────────────────────────
 *   • A download snapshot is a LIVENESS-grade fact — the page runs, bytes
 *     arrive. It never stands in for a painted frame (player rule 5), so no
 *     caller may use it to override a stale render proof.
 *   • A STALE snapshot is never shown as progress: older than about two
 *     telemetry ticks and the numbers are withheld (`state: 'stale'`). The API
 *     writes the report on every tick while a download is in flight, so a live
 *     download never ages past that.
 *   • No ETA — nothing here measures a rate, so nothing here predicts one.
 *
 * Pure: no React, no network, no wall clock (`now` is injected). The copy is
 * returned as catalogue references (`OpsMessage`) for the components to
 * translate, WITH the English it renders to — `DOWNLOAD_COPY_EN` must equal
 * en.json, and a test holds them together.
 */

/**
 * A line of dashboard copy by catalogue key. Components render
 * `t(message.key, message.values)`; the English beside it on each descriptor
 * exists for tests, search and the English-only surfaces around it.
 */
export interface OpsMessage {
  key: string;
  values?: Record<string, string | number>;
}

/** What the player reported, validated on the way in (the column is JSON). */
export interface DownloadSnapshot {
  /** The file's name as the player saw it (last URL path segment), raw. */
  file: string;
  bytesLoaded: number;
  bytesTotal: number | null;
  /** A NEW playlist is held back while the previous content stays on glass. */
  deferredCommit: boolean;
}

/**
 * How old a snapshot may be and still count as progress: two telemetry ticks
 * (60 s each) plus a failed tick's 15 s retry and some slack. Past this the
 * screen has stopped telling us about the download, and a frozen "62 %" on
 * the row would be a claim the evidence no longer supports (player rule 10).
 */
export const DOWNLOAD_REPORT_FRESH_MS = 150_000;

/** Same cap the API stores (cache-report.ts). */
const FILE_MAX_CHARS = 120;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

const nonNegInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

/**
 * The snapshot inside a cache report, or null. Defensive on purpose: this is
 * JSON from a column, and older rows (or an API from before the rebuild) can
 * hold anything.
 */
export function parseDownloadSnapshot(report: unknown): DownloadSnapshot | null {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return null;
  const raw = (report as { downloading?: unknown }).downloading;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const loaded = nonNegInt(d.bytesLoaded);
  if (loaded === null) return null;
  const total = nonNegInt(d.bytesTotal);
  const bytesTotal = total !== null && total > 0 ? total : null;
  return {
    file: typeof d.file === 'string' ? d.file.replace(CONTROL_CHARS, '').trim().slice(0, FILE_MAX_CHARS) : '',
    bytesLoaded: bytesTotal !== null ? Math.min(loaded, bytesTotal) : loaded,
    bytesTotal,
    deferredCommit: d.deferredCommit === true,
  };
}

/**
 *   downloading — fresh; nothing of the new content was waiting on it being
 *                 on glass (first boot, or a file downloading behind items
 *                 that already play)
 *   held        — fresh; the previous content stays on glass until one of
 *                 the new playlist's files is complete
 *   stale       — the last snapshot is too old to be progress; its numbers
 *                 must not be shown
 */
export type ContentDownloadState = 'downloading' | 'held' | 'stale';

export interface ContentDownload {
  state: ContentDownloadState;
  /** Decoded file name, or null when the player sent none. */
  fileName: string | null;
  bytesLoaded: number;
  bytesTotal: number | null;
  /** Whole percent, only when the size is known — floor, so 100 means done. */
  percent: number | null;
}

/** The fields of a screen row this reads (`GET /screens`). */
export interface DownloadSource {
  status?: string | null;
  lastCacheReport?: unknown;
  lastCacheReportAt?: string | Date | null;
}

function msOf(v: string | Date | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** "RIOT%20promo.mp4" → "RIOT promo.mp4"; a malformed escape passes through. */
function decodeName(raw: string): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return raw;
  }
}

/**
 * What this screen says it is downloading, or null. An OFFLINE screen says
 * nothing — its heartbeat owns the row, and any snapshot it left behind is
 * history. A report with no date cannot be graded fresh, so it is stale.
 */
export function deriveContentDownload(screen: DownloadSource, now: number): ContentDownload | null {
  if (screen.status !== 'ONLINE') return null;
  const snap = parseDownloadSnapshot(screen.lastCacheReport);
  if (!snap) return null;
  const at = msOf(screen.lastCacheReportAt);
  // A stamp from the future (the browser's clock behind the server's) is not
  // old; only an age past the window is.
  const fresh = at !== null && now - at <= DOWNLOAD_REPORT_FRESH_MS;
  const percent =
    snap.bytesTotal !== null ? Math.min(100, Math.floor((snap.bytesLoaded / snap.bytesTotal) * 100)) : null;
  return {
    state: !fresh ? 'stale' : snap.deferredCommit ? 'held' : 'downloading',
    fileName: decodeName(snap.file),
    bytesLoaded: snap.bytesLoaded,
    bytesTotal: snap.bytesTotal,
    percent,
  };
}

/** A download that may be shown as progress — never a stale one. */
export function liveDownload(d: ContentDownload | null | undefined): ContentDownload | null {
  return d && d.state !== 'stale' ? d : null;
}

/** "48.8 MB" / "1.2 GB" / "640 KB" — one byte vocabulary for the dashboard. */
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  return `${Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100} GB`;
}

// ═══════════════════════════════════════════════════════════════════
// Copy
// ═══════════════════════════════════════════════════════════════════

/**
 * The English of every key the download / content-state copy uses. MUST equal
 * en.json (contentDownload.test.ts compares them); es and zh live only in the
 * catalogue.
 */
export const DOWNLOAD_COPY_EN = {
  'screens.contentState.downloading': 'Downloading new content',
  'screens.contentState.downloadingProgress': 'Downloading new content · {percent}% of {size}',
  'screens.contentState.downloadingSoFar': 'Downloading new content · {loaded} so far',
  'screens.contentState.downloadingDetail':
    'The new file is downloading to this screen. It starts playing the moment the whole file is on the screen.',
  'screens.contentState.showingPrevious': 'Still showing previous content',
  'screens.contentState.showingPreviousProgress':
    'Still showing previous content · new content {percent}% of {size}',
  'screens.contentState.showingPreviousSoFar': 'Still showing previous content · new content {loaded} so far',
  'screens.contentState.showingPreviousDetail':
    'New content is downloading to this screen. It keeps playing what it had until the whole new file is on the screen, then switches over.',
  'screens.contentState.backgroundProgress': 'Downloading another file · {percent}% of {size}',
  'screens.contentState.backgroundSoFar': 'Downloading another file · {loaded} so far',
  'screens.contentState.unavailable': 'Content unavailable',
  'screens.contentState.unavailableDetail':
    'The screen is on, but none of the scheduled files would load, so it shows its “Content unavailable” card and tries again every 30 seconds on its own. If it stays this way, check the files in the playlist.',
  'screens.contentState.loading': 'Loading content',
  'screens.contentState.loadingDetail': 'The screen picked up its schedule and is opening the first item.',
  'screens.contentState.connecting': 'Screen on · connecting',
  'screens.contentState.connectingDetail':
    'The screen is on and still fetching its schedule, so it shows its waiting screen for now.',
  'playlistsPage.deliveryDownloadOne': '{name} · {percent}% of {size}',
  'playlistsPage.deliveryDownloadOneSoFar': '{name} · {loaded} so far',
  'playlistsPage.deliveryHeldOne': '{name} · new content {percent}% of {size}',
  'playlistsPage.deliveryHeldOneSoFar': '{name} · new content {loaded} so far',
  'playlistsPage.deliveryDownloadMany': 'on {count} of {screens} screens',
} as const;

export type DownloadCopyKey = keyof typeof DOWNLOAD_COPY_EN;

/** A catalogue line and the English it renders to. */
export interface Copy {
  en: string;
  message: OpsMessage;
}

/** Build one line: the reference for `t()`, and its English. */
export function copy(key: DownloadCopyKey, values?: Record<string, string | number>): Copy {
  const en = DOWNLOAD_COPY_EN[key].replace(/\{(\w+)\}/g, (m, name: string) =>
    values && name in values ? String(values[name]) : m,
  );
  return { en, message: values ? { key, values } : { key } };
}

/**
 * The one line that says what a screen is doing with a download:
 *   'downloading'      — nothing of the new content on glass yet
 *   'showing-previous' — the previous content kept on glass meanwhile
 *   'background'       — the new content plays; another of its files downloads
 * With no fresh progress the line carries none — the proof alone says
 * "downloading", and a stale snapshot's numbers are never repeated.
 */
export function downloadLine(
  kind: 'downloading' | 'showing-previous' | 'background',
  download: ContentDownload | null | undefined,
): Copy {
  const d = liveDownload(download);
  const size = d && d.bytesTotal !== null ? fmtBytes(d.bytesTotal) : null;
  const withTotal = d !== null && d.percent !== null && size !== null;
  if (kind === 'showing-previous') {
    if (!d) return copy('screens.contentState.showingPrevious');
    return withTotal
      ? copy('screens.contentState.showingPreviousProgress', { percent: d.percent as number, size: size as string })
      : copy('screens.contentState.showingPreviousSoFar', { loaded: fmtBytes(d.bytesLoaded) });
  }
  if (kind === 'background') {
    // Callers only ask for this with a fresh download in hand; without one
    // there is nothing to say beyond the plain state.
    if (!d) return copy('screens.contentState.downloading');
    return withTotal
      ? copy('screens.contentState.backgroundProgress', { percent: d.percent as number, size: size as string })
      : copy('screens.contentState.backgroundSoFar', { loaded: fmtBytes(d.bytesLoaded) });
  }
  if (!d) return copy('screens.contentState.downloading');
  return withTotal
    ? copy('screens.contentState.downloadingProgress', { percent: d.percent as number, size: size as string })
    : copy('screens.contentState.downloadingSoFar', { loaded: fmtBytes(d.bytesLoaded) });
}
