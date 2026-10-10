/**
 * refreshAdmission — the never-interrupt decisions (2026-10-10).
 *
 * One case per guarantee. The evidence shapes mirror what page.tsx reads at
 * decision time (phaseRef / renderStateRef / the paint + manifest stamps).
 */
import {
  admitRefresh,
  bundleReloadIdle,
  manifestRefreshOrigin,
  pushRefreshOrigin,
  provablyHealthyPlaying,
  MANIFEST_FRESH_MS,
  PAINT_FRESH_MS,
  type LiveEvidence,
} from '../refreshAdmission';

const NOW = 1_790_000_000_000;

/** A screen that is playing a playlist, painting, and fetching — the healthy shape. */
function healthy(over: Partial<LiveEvidence> = {}): LiveEvidence {
  return {
    phase: 'playing',
    rendering: true,
    sig: 'pl:abc123',
    kind: 'playlist',
    emergency: false,
    mediaStalled: false,
    nowMs: NOW,
    lastPaintAtMs: NOW - 40,
    lastManifestOkAtMs: NOW - 8_000,
    ...over,
  };
}

describe('who asked', () => {
  it('a pushed refresh with a requestedBy user is the operator; without one it is the system', () => {
    expect(pushRefreshOrigin({ requestedBy: 'user-1', corrId: 'rw-1' })).toBe('operator');
    expect(pushRefreshOrigin({ requestedBy: null, corrId: 'wedge-1' })).toBe('system');
    expect(pushRefreshOrigin({ source: 'media_rendition_ready' })).toBe('system');
    expect(pushRefreshOrigin({ requestedBy: '' })).toBe('system');
    expect(pushRefreshOrigin(null)).toBe('system');
  });

  it("a durable refresh is the system's only when the manifest says so — anything else is a person's", () => {
    expect(manifestRefreshOrigin('system')).toBe('system');
    expect(manifestRefreshOrigin('operator')).toBe('operator');
    // An older API sends no field at all: the pre-field behaviour (reload) holds.
    expect(manifestRefreshOrigin(undefined)).toBe('operator');
    expect(manifestRefreshOrigin(null)).toBe('operator');
    expect(manifestRefreshOrigin('SYSTEM')).toBe('operator');
  });
});

describe('admitRefresh — a person is always honoured', () => {
  it('an operator refresh reloads a healthy playing screen', () => {
    expect(admitRefresh('operator', healthy())).toEqual({ action: 'reload' });
  });
  it('an operator refresh reloads an idle screen', () => {
    expect(admitRefresh('operator', healthy({ rendering: false, sig: 'idle:playing', kind: 'idle' }))).toEqual({ action: 'reload' });
  });
});

describe('admitRefresh — the system is declined only when the screen can PROVE it is healthy', () => {
  it('declines on a playing, painting, fetching screen', () => {
    expect(admitRefresh('system', healthy())).toEqual({ action: 'decline', reason: 'healthy-playing' });
    expect(provablyHealthyPlaying(healthy())).toBe(true);
  });

  it('declines for template content too (its sig is also pl:)', () => {
    expect(admitRefresh('system', healthy({ kind: 'template', sig: 'pl:tpl-9' }))).toEqual({ action: 'decline', reason: 'healthy-playing' });
  });

  it('reloads when the manifest loop has gone quiet — the G43 wedge shape', () => {
    expect(admitRefresh('system', healthy({ lastManifestOkAtMs: NOW - MANIFEST_FRESH_MS - 1 }))).toEqual({ action: 'reload' });
    expect(admitRefresh('system', healthy({ lastManifestOkAtMs: 0 }))).toEqual({ action: 'reload' });
  });

  it('reloads when the compositor has stopped painting', () => {
    expect(admitRefresh('system', healthy({ lastPaintAtMs: NOW - PAINT_FRESH_MS - 1 }))).toEqual({ action: 'reload' });
    expect(admitRefresh('system', healthy({ lastPaintAtMs: 0 }))).toEqual({ action: 'reload' });
  });

  it('reloads when nothing is on the glass (idle / paused / unavailable / downloading)', () => {
    for (const sig of ['idle:playing', 'idle:content-unavailable', 'idle:content-downloading', 'idle:content-loading', 'paused:pl-1']) {
      expect(admitRefresh('system', healthy({ rendering: false, sig, kind: sig.startsWith('paused') ? 'paused' : 'idle' }))).toEqual({ action: 'reload' });
    }
  });

  it('reloads when the page is not in the playing phase', () => {
    for (const phase of ['registering', 'pairing', 'connecting', 'offline']) {
      expect(admitRefresh('system', healthy({ phase }))).toEqual({ action: 'reload' });
    }
  });

  it('reloads when the active video is stalled — a frozen clip is not healthy playback', () => {
    expect(admitRefresh('system', healthy({ mediaStalled: true }))).toEqual({ action: 'reload' });
  });

  it("does not claim an emergency as 'healthy playing' — the callers' own emergency deferral owns that case", () => {
    expect(admitRefresh('system', healthy({ emergency: true, sig: 'em:LOCKDOWN', kind: 'emergency' }))).toEqual({ action: 'reload' });
  });

  it('is exactly at the edges: a paint 15 s old and a manifest 5 min old still count', () => {
    expect(admitRefresh('system', healthy({ lastPaintAtMs: NOW - PAINT_FRESH_MS, lastManifestOkAtMs: NOW - MANIFEST_FRESH_MS })))
      .toEqual({ action: 'decline', reason: 'healthy-playing' });
  });
});

describe('bundleReloadIdle — a waiting web bundle is picked up only when nothing is on the glass', () => {
  it('yes on the splash phases and on a playing-phase screen with nothing scheduled', () => {
    expect(bundleReloadIdle({ rendering: false, sig: 'idle:connecting', kind: 'idle', emergency: false })).toBe(true);
    expect(bundleReloadIdle({ rendering: false, sig: 'idle:registering', kind: 'idle', emergency: false })).toBe(true);
    expect(bundleReloadIdle({ rendering: false, sig: 'idle:playing', kind: 'idle', emergency: false })).toBe(true);
  });

  it('yes on the Content Unavailable card — nothing is playing and a newer bundle may fix it', () => {
    expect(bundleReloadIdle({ rendering: false, sig: 'idle:content-unavailable', kind: 'idle', emergency: false })).toBe(true);
  });

  it('never while content is on the glass', () => {
    expect(bundleReloadIdle({ rendering: true, sig: 'pl:abc', kind: 'playlist', emergency: false })).toBe(false);
    expect(bundleReloadIdle({ rendering: true, sig: 'pl:tpl', kind: 'template', emergency: false })).toBe(false);
  });

  it('never while a file is downloading or loading — a reload would restart it', () => {
    expect(bundleReloadIdle({ rendering: false, sig: 'idle:content-downloading', kind: 'idle', emergency: false })).toBe(false);
    expect(bundleReloadIdle({ rendering: false, sig: 'idle:content-loading', kind: 'idle', emergency: false })).toBe(false);
  });

  it('never on an operator-paused screen — a reload would un-pause it', () => {
    expect(bundleReloadIdle({ rendering: false, sig: 'paused:pl-1', kind: 'paused', emergency: false })).toBe(false);
  });

  it('never during an emergency', () => {
    expect(bundleReloadIdle({ rendering: true, sig: 'em:LOCKDOWN', kind: 'emergency', emergency: true })).toBe(false);
    expect(bundleReloadIdle({ rendering: false, sig: 'idle:playing', kind: 'idle', emergency: true })).toBe(false);
  });
});
