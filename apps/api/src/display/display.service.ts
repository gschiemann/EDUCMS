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
  DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT,
  DISPLAY_REFUSAL_CODES,
  MIN_SAFE_BRIGHTNESS_PERCENT,
  clampBrightnessPercent,
  displayActionSupport,
  normalizeVerdict,
  readStoredDisplayVerdict,
  type DisplayActionType,
  type DisplayCapabilityReport,
  type DisplayCapabilityReportInput,
  type DisplayCapabilityVerdict,
  type DisplayControlWsPayload,
} from '@cms/api-types';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import type { EmergencyHoldResult } from './display-emergency-hold';

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

/** Why an action could not be confirmed as delivered. `null` when it was. */
export type DisplayDeliveryReason =
  /** Redis fan-out is down: only a screen socketed to THIS replica saw it. */
  | 'redis_unavailable'
  /** The publish itself threw. Nothing was delivered anywhere. */
  | 'publish_failed';

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
  /**
   * TRUE ONLY WHEN THE MESSAGE PROVABLY LEFT THIS PROCESS toward the screen.
   *
   * Do NOT infer this from "publish did not throw" — RedisService.publish
   * silently falls back to the local in-process gateway when Redis is down,
   * so a screen on another replica gets nothing while the call resolves
   * normally. That was the bug: `delivered:true` + `outcome:'dispatched'` on
   * an action that never arrived, with no manifest backstop to catch it
   * (the manifest carries schedules only, never immediate actions). The
   * dashboard MUST surface `false` as a failure, not a success toast.
   */
  delivered: boolean;
  /** Machine-readable reason when `delivered` is false; null when it is true. */
  deliveryReason: DisplayDeliveryReason | null;
}

/**
 * Read a stored capability document back into a verdict.
 *
 * THE BODY MOVED (2026-08-14 sweep) to `readStoredDisplayVerdict` in
 * `packages/api-types/src/display-control.ts`, unchanged, so the DASHBOARD
 * resolver can call the identical function instead of keeping its own,
 * looser copy of the rule — the divergence documented on that export let the
 * panel enable a Blank button the API refuses. This alias stays because
 * `verdictFromStored` is the name every call site and spec in this module
 * already uses; it is deliberately a re-export, not a re-implementation.
 */
export const verdictFromStored: (
  stored: unknown,
) => DisplayCapabilityVerdict | null = readStoredDisplayVerdict;

/** Longest build string we will persist. The schema caps at 120; belt and braces. */
const BUILD_FIELD_MAX = 120;

/**
 * Normalise an inbound probe report into exactly what we persist.
 *
 * BOTH `build` AND `verdict` are rebuilt field by field. The schema keeps
 * `.passthrough()` on both so a newer APK is accepted rather than 400'd —
 * which means unknown keys arrive, and the ONLY thing standing between them
 * and the database is this function.
 *
 * That matters more than it looks: `getManifest` reads the FULL screen row
 * live on every 5 s poll (outside the manifest hot cache), so anything parked
 * in `Screen.displayCapabilities` is re-read fleet-wide, forever. Before this
 * was tightened, `verdict` was assigned wholesale (`verdict: body.verdict`)
 * and a single paired screen could store ~4 MB of junk nested under it —
 * ~70 GB/day of Supabase egress from one device, the exact bug class the
 * manifest cache was built to kill. The persisted document is now bounded by
 * CONSTRUCTION: 7 capped build fields + exactly 6 enum-valued verdict fields.
 */
export function normalizeCapabilityReport(
  body: DisplayCapabilityReportInput,
  now: number,
): DisplayCapabilityReport {
  const b: any = body.build ?? {};
  const s = (x: unknown): string | null =>
    typeof x === 'string' && x.length ? x.slice(0, BUILD_FIELD_MAX) : null;
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
    verdict: normalizeVerdict(body.verdict),
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

/** Refusal code for the emergency interlock. Its own string, so it is greppable. */
export const DISPLAY_EMERGENCY_HOLD_CODE = 'DISPLAY_EMERGENCY_HOLD';

/**
 * Would this action make the panel DARKER (or keep it dark)?
 *
 * BLANK and any allowBlack always qualify. A brightness request qualifies
 * unless it provably leaves the panel clearly legible — we cannot read the
 * screen's current level from here, so the same "provably visible" floor the
 * unknown-verdict gate uses is the honest test. WAKE, SET_VOLUME and REBOOT
 * are never darkening.
 */
export function isDarkeningAction(
  action: DisplayActionType,
  opts: { percent?: number; allowBlack?: boolean },
): boolean {
  if (opts.allowBlack === true) return true;
  if (action === 'BLANK') return true;
  if (action === 'SET_BRIGHTNESS') {
    const p = typeof opts.percent === 'number' ? opts.percent : 0;
    return p < DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT;
  }
  return false;
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
    /**
     * Server half of the emergency interlock. When active, every DARKENING
     * action is refused (see display-emergency-hold.ts). Optional so the
     * default is "no hold" for callers that resolve it themselves; the
     * controller always passes it.
     */
    emergencyHold?: EmergencyHoldResult;
  }): Promise<ApplyActionResult> {
    const { screenId, tenantId, userId, action } = opts;
    const verdict = verdictFromStored(opts.capabilities);

    // ── EMERGENCY INTERLOCK (server half) ───────────────────────────────
    // A blanked or dimmed panel that hides an active lockdown / evacuation /
    // weather alert can get someone hurt. The device holds the primary
    // interlock; this refuses the operator ORIGINATING one, in the window
    // before a hold has propagated and for a screen whose socket is down.
    // ONLY the darkening direction is refused — WAKE, volume and brightness
    // RAISES stay available throughout, because a guard that could stop an
    // operator lighting a screen mid-incident is worse than the risk.
    if (opts.emergencyHold?.active && isDarkeningAction(action, opts)) {
      await this.writeAudit({
        action: DISPLAY_AUDIT_ACTIONS.CONTROL,
        screenId,
        tenantId,
        userId,
        details: {
          requested: action,
          outcome: 'refused',
          code: DISPLAY_EMERGENCY_HOLD_CODE,
          emergencySource: opts.emergencyHold.source,
          requestedPercent:
            typeof opts.percent === 'number' ? opts.percent : null,
          allowBlack: opts.allowBlack === true,
          reason: opts.reason ?? null,
        },
      });
      this.logger.warn(
        `[DisplayService] REFUSED ${action} on screen=${screenId} — emergency ` +
          `hold active (source=${opts.emergencyHold.source}).`,
      );
      throw new DisplayActionUnsupportedError(
        DISPLAY_EMERGENCY_HOLD_CODE,
        opts.emergencyHold.source === 'unreadable'
          ? 'Emergency state could not be confirmed for this screen, so it cannot be dimmed or blanked right now. Try again in a moment.'
          : 'An emergency alert is active on this screen. It cannot be blanked or dimmed until the all-clear.',
        { action },
      );
    }

    // DEAD-MAN REQUIRED FOR allowBlack. The zod schema is the boundary check
    // (→ 400), but applyAction is also reachable from tests and any future
    // internal caller, and this is the one flag that can leave a
    // wall-mounted panel permanently black. Refuse it here too — belt and
    // braces on a screen nobody can reach.
    if (opts.allowBlack === true && typeof opts.revertAfterMs !== 'number') {
      await this.writeAudit({
        action: DISPLAY_AUDIT_ACTIONS.CONTROL,
        screenId,
        tenantId,
        userId,
        details: {
          requested: action,
          outcome: 'refused',
          code: DISPLAY_REFUSAL_CODES.ALLOW_BLACK_REQUIRES_REVERT,
          allowBlack: true,
        },
      });
      throw new DisplayActionUnsupportedError(
        DISPLAY_REFUSAL_CODES.ALLOW_BLACK_REQUIRES_REVERT,
        'A deliberate blackout must carry a dead-man revert window (revertAfterMs).',
        { action },
      );
    }

    const support = displayActionSupport(action, verdict, {
      percent: opts.percent,
      allowBlack: opts.allowBlack === true,
    });

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
    const auditAction =
      action === 'REBOOT'
        ? DISPLAY_AUDIT_ACTIONS.REBOOT
        : DISPLAY_AUDIT_ACTIONS.CONTROL;

    // Transport state is knowable BEFORE the publish and synchronously, so
    // the pre-publish audit row can already tell the truth about whether the
    // fan-out can reach a screen on another replica. Defaults to NOT
    // connected when the accessor is absent — never claim a delivery we
    // cannot prove.
    const fanoutUp =
      typeof (this.redis as { isConnected?: () => boolean }).isConnected ===
      'function'
        ? (this.redis as { isConnected: () => boolean }).isConnected() === true
        : false;
    let delivered = fanoutUp;
    let deliveryReason: DisplayDeliveryReason | null = fanoutUp
      ? null
      : 'redis_unavailable';

    // The audit row goes in BEFORE the publish so a transport outage can
    // never lose the record of who asked for what. `outcome` is honest at
    // this point for the Redis-down case; the publish-threw case appends a
    // CORRECTION row below rather than rewriting this one (AuditLog carries
    // DB-level immutability triggers — rows are append-only by design).
    await this.writeAudit({
      action: auditAction,
      screenId,
      tenantId,
      userId,
      details: {
        requested: action,
        outcome: delivered ? 'dispatched' : 'undelivered',
        delivered,
        deliveryReason,
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
    // Typed against the SHARED payload interface (2026-08-13 verify wave).
    // Both P0-1 (no player handler at all) and P0-3 (two ends spelling one
    // field differently) were the same defect: a wire contract that existed
    // only as an object literal here. This annotation makes the next
    // mismatch a compile error instead of a screen that quietly ignores its
    // operator.
    const payload: DisplayControlWsPayload = {
      screenId,
      actionId,
      action,
      percent,
      revertAfterMs,
      allowBlack: opts.allowBlack === true,
      mechanism: support.mechanism,
      issuedAt: new Date().toISOString(),
    };
    const signed = this.signer.signMessage(DISPLAY_CONTROL_WS_TYPE, payload);

    // Publish even when the fan-out is down: the local-gateway fallback still
    // reaches a screen socketed to THIS replica, which beats dropping the
    // message. We just do not claim it as delivery.
    try {
      await this.redis.publish(`device:${screenId}`, signed);
    } catch (e) {
      delivered = false;
      deliveryReason = 'publish_failed';
      this.logger.warn(
        `[DisplayService] ${action} publish THREW for device:${screenId} (actionId=${actionId}): ${e}`,
      );
      // Correction row — the decision row above said 'dispatched' on the
      // strength of a connected fan-out that then failed. Leaving the log
      // saying "dispatched" for a message that never went out is exactly the
      // forensic lie this fix exists to kill.
      await this.writeAudit({
        action: auditAction,
        screenId,
        tenantId,
        userId,
        details: {
          requested: action,
          outcome: 'undelivered',
          delivered: false,
          deliveryReason,
          actionId,
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }

    if (!delivered) {
      this.logger.warn(
        `[DisplayService] ${action} for device:${screenId} is UNCONFIRMED ` +
          `(reason=${deliveryReason}, actionId=${actionId}) — there is no manifest ` +
          `backstop for immediate display actions.`,
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
      deliveryReason,
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
