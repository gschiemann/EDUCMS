/**
 * playback-config — the per-screen playback switches the manifest carries.
 *
 * `loopMode` picks how a SOLO, muted video repeats:
 *   - `native`  — the browser's own `loop` (a seek back to 0). Today's behaviour,
 *                 and the default everywhere.
 *   - `twodeck` — a prepared second `<video>` takes over just before the end so
 *                 the repeat is a hand-off, not a seek (video-loop audit F1). The
 *                 player measures the seam either way and falls back to `native`
 *                 on its own if the hand-off ever misbehaves.
 *
 * `PLAYER_LOOP_TWODECK` (Railway env) decides who gets `twodeck`:
 *   unset / `off` / `0`  — nobody (default)
 *   `all`                — every screen
 *   `id1,id2,…`          — exactly those screens (a staged rollout)
 * Anything else — including a typo — reads as `off`, the direction a
 * misconfiguration has to fail here. The value is part of the hashed manifest,
 * so a change reaches a screen on its next poll after the API restarts (Railway
 * restarts the API on a variable change, which also clears the in-process
 * manifest cache).
 */
export type LoopMode = 'native' | 'twodeck';

export interface PlaybackConfig {
  loopMode: LoopMode;
}

export function resolveLoopMode(
  screenId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): LoopMode {
  const raw = (env.PLAYER_LOOP_TWODECK ?? '').trim();
  if (!raw) return 'native';
  const v = raw.toLowerCase();
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return 'native';
  if (v === 'all') return 'twodeck';
  if (!screenId) return 'native';
  const ids = raw.split(',').map((x) => x.trim()).filter(Boolean);
  return ids.includes(screenId) ? 'twodeck' : 'native';
}

export function resolvePlaybackConfig(
  screenId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): PlaybackConfig {
  return { loopMode: resolveLoopMode(screenId, env) };
}
