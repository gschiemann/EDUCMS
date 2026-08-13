/**
 * EMERGENCY HOLD — the server half of the display-control interlock.
 *
 * ⚠️ THIS IS A LIFE-SAFETY GUARD. VenueOS screens carry lockdown, evacuation
 * and severe-weather alerts. A blanked or dimmed panel that hides an active
 * alert can get someone hurt, and nothing in the display-control feature
 * consulted emergency state at all when it was built.
 *
 * The PRIMARY interlock is on the device (`displayEmergencyHold` in the
 * player: removes the blackout overlay, restores window brightness,
 * re-asserts KEEP_SCREEN_ON, refuses every blank and every dim while the
 * hold is active, and persists the hold across a process restart). This
 * module is the SERVER half of the same rule, and it exists because the API
 * is the one place that knows the authoritative emergency state — so an
 * operator cannot ORIGINATE a blackout from the dashboard during an
 * incident, even in the window before a hold has propagated to a screen, and
 * even for a screen whose WS socket is down.
 *
 * WHAT IT REFUSES — only ever the DARKENING direction:
 *   • BLANK
 *   • SET_BRIGHTNESS below DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT
 *   • any allowBlack request
 * WAKE, brightness RAISES and volume stay available throughout. A guard that
 * could keep an operator from lighting a screen during an emergency would be
 * worse than the thing it protects against.
 *
 * FAIL-CLOSED. If emergency state cannot be read, a darkening action is
 * REFUSED, not allowed. (In practice the same DB outage already fails the
 * screen lookup that precedes this, so the operator sees an error either
 * way — this just makes the direction explicit and deliberate.)
 *
 * The emergency semantics mirror `ScreensController.getManifest` exactly:
 * a non-expired per-screen override, OR this tenant's own emergencyStatus,
 * OR — when its own is INACTIVE and it is not archived — the nearest
 * non-archived ancestor's (district-wide propagation).
 */

import { Logger } from '@nestjs/common';

import { MAX_TENANT_TREE_DEPTH } from '../emergency/tenant-hierarchy';

const logger = new Logger('DisplayEmergencyHold');

/**
 * Read the tenant rows DIRECTLY — deliberately NOT through
 * manifest-hot-cache's `getTenantState`/`setTenantState`.
 *
 * That cache is typed and consumed as `EmergencyState`
 * (emergencyStatus + emergencyPlaylistId + emergencyPortraitPlaylistId).
 * Writing this module's narrower row into it would hand the MANIFEST an
 * emergency state with no playlist ids for up to its 2 s TTL — i.e. a
 * lockdown manifest that renders no lockdown content. Reading `parentId` /
 * `archivedAt` back out of it is equally unsound, because a value another
 * caller stored may not carry them and the ancestor walk would stop
 * silently. This path runs on an operator action capped at 60/min, so two
 * or three indexed primary-key reads cost nothing worth that risk.
 */
const TENANT_EMERGENCY_SELECT = {
  id: true,
  parentId: true,
  archivedAt: true,
  emergencyStatus: true,
} as const;

export interface EmergencyHoldPrisma {
  client: {
    screenEmergencyOverride: { findUnique: (args: any) => Promise<any> };
    tenant: { findUnique: (args: any) => Promise<any> };
  };
}

export interface EmergencyHoldResult {
  /** True when this screen is currently showing (or owed) an emergency. */
  active: boolean;
  /** 'screen' | 'tenant' | 'ancestor' | 'unreadable' — for the audit row. */
  source: 'screen' | 'tenant' | 'ancestor' | 'unreadable' | null;
}

/**
 * Is an emergency in effect for this screen right now?
 *
 * Returns `{active:true, source:'unreadable'}` when the state cannot be
 * determined — the caller treats that as a hold (fail-closed).
 */
export async function resolveEmergencyHold(
  prisma: EmergencyHoldPrisma,
  screen: { id: string; tenantId: string | null },
): Promise<EmergencyHoldResult> {
  if (!screen.tenantId) return { active: false, source: null };

  try {
    // 1. Per-screen override wins, even when the tenant is INACTIVE.
    const override = await prisma.client.screenEmergencyOverride.findUnique({
      where: { screenId: screen.id },
    });
    if (override) {
      const exp = override.expiresAt
        ? new Date(override.expiresAt).getTime()
        : null;
      const expired = exp !== null && Number.isFinite(exp) && exp < Date.now();
      if (!expired) return { active: true, source: 'screen' };
    }

    // 2. This tenant's own status.
    const tenant = await prisma.client.tenant.findUnique({
      where: { id: screen.tenantId },
      select: TENANT_EMERGENCY_SELECT as any,
    });
    if (!tenant) return { active: false, source: null };
    if (tenant.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE') {
      return { active: true, source: 'tenant' };
    }

    // 3. District-wide propagation. An ARCHIVED location never inherits —
    //    same rule as the manifest and the emergency fan-out.
    if (tenant.archivedAt || !tenant.parentId) {
      return { active: false, source: null };
    }
    let cursor: string | null = tenant.parentId;
    const seen = new Set<string>();
    for (let hop = 0; hop < MAX_TENANT_TREE_DEPTH && cursor; hop++) {
      if (seen.has(cursor)) break; // cycle guard
      seen.add(cursor);
      const ancestor = await prisma.client.tenant.findUnique({
        where: { id: cursor },
        select: TENANT_EMERGENCY_SELECT as any,
      });
      if (!ancestor || ancestor.archivedAt)
        return { active: false, source: null };
      if (ancestor.emergencyStatus && ancestor.emergencyStatus !== 'INACTIVE') {
        return { active: true, source: 'ancestor' };
      }
      cursor = ancestor.parentId ?? null;
    }
    return { active: false, source: null };
  } catch (e) {
    // FAIL CLOSED. "We could not read emergency state" must never resolve to
    // "go ahead and black out the screen".
    logger.error(
      `[display] emergency-state read FAILED for screen=${screen.id} — ` +
        `treating as an ACTIVE hold (darkening refused): ${e}`,
    );
    return { active: true, source: 'unreadable' };
  }
}
