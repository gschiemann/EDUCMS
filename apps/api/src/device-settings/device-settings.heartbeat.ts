/**
 * The native heartbeat's device-settings half (2026-10-18), called from
 * `ScreensController.deviceStatus` (`GET /screens/status/:fp`) ONLY for a
 * paired screen whose caller proved the screen's own device credential — the
 * same gate as the native runtime report. An anonymous status read never
 * sees a desired value, and never a Wi-Fi passphrase.
 *
 * ─────────────────────────────────────────────────────────────────────
 * COST: an unchanged unit pays NOTHING
 * ─────────────────────────────────────────────────────────────────────
 * The heartbeat already loaded the full Screen row. Two markers on it decide
 * whether this needs the database at all:
 *   • `deviceSettingsRev` — the desired set's revision. The unit echoes the
 *     revision it holds; equal ⇒ reply `same`.
 *   • `deviceSettingsReportSig` — the signature of the report already
 *     stored. Equal ⇒ nothing to write.
 * Only a moved marker (or the unit asking for the Wi-Fi passphrase) reads the
 * `desired_device_settings` row. `deviceSettingsReportAt` rides the
 * heartbeat's own debounced write and never forces one.
 *
 * ⚠️ NEVER FAILS THE HEARTBEAT. Any database fault here degrades to "no
 * deviceSettings in the reply" — which the unit reads as silence (it changes
 * nothing) — and the markers are left as they were, so the next beat retries.
 */

import { Logger } from '@nestjs/common';

import { DEVICE_SETTING_KEYS, parseDeviceSettingsReport, type DeviceSettingsReport } from '@cms/api-types';
import type { Prisma } from '@cms/database';

import type { PrismaService } from '../prisma/prisma.service';
import { openCredentials } from '../streaming/creds-cipher';
import {
  DEVICE_SETTINGS_AUDIT_ACTIONS,
  ackTransitions,
  fullReply,
  readStoredReport,
  readStoredSettings,
  reportSignature,
  wifiSecretNeeded,
  type DeviceSettingsReply,
} from './device-settings';

export interface DeviceSettingsHeartbeatResult {
  /** Columns to fold into the heartbeat's own `screens` write. */
  data: Record<string, unknown>;
  /** A marker moved: the heartbeat must write the row now, not on its debounce. */
  mustWrite: boolean;
  /** null = say nothing to the unit this beat (a fault); it changes nothing. */
  reply: DeviceSettingsReply | null;
}

export interface DeviceSettingsHeartbeatScreen {
  id: string;
  tenantId: string | null;
  deviceSettingsRev?: number | null;
  deviceSettingsReportSig?: string | null;
}

const logger = new Logger('DeviceSettings');

/**
 * At most one audit row per setting per report change. Tied to the key list:
 * a fixed number here silently dropped the ninth setting's audit row the day
 * a ninth setting was added (the stored report then hides that transition).
 */
const MAX_AUDIT_ROWS = DEVICE_SETTING_KEYS.length;

export async function deviceSettingsHeartbeat(
  prisma: PrismaService,
  screen: DeviceSettingsHeartbeatScreen,
  header: unknown,
  now: Date = new Date(),
): Promise<DeviceSettingsHeartbeatResult | null> {
  const tenantId = screen.tenantId;
  if (!tenantId) return null;
  const report = parseDeviceSettingsReport(header);
  // No header (an older player) or a malformed one: this feature says nothing.
  if (!report) return null;

  const data: Record<string, unknown> = { deviceSettingsReportAt: now };
  const markerRev = screen.deviceSettingsRev ?? 0;
  const sig = reportSignature(report);
  const reportChanged = sig !== (screen.deviceSettingsReportSig ?? null);
  const needRow = reportChanged || report.rev !== markerRev || report.need === true;

  if (!needRow) {
    return { data, mustWrite: false, reply: steadyReply(markerRev) };
  }

  try {
    const db = prisma.client;
    let mustWrite = false;
    // The ONE read not scoped by tenant, and on purpose: it must see a row
    // still filed under a previous organisation in order to reset it below.
    // ten-ok: (b) identity-derived — the device credential proved this screen id; the row's tenant is compared with the screen's own next.
    let row = await db.desiredDeviceSettings.findUnique({ where: { screenId: screen.id } });

    // Re-paired into another tenant: the old tenant's intent — and its Wi-Fi
    // passphrase — must not follow the hardware. Reset ONCE, revision still
    // going up so no identity is ever reused.
    if (row && row.tenantId !== tenantId) {
      // Conditional on the row this beat read: a save the new organisation
      // made in between must never be wiped, and a revision never reissued.
      // ten-ok: (b) identity-derived — the device's own screen moved tenants; this re-files ITS row under the screen's current tenant, emptied.
      const reset = await db.desiredDeviceSettings.updateMany({
        where: { screenId: screen.id, tenantId: row.tenantId, revision: row.revision },
        data: {
          tenantId,
          revision: row.revision + 1,
          settings: {},
          wifiSecret: null,
          updatedByUserId: null,
        },
      });
      row = await db.desiredDeviceSettings.findFirst({ where: { screenId: screen.id, tenantId } });
      if (!row) {
        // Moved again under us: say nothing this beat; the next one re-reads.
        return { data: {}, mustWrite: false, reply: null };
      }
      if (reset.count === 1) {
        await audit(prisma, tenantId, screen.id, DEVICE_SETTINGS_AUDIT_ACTIONS.CHANGED, {
          reason: 'screen-moved-tenant',
          revision: row.revision,
          before: '(another organisation)',
          after: {},
        });
      }
    }

    const revision = row?.revision ?? 0;
    if (revision !== markerRev) {
      // The marker disagrees with the row: a reset above, a missing row, or a
      // PUT that committed between this beat's two reads. Move it ONLY from the
      // value this beat read — never a blind write folded into the heartbeat's
      // own update, which could land after a newer PUT and put the marker
      // BEHIND the row (the unit would then be told `same` and never receive
      // that change). If a PUT moved it meanwhile, this matches nothing.
      await db.screen.updateMany({
        where: { id: screen.id, tenantId, deviceSettingsRev: markerRev },
        data: { deviceSettingsRev: revision },
      });
    }
    const stored = row ? readStoredSettings(row.settings) : {};

    let reportStored = false;
    if (reportChanged) {
      const json = report as unknown as Prisma.InputJsonValue;
      if (row) {
        const written = await db.desiredDeviceSettings.updateMany({
          where: { screenId: screen.id, tenantId },
          data: { report: json, reportChangedAt: now },
        });
        reportStored = written.count === 1;
      } else {
        try {
          await db.desiredDeviceSettings.create({
            data: { screenId: screen.id, tenantId, revision: 0, settings: {}, report: json, reportChangedAt: now },
          });
          reportStored = true;
        } catch (e) {
          // A concurrent beat or save created it first: the next beat stores it.
          if ((e as { code?: string })?.code !== 'P2002') throw e;
        }
      }
    }
    if (reportStored) {
      const previous = row ? readStoredReport(row.report) : null;
      // Only a STORED report moves the signature; otherwise the next beat retries.
      data.deviceSettingsReportSig = sig;
      mustWrite = true;
      for (const t of ackTransitions(previous, report).slice(0, MAX_AUDIT_ROWS)) {
        await audit(
          prisma,
          tenantId,
          screen.id,
          t.status === 'applied' ? DEVICE_SETTINGS_AUDIT_ACTIONS.APPLIED : DEVICE_SETTINGS_AUDIT_ACTIONS.FAILED,
          {
            setting: t.key,
            id: t.id,
            status: t.status,
            why: t.why,
            attempts: t.attempts,
            // What Android READ BACK — never the requested value.
            observed: t.observed,
            deviceTimeMs: t.appliedAtDeviceMs,
            desired: desiredForAudit(stored, t.key, t.id),
          },
        );
      }
    }

    let reply: DeviceSettingsReply;
    if (revision === 0) {
      reply = steadyReply(0);
    } else if (report.rev === revision && report.need !== true) {
      reply = { schema: 1, rev: revision, same: true };
    } else {
      const passphrase = wifiSecretNeeded(stored, report) ? openWifiSecret(row?.wifiSecret ?? null) : null;
      reply = fullReply(revision, stored, passphrase);
    }
    return { data, mustWrite, reply };
  } catch (e) {
    logger.warn(`device settings heartbeat failed for screen ${screen.id}: ${(e as Error)?.message ?? e}`);
    // The markers stay as they were, so the next beat tries again.
    return { data: {}, mustWrite: false, reply: null };
  }
}

/** The stored value this acknowledgement is for — the Wi-Fi network by name only. */
function desiredForAudit(stored: ReturnType<typeof readStoredSettings>, key: keyof typeof stored, id: string): unknown {
  const item = stored[key];
  if (!item || item.id !== id) return '(an earlier value)';
  if (typeof item.v === 'object') return { ssid: item.v.ssid, security: item.v.security };
  return item.v;
}

/** Rev 0 = nothing stored: an explicit empty set (the unit forgets any old intent). */
function steadyReply(rev: number): DeviceSettingsReply {
  return rev === 0 ? { schema: 1, rev: 0, items: {} } : { schema: 1, rev, same: true };
}

function openWifiSecret(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    const opened = openCredentials(JSON.parse(sealed));
    return typeof opened.passphrase === 'string' ? opened.passphrase : null;
  } catch {
    // Never log the sealed value or anything derived from it.
    logger.warn('a stored Wi-Fi passphrase could not be opened');
    return null;
  }
}

async function audit(
  prisma: PrismaService,
  tenantId: string,
  screenId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.client.auditLog.create({
      data: {
        action,
        targetType: 'screen',
        targetId: screenId,
        tenantId,
        // A device report has no operator behind it.
        userId: null,
        details: JSON.stringify(details),
      },
    });
  } catch (e) {
    logger.warn(`audit(${action}) failed for screen ${screenId}: ${(e as Error)?.message ?? e}`);
  }
}

export type { DeviceSettingsReport };
