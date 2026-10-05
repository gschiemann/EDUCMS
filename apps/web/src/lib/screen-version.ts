/**
 * screen-version.ts — the URL a picker may keep for a video the server
 * converts AFTER upload (2026-10-05).
 *
 * A MOV, AVI, MKV, WMV, MPG, 3GP or MPEG-TS upload is stored as it came and the
 * signage transcode then swaps an H.264 MP4 in: the asset's `fileUrl` CHANGES.
 * Anything that goes through the asset (a playlist item) follows the swap. But
 * the template builder's media picker, the asset picker (sports cues, sponsors,
 * spotlights) and their kin store the URL BY VALUE in a widget's config — and a
 * URL kept from the upload response is the ORIGINAL, which the swap never
 * touches (the original is kept while anything names it). That widget would
 * play the `.mov` on every screen, forever.
 *
 * So such a picker waits here — "Optimizing for screens… 37%" — and keeps the
 * MP4's URL. `GET /assets/optimization` answers the job's state AND the URL the
 * asset serves now. Bounded: it stops on the picker's AbortSignal, and after
 * SCREEN_VERSION_MAX_WAIT_MS it gives up with words that say the file is in the
 * Media Library, still converting. Never used for a file screens play as
 * uploaded (MP4, pictures): those keep the upload's URL at once, as before.
 */
import { apiFetch } from '@/lib/api-client';

export const SCREEN_VERSION_POLL_MS = 3_000;
export const SCREEN_VERSION_MAX_WAIT_MS = 45 * 60_000;
/** How long a job may take to appear at all before "it was never queued" is believed. */
export const SCREEN_VERSION_QUEUE_GRACE_MS = 30_000;

export interface ScreenVersionStatus {
  status: string;
  reason: string | null;
  progress: number | null;
  fileUrl: string | null;
  mimeType: string | null;
}

export interface ScreenVersionDeps {
  getStatus(assetId: string): Promise<ScreenVersionStatus | null>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
}

export type ScreenVersionFailure = 'failed' | 'timeout' | 'aborted';

export class ScreenVersionError extends Error {
  constructor(
    readonly code: ScreenVersionFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ScreenVersionError';
  }
}

const realDeps: ScreenVersionDeps = {
  getStatus: async (assetId) => {
    const r = await apiFetch<{ items?: Array<ScreenVersionStatus & { assetId: string }> }>(
      `/assets/optimization?ids=${encodeURIComponent(assetId)}`,
    );
    return r?.items?.find((i) => i.assetId === assetId) ?? null;
  },
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    }),
  now: () => Date.now(),
};

/**
 * Wait until the asset serves its converted MP4 and return that URL. Rejects
 * with a ScreenVersionError: `failed` (the conversion did not produce an MP4),
 * `timeout`, `aborted`. A status read that fails (a network blip) is retried.
 */
export async function waitForScreenVersion(
  assetId: string,
  opts: {
    onProgress?: (pct: number | null) => void;
    signal?: AbortSignal;
    deps?: Partial<ScreenVersionDeps>;
  } = {},
): Promise<{ fileUrl: string; mimeType: string }> {
  const deps: ScreenVersionDeps = { ...realDeps, ...(opts.deps || {}) };
  const started = deps.now();
  for (;;) {
    if (opts.signal?.aborted) throw new ScreenVersionError('aborted', 'Cancelled.');
    let s: ScreenVersionStatus | null = null;
    let readOk = true;
    try {
      s = await deps.getStatus(assetId);
    } catch {
      readOk = false;
    }
    if (s) {
      if (s.status === 'queued' || s.status === 'running') {
        opts.onProgress?.(typeof s.progress === 'number' ? s.progress : null);
      } else if ((s.status === 'done' || s.status === 'skipped') && s.fileUrl && s.mimeType === 'video/mp4') {
        opts.onProgress?.(100);
        return { fileUrl: s.fileUrl, mimeType: s.mimeType };
      } else {
        // failed, or finished without an MP4 (it was never converted).
        throw new ScreenVersionError('failed', `The conversion ended ${s.status}${s.reason ? ` (${s.reason})` : ''}.`);
      }
    } else if (readOk && deps.now() - started > SCREEN_VERSION_QUEUE_GRACE_MS) {
      // No job at all, long after the upload queued one: it never will be converted.
      throw new ScreenVersionError('failed', 'The conversion was never queued.');
    }
    if (deps.now() - started > SCREEN_VERSION_MAX_WAIT_MS) {
      throw new ScreenVersionError('timeout', 'Still converting.');
    }
    await deps.sleep(SCREEN_VERSION_POLL_MS, opts.signal);
  }
}
