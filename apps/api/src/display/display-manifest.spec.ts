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
 */

import {
  MANIFEST_FED_MODELS,
  SCREEN_TELEMETRY_ONLY_FIELDS,
  shouldBumpManifestRev,
} from '../screens/manifest-hot-cache';
import {
  _resetDisplayManifestLastGood,
  buildDisplayManifestBlock,
  clearDisplayManifestCache,
} from './display-manifest';

const SCREEN = { id: 'screen-a', tenantId: 'tenant-a', screenGroupId: null };

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
    expect(block!.schedules[0].daysOfWeek).toEqual([1, 3, 5]);
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
      expect(block!.schedules.map((s) => s.id)).toEqual(['ds-screen']);
      expect(block!.schedules[0]).toMatchObject({
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
      expect(block!.schedules.map((s) => s.id)).toEqual(['ds-group']);
      expect(block!.schedules[0].scope).toBe('group');
    });

    it('keeps EVERY screen row when several exist — precedence is scope, not "one wins"', async () => {
      const second = { ...lateEventRow, id: 'ds-screen-2', daysOfWeek: [6] };
      const block = await buildDisplayManifestBlock(
        makePrisma([groupRow, lateEventRow, second]),
        GROUPED,
        1,
      );
      expect(block!.schedules.map((s) => s.id).sort()).toEqual([
        'ds-screen',
        'ds-screen-2',
      ]);
      expect(block!.schedules.every((s) => s.scope === 'screen')).toBe(true);
    });

    it('never emits the precedence input itself — screenId stays out of the manifest', async () => {
      const block = await buildDisplayManifestBlock(
        makePrisma([groupRow, lateEventRow]),
        GROUPED,
        1,
      );
      expect(Object.keys(block!.schedules[0]).sort()).toEqual([
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
      expect(good!.schedules).toHaveLength(1);

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
      expect(recovered!.schedules).toHaveLength(1);
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
});
