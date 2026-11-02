/**
 * THE OWNER'S FLEET PUSH RULES at the doors that send a Player update to MORE
 * THAN ONE screen at once (2026-10-31; the rules themselves are pure, in
 * player-ota/fleet-push-policy.ts):
 *
 *   POST /api/v1/screens/bulk/update   "Send update" to a selection or a group
 *                                      (screens/bulk/screens-bulk.controller.ts)
 *   POST /api/v1/screens/force-update  every screen of the location in one
 *                                      write (screens.controller.ts)
 *
 * One hardware class per request, and 22:00–06:00 in every target screen's
 * own time zone (screens/screen-time-zone.ts — never the device's). One
 * screen is exempt. The explicit `overrideMassPushRules: true` on the request
 * (the dashboard never sends it) sets both aside; the caller writes the rules
 * it set aside to its audit rows. Both doors answer with the same codes
 * (`BULK_UPDATE_*`, words in screens/bulk/bulk-screen-actions.ts), which the
 * dashboard words in en / es / zh.
 *
 * FAILURE DIRECTION: closed. A screen whose facts cannot be read proves
 * neither a class nor a zone and refuses the set; a read that throws throws,
 * and nothing is marked.
 */
import { HttpException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { evaluateHardwareClasses, evaluateOffHours, type MassPushRule } from '../player-ota/fleet-push-policy';
import {
  BulkInputError,
  bulkHardwareRefusal,
  bulkOffHoursRefusal,
  parseMassPushOverride,
  type BulkRuleRefusal,
} from './bulk/bulk-screen-actions';
import { manifestTimeZone } from './screen-time-zone';

/** More screens than this cannot all be read at once, so cannot be shown to be one class. */
export const UPDATE_RULES_READ_CAP = 1_000;

/** What the rules read for one screen: its hardware class and its effective time zone. */
const RULE_FACTS_SELECT = {
  id: true,
  name: true,
  hardwareModel: true,
  lastVideoReport: true,
  timezone: true,
  latitude: true,
  longitude: true,
  screenGroup: { select: { latitude: true, longitude: true } },
  tenant: { select: { timezone: true, latitude: true, longitude: true } },
} as const;

interface RuleFacts {
  id: string;
  name?: string | null;
  hardwareModel?: string | null;
  lastVideoReport?: unknown;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  screenGroup?: { latitude?: number | null; longitude?: number | null } | null;
  tenant?: { timezone?: string | null; latitude?: number | null; longitude?: number | null } | null;
}

/** `overrideMassPushRules` on a request body: absent = false; anything but a boolean is a 400. */
export function updatePushOverride(body: unknown): boolean {
  try {
    return parseMassPushOverride(body as Record<string, unknown> | null | undefined);
  } catch (e) {
    if (e instanceof BulkInputError) throw new HttpException({ code: e.code, message: e.message }, e.status);
    throw e;
  }
}

/**
 * Run the rules over the screens an update will MARK — `screens` (the bulk
 * route passes the ones it would reach; a skipped screen installs nothing), or
 * `'all'` for every screen of the tenant, which is exactly what
 * POST /screens/force-update marks. Throws the first rule's refusal; with the
 * override, returns the rules it set aside ([] = none needed).
 */
export async function enforceUpdatePushRules(
  prisma: PrismaService,
  tenantId: string,
  screens: ReadonlyArray<{ id: string; name?: string | null }> | 'all',
  opts: { override: boolean; now?: Date },
): Promise<MassPushRule[]> {
  let facts: RuleFacts[];
  let incomplete = false;
  if (screens === 'all') {
    const rows = (await prisma.client.screen.findMany({
      where: { tenantId },
      select: RULE_FACTS_SELECT,
      orderBy: [{ id: 'asc' }],
      take: UPDATE_RULES_READ_CAP + 1,
    })) as RuleFacts[];
    incomplete = rows.length > UPDATE_RULES_READ_CAP;
    facts = rows.slice(0, UPDATE_RULES_READ_CAP);
  } else {
    if (screens.length <= 1) return [];
    const rows = (await prisma.client.screen.findMany({
      where: { id: { in: screens.map((s) => s.id) }, tenantId },
      select: RULE_FACTS_SELECT,
    })) as RuleFacts[];
    const byId = new Map(rows.map((f) => [f.id, f]));
    facts = screens.map((s) => byId.get(s.id) ?? { id: s.id, name: s.name ?? null });
  }
  if (facts.length <= 1 && !incomplete) return [];
  const broken: Array<[MassPushRule, BulkRuleRefusal]> = [];
  const hardware = evaluateHardwareClasses(facts, { incomplete });
  if (!hardware.ok) broken.push(['hardware-class', bulkHardwareRefusal(hardware)]);
  const hours = evaluateOffHours(
    facts.map((s) => ({ id: s.id, name: s.name, timeZone: manifestTimeZone(s, s.screenGroup, s.tenant) })),
    opts.now ?? new Date(),
  );
  if (!hours.ok) broken.push(['off-hours', bulkOffHoursRefusal(hours)]);
  if (broken.length && !opts.override) {
    const refusal = broken[0][1];
    throw new HttpException({ code: refusal.code, message: refusal.message, ...refusal.extra }, refusal.status);
  }
  return broken.map(([rule]) => rule);
}
