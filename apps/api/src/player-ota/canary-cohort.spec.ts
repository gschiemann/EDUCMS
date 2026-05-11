import { isInCanaryCohort, screenCohortBucket } from './canary-cohort';

describe('screenCohortBucket', () => {
  it('returns deterministic bucket for the same screenId', () => {
    const id = 'b1234567-89ab-cdef-0123-456789abcdef';
    const a = screenCohortBucket(id);
    const b = screenCohortBucket(id);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  it('produces approximately uniform distribution over 5000 UUIDs', () => {
    const counts = new Array(100).fill(0);
    const N = 5000;
    for (let i = 0; i < N; i++) {
      // Random UUID-shaped strings (cryptographic randomness not
      // important here — just to stress the hash).
      const id = [...Array(36)].map((_, j) =>
        [8, 13, 18, 23].includes(j) ? '-' : Math.floor(Math.random() * 16).toString(16),
      ).join('');
      counts[screenCohortBucket(id)]++;
    }
    const mean = N / 100;
    const maxDeviation = counts.reduce((acc, c) => Math.max(acc, Math.abs(c - mean)), 0);
    // Each bucket should average 50. Allow up to ±50 (2x mean) drift —
    // that's a very loose bound but flushes out gross non-uniformity
    // without making the test flaky on randomness.
    expect(maxDeviation).toBeLessThan(50);
  });
});

describe('isInCanaryCohort', () => {
  it('returns false when canaryFleetPercent is 0', () => {
    expect(isInCanaryCohort('any-id', 0)).toBe(false);
    expect(isInCanaryCohort('any-id', -5)).toBe(false);
  });

  it('returns true when canaryFleetPercent is 100', () => {
    expect(isInCanaryCohort('any-id', 100)).toBe(true);
    expect(isInCanaryCohort('any-id', 150)).toBe(true);
  });

  it('returns true for buckets below the threshold, false above', () => {
    const id = 'test-stable-id-1';
    const bucket = screenCohortBucket(id);
    expect(isInCanaryCohort(id, bucket + 1)).toBe(true);
    if (bucket > 0) {
      expect(isInCanaryCohort(id, bucket)).toBe(false);
    }
  });

  it('cohort grows monotonically with the percent setting', () => {
    // A given screen, once in the cohort at percent P, stays in the
    // cohort for all P' > P. Critical for "the kiosks that already
    // got the new build don't get rolled BACK when we bump the percent."
    const ids = Array.from({ length: 200 }, (_, i) => `screen-${i}-uuid`);
    let prevCohort = new Set<string>();
    for (let pct = 10; pct <= 100; pct += 10) {
      const cohort = new Set(ids.filter((id) => isInCanaryCohort(id, pct)));
      for (const id of prevCohort) {
        expect(cohort.has(id)).toBe(true); // never drops out as percent grows
      }
      prevCohort = cohort;
    }
  });
});
