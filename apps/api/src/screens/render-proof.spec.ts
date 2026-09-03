/**
 * The staleness WINDOW, not the proof pipeline (that is
 * `screens.render-proof.spec.ts`). These pin the 2026-09-03 regression: the
 * unified-telemetry wave gave idle screens a 5-minute proof cadence while the
 * server still judged every proof against the 90-second playing window, so a
 * screen with nothing scheduled was reported as "No picture confirmed" for
 * most of every five minutes.
 */
import {
  deriveRenderHealth,
  staleWindowFor,
  IDLE_RENDER_PROOF_STALE_MS,
  RENDER_PROOF_STALE_MS,
} from './render-proof';

describe('idle screens are judged against the idle cadence (2026-09-03 regression)', () => {
  const base = { isLiveOnline: true, nowMs: 1_000_000_000 };

  it('an idle proof four minutes old is still OK — the idle cadence is five minutes', () => {
    const out = deriveRenderHealth({
      ...base,
      lastRenderedAtMs: base.nowMs - 4 * 60_000,
      lastRenderedHash: 'idle:playing',
    });
    // Before the fix this returned STALE and opened a district incident for
    // every screen that simply had nothing scheduled.
    expect(out.renderHealth).toBe('OK');
    expect(out.renderStale).toBe(false);
  });

  it('a PLAYING proof four minutes old is STALE — the fast window is unchanged', () => {
    const out = deriveRenderHealth({
      ...base,
      lastRenderedAtMs: base.nowMs - 4 * 60_000,
      lastRenderedHash: 'pl:tpl:abc',
    });
    expect(out.renderHealth).toBe('STALE');
    expect(out.renderStale).toBe(true);
  });

  it('a genuinely frozen idle screen still goes STALE', () => {
    const out = deriveRenderHealth({
      ...base,
      lastRenderedAtMs: base.nowMs - 20 * 60_000,
      lastRenderedHash: 'idle:playing',
    });
    expect(out.renderHealth).toBe('STALE');
  });

  it('no hash keeps the playing window — absence of evidence is not idleness', () => {
    const out = deriveRenderHealth({
      ...base,
      lastRenderedAtMs: base.nowMs - 2 * 60_000,
      lastRenderedHash: null,
    });
    expect(out.renderHealth).toBe('STALE');
  });

  it('the idle window is at least two idle cadences, so one dropped post is inside it', () => {
    // IDLE_PROOF_INTERVAL_MS in apps/web/src/app/player/telemetry.ts is 5 min.
    expect(IDLE_RENDER_PROOF_STALE_MS).toBeGreaterThanOrEqual(2 * 5 * 60_000);
    expect(staleWindowFor('idle:x')).toBe(IDLE_RENDER_PROOF_STALE_MS);
    expect(staleWindowFor('pl:x')).toBe(RENDER_PROOF_STALE_MS);
    expect(staleWindowFor(null)).toBe(RENDER_PROOF_STALE_MS);
  });
});
