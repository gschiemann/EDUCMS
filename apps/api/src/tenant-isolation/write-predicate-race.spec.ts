/**
 * SEC-009 — THE TENANT PREDICATE ON THE *WRITE* IS LOAD-BEARING (2026-09-05).
 *
 * ── Why this file exists ────────────────────────────────────────────────
 * The 2026-09-05 remediation moved the tenant boundary INTO the query: a
 * handler that used to do
 *
 *     const row = await prisma.game.findFirst({ where: { id, tenantId } });   // gate
 *     if (!row) throw new NotFoundException();
 *     await prisma.game.update({ where: { id }, data });                      // write
 *
 * now writes `where: { id, tenantId }`. Reviewers reasonably ask what that
 * bought, since the gate above it already refused. `two-tenant-role-matrix`
 * cannot answer: aimed at a foreign id, the GATE refuses first, so those tests
 * stay green whether or not the write carries the predicate. A control nothing
 * can distinguish from its own absence is not yet proven.
 *
 * This file is that distinction. Each case lets the gate PASS on a row the
 * caller really does own, and then moves that row to another tenant before the
 * write lands — the read-then-write window every one of these handlers has,
 * because the gate and the write are two separate statements against a live
 * database. With the predicate, the write matches nothing and the request
 * fails closed. Without it, the write lands on a row that now belongs to
 * someone else.
 *
 * ── This is a real window, not a contrived one ──────────────────────────
 * A Screen's `tenantId` changes on pair, on disown (`tenantId -> null`) and on
 * a re-pair into a different org; the pairing-code lookup that decides a claim
 * happens OUTSIDE the claim transaction (which is why that write is written as
 * a compare-and-swap — see the `ten-ok` at the pair site). A Game moves when a
 * location is reorganised. Under Supavisor session pooling these two statements
 * can be milliseconds or seconds apart. "Nobody would do that concurrently" is
 * exactly the assumption SEC-009 was filed about.
 *
 * ── Reading a failure here ──────────────────────────────────────────────
 * A failure means a write landed on a row belonging to another tenant. Do not
 * "fix" it by relaxing the assertion or by deleting the race — restore the
 * `tenantId` (or the fleet-window `tenantId: { in: readable }`) predicate on
 * the `update`/`delete` this case names.
 *
 * MUTATION-TESTED (2026-09-05): removing the predicate from
 * `SportsService.adjustScore`'s update, from `withStatsTx`'s re-read + update,
 * or from `ScreensController.update`'s update turns the matching case here RED
 * while the whole of `two-tenant-role-matrix.spec.ts` stays green — which is
 * the point.
 */

import { AppRole } from '@cms/database';
import { makeTwoTenantPrisma, type Dataset, type TwoTenantPrisma } from './two-tenant-prisma';

import { ScreensController } from '../screens/screens.controller';
import { SportsController } from '../sports/sports.controller';
import { SportsService } from '../sports/sports.service';
import { SponsorsService } from '../sports/sponsors.service';

const HOME = 't-alpha';
const FOREIGN = 't-beta';

function dataset(): Dataset {
  return {
    tenant: [
      { id: HOME, name: 'Alpha District', slug: 'alpha', parentId: null, vertical: 'EDU', archivedAt: null },
      { id: FOREIGN, name: 'Beta District', slug: 'beta', parentId: null, vertical: 'EDU', archivedAt: null },
    ],
    // ONE row per model, owned by the caller's own tenant. The gate is
    // supposed to pass — that is the whole design of this file.
    screen: [
      {
        id: 'scr-a',
        tenantId: HOME,
        screenGroupId: null,
        name: 'Gym North',
        status: 'ONLINE',
        location: null,
        address: null,
        latitude: null,
        longitude: null,
        photoUrl: null,
        resolution: '1920x1080',
        config: null,
        hardwareModel: null,
        deviceFingerprint: 'fp-print-a',
      },
    ],
    game: [
      {
        id: 'game-a',
        tenantId: HOME,
        sport: 'basketball',
        homeTeam: 'Home A',
        awayTeam: 'Away A',
        homeScore: 10,
        awayScore: 8,
        status: 'LIVE',
        segment: 1,
        clockMs: 60_000,
        clockRunning: false,
        clockStartedAt: null,
        stats: null,
        feedTokenVersion: 0,
        consoleTokenVersion: 0,
        templateId: null,
        startsAt: new Date('2026-01-01T00:00:00Z'),
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    playlist: [],
    auditLog: [],
    notification: [],
  };
}

/**
 * Wrap the double's client so that the FIRST row `model.<method>` hands back is
 * moved to `FOREIGN` immediately afterwards — the concurrent re-tenant.
 *
 * The double returns its live row objects rather than copies, so mutating the
 * returned object really does move the row in the table the later write will
 * query. `foreignTouches()` snapshots the tenant AT TOUCH TIME, so the gate's
 * own read is still correctly attributed to the home tenant; only what happens
 * after the flip is attributed to the foreign one.
 *
 * `$transaction` and every other model come from the inner client untouched, so
 * the handler's in-transaction statements run against the same mutated table.
 */
function raceAfterFirstRead(
  prisma: TwoTenantPrisma,
  model: string,
  methods: string[],
): { client: any; fired: () => boolean } {
  const inner: any = prisma.client;
  let fired = false;
  const realModel = inner[model];
  const racedModel = new Proxy(realModel, {
    get(target, prop: string) {
      const fn = (target as any)[prop];
      if (typeof fn !== 'function' || !methods.includes(prop)) return fn;
      return async (...args: any[]) => {
        const out = await fn(...args);
        if (!fired) {
          const rows = Array.isArray(out) ? out : out ? [out] : [];
          for (const row of rows) {
            if (row && typeof row === 'object' && row.tenantId === HOME) {
              row.tenantId = FOREIGN;
              fired = true;
            }
          }
        }
        return out;
      };
    },
  });
  const client = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === model) return racedModel;
        return inner[prop];
      },
    },
  );
  return { client, fired: () => fired };
}

const req = () => ({
  user: {
    id: 'user-a',
    tenantId: HOME,
    schoolId: HOME,
    districtId: HOME,
    role: AppRole.SCHOOL_ADMIN,
    email: 'a@example.test',
  },
  headers: {},
  ip: '127.0.0.1',
  get: () => 'api.test',
});

const stubRedis = { publish: jest.fn(async () => undefined), sismember: jest.fn(async () => false) } as any;
const stubSigner = { signMessage: jest.fn(() => ({ type: 'SYNC' })) } as any;
const stubLicense = { assertSeatAvailable: jest.fn(async () => undefined) } as any;
const stubStripe = { syncSubscriptionQuantity: jest.fn(async () => undefined) } as any;
const stubMenu = { getMenuForScreen: jest.fn(async () => null) } as any;
const stubFlags = { isEnabled: jest.fn(() => false), enabled: jest.fn(() => false) } as any;

interface RaceCase {
  name: string;
  /** Model the gate reads (and the race re-tenants). */
  model: string;
  /** Gate methods to race behind. */
  methods: string[];
  run: (client: any) => Promise<unknown>;
}

const CASES: RaceCase[] = [
  {
    name: 'sports.adjustScore — the score write, after the game moved tenants',
    model: 'game',
    methods: ['findFirst'],
    run: (client) => {
      const service: any = { client };
      const sponsors = new SponsorsService(service);
      const sports = new SportsService(service, stubRedis, stubSigner, sponsors, stubFlags);
      return new SportsController(sports, sponsors).adjustScore(req(), 'game-a', {
        team: 'home',
        delta: 7,
      });
    },
  },
  {
    name: 'sports.updateStats — the withStatsTx re-read + write, after the game moved tenants',
    model: 'game',
    methods: ['findFirst'],
    run: (client) => {
      const service: any = { client };
      const sponsors = new SponsorsService(service);
      const sports = new SportsService(service, stubRedis, stubSigner, sponsors, stubFlags);
      return new SportsController(sports, sponsors).stats(req(), 'game-a', {
        stats: { fouls: 3 },
      });
    },
  },
  {
    name: 'sports.deleteGame — the delete, after the game moved tenants',
    model: 'game',
    methods: ['findFirst'],
    run: (client) => {
      const service: any = { client };
      const sponsors = new SponsorsService(service);
      const sports = new SportsService(service, stubRedis, stubSigner, sponsors, stubFlags);
      return new SportsController(sports, sponsors).deleteGame(req(), 'game-a');
    },
  },
  {
    name: 'screens.update — the rename write, after the screen moved tenants',
    model: 'screen',
    methods: ['findFirst'],
    run: (client) => {
      const service: any = { client };
      return new ScreensController(
        service,
        stubRedis,
        stubSigner,
        stubLicense,
        stubStripe,
        stubMenu,
      ).update(req(), 'scr-a', { name: 'renamed' });
    },
  },
  {
    name: 'screens.setLocation — the map write, after the screen moved tenants',
    model: 'screen',
    methods: ['findFirst'],
    run: (client) => {
      const service: any = { client };
      return new ScreensController(
        service,
        stubRedis,
        stubSigner,
        stubLicense,
        stubStripe,
        stubMenu,
      ).setLocation(req(), 'scr-a', { address: '1 Somewhere St', latitude: 1, longitude: 2 });
    },
  },
  {
    name: 'screens.setEmergencyContent — the LOCKDOWN write, after the screen moved tenants',
    model: 'screen',
    methods: ['findFirst'],
    run: (client) => {
      const service: any = { client };
      return new ScreensController(
        service,
        stubRedis,
        stubSigner,
        stubLicense,
        stubStripe,
        stubMenu,
      ).setEmergencyContent(req(), 'scr-a', { lockdownAssetUrl: 'https://cdn.test/pwned.png' });
    },
  },
  {
    name: 'screens.remove — the delete, after the screen moved tenants',
    model: 'screen',
    methods: ['findFirst'],
    run: (client) => {
      const service: any = { client };
      return new ScreensController(
        service,
        stubRedis,
        stubSigner,
        stubLicense,
        stubStripe,
        stubMenu,
      ).remove(req(), 'scr-a');
    },
  },
];

describe('SEC-009 — a write may not land on a row that moved tenants after the gate', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const prisma = makeTwoTenantPrisma(dataset());
      const { client, fired } = raceAfterFirstRead(prisma, c.model, c.methods);

      let threw = false;
      try {
        await c.run(client);
      } catch {
        // Fail-closed is the expected outcome. WHICH error does not matter —
        // Prisma's P2025 from a `where` that matched nothing, or the handler's
        // own NotFoundException from an in-transaction re-read that missed.
        threw = true;
      }

      // The race must actually have happened, or this case proves nothing.
      expect(fired()).toBe(true);

      // THE ASSERTION: nothing was written to a row belonging to the other
      // tenant. `foreignTouches` records the tenant as it was at touch time.
      const foreignWrites = prisma
        .foreignTouches(HOME)
        .filter((t) => t.isWrite)
        .map((t) => `${t.model}.${t.method}(${t.rowId})`);
      expect(foreignWrites).toEqual([]);

      // And the request did not report success while writing nothing, which
      // would be its own (quieter) bug: an operator told "renamed" about a row
      // that is no longer theirs.
      expect(threw).toBe(true);
    });
  }
});
