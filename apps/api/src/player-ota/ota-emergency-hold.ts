/**
 * No app install while an alert is on the glass (2026-11-21, launch audit
 * FLT-04) — the SERVER half.
 *
 * ⚠️ LIFE-SAFETY GUARD. Installing a Player APK replaces the running package:
 * Android kills the process, and the alert it was showing leaves the glass
 * until the new build relaunches (the post-install relaunch safety net is
 * +60 s, and a pushed broadcast / SOS is not restored after a reload). Before
 * this file nothing on the OTA path read emergency state: an automatic 03:00
 * offer during an overnight weather alert, an operator push, a field-build
 * push or a panel tap during a lockdown installed like any other day. The
 * scheduled restart already waits (scheduled-reboot-policy.ts, `emergency`),
 * and so does the web bundle ("NEVER: during an emergency", offHoursUpdate.ts);
 * this brings the APK path in line.
 *
 * WHAT HOLDS. An install offer is withheld while ANY of these is true for the
 * screen that asked:
 *   • a non-expired per-screen emergency override (live or drill);
 *   • its own tenant's emergencyStatus is not INACTIVE (live or drill);
 *   • an ancestor tenant's is (district-wide propagation) — these three are
 *     `resolveEmergencyHold` (display/display-emergency-hold.ts), the same
 *     reading the display interlock and the scheduled restart use, which
 *     mirrors the manifest's emergency branch;
 *   • an active (not cleared, not expired) pushed message — broadcast, SOS,
 *     media alert, a district copy — the screen may see (the device poll's
 *     own `deviceMessagesWhere`; no visibility narrowing, so a superset holds);
 *   • the screen's own render proof says an emergency was on its glass in the
 *     last OTA_GLASS_EMERGENCY_PROOF_MS (`em:` / `pending|em:` /
 *     `unconfirmed|em:` — emergency-proof.ts). This covers an alert the
 *     server no longer records but the screen still shows (a cached manifest
 *     raises, never releases).
 *
 * THE WHOLE UNIT, NOT ONE PANE (review round 1). A double-sided display is
 * one Screen row per side (screen-faces.ts: side B is linked to the primary
 * by `faceOfScreenId`, with its own fingerprint, override, group, messages
 * and render proof), but ONE Player process drives every side. Installing
 * the APK takes every side's alert off the glass, and the update check only
 * ever arrives with the primary's fingerprint. So the same checks run for
 * every other row of the unit — the primary and all its faces, in the same
 * tenant (the scope the device-scoped alert fan-out uses) — and any one of
 * them holds the install. A failed read of the unit holds. The read is one
 * query, paid only when an install is about to be offered.
 *
 * MESSAGES OF EVERY SEVERITY HOLD. A live INFO or WARN banner holds the
 * install exactly like a CRITICAL one or an SOS (no severity filter), for as
 * long as the sender made it last. That errs toward delaying an update; it
 * is written in docs/ENVIRONMENT.md and the autonomy register so the owner
 * can narrow it deliberately.
 *
 * FAILURE DIRECTION: CLOSED. When the state cannot be read the install is
 * held (`source: 'unreadable'`). An update delayed is safe; an install during
 * an alert is not.
 *
 * WHAT IT ANSWERS. `{ uptoDate: true, heldFor: 'emergency' }` — no `latest`
 * block, which every shipped Player (1.1.23 – 1.1.67) and Manager 1.0.24 read
 * as "nothing newer" and exit before any download. Deliberately NOT `needsTap`
 * (that would make the Player report NEEDS_TAP and hold the push for a tap).
 * `heldFor` is for logs and telemetry; old builds ignore it.
 *
 * A HELD PUSH IS DEFERRED, NEVER DROPPED. The hold returns before an offer is
 * counted, before a field offer is audited and before a push is cleared, so the
 * operator's push record is untouched: it is offered on the screen's next
 * check after the alert ends (its periodic check, a reboot, a new push, a
 * panel tap), and ends visibly as EXPIRED only under the existing rule that a
 * push no check was handed within 24 h is stale (push-tracking.ts).
 *
 * NOT HELD: the Manager's BOOTSTRAP of a kiosk with no Player installed
 * (versionCode 0). There is no Player on that glass to show an alert, so the
 * install is how the alert gets there.
 *
 * KILL SWITCH (subtractive): OTA_EMERGENCY_HOLD_DISABLED=1 | true | yes
 * restores the previous behaviour exactly — nothing is read, nothing is held.
 *
 * The device half (skip `triggerInstall` while `DisplayEmergency` holds) needs
 * an APK and hardware qualification; it is a recorded follow-up. This file
 * cannot stop an install the device was offered BEFORE the alert began.
 */

import { Logger } from '@nestjs/common';

import { resolveEmergencyHold } from '../display/display-emergency-hold';
import { deviceMessagesWhere } from '../emergency/message-visibility';

const logger = new Logger('OtaEmergencyHold');

export const OTA_EMERGENCY_HOLD_DISABLED_ENV = 'OTA_EMERGENCY_HOLD_DISABLED';

/** A render proof newer than this that names an emergency counts as "on the glass". */
export const OTA_GLASS_EMERGENCY_PROOF_MS = 10 * 60_000;

/** Same shape emergency-proof.ts treats as an emergency render signature. */
const EMERGENCY_RENDER_HASH = /^(?:pending\||unconfirmed\|)?em:/;

export type OtaEmergencyHoldSource =
  | 'screen'
  | 'tenant'
  | 'ancestor'
  | 'message'
  | 'glass'
  | 'unreadable';

export interface OtaEmergencyHoldVerdict {
  held: boolean;
  source: OtaEmergencyHoldSource | null;
  /** The kill switch is set: nothing was read and nothing is held. */
  disabled: boolean;
  /**
   * Set when the row that holds is ANOTHER side of the asker's double-sided
   * unit (its primary or one of its faces), not the asker itself. For logs.
   */
  unitScreenId?: string;
}

/** The facts of the screen that asked (all read from its own row). */
export interface OtaEmergencyHoldScreen {
  id: string;
  tenantId: string | null;
  screenGroupId?: string | null;
  lastRenderedHash?: string | null;
  lastRenderedAt?: Date | string | null;
  /** The primary this row is a face of; null on a primary and on a single-sided screen. */
  faceOfScreenId?: string | null;
}

export interface OtaEmergencyHoldPrisma {
  client: {
    screenEmergencyOverride: { findUnique: (args: any) => Promise<any> };
    tenant: { findUnique: (args: any) => Promise<any> };
    emergencyMessage: { findFirst: (args: any) => Promise<unknown> };
    screen: { findMany: (args: any) => Promise<unknown> };
  };
}

/** The columns the hold reads from a screen row (the asker's lookup selects these too). */
export const OTA_EMERGENCY_HOLD_SCREEN_SELECT = {
  id: true,
  tenantId: true,
  screenGroupId: true,
  lastRenderedHash: true,
  lastRenderedAt: true,
  faceOfScreenId: true,
} as const;

/** A screen row as read with (at least) OTA_EMERGENCY_HOLD_SCREEN_SELECT. */
export interface OtaEmergencyHoldScreenRow {
  id: string;
  tenantId?: string | null;
  screenGroupId?: string | null;
  lastRenderedHash?: string | null;
  lastRenderedAt?: Date | string | null;
  faceOfScreenId?: string | null;
}

/** The hold's facts from a screen row the caller already read. */
export function otaHoldScreenFrom(
  row: OtaEmergencyHoldScreenRow,
): OtaEmergencyHoldScreen {
  return {
    id: row.id,
    tenantId: row.tenantId ?? null,
    screenGroupId: row.screenGroupId ?? null,
    lastRenderedHash: row.lastRenderedHash ?? null,
    lastRenderedAt: row.lastRenderedAt ?? null,
    faceOfScreenId: row.faceOfScreenId ?? null,
  };
}

/** The answer a held check gets: what every shipped build reads as "up to date". */
export interface HeldForEmergencyAnswer {
  uptoDate: true;
  heldFor: 'emergency';
}

export function heldForEmergencyAnswer(): HeldForEmergencyAnswer {
  return { uptoDate: true, heldFor: 'emergency' };
}

/** `1`, `true` or `yes` (case-insensitive, trimmed) turns the hold off. Anything else keeps it on. */
export function otaEmergencyHoldDisabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env[OTA_EMERGENCY_HOLD_DISABLED_ENV];
  if (typeof raw !== 'string') return false;
  return ['1', 'true', 'yes'].includes(raw.trim().toLowerCase());
}

/** Did this screen's own render proof show an emergency within the freshness window? */
export function glassReportsEmergency(
  hash: string | null | undefined,
  at: Date | string | null | undefined,
  nowMs: number,
): boolean {
  if (typeof hash !== 'string' || !EMERGENCY_RENDER_HASH.test(hash))
    return false;
  if (!at) return false;
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return false;
  // A proof dated in the future (clock skew between writers) still counts.
  return nowMs - t <= OTA_GLASS_EMERGENCY_PROOF_MS;
}

/**
 * What holds for ONE screen row: its own glass, its per-screen override, its
 * tenant and ancestors, then a live message it may see. Null = nothing.
 * Throws when a read fails (the caller fails closed).
 */
async function rowHoldSource(
  prisma: OtaEmergencyHoldPrisma,
  row: OtaEmergencyHoldScreen,
  now: Date,
): Promise<OtaEmergencyHoldSource | null> {
  if (
    glassReportsEmergency(
      row.lastRenderedHash,
      row.lastRenderedAt,
      now.getTime(),
    )
  ) {
    return 'glass';
  }

  // Per-screen override, own tenant, ancestors. Fails closed on its own
  // ('unreadable' counts as active).
  const state = await resolveEmergencyHold(prisma, {
    id: row.id,
    tenantId: row.tenantId,
  });
  if (state.active) return state.source ?? 'unreadable';

  // An unpaired screen has no tenant, so no alert can be aimed at it.
  if (!row.tenantId) return null;

  const message = await prisma.client.emergencyMessage.findFirst({
    where: deviceMessagesWhere(
      {
        tenantId: row.tenantId,
        screenId: row.id,
        groupId: row.screenGroupId ?? null,
      },
      now,
    ),
    select: { id: true },
  });
  return message ? 'message' : null;
}

/**
 * Should an APK install offer to this screen be withheld right now?
 * Never throws: any failure to read is `{ held: true, source: 'unreadable' }`.
 */
export async function resolveOtaEmergencyHold(
  prisma: OtaEmergencyHoldPrisma,
  screen: OtaEmergencyHoldScreen,
  opts: { env?: Record<string, string | undefined>; now?: Date } = {},
): Promise<OtaEmergencyHoldVerdict> {
  if (otaEmergencyHoldDisabled(opts.env ?? process.env)) {
    return { held: false, source: null, disabled: true };
  }
  const now = opts.now ?? new Date();
  try {
    const own = await rowHoldSource(prisma, screen, now);
    if (own) return { held: true, source: own, disabled: false };

    // An unpaired screen belongs to no unit an alert could reach.
    if (!screen.tenantId) return { held: false, source: null, disabled: false };

    // The rest of a double-sided unit: one Player process drives every side,
    // so an install takes every side's alert off the glass. The unit is the
    // primary and every face of it, in the same tenant — the scope the
    // device-scoped alert fan-out uses (emergency.controller.ts). For an
    // ordinary single-sided screen this returns only the asker.
    const unitRoot = screen.faceOfScreenId || screen.id;
    const unit = await prisma.client.screen.findMany({
      where: {
        tenantId: screen.tenantId,
        OR: [{ id: unitRoot }, { faceOfScreenId: unitRoot }],
      },
      select: OTA_EMERGENCY_HOLD_SCREEN_SELECT,
    });
    if (!Array.isArray(unit)) {
      throw new Error('double-sided unit read returned no rows array');
    }
    for (const raw of unit as Array<OtaEmergencyHoldScreenRow | null>) {
      if (!raw || raw.id === screen.id) continue;
      const other = otaHoldScreenFrom(raw);
      const source = await rowHoldSource(prisma, other, now);
      if (source) {
        return { held: true, source, disabled: false, unitScreenId: other.id };
      }
    }

    return { held: false, source: null, disabled: false };
  } catch (e: unknown) {
    logger.error(
      `[ota] emergency-state read FAILED for screen=${screen.id} — HOLDING the install ` +
        `(fail-closed): ${e instanceof Error ? e.message : String(e)}`,
    );
    return { held: true, source: 'unreadable', disabled: false };
  }
}
