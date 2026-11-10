/**
 * "Needs re-pairing" customer alert — one test per rule that keeps the email
 * from going out (2026-11-09). Pure policy: customer-alert-policy.ts
 * (`repairCandidate`, `sharedCredentialEvent`, `repairRecovered`).
 */
import { ALERT_RULES, intendedDowntime, repairCandidate, repairRecovered, sharedCredentialEvent, type ScreenFacts } from './customer-alert-policy';
import { renderDigestEmail, renderScreenAlertEmail, type AlertLocale } from './customer-alert-copy';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-11-09T15:00:00Z');

const row = (over: Partial<Parameters<typeof repairCandidate>[0]> = {}) => ({
  authState: 'REPAIR_REQUIRED',
  authStateChangedAt: new Date(NOW - 30 * HOUR),
  lastPingAt: new Date(NOW - 20_000),
  status: 'ONLINE',
  ...over,
});

describe('repairCandidate', () => {
  it('is due when marked for more than a day, pinging now', () => {
    expect(repairCandidate(row(), NOW)).toBe('due');
  });
  it('is not due inside the first day: the player and the server restore window may still heal it', () => {
    expect(repairCandidate(row({ authStateChangedAt: new Date(NOW - 23 * HOUR) }), NOW)).toBe('not-yet');
    expect(repairCandidate(row({ authStateChangedAt: new Date(NOW - ALERT_RULES.REPAIR_DUE_MS + MIN) }), NOW)).toBe('not-yet');
    expect(repairCandidate(row({ authStateChangedAt: new Date(NOW - ALERT_RULES.REPAIR_DUE_MS) }), NOW)).toBe('due');
  });
  it('a long-standing state is old news, never emailed on first sight', () => {
    expect(repairCandidate(row({ authStateChangedAt: new Date(NOW - 15 * 24 * HOUR) }), NOW)).toBe('too-old');
  });
  it('any other trust state is not a candidate (PROVEN, null, unknown)', () => {
    for (const authState of ['PROVEN', null, 'SOMETHING_NEW']) expect(repairCandidate(row({ authState }), NOW)).toBe('not-required');
  });
  it('a screen that is not pinging is an OFFLINE matter, not a re-pair email', () => {
    expect(repairCandidate(row({ lastPingAt: new Date(NOW - 10 * MIN) }), NOW)).toBe('not-online');
    expect(repairCandidate(row({ lastPingAt: null }), NOW)).toBe('not-online');
  });
  it('a future-dated ping is not a heartbeat', () => {
    expect(repairCandidate(row({ lastPingAt: new Date(NOW + 10 * MIN) }), NOW)).toBe('not-online');
  });
  it('a missing or future flip time is not credible: silence', () => {
    expect(repairCandidate(row({ authStateChangedAt: null }), NOW)).toBe('no-clock');
    expect(repairCandidate(row({ authStateChangedAt: new Date(NOW + 5 * MIN) }), NOW)).toBe('future-clock');
  });
  it('revoked and pending screens are never candidates', () => {
    expect(repairCandidate(row({ status: 'REVOKED' }), NOW)).toBe('not-required');
    expect(repairCandidate(row({ status: 'PENDING' }), NOW)).toBe('not-required');
  });
});

describe('sharedCredentialEvent', () => {
  const at = NOW - 30 * HOUR;
  it('three screens flipping within five minutes share one cause (a key rotation, a deploy): all held back', () => {
    const ids = sharedCredentialEvent([
      { screenId: 'a', startedAtMs: at },
      { screenId: 'b', startedAtMs: at + 2 * MIN },
      { screenId: 'c', startedAtMs: at + 4 * MIN },
      { screenId: 'd', startedAtMs: at + 3 * HOUR },
    ]);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });
  it('two screens, or three spread over hours, are independent problems', () => {
    expect(sharedCredentialEvent([{ screenId: 'a', startedAtMs: at }, { screenId: 'b', startedAtMs: at + MIN }]).size).toBe(0);
    expect(
      sharedCredentialEvent([{ screenId: 'a', startedAtMs: at }, { screenId: 'b', startedAtMs: at + HOUR }, { screenId: 'c', startedAtMs: at + 2 * HOUR }]).size,
    ).toBe(0);
  });
});

describe('repairRecovered', () => {
  it('only REPAIR_REQUIRED is unhealthy', () => {
    expect(repairRecovered('REPAIR_REQUIRED')).toBe(false);
    expect(repairRecovered('PROVEN')).toBe(true);
    expect(repairRecovered(null)).toBe(true);
  });
});

describe('the intended-downtime rules apply to a re-pair problem too', () => {
  const facts = (over: Partial<ScreenFacts> = {}): ScreenFacts => ({
    id: 's1',
    status: 'ONLINE',
    tenantId: 't1',
    pairedAt: new Date(NOW - 30 * 24 * HOUR),
    lastPingAt: new Date(NOW - 20_000),
    nativeRuntimeReport: null,
    nativeRuntimeReportAt: null,
    credentialEpochRotatedAt: new Date(NOW - 3 * 24 * HOUR),
    lastOtaAt: null,
    lastOtaState: null,
    forceApkUpdatePendingAt: null,
    forceApkUpdateHold: null,
    displayWindows: [],
    otaWindow: null,
    lastPowerCommand: null,
    lastMaintenanceAt: null,
    ...over,
  });
  it('a screen being updated or restarted right now is deferred', () => {
    expect(intendedDowntime(facts({ lastMaintenanceAt: new Date(NOW - 5 * MIN) }), 'REPAIR_REQUIRED', NOW, NOW)).toBe('maintenance');
  });
  it('a screen installed in the last two hours is deferred', () => {
    expect(intendedDowntime(facts({ pairedAt: new Date(NOW - 30 * MIN) }), 'REPAIR_REQUIRED', NOW, NOW)).toBe('just-installed');
  });
  it('a remote power-off is deferred', () => {
    expect(intendedDowntime(facts({ lastPowerCommand: { state: 'off', at: new Date(NOW - HOUR) } }), 'REPAIR_REQUIRED', NOW, NOW)).toBe('remote-power-off');
  });
  it('a screen in good order is not deferred (so the email can go)', () => {
    expect(intendedDowntime(facts(), 'REPAIR_REQUIRED', NOW, NOW)).toBeNull();
  });
});

describe('the words (en / es / zh)', () => {
  const links = { screensUrl: 'https://app.test/lincoln/screens', manageUrl: 'https://app.test/lincoln/account#alert-emails' };
  const locales: AlertLocale[] = ['en', 'es', 'zh'];
  const it1 = (kind: 'REPAIR_REQUIRED' | 'REPAIR_RESTORED') => ({ kind, screenName: 'Lobby TV', locationName: 'Lincoln Elementary', minutes: 1500 });
  it('both kinds read in every language, with the manage link, and never alarm: the screen keeps playing', () => {
    for (const l of locales)
      for (const kind of ['REPAIR_REQUIRED', 'REPAIR_RESTORED'] as const) {
        const e = renderScreenAlertEmail(l, { kind, locationName: 'Lincoln Elementary', items: [it1(kind)] }, links);
        expect(e.subject).toMatch(/^VenueOS[:：]/);
        expect(e.subject).toContain('Lobby TV');
        expect(e.body).toContain(links.manageUrl);
        expect(e.body).toContain(links.screensUrl);
      }
    const en = renderScreenAlertEmail('en', { kind: 'REPAIR_REQUIRED', locationName: 'Lincoln Elementary', items: [it1('REPAIR_REQUIRED')] }, links);
    expect(en.subject).toBe('VenueOS: Lobby TV at Lincoln Elementary needs to be re-paired');
    expect(en.body).toContain('still playing');
    expect(en.body).not.toMatch(/offline|outage|down/i);
  });
  it('the digest names the kind in every language', () => {
    for (const l of locales) {
      const e = renderDigestEmail(l, { orgName: 'Springfield', items: [it1('REPAIR_REQUIRED'), it1('REPAIR_RESTORED')] }, links);
      expect(e.body).toContain('Lobby TV');
      expect(e.body).not.toContain('undefined');
    }
  });
});
