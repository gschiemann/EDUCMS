/**
 * The words for the publish-time VIDEO gate (video guarantee step 5,
 * 2026-10-12), in the operator's language.
 *
 * The API answers a publish with `playbackWarnings` (VIDEO_PLAYBACK_GATE=warn,
 * the default — the publish went through) or refuses it with 422
 * `VIDEO_SCREEN_CANNOT_PLAY` (=enforce). Each warning names the file and the
 * screen(s) and carries a machine-readable `reason`; the API's own English
 * `message` is kept only as a fallback for a reason this bundle does not know.
 * No codec words, no rung names — what the operator can see and what happens.
 */

export interface PlaybackGateWarning {
  code: 'VIDEO_MAY_STUTTER' | 'VIDEO_SCREEN_CANNOT_PLAY';
  reason: 'capability' | 'measured-stutter' | 'over-capability' | 'concurrency' | 'two-sided' | string;
  assetId: string;
  file: string;
  screens: Array<{ id: string; name: string }>;
  hasLighterCopy?: boolean;
  max?: number;
  demand?: number;
  message?: string;
}

/** The `t` of `useTranslations('playbackGate')`. */
export type PlaybackGateT = (key: string, values?: Record<string, string | number>) => string;

const KNOWN = new Set(['capability', 'measured-stutter', 'over-capability', 'concurrency', 'two-sided']);
const SCREENS_SHOWN = 3;
const NAME_CHARS = 60;

const clip = (s: string) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > NAME_CHARS ? `${one.slice(0, NAME_CHARS - 1)}…` : one;
};

/** The warnings a response body carries, validated; [] when none. */
export function playbackWarningsOf(body: unknown): PlaybackGateWarning[] {
  const raw = body && typeof body === 'object' ? (body as { playbackWarnings?: unknown; warnings?: unknown }) : null;
  const list = Array.isArray(raw?.playbackWarnings) ? raw!.playbackWarnings : Array.isArray(raw?.warnings) ? raw!.warnings : [];
  const out: PlaybackGateWarning[] = [];
  for (const w of list as unknown[]) {
    const r = w && typeof w === 'object' ? (w as Record<string, unknown>) : null;
    if (!r || typeof r.file !== 'string' || typeof r.reason !== 'string' || !Array.isArray(r.screens)) continue;
    const screens = (r.screens as unknown[])
      .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>) : null))
      .filter((s): s is Record<string, unknown> => !!s && typeof s.id === 'string')
      .map((s) => ({ id: String(s.id), name: typeof s.name === 'string' && s.name ? s.name : String(s.id) }));
    if (!screens.length) continue;
    out.push({
      code: r.code === 'VIDEO_SCREEN_CANNOT_PLAY' ? 'VIDEO_SCREEN_CANNOT_PLAY' : 'VIDEO_MAY_STUTTER',
      reason: r.reason,
      assetId: typeof r.assetId === 'string' ? r.assetId : '',
      file: r.file,
      screens,
      hasLighterCopy: r.hasLighterCopy === true,
      ...(typeof r.max === 'number' ? { max: r.max } : {}),
      ...(typeof r.demand === 'number' ? { demand: r.demand } : {}),
      ...(typeof r.message === 'string' ? { message: r.message } : {}),
    });
  }
  return out;
}

/** “Lobby”, “Gym” and 2 more — in the operator's language. */
export function screenList(t: PlaybackGateT, names: string[]): string {
  const shown = names.slice(0, SCREENS_SHOWN).map((n) => t('quoted', { name: clip(n) }));
  const joined = shown.join(t('separator'));
  return names.length > shown.length ? t('andMore', { names: joined, count: names.length - shown.length }) : joined;
}

/** One warning as one sentence. */
export function playbackWarningText(t: PlaybackGateT, w: PlaybackGateWarning): string {
  if (!KNOWN.has(w.reason)) return w.message || t('fallback', { file: clip(w.file) });
  return t(`reason.${w.reason}`, {
    file: clip(w.file),
    screens: screenList(t, w.screens.map((s) => s.name)),
    count: w.screens.length,
    max: w.max ?? 1,
    demand: w.demand ?? 2,
  });
}

/** The translated words for an enforce refusal, or null when `err` is not one. */
export function playbackGateErrorText(t: PlaybackGateT, err: unknown): string | null {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; body?: unknown };
  if (String(e.code) !== 'VIDEO_SCREEN_CANNOT_PLAY') return null;
  const warnings = playbackWarningsOf(e.body);
  if (!warnings.length) return null;
  return `${warnings.map((w) => playbackWarningText(t, w)).join(' ')} ${t('previousStays')}`;
}

/** For a mutation: replace a refusal's `message` with the translated words. */
export function withPlaybackGateText<E>(t: PlaybackGateT, err: E): E {
  const text = playbackGateErrorText(t, err);
  if (text && err instanceof Error) err.message = text;
  return err;
}
