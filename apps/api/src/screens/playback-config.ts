/**
 * playback-config — the per-screen playback switches the manifest carries.
 *
 * `loopMode` picks how a SOLO, muted video repeats:
 *   - `continuous` — the standard for every existing and newly paired screen.
 *                 One advancing MSE stream, fragmented from verified local MP4
 *                 bytes, with no seek at cycle boundaries. The player checks
 *                 eligibility and falls back to native on unsupported media,
 *                 missing capabilities or a failed attempt.
 *   - `native`  — the browser's own `loop` (a seek back to 0), the fallback.
 *   - `twodeck` — a prepared second `<video>` takes over just before the end so
 *                 the repeat is a hand-off, not a seek (video-loop audit F1). The
 *                 player measures the seam either way and falls back to `native`
 *                 on its own if the hand-off ever misbehaves.
 *
 * `PLAYER_LOOP_CONTINUOUS` is an operational override, not a pairing step:
 *   unset / empty / `all` — continuous for every screen (default)
 *   `off` / `0` / `false` / `no` — use the legacy selection below
 *   `id1,id2,…` — restrict continuous to named screens for diagnosis/rollback
 * Continuous takes precedence over PLAYER_LOOP_TWODECK. Audio, emergency,
 * sync, mixed playlists and unsupported formats remain on their existing
 * player paths; this switch does not bypass those gates.
 *
 * `PLAYER_LOOP_TWODECK` (Railway env) decides who gets `twodeck`:
 *   unset / `off` / `0`  — nobody (default)
 *   `all`                — every screen
 *   `id1,id2,…`          — exactly those screens (a staged rollout)
 * Anything else — including a typo — reads as `off`, the direction a
 * misconfiguration has to fail here.
 *
 * MEASURED ON REAL HARDWARE (2026-09-29, `lastVideoReport.loop`) — why this is a
 * legacy two-deck switch and not `all`:
 *   - Amlogic T982 / Android 13 / WebView 101 (Brookfield "M43", 4K clip): the
 *     hand-off works. Native loop seam held 156-200 ms every lap; two-deck: first
 *     lap after a page load 1009 ms (cold decoder), then hold 0 ms with the resume
 *     lead still converging (skip <= 600 ms, shrinking).
 *   - Amlogic T982 / Android 11 / WebView 95 (RIOT Cleveland "Pro Series 86\"",
 *     1080p clip): the SECOND <video> `play()`ed while the first plays stays at
 *     t=0 (readyState 4, not paused) for the whole 1.5 s window, twice in a row —
 *     `fallbackReason: handoff-timeout:rs4p0t0`. The second decode session failed in this test; the engine gave up by itself, blocked the path for 24 h and
 *     left the native loop playing. It is the safety net working, not a failure.
 * The value is part of the hashed manifest,
 * so a change reaches a screen on its next poll after the API restarts (Railway
 * restarts the API on a variable change, which also clears the in-process
 * manifest cache).
 */
export type LoopMode = 'native' | 'twodeck' | 'continuous';

export interface PlaybackConfig {
  loopMode: LoopMode;
}

export function resolveLoopMode(
  screenId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): LoopMode {
  // No enrollment record or per-screen allowlist is needed: the same default
  // covers a screen that paired years ago and one added tomorrow. Content and
  // device eligibility are evaluated in the player, with a per-file fallback.
  if (!screenId?.trim()) return 'native';
  const continuous = (env.PLAYER_LOOP_CONTINUOUS ?? '').trim();
  if (!continuous || continuous.toLowerCase() === 'all') return 'continuous';
  if (continuous.split(',').some((x) => x.trim() === screenId))
    return 'continuous';
  const raw = (env.PLAYER_LOOP_TWODECK ?? '').trim();
  if (!raw) return 'native';
  const v = raw.toLowerCase();
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return 'native';
  if (v === 'all') return 'twodeck';
  if (!screenId) return 'native';
  const ids = raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return ids.includes(screenId) ? 'twodeck' : 'native';
}

export function resolvePlaybackConfig(
  screenId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): PlaybackConfig {
  return { loopMode: resolveLoopMode(screenId, env) };
}
