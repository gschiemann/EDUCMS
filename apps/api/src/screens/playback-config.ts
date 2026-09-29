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
 * `continuous` uses one advancing MSE stream, fragmented from the verified
 * local MP4, with no seek at cycle boundaries. PLAYER_LOOP_CONTINUOUS enables
 * named screens only (no `all`); it takes precedence over PLAYER_LOOP_TWODECK.
 *
 * `PLAYER_LOOP_TWODECK` (Railway env) decides who gets `twodeck`:
 *   unset / `off` / `0`  — nobody (default)
 *   `all`                — every screen
 *   `id1,id2,…`          — exactly those screens (a staged rollout)
 * Anything else — including a typo — reads as `off`, the direction a
 * misconfiguration has to fail here.
 *
 * MEASURED ON REAL HARDWARE (2026-09-29, `lastVideoReport.loop`) — why this is a
 * per-screen switch and not `all`:
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
  // Named-screen qualification of the one-stream MSE backend. This wins over
  // two-deck only for explicitly named screens; `all` is deliberately refused.
  const continuous = (env.PLAYER_LOOP_CONTINUOUS ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (screenId && continuous.includes(screenId)) return 'continuous';
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
