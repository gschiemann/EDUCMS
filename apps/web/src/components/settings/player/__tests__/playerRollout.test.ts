import {
  compareInstalledVersion,
  derivePlayerRolloutState,
  gradeScreen,
  rolloutVerification,
  VERSION_EVIDENCE_MAX_AGE_MS,
  type CanaryConfig,
  type PlayerRolloutInput,
  type RolloutScreen,
} from '../playerRollout';

const NOW = Date.parse('2026-09-02T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

function screen(over: Partial<RolloutScreen> & { id: string }): RolloutScreen {
  return {
    playerVersion: '1.1.12',
    playerVersionAt: iso(5 * MIN),
    lastPingAt: iso(20_000),
    status: 'ONLINE',
    ...over,
  };
}

function input(over: Partial<PlayerRolloutInput> = {}): PlayerRolloutInput {
  return {
    now: NOW,
    screens: [],
    latest: { versionName: '1.1.12', source: 'github' },
    autoUpdateEnabled: false,
    canary: { percent: 100, setAt: null, autoPromote: true, soakHours: 24 },
    window: { start: null, end: null, timezone: null },
    ...over,
  };
}

const canary = (over: Partial<CanaryConfig> = {}): CanaryConfig => ({
  percent: 100,
  setAt: null,
  autoPromote: true,
  soakHours: 24,
  ...over,
});

// ── compareInstalledVersion — the cases ScreenSettingsMenu's own suite pins ──
describe('compareInstalledVersion', () => {
  it('compares numerically, not lexically', () => {
    expect(compareInstalledVersion('1.1.11', '1.1.9')).toBe(true);
    expect(compareInstalledVersion('1.1.9', '1.1.11')).toBe(false);
    expect(compareInstalledVersion('v1.1.11', '1.1.11')).toBe(true);
  });
  it('is UNKNOWN (null) whenever either side is missing', () => {
    expect(compareInstalledVersion(null, '1.0.24')).toBeNull();
    expect(compareInstalledVersion('1.0.24', null)).toBeNull();
    expect(compareInstalledVersion('1.0.24', undefined)).toBeNull();
  });
});

describe('gradeScreen — the evidence boundary', () => {
  it('never graded without a version report', () => {
    expect(gradeScreen(screen({ id: 'a', playerVersion: null, playerVersionAt: null }), '1.1.12', NOW)).toBe('unreported');
  });
  it('an undated version report is stale, never fresh', () => {
    expect(gradeScreen(screen({ id: 'a', playerVersionAt: null }), '1.1.12', NOW)).toBe('stale');
  });
  it('a report older than the evidence window is stale', () => {
    expect(gradeScreen(screen({ id: 'a', playerVersionAt: iso(VERSION_EVIDENCE_MAX_AGE_MS + MIN) }), '1.1.12', NOW)).toBe('stale');
  });
  it('is ungradeable when no latest version is known', () => {
    expect(gradeScreen(screen({ id: 'a' }), null, NOW)).toBe('ungradeable');
  });
  it('a sticky OTA error outranks the version string', () => {
    expect(gradeScreen(screen({ id: 'a', playerVersion: '1.1.10', lastOtaErrorAt: iso(HOUR) }), '1.1.12', NOW)).toBe('failed');
  });
  it('but a landed install clears the failure (error + already on latest)', () => {
    expect(gradeScreen(screen({ id: 'a', playerVersion: '1.1.12', lastOtaErrorAt: iso(HOUR) }), '1.1.12', NOW)).toBe('on-latest');
  });
});

describe('derivePlayerRolloutState — one state per evidence shape', () => {
  it('current: every fresh-evidence screen is at or past the target', () => {
    const r = derivePlayerRolloutState(input({ screens: [screen({ id: 'a' }), screen({ id: 'b' })] }));
    expect(r.state).toBe('current');
    expect(r.pill).toBe('ready');
    expect(r.sectionStatus).toBeNull();
    expect(rolloutVerification(r)).toEqual({ verified: 2, of: 2 });
  });

  it('update-available: everyone behind, nobody on the new build yet', () => {
    const r = derivePlayerRolloutState(input({
      screens: [screen({ id: 'a', playerVersion: '1.1.9' }), screen({ id: 'b', playerVersion: '1.1.9' })],
    }));
    expect(r.state).toBe('update-available');
    expect(r.counts.behind).toBe(2);
    expect(rolloutVerification(r)).toEqual({ verified: 0, of: 2 });
  });

  it('partially-deployed: some landed, some behind → attention', () => {
    const r = derivePlayerRolloutState(input({
      screens: [screen({ id: 'a' }), screen({ id: 'b', playerVersion: '1.1.9' })],
    }));
    expect(r.state).toBe('partially-deployed');
    expect(r.sectionStatus).toBe('attention');
    expect(rolloutVerification(r)).toEqual({ verified: 1, of: 2 });
  });

  it('rollout-scheduled: behind + delivery armed + a maintenance window defers the install', () => {
    const r = derivePlayerRolloutState(input({
      screens: [screen({ id: 'a', playerVersion: '1.1.9' })],
      autoUpdateEnabled: true,
      window: { start: '22:00', end: '04:00', timezone: 'America/Chicago' },
    }));
    expect(r.state).toBe('rollout-scheduled');
    expect(r.windowConfigured).toBe(true);
  });

  it('rollout-scheduled also fires on an armed per-screen push inside the 30-minute gate', () => {
    const armed = derivePlayerRolloutState(input({
      screens: [screen({ id: 'a', playerVersion: '1.1.9', forceApkUpdatePendingAt: iso(5 * MIN) })],
      window: { start: '22:00', end: '04:00', timezone: 'America/Chicago' },
    }));
    expect(armed.state).toBe('rollout-scheduled');
    expect(armed.counts.pushArmed).toBe(1);
    // …and stops once the server's gate has closed.
    const expired = derivePlayerRolloutState(input({
      screens: [screen({ id: 'a', playerVersion: '1.1.9', forceApkUpdatePendingAt: iso(2 * HOUR) })],
      window: { start: '22:00', end: '04:00', timezone: 'America/Chicago' },
    }));
    expect(expired.counts.pushArmed).toBe(0);
    expect(expired.state).toBe('update-available');
  });

  it('canary-in-progress: a staged cohort outranks the window branch', () => {
    const r = derivePlayerRolloutState(input({
      screens: [screen({ id: 'a', playerVersion: '1.1.9' }), screen({ id: 'b' })],
      canary: canary({ percent: 10, setAt: iso(6 * HOUR), soakHours: 24 }),
      autoUpdateEnabled: true,
      window: { start: '22:00', end: '04:00', timezone: 'America/Chicago' },
    }));
    expect(r.state).toBe('canary-in-progress');
    expect(r.canaryActive).toBe(true);
    expect(Math.round((r.soakRemainingMs ?? 0) / HOUR)).toBe(18);
  });

  it('paused: percent 0 means nobody is eligible, by policy', () => {
    const r = derivePlayerRolloutState(input({
      screens: [screen({ id: 'a', playerVersion: '1.1.9' })],
      canary: canary({ percent: 0, setAt: iso(HOUR) }),
    }));
    expect(r.state).toBe('paused');
    expect(r.sectionStatus).toBe('attention');
    expect(r.canaryActive).toBe(false);
  });

  it('failed outranks paused, canary and everything else', () => {
    const r = derivePlayerRolloutState(input({
      screens: [
        screen({ id: 'a', playerVersion: '1.1.9', lastOtaErrorAt: iso(HOUR), lastOtaErrorMessage: 'INSTALL_FAILED_VERSION_DOWNGRADE' }),
        screen({ id: 'b' }),
      ],
      canary: canary({ percent: 0, setAt: iso(HOUR) }),
    }));
    expect(r.state).toBe('failed');
    expect(r.pill).toBe('blocked');
    expect(r.sectionStatus).toBe('error');
    expect(r.counts.failed).toBe(1);
    expect(r.attentionScreenIds[0]).toBe('a');
  });

  it('unknown-stale when the API could not name a latest version', () => {
    const r = derivePlayerRolloutState(input({ screens: [screen({ id: 'a' })], latest: { versionName: null, source: 'unknown' } }));
    expect(r.state).toBe('unknown-stale');
    expect(r.latestKnown).toBe(false);
    expect(r.pill).toBe('unknown');
    expect(rolloutVerification(r)).toBeNull();
  });

  it('unknown-stale when the latest version has not loaded at all', () => {
    expect(derivePlayerRolloutState(input({ screens: [screen({ id: 'a' })], latest: undefined })).state).toBe('unknown-stale');
  });

  it('unknown-stale when no screen has a fresh version report', () => {
    const r = derivePlayerRolloutState(input({
      screens: [
        screen({ id: 'a', playerVersionAt: iso(3 * VERSION_EVIDENCE_MAX_AGE_MS) }),
        screen({ id: 'b', playerVersion: null, playerVersionAt: null }),
      ],
    }));
    expect(r.state).toBe('unknown-stale');
    expect(r.counts.stale).toBe(1);
    expect(r.counts.unreported).toBe(1);
    expect(r.counts.reported).toBe(0);
  });

  it('a screen that never reported an APK cannot turn a current fleet amber', () => {
    const r = derivePlayerRolloutState(input({
      screens: [screen({ id: 'a' }), screen({ id: 'browser', playerVersion: null, playerVersionAt: null })],
    }));
    expect(r.state).toBe('current');
    expect(r.sectionStatus).toBeNull();
    expect(r.counts.unreported).toBe(1);
  });

  it('but a screen that went quiet after reporting does raise attention', () => {
    const r = derivePlayerRolloutState(input({
      screens: [screen({ id: 'a' }), screen({ id: 'quiet', playerVersionAt: iso(3 * VERSION_EVIDENCE_MAX_AGE_MS) })],
    }));
    expect(r.state).toBe('current');
    expect(r.sectionStatus).toBe('attention');
    expect(r.counts.stale).toBe(1);
  });

  it('distribution counts every screen, Unknown last, with a stale tally', () => {
    const r = derivePlayerRolloutState(input({
      screens: [
        screen({ id: 'a' }),
        screen({ id: 'b' }),
        screen({ id: 'c', playerVersion: '1.0.74-debug' }),
        screen({ id: 'd', playerVersion: '1.1.12', playerVersionAt: iso(3 * VERSION_EVIDENCE_MAX_AGE_MS) }),
        screen({ id: 'e', playerVersion: null, playerVersionAt: null }),
      ],
    }));
    expect(r.distribution.map((b) => [b.version, b.count, b.stale])).toEqual([
      ['1.1.12', 3, 1],
      ['1.0.74-debug', 1, 0],
      [null, 1, 0],
    ]);
  });

  it('an empty fleet is Unknown, never green', () => {
    const r = derivePlayerRolloutState(input({ screens: [] }));
    expect(r.state).toBe('unknown-stale');
    expect(r.counts.total).toBe(0);
  });
});
