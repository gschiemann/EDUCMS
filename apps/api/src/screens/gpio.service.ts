/**
 * GpioService — Goodview EP6N GPIO event + state coordinator.
 *
 * Backs `apps/api/src/screens/gpio.controller.ts`. Separated from the
 * controller so the emergency controller can call into it directly
 * (auto-drive a status lamp when an emergency fires) without a HTTP
 * round-trip and so the unit test surface is the service, not a
 * controller fixture with multipart middleware.
 *
 * Wiring + state schema lives on `Screen.config` (Json?, see Prisma
 * schema + the 20260527010000_add_screen_config migration):
 *
 *   config.wiring = {
 *     gpio_in1:  'fire_alarm' | 'panic_button' | null,
 *     gpio_in2:  'fire_alarm' | 'panic_button' | null,
 *     gpio_out1: 'status_lamp' | 'horn'        | null,
 *     gpio_out2: 'status_lamp' | 'horn'        | null,
 *   }
 *
 *   config.gpioState = {
 *     out1: 'low' | 'high',
 *     out2: 'low' | 'high',
 *     updatedAt: ISO8601,
 *   }
 *
 * Three call sites:
 *
 *   1. handleInputEvent() — the player POSTs an edge event from the
 *      EP6N's GPIO IN dry-contact ring. If the wired mapping is a
 *      "fire_alarm" or "panic_button" and the event represents the
 *      active state, we synthesize a ScreenEmergencyOverride row for
 *      device-scope (Sprint 8b shape) + signed pub/sub broadcast.
 *      Regardless of mapping we write an AuditLog row so even
 *      "unmapped pin wiggle" appears in incident review.
 *
 *      Anti-flap rate-limit: 10 events per screen per minute. The
 *      11th event in a 60s window is logged but ignored (action =
 *      'rate_limited'). In-memory only; safe to reset on boot.
 *
 *   2. setOutput() — operator clicks "lamp on" in the dashboard.
 *      Persists the new pin state into Screen.config.gpioState +
 *      broadcasts a signed GPIO_SET on device:<screenId> so the player
 *      applies the change without waiting for its next manifest poll.
 *
 *   3. driveStatusLampForEmergency() — called by EmergencyController
 *      on tenant-wide trigger + all-clear. Finds every screen in the
 *      tenant whose `config.wiring.gpio_out1` or `gpio_out2` is
 *      'status_lamp' and flips its output to 'high' (trigger) /
 *      'low' (clear). Same audit + broadcast path as setOutput().
 *
 * In-memory rate-limit map (`_inputRateMap`) is exported for tests.
 * The map is bounded at 1000 entries with sweep-on-write semantics so
 * it can't grow without bound on a long-running pod.
 */

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';

export type GpioInPin = 'in1' | 'in2';
export type GpioOutPin = 'out1' | 'out2';
export type GpioInputState = 'low' | 'high' | 'edge_rising' | 'edge_falling';
export type GpioOutputState = 'low' | 'high';

export type GpioInMapping = 'fire_alarm' | 'panic_button' | null;
export type GpioOutMapping = 'status_lamp' | 'horn' | null;

export interface GpioInputEvent {
  pin: GpioInPin;
  state: GpioInputState;
  at?: string;
}

export interface GpioInputResult {
  accepted: true;
  action: 'emergency_triggered' | 'logged' | 'ignored' | 'rate_limited';
  overrideId?: string;
}

export interface GpioWiringConfig {
  gpio_in1?: GpioInMapping;
  gpio_in2?: GpioInMapping;
  gpio_out1?: GpioOutMapping;
  gpio_out2?: GpioOutMapping;
}

export interface GpioStoredState {
  out1: GpioOutputState;
  out2: GpioOutputState;
  updatedAt: string | null;
}

/**
 * Anti-flap window: max 10 events per screen per minute.
 *
 * Exported for unit-test access only — do not import outside this
 * module + the matching `.spec.ts`. A fire alarm panel that bounces
 * its dry contact during a real evac would otherwise look like 100s
 * of LOCKDOWNs; capped by this gate at 10 logged + 1 emergency in a
 * 60s window. The 11th event in the same window comes back as
 * `rate_limited` and is logged but NOT broadcast.
 */
export const GPIO_INPUT_RATE_LIMIT = 10;
export const GPIO_INPUT_RATE_WINDOW_MS = 60_000;
export const _inputRateMap = new Map<string, number[]>(); // screenId → timestamps (ms)

/**
 * Defensive bound on the rate-limit map so a long-running pod that
 * sees a wide universe of screen ids over time can't accumulate
 * 100k+ keys. Sweep on every write past this count.
 */
const RATE_MAP_MAX_ENTRIES = 1000;

/**
 * Resolve the active wiring mapping for a single pin from the
 * Screen.config blob. Unknown keys and non-string values fall through
 * to null. Defensive against a malformed dashboard write.
 */
export function readWiring(config: any, pin: GpioInPin | GpioOutPin): GpioInMapping | GpioOutMapping {
  const wiring = (config && typeof config === 'object' && config.wiring && typeof config.wiring === 'object')
    ? config.wiring as Record<string, unknown>
    : null;
  if (!wiring) return null;
  const key = `gpio_${pin}`;
  const value = wiring[key];
  if (typeof value !== 'string') return null;
  // Pin-direction sanity check: refuse to misread an OUT mapping
  // for an IN pin or vice-versa, even if the row was hand-edited.
  if (pin === 'in1' || pin === 'in2') {
    return value === 'fire_alarm' || value === 'panic_button' ? value : null;
  }
  return value === 'status_lamp' || value === 'horn' ? value : null;
}

/**
 * Read the current persisted state (defaults to low/low when unset).
 * Exported so the manifest endpoint reads from the same place the
 * service writes — single source of truth.
 */
export function readGpioState(config: any): GpioStoredState {
  const blob = (config && typeof config === 'object' && config.gpioState && typeof config.gpioState === 'object')
    ? config.gpioState as Record<string, unknown>
    : null;
  const out1 = blob && (blob.out1 === 'high' || blob.out1 === 'low') ? blob.out1 : 'low';
  const out2 = blob && (blob.out2 === 'high' || blob.out2 === 'low') ? blob.out2 : 'low';
  const updatedAt = blob && typeof blob.updatedAt === 'string' ? blob.updatedAt : null;
  return { out1, out2, updatedAt };
}

@Injectable()
export class GpioService {
  private readonly logger = new Logger(GpioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly signer: WebsocketSignerService,
  ) {}

  /**
   * Anti-flap rate limit. Returns true when the screen is over its
   * 10-events-per-60s budget. In-memory only — single-replica safe
   * for a fire alarm panel that bounces during a real evacuation.
   *
   * NOTE: multi-replica deployments will each enforce their own
   * 10/min budget; the worst case is N×10/min across the fleet,
   * which is still well below "every event triggers an emergency".
   * If multi-replica tightening matters we can move this to Redis,
   * but per the Sprint-7 multi-replica notes the gate is acceptable
   * at this granularity.
   */
  private isRateLimited(screenId: string): boolean {
    const now = Date.now();
    const cutoff = now - GPIO_INPUT_RATE_WINDOW_MS;
    let arr = _inputRateMap.get(screenId);
    if (arr) {
      // Drop entries outside the rolling window before deciding.
      arr = arr.filter((t) => t > cutoff);
      _inputRateMap.set(screenId, arr);
    } else {
      arr = [];
    }
    if (arr.length >= GPIO_INPUT_RATE_LIMIT) {
      return true;
    }
    arr.push(now);
    _inputRateMap.set(screenId, arr);

    // Defensive sweep: if the map has grown past the soft cap, drop
    // every screen whose newest event is also outside the window.
    if (_inputRateMap.size > RATE_MAP_MAX_ENTRIES) {
      for (const [id, ts] of _inputRateMap) {
        if (!ts.length || ts[ts.length - 1] < cutoff) {
          _inputRateMap.delete(id);
        }
      }
    }
    return false;
  }

  /**
   * Decide whether a (pin, state) tuple represents the ACTIVE level
   * for a dry-contact mapping. Both fire_alarm and panic_button
   * assume an active-high (edge_rising / high) wiring on the EP6N
   * Phoenix terminal. If a customer wires the contact normally-high
   * we'd flip this here — for now the EP6N install playbook calls
   * for active-high, so that's all we accept.
   */
  private isActiveState(state: GpioInputState): boolean {
    return state === 'high' || state === 'edge_rising';
  }

  /**
   * Handle an incoming dry-contact event from a GPIO IN pin. The
   * player POSTs one of these on every state change the EP6N
   * reports. Returns the categorical action taken so the player
   * (and the audit trail) can confirm what happened on the server
   * side.
   *
   * tenantId comes from the resolved Screen row, never from the
   * device JWT or request body. Cross-tenant scoping is the
   * controller's job; the service trusts what it's handed.
   */
  async handleInputEvent(opts: {
    screenId: string;
    tenantId: string;
    event: GpioInputEvent;
    config: any;
  }): Promise<GpioInputResult> {
    const { screenId, tenantId, event } = opts;

    // Always read the mapping BEFORE the rate-limit check so the
    // audit row carries the mapping context even when we throttle.
    const mapping = readWiring(opts.config, event.pin) as GpioInMapping;

    if (this.isRateLimited(screenId)) {
      // Still audit — losing the rate-limit row would hide an
      // attacker hammering the wire. Cheap row, expensive forensic
      // value.
      await this.writeAudit({
        screenId,
        tenantId,
        action: 'gpio.input_event',
        details: {
          pin: event.pin,
          state: event.state,
          at: event.at ?? null,
          mapping,
          result: 'rate_limited',
        },
      });
      return { accepted: true, action: 'rate_limited' };
    }

    // No wiring on this pin → log only.
    if (!mapping) {
      await this.writeAudit({
        screenId,
        tenantId,
        action: 'gpio.input_event',
        details: {
          pin: event.pin,
          state: event.state,
          at: event.at ?? null,
          mapping: null,
          result: 'logged',
        },
      });
      return { accepted: true, action: 'logged' };
    }

    // Mapping present but state is not the active level → log only.
    if (!this.isActiveState(event.state)) {
      await this.writeAudit({
        screenId,
        tenantId,
        action: 'gpio.input_event',
        details: {
          pin: event.pin,
          state: event.state,
          at: event.at ?? null,
          mapping,
          result: 'ignored_inactive_state',
        },
      });
      return { accepted: true, action: 'ignored' };
    }

    // Active state on a mapped pin → trigger the matching emergency
    // type. We persist a ScreenEmergencyOverride row (device-scope,
    // matches Sprint 8b shape) so the player's
    // /:id/emergency-assets + manifest paths both pick it up + so
    // the dashboard's incident review shows the GPIO trigger in
    // the same forensic surface as a manually-pressed panic button.
    const emergencyType = mapping === 'fire_alarm' ? 'EVACUATE' : 'LOCKDOWN';
    const overrideId = await this.triggerScreenEmergency({
      screenId,
      tenantId,
      type: emergencyType,
      mapping,
      pin: event.pin,
    });

    await this.writeAudit({
      screenId,
      tenantId,
      action: 'gpio.input_event',
      details: {
        pin: event.pin,
        state: event.state,
        at: event.at ?? null,
        mapping,
        result: 'emergency_triggered',
        emergencyType,
        overrideId,
      },
    });

    return { accepted: true, action: 'emergency_triggered', overrideId };
  }

  /**
   * Synthesize a per-screen emergency override (Sprint 8b shape) +
   * broadcast a signed OVERRIDE message on `device:<screenId>`.
   * Mirrors ScreenEmergencyController.createOverrideAndBroadcast but
   * scoped to the GPIO-triggered (no operator userId) path.
   *
   * Errors here are NOT swallowed — if the override can't persist,
   * the input event has no real effect and we want the audit row
   * to reflect that. The controller re-throws so the player can
   * retry; an exception bubbles all the way back to the GpioController.
   */
  private async triggerScreenEmergency(opts: {
    screenId: string;
    tenantId: string;
    type: 'EVACUATE' | 'LOCKDOWN';
    mapping: NonNullable<GpioInMapping>;
    pin: GpioInPin;
  }): Promise<string> {
    const { screenId, tenantId, type, mapping, pin } = opts;
    const overrideId = `ovr_gpio_${this.randomId()}`;
    const severity = 'HIGH';
    const triggeredAt = new Date();

    try {
      await this.prisma.client.$transaction([
        (this.prisma.client as any).screenEmergencyOverride.upsert({
          where: { screenId },
          create: {
            screenId,
            tenantId,
            type,
            severity,
            scopeNote: `GPIO ${pin} ${mapping}`,
            playlistId: null,
            mediaUrl: null,
            textBlob: null,
            expiresAt: null,
            triggeredByUserId: 'gpio_system',
          },
          update: {
            type,
            severity,
            scopeNote: `GPIO ${pin} ${mapping}`,
            playlistId: null,
            mediaUrl: null,
            textBlob: null,
            expiresAt: null,
            triggeredByUserId: 'gpio_system',
            triggeredAt,
          },
        }),
        this.prisma.client.auditLog.create({
          data: {
            action: 'TRIGGER_SCREEN_EMERGENCY',
            targetType: 'screen',
            targetId: screenId,
            tenantId,
            userId: null,
            details: JSON.stringify({
              overrideId,
              type,
              severity,
              source: 'gpio',
              pin,
              mapping,
            }),
          },
        }),
      ]);
    } catch (error) {
      this.logger.error(
        `[GpioService] Failed to persist screen emergency override for screen ${screenId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }

    // Pub/sub fanout. Player verifies the signature before rendering.
    const payload = {
      overrideId,
      severity,
      type,
      mediaUrl: null,
      textBlob: null,
      playlistId: null,
      scopeNote: `GPIO ${pin} ${mapping}`,
      expiresAt: null,
      source: 'gpio',
    };
    const signed = this.signer.signMessage('OVERRIDE', payload);
    try {
      await this.redis.publish(`device:${screenId}`, signed);
    } catch (e) {
      this.logger.warn(
        `[GpioService] override redis publish failed for device:${screenId} (HTTP polling will deliver): ${e}`,
      );
    }

    return overrideId;
  }

  /**
   * Operator-driven GPIO OUT write. Used by the gpio-set controller
   * endpoint + by driveStatusLampForEmergency below. tenantId is
   * resolved from the screen.
   *
   * userId is null on the auto-driven (emergency) path; operator id
   * on the controller path. Either way an AuditLog row is written
   * with the mapping + previous state for forensic continuity.
   */
  async setOutput(opts: {
    screenId: string;
    tenantId: string;
    pin: GpioOutPin;
    state: GpioOutputState;
    userId: string | null;
    source: 'operator' | 'emergency_auto';
    sourceContext?: Record<string, unknown>;
  }): Promise<{ success: true; previous: GpioOutputState; mapping: GpioOutMapping }> {
    const { screenId, tenantId, pin, state, userId, source } = opts;

    // Re-read the current row so the transition + audit captures the
    // ACTUAL persisted state before the write — never trust an
    // already-stale cache. Full row + cast for the same reason as
    // driveStatusLampForEmergency above — `select` with `as any` was
    // narrowing the result to Schedule[] under the unregenerated
    // @prisma/client.
    const screen = (await this.prisma.client.screen.findUnique({
      where: { id: screenId },
    })) as unknown as { id: string; config: any } | null;
    if (!screen) {
      throw new Error(`Screen not found: ${screenId}`);
    }

    const config: any = screen.config && typeof screen.config === 'object'
      ? { ...screen.config }
      : {};
    const wiring: GpioWiringConfig = config.wiring && typeof config.wiring === 'object' ? { ...config.wiring } : {};
    const mapping = readWiring(config, pin) as GpioOutMapping;
    const current = readGpioState(config);
    const previous: GpioOutputState = pin === 'out1' ? current.out1 : current.out2;

    const nextState = {
      out1: pin === 'out1' ? state : current.out1,
      out2: pin === 'out2' ? state : current.out2,
      updatedAt: new Date().toISOString(),
    };

    config.wiring = wiring; // preserve any unrelated keys
    config.gpioState = nextState;

    await this.prisma.client.$transaction([
      this.prisma.client.screen.update({
        where: { id: screenId },
        data: { config } as any,
      }),
      this.prisma.client.auditLog.create({
        data: {
          action: 'gpio.output_set',
          targetType: 'screen',
          targetId: screenId,
          tenantId,
          userId,
          details: JSON.stringify({
            pin,
            from: previous,
            to: state,
            mapping,
            source,
            sourceContext: opts.sourceContext ?? null,
          }),
        },
      }),
    ]);

    const signed = this.signer.signMessage('GPIO_SET', {
      screenId,
      pin,
      state,
      mapping,
      updatedAt: nextState.updatedAt,
      source,
    });
    try {
      await this.redis.publish(`device:${screenId}`, signed);
    } catch (e) {
      this.logger.warn(
        `[GpioService] GPIO_SET redis publish failed for device:${screenId} (manifest poll will deliver): ${e}`,
      );
    }

    return { success: true, previous, mapping };
  }

  /**
   * Sweep every screen in the tenant whose GPIO OUT is wired as a
   * `status_lamp` and flip its output to `state`. Called by the
   * emergency trigger + all-clear paths.
   *
   * Tolerant of malformed rows + missing wiring — anything without
   * an explicit status_lamp mapping is skipped. Failures on a single
   * screen are logged but do NOT roll back the surrounding emergency
   * trigger (we never want a faulty lamp to delay a life-safety
   * alert).
   */
  async driveStatusLampForEmergency(opts: {
    tenantId: string;
    state: GpioOutputState;
    reason: 'emergency_trigger' | 'emergency_all_clear';
    sourceContext?: Record<string, unknown>;
  }): Promise<{ touched: number }> {
    // Pull the full row + cast — `select` with `as any` was making the
    // narrowed result type return Schedule[] under the new @prisma/client
    // until db:generate catches up. Full row keeps the type sane and the
    // payload size is fine for the tenant-wide lamp sweep (status_lamp
    // wired screens are a small subset of the fleet).
    const screens = (await this.prisma.client.screen.findMany({
      where: { tenantId: opts.tenantId },
    })) as unknown as Array<{ id: string; tenantId: string | null; config: any }>;
    let touched = 0;
    for (const s of screens) {
      const cfg = s.config;
      const map1 = readWiring(cfg, 'out1');
      const map2 = readWiring(cfg, 'out2');
      const pins: GpioOutPin[] = [];
      if (map1 === 'status_lamp') pins.push('out1');
      if (map2 === 'status_lamp') pins.push('out2');
      if (pins.length === 0) continue;

      for (const pin of pins) {
        try {
          await this.setOutput({
            screenId: s.id,
            tenantId: opts.tenantId,
            pin,
            state: opts.state,
            userId: null,
            source: 'emergency_auto',
            sourceContext: { reason: opts.reason, ...opts.sourceContext },
          });
          touched += 1;
        } catch (e) {
          // Per the comment above — never roll back the emergency
          // path on a single lamp's failure. Logged + Sentry-captured
          // via the standard NestJS Logger.
          this.logger.warn(
            `[GpioService] driveStatusLampForEmergency: setOutput failed for screen ${s.id} pin ${pin}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
    return { touched };
  }

  /**
   * Centralized AuditLog writer for the GPIO surface. Wrapped so
   * one signature change drives every call site at once.
   */
  private async writeAudit(opts: {
    screenId: string;
    tenantId: string;
    action: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          action: opts.action,
          targetType: 'screen',
          targetId: opts.screenId,
          tenantId: opts.tenantId,
          userId: null,
          details: JSON.stringify(opts.details),
        },
      });
    } catch (e) {
      // Audit failure on a GPIO event row is a soft error — the
      // emergency override (if any) has already landed and broadcast
      // by the caller. Log + Sentry capture happens via the Logger.
      this.logger.warn(
        `[GpioService] writeAudit failed for screen ${opts.screenId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Short opaque id for override ids. crypto.randomUUID without the dashes. */
  private randomId(): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto: typeof import('crypto') = require('crypto');
    return crypto.randomUUID().replace(/-/g, '');
  }
}
