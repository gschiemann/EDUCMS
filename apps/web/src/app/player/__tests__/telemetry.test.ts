/**
 * Unified player telemetry — the arithmetic (2026-09-02, efficiency P0-1).
 *
 * The five routine timers this replaces each had a property that mattered.
 * Collapsing them into one request is only safe if every one of those
 * properties survives, so that is what these tests pin — in particular the
 * two that a "just batch everything" refactor would quietly destroy:
 *
 *   • A FROZEN COMPOSITOR MUST STILL GO STALE. The telemetry POST keeps
 *     landing (the JS event loop is fine), so if it carried a render block
 *     unconditionally, `lastRenderedAt` would stay fresh and the fleet's
 *     freeze detector would be blind — the exact bug render-proof exists
 *     to catch. The block must be OMITTED when the paint counter has not
 *     advanced.
 *   • A SINGLE DROPPED POST MUST NOT REACH THE 90 s SERVER-SIDE STALENESS
 *     WINDOW. At a 60 s cadence, waiting a full window after a failure
 *     puts `lastRenderedAt` at 120 s and paints a healthy screen red.
 */

import {
  IDLE_PROOF_INTERVAL_MS,
  TELEMETRY_INTERVAL_MS,
  TELEMETRY_MAX_INTERVAL_MS,
  TELEMETRY_MIN_INTERVAL_MS,
  TELEMETRY_MIN_POST_GAP_MS,
  TELEMETRY_RETRY_MS,
  buildRenderBlock,
  buildTelemetryBody,
  clampTelemetryInterval,
  nextTelemetryDelayMs,
  outcomeFromStatus,
  initialTelemetryDelayMs,
  shouldPostEarly,
} from '../telemetry';

const NOW = 1_700_000_000_000;

const renderInput = (over: Partial<Parameters<typeof buildRenderBlock>[0]> = {}) => ({
  rendering: true,
  paired: true,
  frames: 1_000,
  lastReportedFrames: 900,
  lastIdlePostAtMs: 0,
  nowMs: NOW,
  hash: 'pl:sig-1',
  contentKind: 'playlist',
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────
describe('render proof: what the telemetry POST may and may not claim', () => {
  it('THE LOAD-BEARING CASE — a frozen paint counter reports NO render block', () => {
    // The compositor is wedged: rAF stopped firing, so `frames` has not
    // moved since the last report. Liveness still posts (the event loop is
    // alive), but claiming a paint here would keep `lastRenderedAt` fresh
    // and HIDE the freeze.
    expect(
      buildRenderBlock(renderInput({ frames: 900, lastReportedFrames: 900 })),
    ).toBeNull();
  });

  it('an advancing counter DOES report, and carries the content signature', () => {
    const out = buildRenderBlock(renderInput());
    expect(out).not.toBeNull();
    expect(out?.block.frames).toBe(1_000);
    expect(out?.block.hash).toBe('pl:sig-1');
    expect(out?.block.contentKind).toBe('playlist');
    expect(out?.isIdleLane).toBe(false);
  });

  it('an UNPAIRED idle screen reports nothing — no tenant to report to', () => {
    expect(
      buildRenderBlock(renderInput({ rendering: false, paired: false })),
    ).toBeNull();
  });

  it('an idle PAIRED screen proves liveness, but only every 5 minutes', () => {
    const first = buildRenderBlock(
      renderInput({ rendering: false, hash: 'idle:playing', contentKind: 'idle' }),
    );
    expect(first?.isIdleLane).toBe(true);

    // One minute later, inside the idle window → silent.
    expect(
      buildRenderBlock(
        renderInput({
          rendering: false,
          hash: 'idle:playing',
          contentKind: 'idle',
          lastIdlePostAtMs: NOW,
          nowMs: NOW + 60_000,
        }),
      ),
    ).toBeNull();

    // Past the window → proves again.
    expect(
      buildRenderBlock(
        renderInput({
          rendering: false,
          hash: 'idle:playing',
          contentKind: 'idle',
          lastIdlePostAtMs: NOW,
          nowMs: NOW + IDLE_PROOF_INTERVAL_MS,
        }),
      ),
    ).not.toBeNull();
  });

  it('the idle lane is ALSO subject to the frozen-counter refusal', () => {
    // An idle screen whose compositor has wedged must not prove liveness
    // for pixels either — otherwise the idle lane becomes the hole.
    expect(
      buildRenderBlock(
        renderInput({
          rendering: false,
          frames: 900,
          lastReportedFrames: 900,
          lastIdlePostAtMs: 0,
        }),
      ),
    ).toBeNull();
  });

  it('caps the content signature so a hostile/odd value cannot bloat the row', () => {
    const out = buildRenderBlock(renderInput({ hash: 'x'.repeat(400) }));
    expect(out?.block.hash).toHaveLength(128);
  });

  it('carries the frame-locked sync report when sync is on, and omits it otherwise', () => {
    const sync = {
      locked: true,
      errMs: 3.2,
      clockUncertaintyMs: 12,
      rttMs: 40,
      contentSig: 'abc',
      renderLeadMs: 8,
      skewPpm: -2,
    };
    expect(buildRenderBlock(renderInput({ sync }))?.block.sync).toEqual(sync);
    expect(buildRenderBlock(renderInput())?.block).not.toHaveProperty('sync');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('cadence', () => {
  it('a healthy post waits a full minute', () => {
    expect(nextTelemetryDelayMs('ok')).toBe(TELEMETRY_INTERVAL_MS);
  });

  it('THE LOAD-BEARING CASE — a failure retries fast enough to stay inside the 90 s staleness window', () => {
    // 60 s cadence + a dropped post = 120 s of silence, which is past the
    // server's RENDER_PROOF_STALE_MS (90 s) and paints a HEALTHY screen
    // red. The retry has to land before that.
    expect(nextTelemetryDelayMs('failed')).toBe(TELEMETRY_RETRY_MS);
    expect(TELEMETRY_INTERVAL_MS + TELEMETRY_RETRY_MS).toBeLessThan(90_000);
  });

  it('a 429 is NOT a failure — it waits a normal window instead of hammering', () => {
    expect(nextTelemetryDelayMs('throttled')).toBe(TELEMETRY_INTERVAL_MS);
  });

  it('a 401 resumes the normal cadence — credential recovery owns the fix, not a retry loop', () => {
    expect(nextTelemetryDelayMs('unauthorized')).toBe(TELEMETRY_INTERVAL_MS);
  });

  it('honours a server-suggested cadence, clamped at both ends', () => {
    expect(nextTelemetryDelayMs('ok', 90_000)).toBe(90_000);
    // A server that says "every hour" must not be able to blind the fleet's
    // freeze detector…
    expect(clampTelemetryInterval(60 * 60_000)).toBe(TELEMETRY_MAX_INTERVAL_MS);
    // …and one that says "every second" must not make every screen self-429.
    expect(clampTelemetryInterval(1_000)).toBe(TELEMETRY_MIN_INTERVAL_MS);
    // Garbage falls back to the contract, never to NaN.
    expect(clampTelemetryInterval(undefined)).toBe(TELEMETRY_INTERVAL_MS);
    expect(clampTelemetryInterval('soon')).toBe(TELEMETRY_INTERVAL_MS);
    expect(clampTelemetryInterval(Number.NaN)).toBe(TELEMETRY_INTERVAL_MS);
  });

  it('maps HTTP results onto outcomes (a thrown fetch is a failure, not a 401)', () => {
    expect(outcomeFromStatus(200)).toBe('ok');
    expect(outcomeFromStatus(204)).toBe('ok');
    expect(outcomeFromStatus(401)).toBe('unauthorized');
    expect(outcomeFromStatus(429)).toBe('throttled');
    expect(outcomeFromStatus(500)).toBe('failed');
    expect(outcomeFromStatus(null)).toBe('failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('event-driven early posts', () => {
  it('posts immediately when nothing has been sent yet', () => {
    expect(shouldPostEarly({ nowMs: NOW, lastPostAtMs: null })).toBe(true);
  });

  it('refuses to post inside the server 30 s accept floor', () => {
    // A content change 5 s after the last report would be 429'd, so the
    // proof would be lost AND the request wasted.
    expect(shouldPostEarly({ nowMs: NOW + 5_000, lastPostAtMs: NOW })).toBe(false);
    expect(
      shouldPostEarly({ nowMs: NOW + TELEMETRY_MIN_POST_GAP_MS - 1, lastPostAtMs: NOW }),
    ).toBe(false);
  });

  it('allows the early post once it is clear of the floor', () => {
    expect(
      shouldPostEarly({ nowMs: NOW + TELEMETRY_MIN_POST_GAP_MS, lastPostAtMs: NOW }),
    ).toBe(true);
    // …and the gap is genuinely above the server's floor, with slack for
    // clock drift between the two sides.
    expect(TELEMETRY_MIN_POST_GAP_MS).toBeGreaterThan(30_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('scheduler (re)start — the double-post the fleet was logging as 429s (2026-09-22)', () => {
  it('a FRESH load posts at once — the dashboard must flip ONLINE within seconds', () => {
    expect(initialTelemetryDelayMs({ nowMs: NOW, lastPostAtMs: null })).toBe(0);
  });

  it('a restart inside the server floor waits out exactly the remainder, not zero', () => {
    // The effect re-runs on every registering/pairing phase transition; the
    // old unconditional kick posted 5 s after the last report → 429.
    expect(initialTelemetryDelayMs({ nowMs: NOW + 5_000, lastPostAtMs: NOW })).toBe(
      TELEMETRY_MIN_POST_GAP_MS - 5_000,
    );
    expect(
      initialTelemetryDelayMs({ nowMs: NOW + TELEMETRY_MIN_POST_GAP_MS - 1, lastPostAtMs: NOW }),
    ).toBe(1);
  });

  it('a restart once clear of the floor posts at once', () => {
    expect(initialTelemetryDelayMs({ nowMs: NOW + TELEMETRY_MIN_POST_GAP_MS, lastPostAtMs: NOW })).toBe(0);
    expect(initialTelemetryDelayMs({ nowMs: NOW + 10 * 60_000, lastPostAtMs: NOW })).toBe(0);
  });

  it('a clock that jumped backwards waits the full gap — never a negative timer', () => {
    expect(initialTelemetryDelayMs({ nowMs: NOW - 60_000, lastPostAtMs: NOW })).toBe(TELEMETRY_MIN_POST_GAP_MS);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('body assembly', () => {
  it('omits every block it has nothing to say about', () => {
    expect(buildTelemetryBody({})).toEqual({});
  });

  it('THE MANAGER TRISTATE — absent, empty and set are three different facts', () => {
    // Conflating "this build has no opinion" with "Manager is uninstalled"
    // is the 2026-04-28 stuck-chip bug: the dashboard showed v1.0.1 long
    // after the operator removed it.
    expect(buildTelemetryBody({}).versions).toBeUndefined();
    expect(buildTelemetryBody({ managerVersion: '' }).versions).toEqual({ manager: '' });
    expect(buildTelemetryBody({ managerVersion: '1.0.4' }).versions).toEqual({
      manager: '1.0.4',
    });
    // null is treated as "no opinion", same as absent — the caller sends ''
    // when it MEANS uninstalled.
    expect(buildTelemetryBody({ managerVersion: null }).versions).toBeUndefined();
  });

  it('carries the APK version pair and the page-bundle identity', () => {
    const body = buildTelemetryBody({
      playerVersion: ' 1.1.17 ',
      playerVersionCode: 11170,
      bundleSha: 'abc123def456',
    });
    expect(body.versions).toEqual({
      player: '1.1.17',
      playerCode: 11170,
      bundleSha: 'abc123def456',
    });
  });

  /**
   * 2026-09-21 — the player must report the identity it actually RELOADS on.
   * Until it did, the dashboard graded skew on the commit SHA, which moves on
   * every commit, so an API-only / docs / APK / test deploy left every online
   * screen reading "behind" forever with a Resync that could never clear it.
   */
  it('carries the bundleId when the build stamped one', () => {
    const body = buildTelemetryBody({
      bundleSha: 'abc123def456',
      bundleId: '1f2e3d4c5b6a',
    });
    expect(body.versions).toEqual({
      bundleSha: 'abc123def456',
      bundleId: '1f2e3d4c5b6a',
    });
  });

  it('OMITS bundleId entirely when the build stamped none', () => {
    // `versions` is a zod strictObject on the server. An explicit null or ''
    // would fail validation and 400 the WHOLE report — losing liveness and
    // render proof with it — so absence has to mean absence.
    for (const none of [null, undefined, '', '   ']) {
      const body = buildTelemetryBody({ bundleSha: 'abc123def456', bundleId: none });
      expect(body.versions).not.toHaveProperty('bundleId');
      expect(body.versions).toEqual({ bundleSha: 'abc123def456' });
    }
  });

  it('a bundleId with no SHA still sends — the two are independent facts', () => {
    expect(buildTelemetryBody({ bundleId: '1f2e3d4c5b6a' }).versions).toEqual({
      bundleId: '1f2e3d4c5b6a',
    });
  });

  it('drops a nonsense version code rather than sending it', () => {
    expect(buildTelemetryBody({ playerVersionCode: 0 }).versions).toBeUndefined();
    expect(buildTelemetryBody({ playerVersionCode: Number.NaN }).versions).toBeUndefined();
  });

  it('sends only the two counters per cache tier — the server schema is strict', () => {
    const body = buildTelemetryBody({
      cache: {
        // A real SW status object carries extra keys (floorBytes, shell…);
        // an unknown key would 400 the WHOLE report, losing liveness too.
        playlist: { count: 4.7, bytes: 100, floorBytes: 5 } as never,
        emergency: { count: -1, bytes: 20 },
      },
    });
    expect(body.cache).toEqual({
      playlist: { count: 4, bytes: 100 },
      emergency: { count: 0, bytes: 20 },
    });
  });

  it('passes the durable-REFRESH ack through as a VALUE, and omits it when absent', () => {
    expect(buildTelemetryBody({ refreshAckMs: 1_700_000_000_000 }).refreshAckMs).toBe(
      1_700_000_000_000,
    );
    expect(buildTelemetryBody({ refreshAckMs: null })).not.toHaveProperty('refreshAckMs');
  });

  it('carries the last video sample as bounded ints, and omits it when there is none', () => {
    const body = buildTelemetryBody({
      video: { url: 'https://cdn/x/clip.mp4', totalFrames: 1830.7, droppedFrames: 9000, elapsedMs: 61_000.2, width: 1920.4, height: 1080 },
    });
    expect(body.video).toEqual({
      url: 'https://cdn/x/clip.mp4',
      totalFrames: 1830,
      droppedFrames: 1830,
      elapsedMs: 61_000,
      width: 1920,
      height: 1080,
    });
    expect(buildTelemetryBody({ video: null })).not.toHaveProperty('video');
    // No size when the element had none — the key is omitted, never sent as 0.
    expect(buildTelemetryBody({ video: { url: 'x', totalFrames: 10, droppedFrames: 0 } }).video).toEqual({
      url: 'x',
      totalFrames: 10,
      droppedFrames: 0,
    });
  });

  it('a full report is the shape the server accepts', () => {
    const body = buildTelemetryBody({
      playerVersion: '1.1.17',
      playerVersionCode: 11170,
      managerVersion: '1.0.4',
      bundleSha: 'abc123def456',
      cache: { playlist: { count: 4, bytes: 100 }, emergency: { count: 2, bytes: 50 } },
      render: { frames: 42, hash: 'pl:x', contentKind: 'playlist' },
      refreshAckMs: 123,
      capsHash: 'h1',
    });
    expect(Object.keys(body).sort()).toEqual([
      'cache',
      'capsHash',
      'refreshAckMs',
      'render',
      'versions',
    ]);
  });
});
