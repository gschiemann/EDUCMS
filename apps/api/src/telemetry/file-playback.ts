/**
 * Per-(screen, file) playback evidence — the ingest half of the video
 * guarantee's step 1 (2026-10-11,
 * docs/research/2026-10-11-launch-readiness/02-video-guarantee.md §4.4).
 *
 * The telemetry POST already writes the latest sample to
 * `Screen.lastVideoReport` (latest wins, no history, no digest). When the
 * sample names the file by digest (`video.sha256`, sent by a web bundle from
 * this wave on), it is ALSO folded into ONE `screen_file_playback` row per
 * screen × file by the pure `foldPlaybackSample` (@cms/api-types), so the
 * dashboard — and later the publish gate — can say whether THIS screen plays
 * THIS file smoothly, from minutes of evidence rather than one.
 *
 * Posture, same as every other telemetry side write:
 *   • NOT manifest-fed (neither model is in MANIFEST_FED_MODELS) — a write
 *     here never busts the manifest hot cache.
 *   • Best-effort. The caller wraps it in try/catch: evidence must never turn
 *     a healthy report into a 500 the player retries forever.
 *   • Tenant scope comes from the LIVE screen row, never from the payload.
 *   • Bounded: one narrow read + one read + one upsert, and only on a report
 *     that carries a digest — at most once per accepted POST (≥ 30 s apart).
 *   • Changes NOTHING a screen plays by itself. Since 2026-10-12 it also keeps
 *     the VISIBLE-stutter streak (`visibleBadStreak`: settled, cached samples
 *     in a row that dropped ≥ 5 % or froze ≥ 250 ms; one good sample resets
 *     it), which the closed loop (`PlaybackDemotionService.evaluate`) reads.
 *   • Since 2026-10-17 a sample inside the warm-up of a page load, an engine
 *     change, a hand-off or a player update — or one the browser played while
 *     the screen should be on its hardware engine — is RECORDED (counted, its
 *     reason kept for the dashboard) and never graded: it moves no verdict and
 *     no streak, so it can never demote (`playbackSampleExclusion`).
 */

import {
  EMPTY_FILE_PLAYBACK,
  MEDIA_CAPS_CONFIGS,
  asPlaybackSampleExclusion,
  classifyVisibleStutterSample,
  foldPlaybackSample,
  nextVisibleBadStreak,
  playbackSampleExclusion,
  visibleStutterThresholds,
  type PlaybackSampleExclusion,
  type VisibleSampleClass,
  type VisibleStutterThresholds,
  playbackDeviceClass,
  type FilePlaybackRecord,
  type MediaCapsReport,
  type PlaybackSampleInput,
} from '@cms/api-types';

/** A sibling face counts as "playing video too" when it reported a sample this recently. */
export const SIBLING_VIDEO_WINDOW_MS = 150_000;

/** Narrow Prisma surface this module needs — kept small so specs can fake it. */
export interface FilePlaybackDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray | any, ...values: any[]): Promise<T>;
  screenFilePlayback: {
    findUnique(args: any): Promise<any>;
    upsert(args: any): Promise<any>;
  };
}

/** The sanitized sample (`sanitizeVideoReport` output) this module folds. */
export interface StoredVideoSample extends PlaybackSampleInput {
  url: string;
  sha256?: string;
  /** Wall-clock span the counters cover, ms — dates the sample's start. */
  elapsedMs?: number | null;
}

export function webviewMajorFromUserAgent(ua: unknown): number | null {
  if (typeof ua !== 'string') return null;
  const m = /\bChrome\/(\d{2,4})\./.exec(ua.slice(0, 512));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 10_000 ? n : null;
}

const toNum = (v: unknown): number => {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
};

/** A stored row → the pure record shape (BigInt counters → numbers). */
export function recordFromRow(row: any): FilePlaybackRecord {
  if (!row) return { ...EMPTY_FILE_PLAYBACK };
  return {
    samples: toNum(row.samples),
    settledSamples: toNum(row.settledSamples),
    frames: toNum(row.frames),
    dropped: toNum(row.dropped),
    stalls: toNum(row.stalls),
    stalledMs: toNum(row.stalledMs),
    consecutiveGood: toNum(row.consecutiveGood),
    consecutiveBad: toNum(row.consecutiveBad),
    worstPct: typeof row.worstPct === 'number' ? row.worstPct : null,
    lastPct: typeof row.lastPct === 'number' ? row.lastPct : null,
    lastGrade: row.lastGrade ?? null,
    lastSettled: row.lastSettled === true,
    width: typeof row.width === 'number' ? row.width : null,
    height: typeof row.height === 'number' ? row.height : null,
    engine: row.engine ?? null,
    concurrentMax: toNum(row.concurrentMax) || 1,
    unitConcurrentMax: toNum(row.unitConcurrentMax) || 1,
    verdict: row.verdict ?? 'insufficient',
  };
}

/** The record → the columns written (explicit map; the payload is never spread). */
function columnsFromRecord(r: FilePlaybackRecord) {
  return {
    width: r.width,
    height: r.height,
    samples: r.samples,
    settledSamples: r.settledSamples,
    frames: BigInt(Math.floor(r.frames)),
    dropped: BigInt(Math.floor(r.dropped)),
    stalls: Math.min(r.stalls, 2_147_483_647),
    stalledMs: BigInt(Math.floor(r.stalledMs)),
    consecutiveGood: r.consecutiveGood,
    consecutiveBad: r.consecutiveBad,
    worstPct: r.worstPct,
    lastPct: r.lastPct,
    lastGrade: r.lastGrade,
    lastSettled: r.lastSettled,
    engine: r.engine,
    concurrentMax: r.concurrentMax,
    unitConcurrentMax: r.unitConcurrentMax,
    verdict: r.verdict,
  };
}

/**
 * Fold one sample into the screen's row for that file. Returns the new record,
 * or null when the sample carries no digest / the screen has no tenant (an
 * unpaired screen's evidence has nowhere to belong).
 */
/** The folded record plus the visible-stutter facts the closed loop needs. */
export type IngestedFilePlayback = FilePlaybackRecord & {
  /** This sample under the visible-stutter rule — `ignored` whenever it was excluded. */
  visibleClass: VisibleSampleClass;
  /** BAD samples in a row after this one (stored as `visible_bad_streak`). */
  visibleBadStreak: number;
  /** Why this sample was recorded without grading; null when it graded. */
  excludedReason: PlaybackSampleExclusion | null;
};

/** What the telemetry POST knows about the moments a sample must not be graded across. */
export interface SampleGuardContext {
  /** The screen's last page load — every proven register rotates `credentialEpochRotatedAt`. */
  pageLoadAt?: Date | null;
  /** The hardware engine's session in this report differs from the one on record. */
  nativeSessionChanged?: boolean;
  /** The engine this screen is supposed to play this file on (`expectedPlaybackEngine`). */
  expectedEngine?: 'native' | 'web';
}

const timeMs = (d: unknown): number | null => {
  if (d instanceof Date) return Number.isFinite(d.getTime()) ? d.getTime() : null;
  if (typeof d === 'string' || typeof d === 'number') {
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
};

export async function ingestFilePlayback(
  db: FilePlaybackDb,
  args: {
    screenId: string;
    tenantId: string | null;
    sample: StoredVideoSample;
    playerVersionCode: number | null;
    webviewMajor: number | null;
    now: Date;
    /** Default: from the environment (`VIDEO_DEMOTION_*`). */
    thresholds?: VisibleStutterThresholds;
    /** Page load / hand-off / engine facts (2026-10-17). Absent = none known, graded as before. */
    guard?: SampleGuardContext;
  },
): Promise<IngestedFilePlayback | null> {
  const { screenId, tenantId, sample, now } = args;
  const sha = typeof sample.sha256 === 'string' && /^[0-9a-f]{64}$/.test(sample.sha256) ? sample.sha256 : null;
  if (!sha || !tenantId) return null;

  // The model of this box, and how many sibling faces of the same physical
  // unit are playing video right now (a double-sided display's faces are
  // separate screen rows). One narrow read, self-scoped to the screen the
  // device token proved. `display_capabilities->'build'` only — never the
  // whole JSON.
  const since = new Date(now.getTime() - SIBLING_VIDEO_WINDOW_MS);
  const rows = await db.$queryRaw<Array<{ build: unknown; siblings: number | bigint | null }>>`
    SELECT s.display_capabilities->'build' AS build,
      (SELECT count(*)::int FROM screens f
        WHERE f.id <> s.id
          AND (f.id = s.face_of_screen_id OR f.face_of_screen_id = COALESCE(s.face_of_screen_id, s.id))
          AND f.last_video_report_at > ${since}) AS siblings
    FROM screens s WHERE s.id = ${screenId}`;
  const row = Array.isArray(rows) ? rows[0] : null;
  const deviceClass = playbackDeviceClass((row?.build ?? null) as any);
  const siblings = toNum(row?.siblings ?? 0);
  const ownConcurrent = typeof sample.concurrent === 'number' && sample.concurrent > 0 ? Math.floor(sample.concurrent) : 1;

  const key = { screenId_fileSha256: { screenId, fileSha256: sha } };
  // ten-ok: self-scoped device write — the composite key starts with the
  // screen id the device token proved; tenantId comes from that live row.
  const existing = await db.screenFilePlayback.findUnique({ where: key });
  // The demotion sample guard (2026-10-17): decided BEFORE the fold, so an
  // excluded sample never reaches a settled counter, a verdict or the streak.
  const guard = args.guard ?? {};
  const exclusion = playbackSampleExclusion({
    nowMs: now.getTime(),
    elapsedMs: sample.elapsedMs ?? null,
    first: sample.first ?? null,
    engine: sample.engine ?? null,
    playerVersionCode: args.playerVersionCode,
    pageLoadAtMs: timeMs(guard.pageLoadAt),
    previous: existing
      ? {
          engine: existing.engine ?? null,
          playerVersionCode: typeof existing.playerVersionCode === 'number' ? existing.playerVersionCode : null,
          excludedUntilMs: timeMs(existing.excludedUntil),
          excludedReason: existing.excludedReason ?? null,
        }
      : null,
    nativeSessionChanged: guard.nativeSessionChanged === true,
    expectedEngine: guard.expectedEngine ?? 'web',
  });
  const excluded = exclusion.reason !== null;
  const next = foldPlaybackSample(recordFromRow(existing), sample, { unitConcurrent: ownConcurrent + siblings, excluded });
  const visibleClass: VisibleSampleClass = excluded
    ? 'ignored'
    : classifyVisibleStutterSample(sample, args.thresholds ?? visibleStutterThresholds(process.env));
  const prevStreak = typeof existing?.visibleBadStreak === 'number' ? existing.visibleBadStreak : 0;
  const visibleBadStreak = nextVisibleBadStreak(prevStreak, visibleClass);
  const prevExcluded = typeof existing?.excludedSamples === 'number' ? existing.excludedSamples : 0;
  const cols = {
    ...columnsFromRecord(next),
    visibleBadStreak,
    tenantId,
    deviceClass,
    fileUrl: sample.url.slice(0, 512),
    playerVersionCode: args.playerVersionCode,
    webviewMajor: args.webviewMajor,
    lastAt: now,
    // The most recent excluded sample stays on the row after grading resumes,
    // so the dashboard can still say what was left out and why.
    excludedReason: excluded ? exclusion.reason : asPlaybackSampleExclusion(existing?.excludedReason),
    excludedAt: excluded ? now : (existing?.excludedAt ?? null),
    excludedUntil: exclusion.windowUntilMs !== null ? new Date(exclusion.windowUntilMs) : null,
    excludedSamples: Math.min(prevExcluded + (excluded ? 1 : 0), 2_147_483_647),
  };
  // ten-ok: same self-scoped composite key as the read above.
  await db.screenFilePlayback.upsert({
    where: key,
    create: { screenId, fileSha256: sha, firstAt: now, ...cols },
    update: cols,
    select: { screenId: true },
  });
  return { ...next, visibleClass, visibleBadStreak, excludedReason: exclusion.reason };
}

/**
 * The engine a screen is SUPPOSED to play a file on (2026-10-17, plan §4B):
 * `native` whenever its current manifest hands the Android hardware engine
 * this very file (`nativeVideo`, protocol 2, or the protocol-1 pair's
 * `nativeSharedVideo`) — otherwise `web`. Owner direction, 2026-10-17: native
 * hardware video is the target engine on every class and the browser is only
 * its automatic fallback, so the descriptor alone decides; no player-version
 * or capability guess overrides it. A sample the browser took of a file the
 * hardware engine owns comes from a hand-off or a fallback (an engine fault
 * the browser covered for, or an APK that cannot run the engine yet); it is
 * never evidence that the FILE stutters, so it never demotes.
 *
 * `manifest` is the screen's cached manifest payload (in-process hot cache),
 * or null when this replica has none; `evidenceSha` is the file the hardware
 * engine reported in this POST or last on record — without a manifest, the
 * hardware engine's own report is the evidence.
 */
export function expectedPlaybackEngine(args: {
  sha256: string;
  manifest: Record<string, any> | null | undefined;
  evidenceSha: string | null | undefined;
}): 'native' | 'web' {
  const sha = args.sha256.toLowerCase();
  const m = args.manifest;
  if (m && typeof m === 'object') {
    const handed = [m.nativeVideo?.asset?.sha256, m.nativeSharedVideo?.asset?.sha256].some(
      (x) => typeof x === 'string' && x.toLowerCase() === sha,
    );
    return handed ? 'native' : 'web';
  }
  return typeof args.evidenceSha === 'string' && args.evidenceSha.toLowerCase() === sha ? 'native' : 'web';
}

/**
 * Rebuild the declared-capability block field by field — never persist the
 * raw payload. Only the four canonical configs, each once, booleans only.
 */
export function sanitizeMediaCaps(raw: unknown): MediaCapsReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ids = new Set<string>(MEDIA_CAPS_CONFIGS);
  const seen = new Set<string>();
  const configs: MediaCapsReport['configs'] = [];
  for (const c of Array.isArray(r.configs) ? r.configs.slice(0, 8) : []) {
    if (!c || typeof c !== 'object') continue;
    const e = c as Record<string, unknown>;
    if (typeof e.id !== 'string' || !ids.has(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    configs.push({
      id: e.id as MediaCapsReport['configs'][number]['id'],
      supported: e.supported === true,
      smooth: e.smooth === true,
      powerEfficient: e.powerEfficient === true,
    });
  }
  if (configs.length === 0) return null;
  const wv = typeof r.webviewMajor === 'number' && Number.isFinite(r.webviewMajor) && r.webviewMajor > 0 && r.webviewMajor < 10_000
    ? Math.floor(r.webviewMajor) : null;
  return { webviewMajor: wv, configs };
}
