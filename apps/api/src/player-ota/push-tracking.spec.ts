/**
 * Tracked APK pushes — the pure decision (push-tracking.ts).
 *
 * The field case every test here is measured against: on 2026-10-15/16 the
 * API answered `install v1.1.29` to an Android 9 panel on every 30-minute
 * check for 24 h — 48 full downloads, 48 commits ending at an "Install?"
 * dialog nobody tapped — and the push then vanished. A push must now be
 * offered a bounded number of times, given time to land once committed, and
 * then HELD (visibly) when it did not.
 */
import {
  PUSH_EXPIRE_MS,
  PUSH_MAX_OFFERS,
  PUSH_SETTLE_MS,
  decidePushGate,
  holdSentence,
  isInstallPhaseError,
  pushIsActive,
  pushSatisfiedByReport,
  type PushGateFacts,
} from './push-tracking';

const NOW = new Date('2026-10-16T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

function facts(over: Partial<PushGateFacts> = {}, push: Partial<PushGateFacts['push']> = {}): PushGateFacts {
  return {
    push: {
      pendingAt: ago(60 * MIN),
      hold: null,
      offerCount: 0,
      lastOfferAt: null,
      targetVersionCode: null,
      ...push,
    },
    callerVersionCode: 10123,
    callerAuthenticated: true,
    report: { state: null, message: null, at: null },
    readiness: 'needs-tap',
    now: NOW,
    ...over,
  };
}

/** A push that was offered `minutesAgo` (once, by default). */
const offered = (minutesAgo: number, extra: Partial<PushGateFacts['push']> = {}) => ({
  offerCount: 1,
  lastOfferAt: ago(minutesAgo * MIN),
  targetVersionCode: 10129,
  ...extra,
});
const report = (state: string, minutesAgo: number, message: string | null = null) => ({
  report: { state, message, at: ago(minutesAgo * MIN) },
});

describe('decidePushGate — the first offer', () => {
  it('offers a fresh push, and the offer is tracked for an authenticated Player', () => {
    expect(decidePushGate(facts())).toEqual({ action: 'offer', reason: 'first-offer', tracked: true });
  });

  it('an unauthenticated caller still gets the first offer (OTA-01: the read path stays open) but cannot move the record', () => {
    expect(decidePushGate(facts({ callerAuthenticated: false }))).toEqual({
      action: 'offer', reason: 'first-offer', tracked: false,
    });
  });

  it('a push no check was handed within 24 h is EXPIRED — held visibly, never a surprise install days later', () => {
    const g = decidePushGate(facts({}, { pendingAt: ago(PUSH_EXPIRE_MS) }));
    expect(g).toEqual({ action: 'hold', hold: 'EXPIRED', reason: 'not-offered-within-24h', record: true });
    expect(decidePushGate(facts({}, { pendingAt: ago(PUSH_EXPIRE_MS - MIN) })).action).toBe('offer');
  });

  it('EXPIRED is time alone, so any caller may observe it', () => {
    const g = decidePushGate(facts({ callerAuthenticated: false }, { pendingAt: ago(PUSH_EXPIRE_MS + MIN) }));
    expect(g).toMatchObject({ action: 'hold', hold: 'EXPIRED', record: true });
  });
});

describe('decidePushGate — a check that arrives before the install was committed is offered again', () => {
  it('REPLACE SHAPE: the heartbeat check 30 s after the WebSocket check, first download still running → offered again', () => {
    // PlayerApp.fireOtaCheckNow enqueues with ExistingWorkPolicy.REPLACE: the
    // second check may have cancelled the first download. "Up to date" here
    // would leave nothing installing.
    const g = decidePushGate(facts(report('DOWNLOADING', 0.2), offered(0.5)));
    expect(g).toEqual({ action: 'offer', reason: 'reoffer-not-installed', tracked: true });
  });

  it('no word from the device since the offer, or only its pre-offer CHECKING → offered again', () => {
    expect(decidePushGate(facts({}, offered(3))).action).toBe('offer');
    expect(decidePushGate(facts(report('CHECKING', 4), offered(3))).action).toBe('offer');
  });

  it('a DOWNLOAD error is worth another try — up to the offer limit', () => {
    const err = report('ERROR', 1, 'Download failed: timeout');
    expect(decidePushGate(facts(err, offered(2)))).toEqual({ action: 'offer', reason: 'retry-after-download-error', tracked: true });
    expect(decidePushGate(facts(err, offered(2, { offerCount: PUSH_MAX_OFFERS - 1 }))).action).toBe('offer');
    expect(decidePushGate(facts(err, offered(2, { offerCount: PUSH_MAX_OFFERS })))).toEqual({
      action: 'hold', hold: 'STALLED', reason: 'offer-limit-reached', record: true,
    });
  });

  it('the offer limit bounds every re-offer, not just error retries', () => {
    const g = decidePushGate(facts(report('DOWNLOADING', 30), offered(31, { offerCount: PUSH_MAX_OFFERS })));
    expect(g).toEqual({ action: 'hold', hold: 'STALLED', reason: 'offer-limit-reached', record: true });
  });

  it('the limit is small: the field loop was 48 downloads', () => {
    expect(PUSH_MAX_OFFERS).toBeLessThanOrEqual(4);
  });
});

describe('decidePushGate — a committed install is given time to land, then held', () => {
  it('within the settle window after INSTALLING: no second offer, no second download', () => {
    const g = decidePushGate(facts(report('INSTALLING', 1), offered(2)));
    expect(g.action).toBe('in-flight');
  });

  it('M24 SHAPE: offered 30 min ago, the panel committed (INSTALLING) and is still on the old build → NEEDS_TAP', () => {
    const g = decidePushGate(facts({ ...report('INSTALLING', 29, 'v1.1.29'), readiness: 'needs-tap' }, offered(30)));
    expect(g).toEqual({ action: 'hold', hold: 'NEEDS_TAP', reason: 'did-not-land-needs-tap-class', record: true });
  });

  it('a class we cannot read is still held — with a reason that says so', () => {
    const g = decidePushGate(facts({ ...report('INSTALLING', 29), readiness: 'unknown' }, offered(30)));
    expect(g).toEqual({ action: 'hold', hold: 'NEEDS_TAP', reason: 'did-not-land-unknown-class', record: true });
  });

  it('a screen that installs silently and still did not land is STALLED, not NEEDS_TAP', () => {
    const g = decidePushGate(facts({ ...report('INSTALLING', 29), readiness: 'silent' }, offered(30)));
    expect(g).toEqual({ action: 'hold', hold: 'STALLED', reason: 'silent-install-did-not-land', record: true });
  });

  it('the settle window is exactly PUSH_SETTLE_MS, measured from the last offer', () => {
    const settle = PUSH_SETTLE_MS / MIN;
    expect(decidePushGate(facts(report('INSTALLING', 1), offered(settle - 1))).action).toBe('in-flight');
    expect(decidePushGate(facts(report('INSTALLING', 1), offered(settle))).action).toBe('hold');
  });

  it('an INSTALLING from before the last offer is about an earlier attempt — offered again', () => {
    expect(decidePushGate(facts(report('INSTALLING', 40), offered(4))).action).toBe('offer');
  });

  it('the install LANDED but Android blocked the relaunch → never re-offered (the new build reports itself)', () => {
    expect(decidePushGate(facts(report('RELAUNCH_BLOCKED', 1), offered(30)))).toEqual({
      action: 'in-flight', reason: 'installed-relaunch-blocked',
    });
  });
});

describe('decidePushGate — what the device said', () => {
  it('the device SAYING it needs a tap holds at once — no settle wait', () => {
    const g = decidePushGate(facts(report('NEEDS_TAP', 1), offered(2)));
    expect(g).toEqual({ action: 'hold', hold: 'NEEDS_TAP', reason: 'device-reported-needs-tap', record: true });
  });

  it('…for every caller, recorded only on an authenticated check (piece 2\'s rule, kept)', () => {
    const g = decidePushGate(facts({ ...report('NEEDS_TAP', 1), callerAuthenticated: false }, offered(2)));
    expect(g).toEqual({ action: 'hold', hold: 'NEEDS_TAP', reason: 'device-reported-needs-tap', record: false });
  });

  it('a push armed BEFORE this record existed (never tracked) is held by a NEEDS_TAP after it too', () => {
    // The deploy transition: a push already pending, offerCount 0, and the
    // screen said NEEDS_TAP. It must not be offered once more.
    const g = decidePushGate(facts(report('NEEDS_TAP', 5)));
    expect(g).toMatchObject({ action: 'hold', hold: 'NEEDS_TAP' });
  });

  it('a NEEDS_TAP from before the push is about an earlier attempt — a new push is offered', () => {
    expect(decidePushGate(facts(report('NEEDS_TAP', 90))).action).toBe('offer');
  });

  it('a FAILED_<code> report holds as FAILED', () => {
    const g = decidePushGate(facts(report('FAILED_INCOMPATIBLE', 1), offered(2)));
    expect(g).toEqual({ action: 'hold', hold: 'FAILED', reason: 'device-reported-failed_incompatible', record: true });
  });

  it('only the strict FAILED_<CODE> shape counts (shared with ota-install-state)', () => {
    expect(decidePushGate(facts(report('FAILED_X;Y', 1), offered(2))).action).toBe('offer');
  });

  it('an install-phase ERROR from an older player holds as FAILED', () => {
    const g = decidePushGate(facts(report('ERROR', 1, 'Install failed: FAILURE_ABORTED'), offered(2)));
    expect(g).toEqual({ action: 'hold', hold: 'FAILED', reason: 'device-reported-install-error', record: true });
  });

  it('a report older than the last offer says nothing about it', () => {
    expect(decidePushGate(facts(report('FAILED_STORAGE', 40), offered(4))).action).toBe('offer');
  });
});

describe('decidePushGate — unauthenticated callers after an offer (OTA-01)', () => {
  it('cannot infer a hold, and get the old behaviour — the offer, untracked — inside 24 h', () => {
    const g = decidePushGate(facts({ ...report('INSTALLING', 29), callerAuthenticated: false }, offered(30)));
    expect(g).toEqual({ action: 'offer', reason: 'untracked-unauthenticated', tracked: false });
  });

  it('…and nothing after 24 h: a screen whose credential broke is not handed a download every 6 hours forever', () => {
    const g = decidePushGate(facts({ callerAuthenticated: false }, { ...offered(60), pendingAt: ago(PUSH_EXPIRE_MS + MIN) }));
    expect(g).toEqual({ action: 'withhold', reason: 'unauthenticated-after-24h' });
  });
});

describe('decidePushGate — held pushes and satisfied pushes', () => {
  it('a recorded hold is honoured for every caller, and is not re-recorded', () => {
    for (const hold of ['NEEDS_TAP', 'STALLED', 'FAILED', 'EXPIRED']) {
      for (const callerAuthenticated of [true, false]) {
        const g = decidePushGate(facts({ callerAuthenticated }, { hold, ...offered(60) }));
        expect(g).toMatchObject({ action: 'hold', hold, record: false });
      }
    }
  });

  it('a caller already on the offered build satisfies the push — even a held one (a person tapped Install)', () => {
    const g = decidePushGate(facts({ callerVersionCode: 10129 }, { hold: 'NEEDS_TAP', ...offered(60) }));
    expect(g.action).toBe('satisfied');
  });

  it('a person at the panel (device-authenticated source=user) passes any hold, uncounted', () => {
    for (const hold of ['NEEDS_TAP', 'STALLED', 'FAILED', 'EXPIRED']) {
      const g = decidePushGate(facts({ callerIsPerson: true }, { hold, ...offered(60) }));
      expect(g).toEqual({ action: 'offer', reason: 'person-at-panel', tracked: false });
    }
    // The claim without the credential is just another unattended check.
    expect(decidePushGate(facts({ callerIsPerson: true, callerAuthenticated: false }, { hold: 'NEEDS_TAP', ...offered(60) })).action).toBe('hold');
    // …and a person on the offered build has nothing to install.
    expect(decidePushGate(facts({ callerIsPerson: true, callerVersionCode: 10129 }, offered(60))).action).toBe('satisfied');
  });

  it('an unknown hold value is not a hold', () => {
    expect(decidePushGate(facts({}, { hold: 'SOMETHING' })).action).toBe('offer');
  });

  it('no push → plain offer path, untracked (the gate is only consulted with a push)', () => {
    expect(decidePushGate(facts({}, { pendingAt: null }))).toEqual({ action: 'offer', reason: 'no-push', tracked: false });
  });
});

describe('a whole push, check by check — the 48-download loop cannot come back', () => {
  it('Android 9 panel, old player, WebSocket + heartbeat checks then 46 half-hourly checks → 2 offers, then NEEDS_TAP', () => {
    const pushAt = NOW.getTime();
    const push = { pendingAt: new Date(pushAt), hold: null as string | null, offerCount: 0, lastOfferAt: null as Date | null, targetVersionCode: null as number | null };
    let rep: { state: string | null; message: string | null; at: Date | null } = { state: null, message: null, at: null };
    let offers = 0;
    const check = (atMs: number) => {
      const g = decidePushGate({ push: { ...push }, callerVersionCode: 10123, callerAuthenticated: true, report: rep, readiness: 'needs-tap', now: new Date(atMs) });
      if (g.action === 'offer') { offers += 1; push.offerCount += 1; push.lastOfferAt = new Date(atMs); push.targetVersionCode = 10129; }
      if (g.action === 'hold' && g.record) push.hold = g.hold;
      return g;
    };
    check(pushAt + 5_000); // the WebSocket nudge
    rep = { state: 'DOWNLOADING', message: null, at: new Date(pushAt + 10_000) };
    check(pushAt + 40_000); // the heartbeat's forceUpdatePending — REPLACEs the first worker
    rep = { state: 'INSTALLING', message: 'v1.1.29', at: new Date(pushAt + 70_000) }; // dialog up, nobody there
    const last: string[] = [];
    for (let i = 1; i <= 46; i++) last.push(check(pushAt + i * 30 * MIN).action);
    expect(offers).toBe(2);
    expect(push.hold).toBe('NEEDS_TAP');
    expect(new Set(last)).toEqual(new Set(['hold']));
  });
});

describe('helpers', () => {
  it('isInstallPhaseError separates install failures from download failures', () => {
    expect(isInstallPhaseError('Install failed: FAILURE_ABORTED')).toBe(true);
    expect(isInstallPhaseError('Install succeeded but Player did not relaunch; reboot')).toBe(true);
    expect(isInstallPhaseError('Download failed: timeout')).toBe(false);
    expect(isInstallPhaseError('SHA256 mismatch (expected 1234…)')).toBe(false);
    expect(isInstallPhaseError(null)).toBe(false);
  });

  it('pushSatisfiedByReport: a version increase, or the offered build even after the stored version moved', () => {
    const pendingAt = NOW;
    expect(pushSatisfiedByReport({ pendingAt, priorVersionCode: 10123, reportedVersionCode: 10129, targetVersionCode: null })).toBe(true);
    // The Manager's anonymous check already stored 10129; the Player's own
    // authenticated report must still clear the push.
    expect(pushSatisfiedByReport({ pendingAt, priorVersionCode: 10129, reportedVersionCode: 10129, targetVersionCode: 10129 })).toBe(true);
    expect(pushSatisfiedByReport({ pendingAt, priorVersionCode: 10129, reportedVersionCode: 10129, targetVersionCode: null })).toBe(false);
    expect(pushSatisfiedByReport({ pendingAt, priorVersionCode: 10123, reportedVersionCode: 10123, targetVersionCode: 10129 })).toBe(false);
    expect(pushSatisfiedByReport({ pendingAt: null, priorVersionCode: 1, reportedVersionCode: 10129, targetVersionCode: 10129 })).toBe(false);
    expect(pushSatisfiedByReport({ pendingAt, priorVersionCode: 1, reportedVersionCode: 0, targetVersionCode: 10129 })).toBe(false);
  });

  it('pushIsActive: an un-held push younger than 24 h — the same rule the wedge detector queries', () => {
    const now = NOW.getTime();
    expect(pushIsActive({ pendingAt: ago(5 * MIN), hold: null }, now)).toBe(true);
    expect(pushIsActive({ pendingAt: ago(5 * MIN).toISOString(), hold: null }, now)).toBe(true);
    expect(pushIsActive({ pendingAt: null, hold: null }, now)).toBe(false);
    for (const hold of ['NEEDS_TAP', 'STALLED', 'FAILED', 'EXPIRED']) expect(pushIsActive({ pendingAt: ago(MIN), hold }, now)).toBe(false);
    expect(pushIsActive({ pendingAt: ago(PUSH_EXPIRE_MS), hold: null }, now)).toBe(false);
    expect(pushIsActive({ pendingAt: ago(PUSH_EXPIRE_MS - 1), hold: null }, now)).toBe(true);
  });

  it('holdSentence states what the evidence proves (rule 10)', () => {
    expect(holdSentence('NEEDS_TAP', 'device-reported-needs-tap', { targetVersion: '1.1.29', callerVersion: null, offeredAt: null }))
      .toBe('Android on this screen is waiting for someone to tap Install for v1.1.29.');
    const inferred = holdSentence('NEEDS_TAP', 'did-not-land-unknown-class', { targetVersion: '1.1.29', callerVersion: '1.1.23', offeredAt: null });
    expect(inferred).toContain('did not install');
    expect(inferred).toContain('Most often');
    // An offer limit can be reached without a single download error, so the
    // sentence counts offers — it never claims "could not be downloaded".
    const limit = holdSentence('STALLED', 'offer-limit-reached', { targetVersion: '1.1.29', callerVersion: '1.1.23', offeredAt: null, offerCount: 4 });
    expect(limit).toBe('v1.1.29 was offered 4 times and did not install; the screen is still on v1.1.23.');
    // EXPIRED never claims the screen was offline: it may have been outside
    // its window or held by a staged rollout.
    const expired = holdSentence('EXPIRED', 'not-offered-within-24h', { targetVersion: null, callerVersion: null, offeredAt: null });
    expect(expired).toContain('was not handed to this screen within 24 hours');
    expect(expired).not.toContain('did not check in');
  });
});
