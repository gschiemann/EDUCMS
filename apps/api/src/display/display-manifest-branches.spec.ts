/**
 * The `display` block must reach the player on EVERY manifest branch.
 *
 * This drives the REAL ScreensController.getManifest handler rather than
 * asserting on the builder in isolation — the repo has been burned by edits
 * that type-checked and shipped into a code path nothing actually renders
 * (CLAUDE.md "VERIFY THE RENDER TREE"). The manifest has four exits and
 * three of them return BEFORE the normal payload is assembled:
 *
 *   emergency → sports scoreboard → hot-cache hit → empty → full
 *
 * A screen sitting in emergency or scoreboard mode that received a manifest
 * with no `display` block could disarm its local blank/wake alarms and stay
 * dark after the incident. So the block is duplicated into those branches
 * exactly like `gpio` is, and these tests are what keeps it that way.
 */

import { ScreensController } from '../screens/screens.controller';
import {
  invalidateTenantState,
  resetManifestCacheForTests,
} from '../screens/manifest-hot-cache';
import {
  _resetDisplayManifestLastGood,
  clearDisplayManifestCache,
} from './display-manifest';

const TENANT = 'tenant-a';
const SCREEN_ID = 'screen-a';

/** A GROUP-level window (screenId null) — see resolveSchedulePrecedence. */
const scheduleRow = {
  id: 'ds-1',
  screenId: null,
  daysOfWeek: [1, 2, 3, 4, 5],
  onTime: '07:00',
  offTime: '22:00',
  timezone: 'America/Chicago',
};

/** Minimal content schedule that reaches the FULL (ETag-bearing) branch. */
const contentSchedule = {
  id: 'sch-1',
  playlistId: 'pl-1',
  daysOfWeek: null,
  timeStart: null,
  timeEnd: null,
  mutedOverride: null,
  playlist: {
    id: 'pl-1',
    name: 'Lobby',
    template: null,
    items: [
      {
        id: 'pi-1',
        assetId: 'as-1',
        durationMs: 10_000,
        sequenceOrder: 0,
        transitionType: null,
        muted: true,
        asset: {
          fileUrl: 'https://cdn/x.png',
          fileHash: 'h',
          fileSize: 10,
          mimeType: 'image/png',
        },
      },
    ],
  },
};

interface Opts {
  emergency?: boolean;
  activeBoardGameId?: string | null;
  contentSchedules?: any[];
  /** `Screen.displayCapabilities` — decides hard vs soft scheduled off. */
  displayCapabilities?: unknown;
}

function makePrisma(opts: Opts = {}) {
  const tenantRow = {
    id: TENANT,
    name: 'Tenant A',
    parentId: null,
    archivedAt: null,
    emergencyStatus: opts.emergency ? 'LOCKDOWN' : 'INACTIVE',
    emergencyPlaylistId: null,
    panicLockdownPlaylistId: null,
  };
  const screenRow = {
    id: SCREEN_ID,
    tenantId: TENANT,
    screenGroupId: null,
    status: 'ONLINE',
    resolution: '1920x1080',
    orientation: 'LANDSCAPE',
    canvasW: null,
    canvasH: null,
    repeats: 1,
    config: null,
    hardwareModel: null,
    activeBoardGameId: opts.activeBoardGameId ?? null,
    activeBoardSurface: null,
    syncOffsetMs: 0,
    screenGroup: null,
    tenant: { name: 'Tenant A' },
    // 2026-08-25 — the live verdict routes this screen's windows onto the
    // HARD or the SOFT array. Default null = "never reported", which is the
    // soft path, which is what an unprobed screen must get on EVERY branch.
    displayCapabilities: opts.displayCapabilities ?? null,
  };

  return {
    client: {
      screen: {
        findUnique: jest.fn(async () => ({ ...screenRow })),
        update: jest.fn(async () => ({})),
      },
      tenant: {
        findUnique: jest.fn(async () => ({ ...tenantRow })),
        findMany: jest.fn(async () => []),
      },
      screenEmergencyOverride: { findUnique: jest.fn(async () => null) },
      schedule: {
        findMany: jest.fn(async () => opts.contentSchedules ?? []),
        findFirst: jest.fn(async () => null),
      },
      playlist: {
        findUnique: jest.fn(async () => null),
        findFirst: jest.fn(async () => null),
      },
      game: {
        findFirst: jest.fn(async () =>
          opts.activeBoardGameId ? { id: opts.activeBoardGameId } : null,
        ),
      },
      emergencyMessage: { findMany: jest.fn(async () => []) },
      auditLog: { create: jest.fn(async () => ({})) },
      displaySchedule: { findMany: jest.fn(async () => [scheduleRow]) },
      displayVendorRecipe: {
        findMany: jest.fn(async () => [
          {
            vendorId: 'goodview-ep6n',
            priority: 10,
            recipe: { vendorId: 'goodview-ep6n' },
          },
        ]),
      },
      $transaction: jest.fn((x: any) =>
        typeof x === 'function' ? x({}) : Promise.all(x),
      ),
    },
  } as any;
}

/** Drive the real handler and capture what it emitted. */
async function manifestFor(
  prisma: any,
): Promise<{ status: number; body: any }> {
  const controller = new ScreensController(
    prisma,
    { publish: jest.fn(), sismember: jest.fn(async () => false) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  let body: any = null;
  let status = 200;
  const res: any = {
    setHeader: jest.fn(),
    status: jest.fn((s: number) => {
      status = s;
      return res;
    }),
    json: jest.fn((p: any) => {
      body = p;
      return res;
    }),
    send: jest.fn(() => res),
  };
  // No req.user → the caller-scoping block is skipped, which reads exactly as
  // the screen's own device would after auth.
  await controller.getManifest(SCREEN_ID, { headers: {} } as any, res);
  return { status, body };
}

/** `screenId` is a precedence input, NOT a manifest field — it is not emitted. */
const { screenId: _omitted, ...scheduleManifestFields } = scheduleRow;

/**
 * The block as it must reach the wire, for a screen whose scheduled OFF
 * resolves to `path`.
 *
 * The window rows are IDENTICAL either way — only which array carries them
 * moves. That is the whole shape of the 2026-08-25 fix: same schedule, two
 * executions, chosen by the panel's proven power mechanism.
 */
const expectedBlock = (path: 'hard-power' | 'soft-blank') => ({
  schedules:
    path === 'hard-power' ? [{ ...scheduleManifestFields, scope: 'group' }] : [],
  softSchedules:
    path === 'soft-blank' ? [{ ...scheduleManifestFields, scope: 'group' }] : [],
  brightness: { minSafePercent: 5, allowBlack: false },
  vendorRecipes: [
    {
      vendorId: 'goodview-ep6n',
      priority: 10,
      recipe: { vendorId: 'goodview-ep6n' },
    },
  ],
});

/** An unprobed screen — the default fixture — is on the soft path. */
const EXPECTED_BLOCK = expectedBlock('soft-blank');

/** A verdict whose `screenBlank` is the ONE proven power mechanism. */
const PROVEN_POWER_CAPS = {
  verdict: {
    volume: 'audiomanager',
    brightness: 'vendor-recipe',
    screenBlank: 'vendor-recipe',
    reboot: 'none',
    hardPowerOff: 'none',
    deviceOwnerPath: 'provisionable-after-factory-reset',
  },
};

describe('manifest `display` block — every branch', () => {
  beforeEach(() => {
    // Every one of these caches is module-level and survives between tests —
    // the tenant emergency snapshot in particular, or test 1's LOCKDOWN
    // leaks into the branch the later tests are trying to reach.
    resetManifestCacheForTests();
    invalidateTenantState(TENANT);
    clearDisplayManifestCache();
    _resetDisplayManifestLastGood();
  });

  it('rides the EMERGENCY manifest — a locked-down screen must not disarm its alarms', async () => {
    const prisma = makePrisma({ emergency: true });
    const { body } = await manifestFor(prisma);
    expect(body.isEmergency).toBe(true);
    expect(body.display).toEqual(EXPECTED_BLOCK);
  });

  it('rides the SPORTS scoreboard manifest', async () => {
    const prisma = makePrisma({ activeBoardGameId: 'game-1' });
    const { body } = await manifestFor(prisma);
    expect(body.display).toEqual(EXPECTED_BLOCK);
  });

  it('rides the EMPTY (no content scheduled) manifest', async () => {
    // "No playlist assigned" is not "no display schedule" — the panel still
    // has to power down overnight.
    const prisma = makePrisma();
    const { body } = await manifestFor(prisma);
    expect(body.emptyReason).toBe('NO_SCHEDULE');
    expect(body.display).toEqual(EXPECTED_BLOCK);
  });

  it('is hashed into the ETag on the normal branch, so an edit busts the 304', async () => {
    // The FULL branch is the one that carries an ETag — the empty branch
    // returns a static `hash: 'empty'` with no ETag header at all, so a
    // display-schedule edit there is delivered by the cache bust
    // (DisplaySchedule ∈ MANIFEST_FED_MODELS) rather than by hash change.
    const first = await manifestFor(
      makePrisma({ contentSchedules: [contentSchedule] }),
    );
    expect(first.body.playlists).toHaveLength(1);
    const firstHash = first.body.hash;
    expect(typeof firstHash).toBe('string');
    expect(first.body.display).toEqual(EXPECTED_BLOCK);

    // Same data → same hash (a volatile field here would break every 304 in
    // the fleet and re-create the 25 GB/mo Supabase egress).
    resetManifestCacheForTests();
    invalidateTenantState(TENANT);
    clearDisplayManifestCache();
    const repeat = await manifestFor(
      makePrisma({ contentSchedules: [contentSchedule] }),
    );
    expect(repeat.body.hash).toBe(firstHash);

    // Changed window → different hash, so screens pick it up on next poll.
    resetManifestCacheForTests();
    invalidateTenantState(TENANT);
    clearDisplayManifestCache();
    const edited = makePrisma({ contentSchedules: [contentSchedule] });
    edited.client.displaySchedule.findMany = jest.fn(async () => [
      { ...scheduleRow, offTime: '23:00' },
    ]);
    const after = await manifestFor(edited);
    expect(after.body.hash).not.toBe(firstHash);
  });

  // ── 2026-08-25, the scheduled-off incident ───────────────────────────
  // The manual POWER_OFF gate refused `device-admin` that afternoon; the
  // SCHEDULED off did not consult it at all, drove lockNow() through the
  // native chain, and latched a G43 dark. The routing therefore has to hold
  // on EVERY manifest exit — an emergency or a pushed scoreboard must not be
  // a way for a hard window to reach an unproven panel.
  describe('the scheduled OFF is routed by the panel, on every branch', () => {
    const branches: Array<[string, Opts]> = [
      ['EMERGENCY', { emergency: true }],
      ['SPORTS scoreboard', { activeBoardGameId: 'game-1' }],
      ['EMPTY', {}],
      ['FULL', { contentSchedules: [contentSchedule] }],
    ];

    for (const [label, opts] of branches) {
      it(`${label}: an UNPROVEN / unreported panel gets NO hard window`, async () => {
        const { body } = await manifestFor(makePrisma(opts));
        expect(body.display).toEqual(expectedBlock('soft-blank'));
        // The property every old-APK safety argument rests on: the field
        // that APK reads is empty, so it arms nothing.
        expect(body.display.schedules).toEqual([]);
      });

      it(`${label}: a PROVEN vendor-recipe panel keeps real panel power`, async () => {
        const { body } = await manifestFor(
          makePrisma({ ...opts, displayCapabilities: PROVEN_POWER_CAPS }),
        );
        expect(body.display).toEqual(expectedBlock('hard-power'));
        expect(body.display.softSchedules).toEqual([]);
      });
    }

    it('an admin-lock panel — the exact G43/A-Frame verdict — is soft', async () => {
      const { body } = await manifestFor(
        makePrisma({
          displayCapabilities: {
            verdict: {
              volume: 'audiomanager',
              brightness: 'settings',
              screenBlank: 'device-admin',
              reboot: 'none',
              hardPowerOff: 'none',
              deviceOwnerPath: 'blocked-other-owner',
            },
          },
        }),
      );
      expect(body.display.schedules).toEqual([]);
      expect(body.display.softSchedules).toHaveLength(1);
    });

    it('a verdict change moves the SAME window between the arrays', async () => {
      // Both directions, because the recovery direction matters too: a panel
      // that earns a proven mechanism must actually start using it.
      const soft = await manifestFor(makePrisma());
      resetManifestCacheForTests();
      invalidateTenantState(TENANT);
      clearDisplayManifestCache();
      const hard = await manifestFor(
        makePrisma({ displayCapabilities: PROVEN_POWER_CAPS }),
      );
      expect(soft.body.display.softSchedules).toEqual(
        hard.body.display.schedules,
      );
      expect(soft.body.display.schedules).toEqual([]);
      expect(hard.body.display.softSchedules).toEqual([]);
    });
  });
});
