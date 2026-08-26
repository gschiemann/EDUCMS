/**
 * display-manifest tests — the manifest `display` block.
 *
 * This block is part of the ETag-hashed manifest payload and is stored
 * verbatim in the per-screen hot cache, so the tests that matter are about
 * STABILITY and SCOPE, not formatting:
 *
 *   - STABILITY: two builds of the same data must be byte-identical. One
 *     volatile field (a clock read, a "next fire" computation) changes the
 *     hash every poll, kills 304s fleet-wide and re-creates the 25 GB/mo
 *     Supabase egress the cache exists to prevent.
 *   - REGISTRATION: DisplaySchedule / DisplayVendorRecipe must be in
 *     MANIFEST_FED_MODELS (an edit has to bust the cache), and
 *     displayCapabilities / displayCapabilitiesAt must be in
 *     SCREEN_TELEMETRY_ONLY_FIELDS (a device report must NOT).
 *   - SCOPE: the group clause must only be added when the screen actually
 *     has a group — the Prisma `{ screenGroupId: null }` trap that would
 *     otherwise make a groupless screen inherit every screen-pinned row.
 *   - ROUTING (2026-08-25): the scheduled OFF must resolve per PANEL exactly
 *     as the manual POWER_OFF does. A hard window may only reach a proven
 *     power mechanism; everything else — including a screen that has never
 *     reported — gets the same window on the soft array instead. This is the
 *     one and only thing in the block that reads the verdict, and the
 *     registration test above is narrowed to say so rather than to forbid it.
 */

import {
  DISPLAY_MANIFEST_SOFT_SCHEDULES_KEY,
  DISPLAY_MANIFEST_VENDOR_RECIPES_KEY,
  DISPLAY_BLANK_MECHANISMS,
  DISPLAY_POWER_PROVEN_MECHANISMS,
  displayActionSupport,
  resolveDisplayScheduleOffPath,
  type DisplayManifestBlock,
} from '@cms/api-types';

import {
  MANIFEST_FED_MODELS,
  SCREEN_TELEMETRY_ONLY_FIELDS,
  shouldBumpManifestRev,
} from '../screens/manifest-hot-cache';
import {
  _resetDisplayManifestLastGood,
  buildDisplayManifestBlock,
  clearDisplayManifestCache,
  invalidateDisplayManifestBlock,
  routeScheduleWindows,
} from './display-manifest';

/**
 * A full verdict document with `screenBlank` set to `mech`.
 *
 * All six axes are filled because `readStoredDisplayVerdict` treats a
 * partial document as NO verdict at all — a fixture missing one key would
 * silently test the unknown-verdict path while claiming to test a mechanism.
 */
const capsWithBlank = (mech: string) => ({
  verdict: {
    volume: 'audiomanager',
    brightness: 'software-dim',
    screenBlank: mech,
    reboot: 'none',
    hardPowerOff: 'none',
    deviceOwnerPath: 'provisionable-after-factory-reset',
  },
});

/** The only mechanism proven to round-trip real panel power today. */
const PROVEN_CAPS = capsWithBlank(DISPLAY_POWER_PROVEN_MECHANISMS[0]);

/** Every window in the block, whichever array carries it. */
const allWindows = (b: DisplayManifestBlock | null) => [
  ...(b?.schedules ?? []),
  ...(b?.softSchedules ?? []),
];

/**
 * The default fixture screen has NEVER reported — so it is on the soft path,
 * which is the correct default for an unprobed panel. Tests that care about
 * window CONTENT use `allWindows`; tests that care about ROUTING say so.
 */
const SCREEN = { id: 'screen-a', tenantId: 'tenant-a', screenGroupId: null };

/** The same screen, on hardware whose power we have actually proven. */
const PROVEN_SCREEN = { ...SCREEN, displayCapabilities: PROVEN_CAPS };

const scheduleRow = {
  id: 'ds-1',
  screenId: 'screen-a',
  daysOfWeek: [5, 1, 3],
  onTime: '07:00',
  offTime: '22:00',
  timezone: 'America/Chicago',
};

function makePrisma(schedules: any[] = [scheduleRow], recipes: any[] = []) {
  return {
    client: {
      displaySchedule: { findMany: jest.fn().mockResolvedValue(schedules) },
      displayVendorRecipe: { findMany: jest.fn().mockResolvedValue(recipes) },
    },
  };
}

describe('buildDisplayManifestBlock', () => {
  beforeEach(() => {
    clearDisplayManifestCache();
    _resetDisplayManifestLastGood();
  });

  it('emits ONLY stable fields — nothing clock-derived, nothing volatile', async () => {
    const prisma = makePrisma();
    const first = await buildDisplayManifestBlock(prisma, SCREEN, 1);
    clearDisplayManifestCache();
    // Advance real time between builds; a stable block must not notice.
    await new Promise((r) => setTimeout(r, 15));
    const second = await buildDisplayManifestBlock(prisma, SCREEN, 1);

    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
    expect(Object.keys(first as object).sort()).toEqual([
      'brightness',
      'schedules',
      'softSchedules',
      'vendorRecipes',
    ]);
    // Belt and braces: no field anywhere in the serialised block looks like a
    // timestamp or a countdown.
    const serialised = JSON.stringify(first);
    for (const banned of [
      'generatedAt',
      'now',
      'nextFire',
      'msUntil',
      'reportedAt',
      'probedAt',
    ]) {
      expect(serialised).not.toContain(banned);
    }
  });

  it('sorts daysOfWeek so click order cannot flip the ETag', async () => {
    const block = await buildDisplayManifestBlock(makePrisma(), SCREEN, 1);
    expect(allWindows(block)[0].daysOfWeek).toEqual([1, 3, 5]);
  });

  it('reads schedules ordered, so an unordered DB read cannot flip the ETag', async () => {
    const prisma = makePrisma();
    await buildDisplayManifestBlock(prisma, SCREEN, 1);
    expect(
      prisma.client.displaySchedule.findMany.mock.calls[0][0].orderBy,
    ).toEqual({ id: 'asc' });
  });

  it('carries the safety floor, and never allows black on the scheduled path', async () => {
    const block = await buildDisplayManifestBlock(makePrisma(), SCREEN, 1);
    expect(block!.brightness).toEqual({ minSafePercent: 5, allowBlack: false });
  });

  it('ships the recipe CATALOG, not a per-screen selection', async () => {
    // Matching happens on the device against its own Build.* identity. That
    // is what keeps this block independent of Screen.displayCapabilities —
    // which is telemetry-only and must never move the manifest hash.
    const prisma = makePrisma(
      [],
      [
        {
          vendorId: 'goodview-ep6n',
          priority: 10,
          recipe: { vendorId: 'goodview-ep6n' },
        },
        {
          vendorId: 'novastar-taurus',
          priority: 0,
          recipe: { vendorId: 'novastar-taurus' },
        },
      ],
    );
    const block = await buildDisplayManifestBlock(prisma, SCREEN, 1);
    expect(block!.vendorRecipes.map((r) => r.vendorId)).toEqual([
      'goodview-ep6n',
      'novastar-taurus',
    ]);
  });

  // ── P0-3 (2026-08-13 verify wave) — THE WIRE NAME ────────────────────
  // The server emitted `display.vendorRecipes`; the device's
  // DisplayConfigParser read `display.recipe`. Nobody had agreed a name, so
  // every recipe a SUPER_ADMIN saved reached the glass as null and
  // BRIGHTNESS fell to software dim fleet-wide with no error anywhere.
  // The agreed name is `vendorRecipes` — forced, not chosen: serving ONE
  // pre-matched recipe would require the screen's Build.* identity, which
  // lives only in the telemetry-only Screen.displayCapabilities column.
  it('emits the catalog under the AGREED key name, sorted most-specific-first', async () => {
    const prisma = makePrisma(
      [],
      [{ vendorId: 'goodview-ep6n', priority: 10, recipe: { vendorId: 'x' } }],
    );
    const block: any = await buildDisplayManifestBlock(prisma, SCREEN, 1);
    expect(DISPLAY_MANIFEST_VENDOR_RECIPES_KEY).toBe('vendorRecipes');
    expect(
      Object.prototype.hasOwnProperty.call(
        block,
        DISPLAY_MANIFEST_VENDOR_RECIPES_KEY,
      ),
    ).toBe(true);
    // The device takes the FIRST matching row, so the ORDER is part of the
    // contract, not a nicety.
    expect(
      prisma.client.displayVendorRecipe.findMany.mock.calls[0][0].orderBy,
    ).toEqual([{ priority: 'desc' }, { vendorId: 'asc' }]);
    expect(block[DISPLAY_MANIFEST_VENDOR_RECIPES_KEY][0]).toEqual({
      vendorId: 'goodview-ep6n',
      priority: 10,
      recipe: { vendorId: 'x' },
    });
  });

  describe('precedence — a per-screen window overrides its group (2026-08-13)', () => {
    const groupRow = {
      id: 'ds-group',
      screenId: null,
      daysOfWeek: [1, 2, 3, 4, 5],
      onTime: '07:00',
      offTime: '22:00',
      timezone: 'America/Chicago',
    };
    const lateEventRow = {
      id: 'ds-screen',
      screenId: 'screen-a',
      daysOfWeek: [5],
      onTime: '07:00',
      offTime: '23:30',
      timezone: 'America/Chicago',
    };
    const GROUPED = { ...SCREEN, screenGroupId: 'group-a' };

    it('suppresses the group rows entirely when a screen row exists', async () => {
      // THE BUG: both rows used to be concatenated with nothing saying which
      // was more specific, so the player armed both and the group's 22:00
      // blank killed the board 90 minutes into a 23:30 event.
      const block = await buildDisplayManifestBlock(
        makePrisma([groupRow, lateEventRow]),
        GROUPED,
        1,
      );
      expect(allWindows(block).map((s) => s.id)).toEqual(['ds-screen']);
      expect(allWindows(block)[0]).toMatchObject({
        offTime: '23:30',
        scope: 'screen',
      });
    });

    it('inherits the group rows when the screen has none of its own', async () => {
      const block = await buildDisplayManifestBlock(
        makePrisma([groupRow]),
        GROUPED,
        1,
      );
      expect(allWindows(block).map((s) => s.id)).toEqual(['ds-group']);
      expect(allWindows(block)[0].scope).toBe('group');
    });

    it('keeps EVERY screen row when several exist — precedence is scope, not "one wins"', async () => {
      const second = { ...lateEventRow, id: 'ds-screen-2', daysOfWeek: [6] };
      const block = await buildDisplayManifestBlock(
        makePrisma([groupRow, lateEventRow, second]),
        GROUPED,
        1,
      );
      expect(allWindows(block).map((s) => s.id).sort()).toEqual([
        'ds-screen',
        'ds-screen-2',
      ]);
      expect(allWindows(block).every((s) => s.scope === 'screen')).toBe(true);
    });

    it('never emits the precedence input itself — screenId stays out of the manifest', async () => {
      const block = await buildDisplayManifestBlock(
        makePrisma([groupRow, lateEventRow]),
        GROUPED,
        1,
      );
      expect(Object.keys(allWindows(block)[0]).sort()).toEqual([
        'daysOfWeek',
        'id',
        'offTime',
        'onTime',
        'scope',
        'timezone',
      ]);
    });
  });

  describe('target scoping', () => {
    it('scopes to the tenant and to this screen only when it has no group', async () => {
      const prisma = makePrisma();
      await buildDisplayManifestBlock(prisma, SCREEN, 1);
      const where =
        prisma.client.displaySchedule.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe('tenant-a');
      expect(where.isActive).toBe(true);
      // The trap: `{ screenGroupId: null }` matches EVERY screen-pinned row
      // (they all carry a null group), so a groupless screen would inherit
      // other screens' windows. The clause must simply be absent.
      expect(where.OR).toEqual([{ screenId: 'screen-a' }]);
    });

    it('adds the group clause only when the screen is actually in a group', async () => {
      const prisma = makePrisma();
      await buildDisplayManifestBlock(
        prisma,
        { ...SCREEN, screenGroupId: 'group-a' },
        1,
      );
      expect(
        prisma.client.displaySchedule.findMany.mock.calls[0][0].where.OR,
      ).toEqual([{ screenId: 'screen-a' }, { screenGroupId: 'group-a' }]);
    });

    it('returns null for an unpaired screen rather than an empty block', async () => {
      const prisma = makePrisma();
      expect(
        await buildDisplayManifestBlock(
          prisma,
          { ...SCREEN, tenantId: null },
          1,
        ),
      ).toBeNull();
      expect(prisma.client.displaySchedule.findMany).not.toHaveBeenCalled();
    });
  });

  describe('fail-safe (this builder is reachable from the EMERGENCY branch)', () => {
    it('never throws — a pool blip must not 500 a life-safety manifest', async () => {
      const prisma = makePrisma();
      prisma.client.displaySchedule.findMany.mockRejectedValue(
        new Error('pool timeout'),
      );
      await expect(
        buildDisplayManifestBlock(prisma, SCREEN, 1),
      ).resolves.toBeNull();
    });

    it('serves the last known-good block rather than an empty one', async () => {
      // An empty block could read as "this screen has no display schedule"
      // and disarm its overnight blank/wake alarms. Known-good beats nothing.
      const prisma = makePrisma();
      const good = await buildDisplayManifestBlock(prisma, SCREEN, 1);
      expect(allWindows(good)).toHaveLength(1);

      prisma.client.displaySchedule.findMany.mockRejectedValue(
        new Error('pool timeout'),
      );
      const degraded = await buildDisplayManifestBlock(prisma, SCREEN, 2);
      expect(degraded).toEqual(good);
    });

    it('does not memoise a degraded result — the next poll retries', async () => {
      const prisma = makePrisma();
      prisma.client.displaySchedule.findMany.mockRejectedValueOnce(
        new Error('pool timeout'),
      );
      expect(await buildDisplayManifestBlock(prisma, SCREEN, 1)).toBeNull();
      const recovered = await buildDisplayManifestBlock(prisma, SCREEN, 1);
      expect(allWindows(recovered)).toHaveLength(1);
    });

    it('survives a total absence of the display tables (older DB, pre-migration)', async () => {
      const prisma = { client: {} } as any;
      await expect(
        buildDisplayManifestBlock(prisma, SCREEN, 1),
      ).resolves.toBeNull();
    });
  });

  describe('memoisation', () => {
    it('serves the memo on a repeat build at the same content rev', async () => {
      const prisma = makePrisma();
      await buildDisplayManifestBlock(prisma, SCREEN, 7);
      await buildDisplayManifestBlock(prisma, SCREEN, 7);
      // One query pair, not two — this is what keeps the UNCACHED emergency
      // and scoreboard manifest branches from paying a DB read every poll.
      expect(prisma.client.displaySchedule.findMany).toHaveBeenCalledTimes(1);
    });

    it('rebuilds as soon as the manifest content rev moves', async () => {
      const prisma = makePrisma();
      await buildDisplayManifestBlock(prisma, SCREEN, 7);
      await buildDisplayManifestBlock(prisma, SCREEN, 8);
      expect(prisma.client.displaySchedule.findMany).toHaveBeenCalledTimes(2);
    });
  });
});

describe('manifest cache registration', () => {
  it('busts the manifest cache on a DisplaySchedule / DisplayVendorRecipe write', () => {
    // Without this an operator's schedule edit is invisible to players for up
    // to the 30-minute armed TTL, which looks exactly like a broken feature.
    expect(MANIFEST_FED_MODELS.has('DisplaySchedule')).toBe(true);
    expect(MANIFEST_FED_MODELS.has('DisplayVendorRecipe')).toBe(true);
    expect(shouldBumpManifestRev('DisplaySchedule', 'create', null)).toBe(true);
    expect(
      shouldBumpManifestRev('DisplaySchedule', 'updateMany', ['onTime']),
    ).toBe(true);
    expect(shouldBumpManifestRev('DisplayVendorRecipe', 'upsert', null)).toBe(
      true,
    );
  });

  it('does NOT bust the cache on a device capability report', () => {
    // The report writes exactly these two columns (asserted in
    // display.service.spec.ts). If they ever leave this set, every screen's
    // boot-time report clears the process-wide manifest cache and the
    // 25 GB/mo Supabase egress comes straight back.
    expect(SCREEN_TELEMETRY_ONLY_FIELDS.has('displayCapabilities')).toBe(true);
    expect(SCREEN_TELEMETRY_ONLY_FIELDS.has('displayCapabilitiesAt')).toBe(
      true,
    );
    expect(
      shouldBumpManifestRev('Screen', 'update', [
        'displayCapabilities',
        'displayCapabilitiesAt',
      ]),
    ).toBe(false);
  });

  // ── THE INVARIANT, NARROWED (2026-08-25) ────────────────────────────
  // This used to assert the block was byte-identical for ANY verdict, and
  // that absolute reading is what left the scheduled off ungated: the
  // manifest armed a device-admin blank the manual path refuses, and a G43
  // latched dark. The verdict now decides EXACTLY ONE thing — which array a
  // window rides — and this test pins that it decides nothing else, which is
  // what keeps `displayCapabilities` legitimately on the telemetry list
  // (paired with the targeted per-screen invalidation on verdict change).
  it("varies with the verdict in EXACTLY ONE way: which array carries the windows", async () => {
    const recipes = [
      { vendorId: 'goodview-ep6n', priority: 10, recipe: { vendorId: 'x' } },
    ];
    const unreported = await buildDisplayManifestBlock(
      makePrisma([scheduleRow], recipes),
      SCREEN,
      1,
    );
    clearDisplayManifestCache();
    const proven = await buildDisplayManifestBlock(
      makePrisma([scheduleRow], recipes),
      {
        ...SCREEN,
        displayCapabilities: PROVEN_CAPS,
        displayCapabilitiesAt: new Date('2026-08-13T00:00:00Z'),
      } as any,
      1,
    );

    // Everything EXCEPT the two schedule arrays is byte-identical.
    const rest = (b: any) => {
      const { schedules, softSchedules, ...others } = b;
      return JSON.stringify(others);
    };
    expect(rest(proven)).toEqual(rest(unreported));

    // And the arrays hold the SAME windows, just swapped.
    expect(proven!.schedules).toEqual(unreported!.softSchedules);
    expect(proven!.softSchedules).toEqual([]);
    expect(unreported!.schedules).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// The 2026-08-25 scheduled-off incident
// ─────────────────────────────────────────────────────────────────────

describe('scheduled OFF routing — same gate as the manual POWER_OFF', () => {
  beforeEach(() => {
    clearDisplayManifestCache();
    _resetDisplayManifestLastGood();
  });

  // The whole point of `resolveDisplayScheduleOffPath` delegating to
  // `displayActionSupport` is that they cannot drift. Prove it over the FULL
  // mechanism vocabulary rather than the two we happen to have in the field,
  // so a mechanism added next year is covered the day it is added.
  it.each([...DISPLAY_BLANK_MECHANISMS])(
    'agrees with the manual gate for screenBlank=%s',
    (mech) => {
      const verdict = capsWithBlank(mech).verdict as any;
      const manualAllowsHardPower = displayActionSupport(
        'POWER_OFF',
        verdict,
      ).supported;
      expect(resolveDisplayScheduleOffPath(verdict)).toBe(
        manualAllowsHardPower ? 'hard-power' : 'soft-blank',
      );
    },
  );

  it('a screen that has never reported gets the SOFT path', () => {
    // The C4 hole, verbatim from displayActionSupport's own header: "a screen
    // that has never reported still receives and executes schedule blanks
    // (the manifest does not consult the verdict)". It does now.
    expect(resolveDisplayScheduleOffPath(null)).toBe('soft-blank');
    expect(resolveDisplayScheduleOffPath(undefined)).toBe('soft-blank');
  });

  // One case per mechanism CLASS the fleet actually exhibits, named for the
  // panel that exhibits it, so a regression reads as "the G43 is armed hard
  // again" rather than as an enum change.
  const FIELD_PANELS: Array<[string, string | null, 'hard-power' | 'soft-blank']> = [
    ['vendor-recipe (a proven backlight node)', 'vendor-recipe', 'hard-power'],
    ['device-admin — G43 / L55VEC / M43 / A-Frame', 'device-admin', 'soft-blank'],
    ['device-owner', 'device-owner', 'soft-blank'],
    ['screen-timeout — GUQ55', 'screen-timeout', 'soft-blank'],
    ['software-dim — TC22', 'software-dim', 'soft-blank'],
    ['none', 'none', 'soft-blank'],
    ['NO VERDICT AT ALL — a brand-new panel', null, 'soft-blank'],
  ];

  it.each(FIELD_PANELS)('%s → %s', async (_label, mech, expected) => {
    clearDisplayManifestCache();
    const block = await buildDisplayManifestBlock(
      makePrisma(),
      { ...SCREEN, displayCapabilities: mech ? capsWithBlank(mech) : null },
      1,
    );
    // The window itself is present either way — the operator's schedule is
    // never silently dropped, only routed.
    expect(allWindows(block)).toHaveLength(1);
    if (expected === 'hard-power') {
      expect(block!.schedules).toHaveLength(1);
      expect(block!.softSchedules).toEqual([]);
    } else {
      expect(block!.schedules).toEqual([]);
      expect(block!.softSchedules).toHaveLength(1);
    }
  });

  it('routes a GROUP schedule per MEMBER, not per group', async () => {
    // THE INCIDENT'S OWN SHAPE. One group-level 07:00/14:45 row spanning a
    // proven panel and four device-admin panels. Per-group routing would
    // have to pick one answer for all five; per-member gives each panel the
    // execution its own hardware can survive.
    const groupRow = { ...scheduleRow, id: 'ds-group', screenId: null };
    const member = (id: string, mech: string | null) => ({
      id,
      tenantId: 'tenant-a',
      screenGroupId: 'group-a',
      displayCapabilities: mech ? capsWithBlank(mech) : null,
    });

    const blocks = [];
    for (const m of [
      member('proven', 'vendor-recipe'),
      member('g43', 'device-admin'),
      member('guq55', 'screen-timeout'),
      member('never-reported', null),
    ]) {
      clearDisplayManifestCache();
      blocks.push(
        await buildDisplayManifestBlock(makePrisma([groupRow]), m, 1),
      );
    }
    const [proven, g43, guq55, unreported] = blocks;

    expect(proven!.schedules.map((s) => s.id)).toEqual(['ds-group']);
    expect(proven!.softSchedules).toEqual([]);
    for (const soft of [g43, guq55, unreported]) {
      expect(soft!.schedules).toEqual([]);
      expect(soft!.softSchedules.map((s) => s.id)).toEqual(['ds-group']);
    }
    // Same row, same scope, on every panel — only the execution differs.
    expect(g43!.softSchedules[0]).toEqual(proven!.schedules[0]);
    expect(proven!.schedules[0].scope).toBe('group');
  });

  it('the scheduled ON reverses whichever path the OFF took', () => {
    // Structural, and that is the strongest form available: on/off are two
    // fields of ONE row, and a row goes into exactly one array. There is no
    // representable state in which the off is hard and the on is soft.
    const windows = [
      {
        id: 'ds-1',
        daysOfWeek: [1],
        onTime: '07:00',
        offTime: '14:45',
        timezone: 'America/Los_Angeles',
        scope: 'screen' as const,
      },
    ];
    for (const mech of [...DISPLAY_BLANK_MECHANISMS, null]) {
      const routed = routeScheduleWindows(
        windows,
        mech ? capsWithBlank(mech) : null,
      );
      const union = [...routed.schedules, ...routed.softSchedules];
      expect(union).toEqual(windows);
      // Disjoint: never armed twice, never dropped.
      expect(routed.schedules.length * routed.softSchedules.length).toBe(0);
      for (const w of union) {
        expect(w.onTime).toBe('07:00');
        expect(w.offTime).toBe('14:45');
      }
    }
  });

  it('serves the routing for THIS request even on a memo hit', async () => {
    // The memo holds the DB read, never the finished block. If it held the
    // block, a screen whose verdict just dropped to device-admin would keep
    // being served its old HARD window until the TTL expired.
    const prisma = makePrisma();
    const hard = await buildDisplayManifestBlock(prisma, PROVEN_SCREEN, 5);
    expect(hard!.schedules).toHaveLength(1);

    const soft = await buildDisplayManifestBlock(
      prisma,
      { ...SCREEN, displayCapabilities: capsWithBlank('device-admin') },
      5,
    );
    expect(soft!.schedules).toEqual([]);
    expect(soft!.softSchedules).toHaveLength(1);
    // Still one query pair — the memo did its job; only the routing moved.
    expect(prisma.client.displaySchedule.findMany).toHaveBeenCalledTimes(1);
  });

  it('re-routes the DB-failure fail-safe too, instead of replaying the old block', async () => {
    // lastGood holds unrouted parts for exactly this reason: a pool blip on
    // the poll after a verdict change must not resurrect a hard window.
    const prisma = makePrisma();
    await buildDisplayManifestBlock(prisma, PROVEN_SCREEN, 1);
    prisma.client.displaySchedule.findMany.mockRejectedValue(
      new Error('pool timeout'),
    );
    const degraded = await buildDisplayManifestBlock(
      prisma,
      { ...SCREEN, displayCapabilities: capsWithBlank('device-admin') },
      2,
    );
    expect(allWindows(degraded)).toHaveLength(1);
    expect(degraded!.schedules).toEqual([]);
  });

  it('exposes a per-screen memo invalidation for the verdict-change hook', async () => {
    const prisma = makePrisma();
    await buildDisplayManifestBlock(prisma, SCREEN, 9);
    invalidateDisplayManifestBlock(SCREEN.id);
    await buildDisplayManifestBlock(prisma, SCREEN, 9);
    expect(prisma.client.displaySchedule.findMany).toHaveBeenCalledTimes(2);
  });

  it('names the soft key once, and the old APK does not know it', () => {
    expect(DISPLAY_MANIFEST_SOFT_SCHEDULES_KEY).toBe('softSchedules');
  });
});
