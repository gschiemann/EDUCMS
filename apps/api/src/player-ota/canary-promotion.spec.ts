/**
 * Regression tests for the canary auto-promotion quorum (OTA-02).
 *
 * The old gate was one line — `cohort.find(s => s.lastOtaState === 'ERROR')`
 * — and every property of it was wrong:
 *   • an EMPTY cohort promoted to a 100% rollout on zero evidence;
 *   • it never checked that anything had actually INSTALLED;
 *   • one ERROR halted forever, and `lastOtaState` was writable by any
 *     unauthenticated caller who knew one device fingerprint;
 *   • the player's own `CHECKING` report, sent at the head of every OTA
 *     cycle, erased a genuine ERROR before the soak expired.
 */

import { evaluateCanaryPromotion } from './canary-auto-promote';

const SET_AT = new Date('2026-08-01T00:00:00Z');
const DURING = new Date('2026-08-01T06:00:00Z');
const BEFORE = new Date('2026-07-20T00:00:00Z');

const healthy = (id: string) => ({ id, playerVersionAt: DURING });

describe('evaluateCanaryPromotion', () => {
  it('promotes when the cohort is non-empty, installs are confirmed, and there are no errors', () => {
    const v = evaluateCanaryPromotion({
      cohort: [healthy('a'), healthy('b'), healthy('c')],
      canarySetAt: SET_AT,
    });
    expect(v.promote).toBe(true);
    expect(v.successCount).toBe(3);
  });

  it('REFUSES to promote an empty cohort — the zero-evidence promotion bug', () => {
    // A percent no screen hashes below, a tenant whose screens were all
    // deleted, a tenant with no screens: `find()` returned undefined, which
    // read as "no errors", which promoted the whole fleet.
    const v = evaluateCanaryPromotion({ cohort: [], canarySetAt: SET_AT });
    expect(v.promote).toBe(false);
    expect(v.reason).toMatch(/cohort-below-minimum/);
  });

  it('REFUSES to promote with no confirmed install in the cohort', () => {
    // The gate never once checked that the new build actually landed;
    // `playerVersionAt` was selected and never read. Absence of an
    // erasable error signal is not evidence of success.
    const v = evaluateCanaryPromotion({
      cohort: [{ id: 'a' }, { id: 'b', playerVersionAt: BEFORE }],
      canarySetAt: SET_AT,
    });
    expect(v.promote).toBe(false);
    expect(v.reason).toBe('no-confirmed-install-in-cohort');
  });

  it('halts on an AUTHENTICATED error regardless of how small a share of the cohort it is', () => {
    // A failure we can attribute to the real screen is trustworthy, so it
    // vetoes outright — no rate threshold applies.
    const cohort = [
      ...Array.from({ length: 20 }, (_, i) => healthy(`ok${i}`)),
      { id: 'bad', playerVersionAt: DURING, lastOtaErrorAt: DURING, lastOtaErrorAuthenticated: true },
    ];
    const v = evaluateCanaryPromotion({ cohort, canarySetAt: SET_AT });
    expect(v.promote).toBe(false);
    expect(v.reason).toBe('authenticated-install-error-in-cohort');
    expect(v.authenticatedErrorCount).toBe(1);
  });

  it('OUTLIER REJECTION: one anonymous error in a large cohort no longer halts the pipeline', () => {
    // The availability half of OTA-02: one unauthenticated POST used to
    // block a tenant's patch rollout indefinitely, every 5 minutes, forever.
    const cohort = [
      ...Array.from({ length: 20 }, (_, i) => healthy(`ok${i}`)),
      { id: 'bad', playerVersionAt: DURING, lastOtaErrorAt: DURING, lastOtaErrorAuthenticated: false },
    ];
    const v = evaluateCanaryPromotion({ cohort, canarySetAt: SET_AT });
    expect(v.promote).toBe(true);
    expect(v.errorCount).toBe(1);
  });

  it('still halts when anonymous errors are widespread — a genuinely bad build', () => {
    const cohort = [
      healthy('ok1'),
      healthy('ok2'),
      { id: 'b1', playerVersionAt: DURING, lastOtaErrorAt: DURING },
      { id: 'b2', playerVersionAt: DURING, lastOtaErrorAt: DURING },
    ];
    const v = evaluateCanaryPromotion({ cohort, canarySetAt: SET_AT });
    expect(v.promote).toBe(false);
    expect(v.reason).toMatch(/error-rate-above-threshold/);
  });

  it('reads the STICKY error column, so the player’s own CHECKING report cannot erase a failure', () => {
    // The self-erase: `lastOtaState` is last-writer-wins and the worker
    // reports CHECKING first thing every cycle. `lastOtaErrorAt` survives it.
    const cohort = [
      healthy('ok1'),
      {
        id: 'bad',
        playerVersionAt: DURING,
        lastOtaState: 'CHECKING',      // overwritten by the device
        lastOtaAt: DURING,
        lastOtaErrorAt: DURING,        // …but the failure is still recorded
        lastOtaErrorAuthenticated: true,
      },
    ];
    expect(evaluateCanaryPromotion({ cohort, canarySetAt: SET_AT }).promote).toBe(false);
  });

  it('ignores errors that predate the canary window', () => {
    const cohort = [healthy('a'), { id: 'b', playerVersionAt: DURING, lastOtaErrorAt: BEFORE }];
    const v = evaluateCanaryPromotion({ cohort, canarySetAt: SET_AT });
    expect(v.promote).toBe(true);
    expect(v.errorCount).toBe(0);
  });

  it('honours the legacy lastOtaState column for a canary armed across the deploy boundary', () => {
    const cohort = [healthy('a'), { id: 'b', playerVersionAt: DURING, lastOtaState: 'ERROR', lastOtaAt: DURING }];
    const v = evaluateCanaryPromotion({ cohort, canarySetAt: SET_AT, maxAnonymousErrorRate: 0.2 });
    expect(v.promote).toBe(false);
  });

  it('respects a stricter operator-configured minimum cohort', () => {
    const cohort = [healthy('a'), healthy('b')];
    expect(evaluateCanaryPromotion({ cohort, canarySetAt: SET_AT, minCohort: 5 }).promote).toBe(false);
    expect(evaluateCanaryPromotion({ cohort, canarySetAt: SET_AT, minCohort: 2 }).promote).toBe(true);
  });

  it('defaults the minimum to 1 so small K-12 tenants are not stranded in canary forever', () => {
    // A floor of 3+ would silently strand every tenant running one or two
    // screens — its own kind of outage.
    expect(evaluateCanaryPromotion({ cohort: [healthy('only')], canarySetAt: SET_AT }).promote).toBe(true);
  });
});
