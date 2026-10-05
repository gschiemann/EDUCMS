/**
 * The words for a publish that could not prepare files for 1080p screens
 * (2026-10-05), in the operator's language.
 *
 * One picture that could not get its 1080p copy used to refuse a whole publish
 * with "The 1080p image copy could not be prepared … please retry publishing" —
 * no file named, and retrying never helped (media beta test 2026-10-04). The API
 * now names every such file and sends them machine-readable:
 *   • a refused publish (POST /schedules and the activation doors): 422 / 503
 *     `IMAGE_PLAYBACK_COPY_FAILED` | `VIDEO_PLAYBACK_COPY_QUEUE_FAILED` with
 *     `files: [{ assetId, name }]` and `retryable`;
 *   • a held publish whose video copy failed later: the rule's
 *     `pendingMediaError` (English, naming the files) plus `pendingMediaFiles`
 *     on GET /schedules.
 * These turn that into `playbackCopy.*` words. Without `files` the server's own
 * sentence is kept as sent.
 */

/** One file a publish could not prepare. */
export interface PlaybackCopyFile {
  assetId: string;
  name: string;
}

/** The `t` of `useTranslations('playbackCopy')`. */
export type PlaybackCopyT = (key: string, values?: Record<string, string | number>) => string;

const REFUSAL_CODES = new Set(['IMAGE_PLAYBACK_COPY_FAILED', 'VIDEO_PLAYBACK_COPY_QUEUE_FAILED']);
const NAMES_SHOWN = 5;
const NAME_CHARS = 80;

/** The files a body / row carries, or null when it carries none. */
export function playbackCopyFiles(v: unknown): PlaybackCopyFile[] | null {
  if (!Array.isArray(v)) return null;
  const out: PlaybackCopyFile[] = [];
  for (const f of v) {
    const rec = f && typeof f === 'object' ? (f as Record<string, unknown>) : {};
    if (typeof rec.assetId === 'string' && typeof rec.name === 'string') out.push({ assetId: rec.assetId, name: rec.name });
  }
  return out.length ? out : null;
}

/** `“a.jpg”, “b.png” and 3 more` — at most five names, each cut at 80 characters, in the operator's language. */
export function playbackCopyFileList(t: PlaybackCopyT, names: string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).map((n) => {
    const one = n.replace(/\s+/g, ' ').trim();
    return t('quoted', { name: one.length > NAME_CHARS ? `${one.slice(0, NAME_CHARS - 1)}…` : one });
  });
  const joined = shown.join(t('separator'));
  return names.length > shown.length ? t('andMore', { names: joined, count: names.length - shown.length }) : joined;
}

function wordsFor(t: PlaybackCopyT, files: PlaybackCopyFile[], retryable: boolean): string {
  return t(retryable ? 'notNow' : 'cannotPrepare', {
    count: files.length,
    files: playbackCopyFileList(t, files.map((f) => f.name)),
  });
}

/** The translated words for a refused publish, or null when `err` is not one that names files. */
export function playbackCopyErrorText(t: PlaybackCopyT, err: unknown): string | null {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; body?: unknown };
  if (!REFUSAL_CODES.has(String(e.code))) return null;
  const body = (e.body && typeof e.body === 'object' ? e.body : {}) as { files?: unknown; retryable?: unknown };
  const files = playbackCopyFiles(body.files);
  return files ? wordsFor(t, files, body.retryable === true) : null;
}

/**
 * For a mutation: the same error, its `message` replaced by the translated words
 * when it is a refused publish that names files. Every caller shows
 * `err.message`, so this is the one place the words change.
 */
export function withPlaybackCopyText<E>(t: PlaybackCopyT, err: E): E {
  const text = playbackCopyErrorText(t, err);
  if (text && err instanceof Error) err.message = text;
  return err;
}

/**
 * Rows from GET /schedules: a held publish that failed carries its files
 * (`pendingMediaFiles`); its `pendingMediaError` becomes the translated words.
 * Rows without files keep the server's sentence. Returns the same array when
 * nothing changes, so a query's `select` stays referentially stable.
 */
export function translateFailedPublications<T>(t: PlaybackCopyT, rows: T): T {
  if (!Array.isArray(rows)) return rows;
  let changed = false;
  const out = rows.map((row: unknown) => {
    const r = row as { pendingMediaError?: unknown; pendingMediaFiles?: unknown } | null;
    const files = r && typeof r.pendingMediaError === 'string' && r.pendingMediaError ? playbackCopyFiles(r.pendingMediaFiles) : null;
    if (!files) return row;
    changed = true;
    return { ...(row as object), pendingMediaError: wordsFor(t, files, false) };
  });
  return (changed ? out : rows) as T;
}
