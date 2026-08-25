/**
 * Activation-funnel pure-logic tests.
 *
 * Two layers, same discipline as screens.render-proof.spec.ts:
 *   1. deriveStage — rows in, stage out. No Prisma, no NestJS.
 *   2. isExcludedFromFunnel / medianOf / rateOf — the small pure helpers
 *      the service composes into the aggregate response.
 */

import {
  deriveStage,
  isExcludedFromFunnel,
  medianOf,
  hoursBetween,
  rateOf,
  DEMO_TENANT_SLUG_PREFIXES,
  type TenantMilestones,
} from './activation-funnel.logic';
import { SYSTEM_TENANT_ID } from '../security/system-tenant';

const NOW = new Date('2026-08-24T12:00:00.000Z').getTime();
const DAY_MS = 86_400_000;

function milestones(overrides: Partial<TenantMilestones> = {}): TenantMilestones {
  return {
    signedUpAt: new Date('2026-08-01T00:00:00.000Z'),
    firstBoardAt: null,
    firstScreenPairedAt: null,
    firstPublishedAt: null,
    lastRenderProofAt: null,
    ...overrides,
  };
}

describe('deriveStage (pure)', () => {
  it('a brand-new tenant with no milestones sits at SIGNED_UP', () => {
    const r = deriveStage(milestones(), NOW);
    expect(r.stage).toBe('SIGNED_UP');
    expect(r.stageReachedAt).toEqual(new Date('2026-08-01T00:00:00.000Z'));
  });

  it('walks forward one stage at a time as each milestone lands', () => {
    const boardAt = new Date('2026-08-02T00:00:00.000Z');
    expect(deriveStage(milestones({ firstBoardAt: boardAt }), NOW).stage).toBe('BOARD_CREATED');

    const screenAt = new Date('2026-08-03T00:00:00.000Z');
    expect(
      deriveStage(milestones({ firstBoardAt: boardAt, firstScreenPairedAt: screenAt }), NOW).stage,
    ).toBe('SCREEN_PAIRED');

    const publishedAt = new Date('2026-08-04T00:00:00.000Z');
    expect(
      deriveStage(
        milestones({ firstBoardAt: boardAt, firstScreenPairedAt: screenAt, firstPublishedAt: publishedAt }),
        NOW,
      ).stage,
    ).toBe('PUBLISHED');

    const provenAt = new Date('2026-08-05T00:00:00.000Z');
    expect(
      deriveStage(
        milestones({
          firstBoardAt: boardAt,
          firstScreenPairedAt: screenAt,
          firstPublishedAt: publishedAt,
          lastRenderProofAt: provenAt,
        }),
        NOW,
      ).stage,
    ).toBe('RENDER_PROVEN');
  });

  // Task-specified edge case #1: no screens at all.
  it('EDGE CASE — no screens: a board with zero paired screens caps at BOARD_CREATED, never advances', () => {
    const r = deriveStage(
      milestones({
        firstBoardAt: new Date('2026-08-02T00:00:00.000Z'),
        firstScreenPairedAt: null,
        // Even if somehow a publish/render timestamp were present (shouldn't
        // happen without a screen, but the function must not trust that),
        // the missing screen milestone must cap the stage.
        firstPublishedAt: new Date('2026-08-03T00:00:00.000Z'),
        lastRenderProofAt: new Date('2026-08-03T00:05:00.000Z'),
      }),
      NOW,
    );
    expect(r.stage).toBe('BOARD_CREATED');
  });

  // Task-specified edge case #2: render-proof without publish.
  it('EDGE CASE — render-proof without publish: does NOT jump ahead to RENDER_PROVEN', () => {
    const r = deriveStage(
      milestones({
        firstBoardAt: new Date('2026-08-02T00:00:00.000Z'),
        firstScreenPairedAt: new Date('2026-08-03T00:00:00.000Z'),
        firstPublishedAt: null, // never published (e.g. player only ever showed its idle splash)
        lastRenderProofAt: new Date('2026-08-03T00:05:00.000Z'), // yet a proof heartbeat landed
      }),
      NOW,
    );
    expect(r.stage).toBe('SCREEN_PAIRED');
    expect(r.stageReachedAt).toEqual(new Date('2026-08-03T00:00:00.000Z'));
  });

  it('daysInStage floors whole days since stageReachedAt and never goes negative', () => {
    const reachedAt = new Date(NOW - 2.9 * DAY_MS);
    const r = deriveStage(milestones({ firstBoardAt: reachedAt }), NOW);
    expect(r.daysInStage).toBe(2);

    // A timestamp in the "future" relative to nowMs (clock skew / bad data)
    // must clamp to 0, never go negative.
    const future = new Date(NOW + DAY_MS);
    const r2 = deriveStage(milestones({ firstBoardAt: future }), NOW);
    expect(r2.daysInStage).toBe(0);
  });

  it('defaults nowMs to Date.now() when not supplied', () => {
    const r = deriveStage(milestones());
    expect(r.stage).toBe('SIGNED_UP');
    expect(typeof r.daysInStage).toBe('number');
  });
});

describe('isExcludedFromFunnel (pure)', () => {
  it('excludes archived tenants', () => {
    expect(
      isExcludedFromFunnel({ id: 'real-1', slug: 'real-school', archivedAt: new Date() }),
    ).toBe(true);
  });

  it('excludes the SYSTEM_TENANT_ID sentinel', () => {
    expect(
      isExcludedFromFunnel({ id: SYSTEM_TENANT_ID, slug: '__system__', archivedAt: null }),
    ).toBe(true);
  });

  it('excludes known demo-seed slug prefixes (acme-*)', () => {
    for (const prefix of DEMO_TENANT_SLUG_PREFIXES) {
      expect(
        isExcludedFromFunnel({ id: 'x', slug: `${prefix}austin`, archivedAt: null }),
      ).toBe(true);
    }
  });

  it('does NOT exclude a normal, non-archived, non-demo tenant', () => {
    expect(
      isExcludedFromFunnel({ id: 'real-tenant-id', slug: 'chardon-high-school', archivedAt: null }),
    ).toBe(false);
  });

  it('does NOT exclude the kept Springfield seed tenants (precedent: archive-test-tenants.cjs keeps them)', () => {
    expect(
      isExcludedFromFunnel({
        id: '00000000-0000-0000-0000-000000000001',
        slug: 'springfield-school-district',
        archivedAt: null,
      }),
    ).toBe(false);
  });
});

describe('medianOf (pure)', () => {
  it('is null for an empty array (no data, not zero)', () => {
    expect(medianOf([])).toBeNull();
  });

  it('returns the single value for a 1-element array', () => {
    expect(medianOf([42])).toBe(42);
  });

  it('returns the middle value for an odd-length array, unsorted input', () => {
    expect(medianOf([5, 1, 3])).toBe(3);
  });

  it('averages the two middle values for an even-length array', () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('hoursBetween (pure)', () => {
  it('computes positive hours for a later `to`', () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-01T06:00:00.000Z');
    expect(hoursBetween(from, to)).toBe(6);
  });
});

describe('rateOf (pure)', () => {
  it('is null pct when total is 0 (no data, not 0%)', () => {
    expect(rateOf(0, 0)).toEqual({ reached: 0, total: 0, pct: null });
  });

  it('rounds pct to 1 decimal', () => {
    expect(rateOf(1, 3)).toEqual({ reached: 1, total: 3, pct: 33.3 });
  });

  it('is 100 when everyone reached it', () => {
    expect(rateOf(4, 4)).toEqual({ reached: 4, total: 4, pct: 100 });
  });
});
