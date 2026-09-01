/**
 * renderTrust — render-proof trust derivation unit tests (2026-08-24).
 *
 * Pins the fresh/stale/unknown/offline matrix for the Screens-list
 * render-trust line: a screen must NEVER read as "painting" off a fresh
 * ping alone, a stale-but-reachable screen must ALWAYS surface as the
 * money state ('not-painting'), an unreported verdict must NEVER read as
 * an alarm, and an unreachable screen must defer entirely to its existing
 * offline treatment (no double-alarm).
 */
import { deriveRenderTrust, RENDER_STALE_AFTER_MS } from '../renderTrust';

const ONLINE = { status: 'ONLINE' };

describe('deriveRenderTrust — precomputed renderHealth path', () => {
  it('ONLINE + renderHealth OK → painting', () => {
    expect(
      deriveRenderTrust({ ...ONLINE, renderHealth: 'OK', renderStale: false }),
    ).toBe('painting');
  });

  it('THE MONEY STATE: ONLINE + renderHealth STALE → not-painting', () => {
    // The exact frozen-kiosk case: device answers the heartbeat (ONLINE)
    // but the renderer has wedged. renderStale === true is load-bearing.
    expect(
      deriveRenderTrust({ ...ONLINE, renderHealth: 'STALE', renderStale: true }),
    ).toBe('not-painting');
  });

  it('renderHealth STALE alone (no renderStale bool) still → not-painting', () => {
    expect(deriveRenderTrust({ ...ONLINE, renderHealth: 'STALE' })).toBe('not-painting');
  });

  it('renderStale === true wins even if renderHealth is missing/other', () => {
    expect(deriveRenderTrust({ ...ONLINE, renderStale: true })).toBe('not-painting');
    expect(
      deriveRenderTrust({ ...ONLINE, renderHealth: 'OK', renderStale: true }),
    ).toBe('not-painting');
  });

  it('ONLINE + renderHealth UNKNOWN → unknown (never an alarm)', () => {
    expect(
      deriveRenderTrust({ ...ONLINE, renderHealth: 'UNKNOWN', renderStale: false }),
    ).toBe('unknown');
  });

  it('a fresh ping (ONLINE) ALONE never produces "painting"', () => {
    // The whole point: ONLINE without a positive OK render-proof must not
    // read as the proof-backed green state.
    const inputs = [
      { ...ONLINE },
      { ...ONLINE, renderHealth: 'UNKNOWN' as const },
      { ...ONLINE, renderHealth: null },
    ];
    for (const input of inputs) {
      expect(deriveRenderTrust(input)).not.toBe('painting');
    }
  });
});

describe('deriveRenderTrust — offline gate (no double-alarm)', () => {
  it('OFFLINE wins regardless of render-proof', () => {
    expect(
      deriveRenderTrust({ status: 'OFFLINE', renderHealth: 'OK', renderStale: false }),
    ).toBe('offline');
    // Even a stale-render verdict on an unreachable box reads as offline,
    // not not-painting — render-proof only speaks for reachable screens.
    expect(
      deriveRenderTrust({ status: 'OFFLINE', renderHealth: 'STALE', renderStale: true }),
    ).toBe('offline');
  });

  it('PENDING / REVOKED (not ONLINE) → offline bucket', () => {
    expect(deriveRenderTrust({ status: 'PENDING' })).toBe('offline');
    expect(deriveRenderTrust({ status: 'REVOKED', renderHealth: 'OK' })).toBe('offline');
  });

  it('missing/undefined status → offline (fail closed, never a stray alarm)', () => {
    expect(deriveRenderTrust({ renderHealth: 'STALE', renderStale: true })).toBe('offline');
    expect(deriveRenderTrust({})).toBe('offline');
  });
});

describe('deriveRenderTrust — fallback path (renderHealth absent entirely)', () => {
  it('ONLINE + no renderHealth + lastRenderedAtMs fresh → painting', () => {
    const now = 1_000_000;
    expect(
      deriveRenderTrust({ ...ONLINE, lastRenderedAtMs: now - 10_000, nowMs: now }),
    ).toBe('painting');
  });

  it('ONLINE + no renderHealth + lastRenderedAtMs stale (>= window) → not-painting', () => {
    const now = 1_000_000;
    expect(
      deriveRenderTrust({
        ...ONLINE,
        lastRenderedAtMs: now - RENDER_STALE_AFTER_MS,
        nowMs: now,
      }),
    ).toBe('not-painting');
    expect(
      deriveRenderTrust({
        ...ONLINE,
        lastRenderedAtMs: now - (RENDER_STALE_AFTER_MS + 1),
        nowMs: now,
      }),
    ).toBe('not-painting');
  });

  it('ONLINE + no renderHealth + lastRenderedAtMs just under the window → painting', () => {
    const now = 1_000_000;
    expect(
      deriveRenderTrust({
        ...ONLINE,
        lastRenderedAtMs: now - (RENDER_STALE_AFTER_MS - 1),
        nowMs: now,
      }),
    ).toBe('painting');
  });

  it('ONLINE + no renderHealth + no lastRenderedAtMs → unknown (never a false alarm)', () => {
    expect(deriveRenderTrust({ ...ONLINE })).toBe('unknown');
    expect(deriveRenderTrust({ ...ONLINE, lastRenderedAtMs: null })).toBe('unknown');
  });
});

// 2026-08-25 calm-down — staleness grades by AGE so the red alarm is
// reserved for the true frozen-kiosk window ("was painting, stopped").
describe('deriveRenderTrustGrade — alarm grading', () => {
  const { deriveRenderTrustGrade } = require('../renderTrust');
  const NOW = 1_756_100_000_000;
  const stale = (ageMs: number) => ({
    status: 'ONLINE',
    renderHealth: 'STALE' as const,
    renderStale: true,
    lastRenderedAtMs: NOW - ageMs,
    nowMs: NOW,
  });

  it('stale < 5min → checking (reload/OTA gap, no siren)', () => {
    expect(deriveRenderTrustGrade(stale(2 * 60_000))).toBe('checking');
  });
  it('stale in the 5min–48h window → not-painting (the real alarm)', () => {
    expect(deriveRenderTrustGrade(stale(30 * 60_000))).toBe('not-painting');
    expect(deriveRenderTrustGrade(stale(12 * 3600_000))).toBe('not-painting');
  });
  it('stale > 48h → stale-chronic (calm history, not an incident)', () => {
    expect(deriveRenderTrustGrade(stale(27 * 24 * 3600_000))).toBe('stale-chronic');
  });
  it('stale with NO timestamp to grade → keeps the loud not-painting (never hides a possible freeze)', () => {
    expect(deriveRenderTrustGrade({ status: 'ONLINE', renderHealth: 'STALE', renderStale: true })).toBe('not-painting');
  });
  it('non-stale variants pass through ungraded (painting / unknown / offline)', () => {
    expect(deriveRenderTrustGrade({ status: 'ONLINE', renderHealth: 'OK' })).toBe('painting');
    expect(deriveRenderTrustGrade({ status: 'ONLINE', renderHealth: 'UNKNOWN' })).toBe('unknown');
    expect(deriveRenderTrustGrade({ status: 'OFFLINE', renderHealth: 'STALE', renderStale: true, lastRenderedAtMs: NOW - 60_000, nowMs: NOW })).toBe('offline');
  });
});

// ─────────────────────────────────────────────────────────────────
// THE IDLE GRADE (2026-08-25, v1.1.6)
//
// A freshly-paired panel with no schedule paints its own waiting screen
// forever and, before this wave, reported NOTHING — so this chip went
// silent on a brand-new install. After the 2026-08-25 field night the
// operator reads silence as breakage, so the player now proves liveness
// while idle, under an `idle:` content signature.
//
// The property these tests pin is that the new fact CANNOT eat the old
// one: green "Rendering" must keep meaning "the operator's content is on
// the glass", and a wedged idle panel must still go red.
// ─────────────────────────────────────────────────────────────────
describe('deriveRenderTrustGrade — idle proof', () => {
  // Same local require + clock as the alarm-grading block above.
  const { deriveRenderTrustGrade } = require('../renderTrust');
  const NOW = 1_756_100_000_000;

  it('a FRESH idle proof reads idle, never painting', () => {
    expect(
      deriveRenderTrustGrade({
        status: 'ONLINE',
        renderHealth: 'OK',
        lastRenderedHash: 'idle:connecting',
      }),
    ).toBe('idle');
  });

  it('a fresh CONTENT proof still reads painting', () => {
    expect(
      deriveRenderTrustGrade({
        status: 'ONLINE',
        renderHealth: 'OK',
        lastRenderedHash: 'pl:playlist-42',
      }),
    ).toBe('painting');
    // …and an old build that reports no hash at all is unchanged.
    expect(deriveRenderTrustGrade({ status: 'ONLINE', renderHealth: 'OK' })).toBe('painting');
  });

  // 2026-09-01 (TC22 field find): an operator paused playback on the screen
  // (remote Back → Stop) with a playlist still scheduled, and the dashboard
  // said "Screen on · nothing scheduled". The player now proves the pause
  // under `paused:` — a third fact, distinct from idle AND from content.
  it('a FRESH paused proof reads paused — never idle, never painting', () => {
    expect(
      deriveRenderTrustGrade({
        status: 'ONLINE',
        renderHealth: 'OK',
        lastRenderedHash: 'paused:pl-42',
      }),
    ).toBe('paused');
  });

  it('a WEDGED paused panel still grades through the staleness ladder', () => {
    const wedged = (ageMs: number) => ({
      status: 'ONLINE',
      renderHealth: 'STALE' as const,
      renderStale: true,
      lastRenderedHash: 'paused:pl-42',
      lastRenderedAtMs: NOW - ageMs,
      nowMs: NOW,
    });
    expect(deriveRenderTrustGrade(wedged(2 * 60_000))).toBe('checking');
    expect(deriveRenderTrustGrade(wedged(30 * 60_000))).toBe('not-painting');
  });

  it('a WEDGED idle panel still grades through the staleness ladder', () => {
    // The freeze signal must survive the new state: a panel that stopped
    // painting its waiting screen is exactly as broken as one that stopped
    // painting a playlist.
    const wedged = (ageMs: number) => ({
      status: 'ONLINE',
      renderHealth: 'STALE' as const,
      renderStale: true,
      lastRenderedHash: 'idle:playing',
      lastRenderedAtMs: NOW - ageMs,
      nowMs: NOW,
    });
    expect(deriveRenderTrustGrade(wedged(2 * 60_000))).toBe('checking');
    expect(deriveRenderTrustGrade(wedged(30 * 60_000))).toBe('not-painting');
  });

  it('an offline screen is still offline, idle hash or not', () => {
    expect(
      deriveRenderTrustGrade({
        status: 'OFFLINE',
        renderHealth: 'OK',
        lastRenderedHash: 'idle:connecting',
      }),
    ).toBe('offline');
  });
});

// ── 2026-08-30 reliability program: credential trust in the grade ────────
describe('deriveRenderTrustGrade — authState (re-pair required)', () => {
  const { deriveRenderTrustGrade } = require('../renderTrust');
  const NOW = 1_800_000_000_000;

  it('THE G43 LIE, FIXED: painting on downgraded tokens grades repair-required, never plain green', () => {
    expect(
      deriveRenderTrustGrade({
        status: 'ONLINE',
        renderHealth: 'OK',
        renderStale: false,
        lastRenderedHash: 'pl:something-real',
        lastRenderedAtMs: NOW - 30_000,
        nowMs: NOW,
        authState: 'REPAIR_REQUIRED',
      }),
    ).toBe('repair-required');
  });

  it('an ALARM outranks the credential chip — not-painting keeps precedence', () => {
    expect(
      deriveRenderTrustGrade({
        status: 'ONLINE',
        renderHealth: 'STALE',
        renderStale: true,
        lastRenderedAtMs: NOW - 30 * 60_000,
        nowMs: NOW,
        authState: 'REPAIR_REQUIRED',
      }),
    ).toBe('not-painting');
  });

  it('offline keeps precedence (the ping path owns that message)', () => {
    expect(
      deriveRenderTrustGrade({ status: 'OFFLINE', authState: 'REPAIR_REQUIRED' }),
    ).toBe('offline');
  });

  it('PROVEN / null authState changes nothing (whole existing fleet)', () => {
    const base = {
      status: 'ONLINE',
      renderHealth: 'OK' as const,
      renderStale: false,
      lastRenderedAtMs: NOW - 30_000,
      nowMs: NOW,
    };
    expect(deriveRenderTrustGrade({ ...base, authState: 'PROVEN' })).toBe('painting');
    expect(deriveRenderTrustGrade({ ...base, authState: null })).toBe('painting');
  });

  it('unknown render proof + repair-required still surfaces the credential fact', () => {
    expect(
      deriveRenderTrustGrade({
        status: 'ONLINE',
        renderHealth: 'UNKNOWN',
        authState: 'REPAIR_REQUIRED',
      }),
    ).toBe('repair-required');
  });
});

// ── 2026-08-30 deep audit D-2: media-stall grading ───────────────────────
describe('deriveRenderTrustGrade — media stall (stall| hash prefix)', () => {
  const { deriveRenderTrustGrade } = require('../renderTrust');
  const NOW = 1_800_000_000_000;
  const freshPainting = {
    status: 'ONLINE',
    renderHealth: 'OK' as const,
    renderStale: false,
    lastRenderedAtMs: NOW - 30_000,
    nowMs: NOW,
  };

  it('THE FROZEN-FRAME LIE, FIXED: painting + stall| hash grades media-stalled, not green', () => {
    expect(
      deriveRenderTrustGrade({ ...freshPainting, lastRenderedHash: 'stall|pl:0|10000|abc' }),
    ).toBe('media-stalled');
  });

  it('a normal pl: hash stays painting; idle hashes are untouched by the stall path', () => {
    expect(deriveRenderTrustGrade({ ...freshPainting, lastRenderedHash: 'pl:0|10000|abc' })).toBe('painting');
    expect(deriveRenderTrustGrade({ ...freshPainting, lastRenderedHash: 'idle:playing' })).toBe('idle');
  });

  it('offline and the not-painting alarm keep precedence over the stall marker', () => {
    expect(
      deriveRenderTrustGrade({ status: 'OFFLINE', lastRenderedHash: 'stall|pl:x' }),
    ).toBe('offline');
    expect(
      deriveRenderTrustGrade({
        status: 'ONLINE', renderHealth: 'STALE', renderStale: true,
        lastRenderedAtMs: NOW - 30 * 60_000, nowMs: NOW,
        lastRenderedHash: 'stall|pl:x',
      }),
    ).toBe('not-painting');
  });
});

// ── 2026-08-30 deep audit A-F10: alert held without server confirmation ──
describe('deriveRenderTrustGrade — unconfirmed alert (unconfirmed|em: prefix)', () => {
  const { deriveRenderTrustGrade } = require('../renderTrust');
  const NOW = 1_800_000_000_000;
  const freshPainting = {
    status: 'ONLINE',
    renderHealth: 'OK' as const,
    renderStale: false,
    lastRenderedAtMs: NOW - 30_000,
    nowMs: NOW,
  };

  it('THE HELD-ALERT GAP, CLOSED: painting an alert the server cannot re-confirm is red, not green', () => {
    expect(
      deriveRenderTrustGrade({ ...freshPainting, lastRenderedHash: 'unconfirmed|em:lockdown' }),
    ).toBe('alert-unconfirmed');
  });

  it('a server-confirmed emergency sig stays painting (the healthy alert case)', () => {
    expect(
      deriveRenderTrustGrade({ ...freshPainting, lastRenderedHash: 'em:lockdown' }),
    ).toBe('painting');
  });

  it('outranks repair-required and media-stalled among painting reinterpretations', () => {
    expect(
      deriveRenderTrustGrade({
        ...freshPainting,
        lastRenderedHash: 'unconfirmed|em:lockdown',
        authState: 'REPAIR_REQUIRED',
      }),
    ).toBe('alert-unconfirmed');
  });

  it('offline and the not-painting ladder keep precedence (their signals are worse)', () => {
    expect(
      deriveRenderTrustGrade({ status: 'OFFLINE', lastRenderedHash: 'unconfirmed|em:x' }),
    ).toBe('offline');
    expect(
      deriveRenderTrustGrade({
        status: 'ONLINE', renderHealth: 'STALE', renderStale: true,
        lastRenderedAtMs: NOW - 30 * 60_000, nowMs: NOW,
        lastRenderedHash: 'unconfirmed|em:x',
      }),
    ).toBe('not-painting');
  });
});
