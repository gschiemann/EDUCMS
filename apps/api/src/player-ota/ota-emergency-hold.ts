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
}

/** The facts of the screen that asked (all read from its own row). */
export interface OtaEmergencyHoldScreen {
  id: string;
  tenantId: string | null;
  screenGroupId?: string | null;
  lastRenderedHash?: string | null;
  lastRenderedAt?: Date | string | null;
}

export interface OtaEmergencyHoldPrisma {
  client: {
    screenEmergencyOverride: { findUnique: (args: any) => Promise<any> };
    tenant: { findUnique: (args: any) => Promise<any> };
    emergencyMessage: { findFirst: (args: any) => Promise<unknown> };
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
    if (
      glassReportsEmergency(
        screen.lastRenderedHash,
        screen.lastRenderedAt,
        now.getTime(),
      )
    ) {
      return { held: true, source: 'glass', disabled: false };
    }

    // Per-screen override, own tenant, ancestors. Fails closed on its own
    // ('unreadable' counts as active).
    const state = await resolveEmergencyHold(prisma, {
      id: screen.id,
      tenantId: screen.tenantId,
    });
    if (state.active)
      return {
        held: true,
        source: state.source ?? 'unreadable',
        disabled: false,
      };

    // An unpaired screen has no tenant, so no alert can be aimed at it.
    if (!screen.tenantId) return { held: false, source: null, disabled: false };

    const message = await prisma.client.emergencyMessage.findFirst({
      where: deviceMessagesWhere(
        {
          tenantId: screen.tenantId,
          screenId: screen.id,
          groupId: screen.screenGroupId ?? null,
        },
        now,
      ),
      select: { id: true },
    });
    if (message) return { held: true, source: 'message', disabled: false };

    return { held: false, source: null, disabled: false };
  } catch (e: unknown) {
    logger.error(
      `[ota] emergency-state read FAILED for screen=${screen.id} — HOLDING the install ` +
        `(fail-closed): ${e instanceof Error ? e.message : String(e)}`,
    );
    return { held: true, source: 'unreadable', disabled: false };
  }
}
