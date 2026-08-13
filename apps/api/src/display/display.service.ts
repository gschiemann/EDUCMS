/**
 * DisplayService — screen volume / brightness / blank / wake / reboot.
 *
 * WHY IT EXISTS: the operator needs to control every screen's display from
 * the dashboard across Goodview (today), NovaStar Taurus, TCL and whatever
 * Android signage SoC ships next, WITHOUT us holding a per-vendor SDK. The
 * player answers "what can this box actually do" with a read-only capability
 * probe; this service is the server half — it stores that verdict, refuses
 * anything the verdict does not support, and publishes the actions it does
 * allow as signed WS messages on `device:<screenId>`.
 *
 * THE THREE RULES THAT MATTER (these screens are wall-mounted and nobody can
 * reach them):
 *
 *   1. CAPABILITY TRUTH-GATE. An action is validated against the screen's
 *      REPORTED verdict and 409s when it exceeds it. A screen that has never
 *      reported supports NOTHING — we do not optimistically fire at hardware
 *      whose surface we have not observed. Same discipline as the capability
 *      registry: never a button the hardware cannot perform.
 *
 *   2. BRIGHTNESS FLOOR. A remote 0% is a truck roll. Anything below
 *      MIN_SAFE_BRIGHTNESS_PERCENT is CLAMPED (never rejected — a rejected
 *      slider just gets dragged again), unless the caller explicitly passes
 *      `allowBlack`, which is recorded in the audit row.
 *
 *   3. AUDIT EVERY ACTION. REBOOT gets its own action string so it is
 *      greppable, and the row is written whether or not the WS publish
 *      succeeds — the forensic record is of the DECISION, not the delivery.
 *
 * DELIVERY: signed WS publish is the fast path only. The player also holds
 * the schedule locally (AlarmManager, armed from the manifest) so a screen
 * with the network cut still blanks at 22:00 and wakes at 07:00. A failed
 * publish is logged, never thrown — exactly like GpioService.setOutput.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

import {
  DISPLAY_CONTROL_WS_TYPE,
  MIN_SAFE_BRIGHTNESS_PERCENT,
  clampBrightnessPercent,
  displayActionSupport,
  type DisplayActionType,
  type DisplayCapabilityReport,
  type DisplayCapabilityReportInput,
  type DisplayCapabilityVerdict,
} from '@cms/api-types';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';

/** AuditLog action strings. SCREAMING_SNAKE, matching the screens module. */
export const DISPLAY_AUDIT_ACTIONS = {
  CONTROL: 'SCREEN_DISPLAY_CONTROL',
  /** Its own string so "who rebooted that screen" is a one-line grep. */
  REBOOT: 'SCREEN_DISPLAY_REBOOT',
  CAPABILITIES: 'SCREEN_DISPLAY_CAPABILITIES_CHANGED',
  SCHEDULE_CREATED: 'DISPLAY_SCHEDULE_CREATED',
  SCHEDULE_UPDATED: 'DISPLAY_SCHEDULE_UPDATED',
  SCHEDULE_DELETED: 'DISPLAY_SCHEDULE_DELETED',
  RECIPE_UPSERTED: 'DISPLAY_VENDOR_RECIPE_UPSERTED',
  RECIPE_DELETED: 'DISPLAY_VENDOR_RECIPE_DELETED',
} as const;

export interface ApplyActionResult {
  success: true;
  action: DisplayActionType;
  /** Which provider mechanism the screen reported for this capability. */
  mechanism: string;
  /** The value actually sent (post-clamp), or null for BLANK/WAKE/REBOOT. */
  percent: number | null;
  /** True when the safety floor moved the requested value. */
  clamped: boolean;
  revertAfterMs: number | null;
  /** Correlates the audit row, the WS message and the player's log line. */
  actionId: string;
  /** False when Redis was unavailable — the action was still audited. */
  delivered: boolean;
}

/**
 * Read a stored capability document back into a verdict.
 *
 * Tolerant by design: the column is written by a device and read on a path
 * that gates operator UI. A malformed/legacy document must degrade to "we
 * know nothing" (every control disabled) rather than throw or, far worse,
 * be coerced into a permissive verdict.
 */
export function verdictFromStored(
  stored: unknown,
): DisplayCapabilityVerdict | null {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored))
    return null;
  const v = (stored as any).verdict;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const str = (k: string): string | null =>
    typeof v[k] === 'string' ? v[k] : null;
  const volume = str('volume');
  const brightness = str('brightness');
  const screenBlank = str('screenBlank');
  const reboot = str('reboot');
  if (!volume || !brightness || !screenBlank || !reboot) return null;
  return {
    volume,
    brightness,
    screenBlank,
    reboot,
    hardPowerOff: str('hardPowerOff') ?? 'none',
    deviceOwnerPath:
      str('deviceOwnerPath') ?? 'provisionable-after-factory-reset',
  } as DisplayCapabilityVerdict;
}

/** Normalise an inbound probe report into exactly what we persist. */
export function normalizeCapabilityReport(
  body: DisplayCapabilityReportInput,
  now: number,
): DisplayCapabilityReport {
  const b: any = body.build ?? {};
  const s = (x: unknown): string | null =>
    typeof x === 'string' && x.length ? x : null;
  return {
    schema: typeof body.schema === 'number' ? body.schema : 1,
    probedAt: typeof body.probedAt === 'number' ? body.probedAt : null,
    reportedAt: now,
    build: {
      manufacturer: s(b.manufacturer),
      brand: s(b.brand),
      model: s(b.model),
      device: s(b.device),
      board: s(b.board),
      sdk: typeof b.sdk === 'number' ? b.sdk : null,
      release: s(b.release),
    },
    verdict: body.verdict as unknown as DisplayCapabilityVerdict,
  };
}

/** Did the capability picture actually change? Ignores timestamps. */
export function verdictChanged(
  before: DisplayCapabilityVerdict | null,
  after: DisplayCapabilityVerdict,
): boolean {
  if (!before) return true;
  return (
    before.volume !== after.volume ||
    before.brightness !== after.brightness ||
    before.screenBlank !== after.screenBlank ||
    before.reboot !== after.reboot ||
    before.hardPowerOff !== after.hardPowerOff ||
    before.deviceOwnerPath !== after.deviceOwnerPath
  );
}

/** Thrown when an action exceeds the screen's reported capability → HTTP 409. */
export class DisplayActionUnsupportedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DisplayActionUnsupportedError';
  }
}

@Injectable()
export class DisplayService {
  private readonly logger = new Logger(DisplayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly signer: WebsocketSignerService,
  ) {}

  /**
   * Persist a device's capability verdict.
   *
   * Writes ONLY `displayCapabilities` + `displayCapabilitiesAt`, both of
   * which are registered in SCREEN_TELEMETRY_ONLY_FIELDS — so this write can
   * never invalidate the screen's cached manifest. Keep it that way: adding
   * any other column to this update would silently re-arm the fleet-wide
   * cache thrash that cost 25 GB/mo of Supabase egress.
   *
   * Audits only on an actual CHANGE of verdict (or the first report). A
   * report on every boot is normal traffic; an audit row per boot is noise
   * that would bury the signal we actually want — "this screen lost device
   * owner", "this screen dropped from sysfs to software-dim".
   */
  async recordCapabilities(opts: {
    screenId: string;
    tenantId: string | null;
    previous: unknown;
    report: DisplayCapabilityReport;
  }): Promise<{ changed: boolean }> {
    const { screenId, tenantId, previous, report } = opts;
    const before = verdictFromStored(previous);
    const changed = verdictChanged(before, report.verdict);

    // ten-ok: identity-derived self-write — the ONLY caller is
    // DisplayController.reportCapabilities, which has already proved via
    // verifyDeviceForScreen that `screenId` equals the device token's `sub`
    // (and that the credential is unrevoked, the row exists, and the epoch
    // matches). The device IS the principal here, so its own row is the
    // narrowest possible scope; a `tenantId` clause would add nothing and
    // would break the write for an unpaired screen. Escape-hatch case (b).
    await this.prisma.client.screen.update({
      where: { id: screenId },
      data: {
        displayCapabilities: report as unknown as any,
        displayCapabilitiesAt: new Date(report.reportedAt),
      } as any,
    });

    if (changed && tenantId) {
      await this.prisma.client.auditLog
        .create({
          data: {
            action: DISPLAY_AUDIT_ACTIONS.CAPABILITIES,
            targetType: 'screen',
            targetId: screenId,
            tenantId,
            // A device report has no operator behind it. auditActorFields
            // resolves a device principal to both-null by design; being
            // explicit here documents that rather than implying an actor.
            userId: null,
            details: JSON.stringify({
              from: before,
              to: report.verdict,
              build: report.build,
              schema: report.schema,
            }),
          },
        })
        .catch((e: any) =>
          this.logger.warn(
            `capability audit failed for screen=${screenId}: ${e?.message ?? e}`,
          ),
        );
    }

    return { changed };
  }

  /**
   * Validate + dispatch an immediate display action.
   *
   * Throws DisplayActionUnsupportedError (→ 409) when the action exceeds the
   * screen's reported capability. Every other outcome writes an AuditLog row
   * BEFORE the WS publish, so a Redis outage cannot lose the forensic record
   * of who asked for what.
   */
  async applyAction(opts: {
    screenId: string;
    tenantId: string;
    userId: string | null;
    action: DisplayActionType;
    percent?: number;
    revertAfterMs?: number;
    allowBlack?: boolean;
    reason?: string;
    /** Stored verdict document straight off the Screen row. */
    capabilities: unknown;
  }): Promise<ApplyActionResult> {
    const { screenId, tenantId, userId, action } = opts;
    const verdict = verdictFromStored(opts.capabilities);
    const support = displayActionSupport(action, verdict);

    if (!support.supported) {
      // Audit the REFUSAL too. "The operator tried to reboot a screen that
      // cannot be rebooted" is exactly the kind of thing you want in the log
      // when a wall of screens is behaving oddly.
      await this.writeAudit({
        action:
          action === 'REBOOT'
            ? DISPLAY_AUDIT_ACTIONS.REBOOT
            : DISPLAY_AUDIT_ACTIONS.CONTROL,
        screenId,
        tenantId,
        userId,
        details: {
          requested: action,
          outcome: 'refused',
          code: support.code,
          verdict,
        },
      });
      throw new DisplayActionUnsupportedError(support.code, support.message, {
        action,
        verdict,
      });
    }

    let percent: number | null = null;
    let clamped = false;
    if (action === 'SET_VOLUME' || action === 'SET_BRIGHTNESS') {
      const raw = typeof opts.percent === 'number' ? opts.percent : 0;
      if (action === 'SET_BRIGHTNESS') {
        const c = clampBrightnessPercent(raw, opts.allowBlack === true);
        percent = c.value;
        clamped = c.clamped;
      } else {
        percent = raw;
      }
    }

    const actionId = crypto.randomUUID();
    const revertAfterMs =
      typeof opts.revertAfterMs === 'number' ? opts.revertAfterMs : null;

    await this.writeAudit({
      action:
        action === 'REBOOT'
          ? DISPLAY_AUDIT_ACTIONS.REBOOT
          : DISPLAY_AUDIT_ACTIONS.CONTROL,
      screenId,
      tenantId,
      userId,
      details: {
        requested: action,
        outcome: 'dispatched',
        actionId,
        mechanism: support.mechanism,
        requestedPercent:
          typeof opts.percent === 'number' ? opts.percent : null,
        appliedPercent: percent,
        clamped,
        clampFloor: MIN_SAFE_BRIGHTNESS_PERCENT,
        allowBlack: opts.allowBlack === true,
        revertAfterMs,
        reason: opts.reason ?? null,
      },
    });

    // `issuedAt` rides the WS message, NOT the manifest — a per-request
    // clock value in the manifest would kill 304s fleet-wide (CLAUDE.md
    // multiscreen-sync rule 4 / manifest-cache rule 7).
    const signed = this.signer.signMessage(DISPLAY_CONTROL_WS_TYPE, {
      screenId,
      actionId,
      action,
      percent,
      revertAfterMs,
      allowBlack: opts.allowBlack === true,
      mechanism: support.mechanism,
      issuedAt: new Date().toISOString(),
    });

    let delivered = true;
    try {
      await this.redis.publish(`device:${screenId}`, signed);
    } catch (e) {
      delivered = false;
      this.logger.warn(
        `[DisplayService] ${action} publish failed for device:${screenId} (audited, actionId=${actionId}): ${e}`,
      );
    }

    return {
      success: true,
      action,
      mechanism: support.mechanism,
      percent,
      clamped,
      revertAfterMs,
      actionId,
      delivered,
    };
  }

  /**
   * AuditLog write. Best-effort but never silent — AuditLog carries DB-level
   * immutability triggers, so a failure here is a real signal, not a nuisance.
   */
  async writeAudit(opts: {
    action: string;
    screenId?: string | null;
    targetType?: string;
    targetId?: string | null;
    tenantId: string;
    userId: string | null;
    details: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          action: opts.action,
          targetType: opts.targetType ?? 'screen',
          targetId: opts.targetId ?? opts.screenId ?? null,
          tenantId: opts.tenantId,
          userId: opts.userId,
          details: JSON.stringify(opts.details),
        },
      });
    } catch (e: any) {
      this.logger.warn(`audit(${opts.action}) failed: ${e?.message ?? e}`);
    }
  }

  /** Nudge every player in the tenant to re-poll after a schedule edit. */
  async notifyScheduleChanged(tenantId: string): Promise<void> {
    try {
      const message = this.signer.signMessage('SYNC', {
        source: 'display_schedule_update',
      });
      await this.redis.publish(`tenant:${tenantId}`, message);
    } catch {
      /* manifest poll is the backstop — never fail an operator's edit on it */
    }
  }
}
