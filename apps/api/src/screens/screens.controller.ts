import { Controller, Post, Get, Put, Delete, Body, Param, Query, Req, Res, UseGuards, Request, HttpException, HttpStatus } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import type { Request as ExpressReq, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { withDbRetry } from '../prisma/with-db-retry';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
// 2026-05-27 — player-hardware catalog. Used by PUT /screens/:id to
// validate hardwareModel against the known SKU list.
import {
  HARDWARE_CATALOG,
  HARDWARE_MODELS,
  resolveHardwareModel,
  type HardwareModel,
} from '@cms/api-types';
import * as crypto from 'crypto';
import { safeFetch } from '../branding/safe-fetch';
import * as jwt from 'jsonwebtoken';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { LicenseService } from '../license/license.service';
import { StripeService } from '../billing/stripe.service';
// Menu-mgmt-at-scale (2026-05-29) — device-authed GET /screens/:id/menu
// resolves the screen's location → per-location menu via MenuService.
import { MenuService } from '../pos/menu.service';
import { requireSecret } from '../security/required-secret';
import { clientIpFromRequest } from '../security/client-ip';
import {
  getTenantState,
  setTenantState,
  shouldSkipLastPingWrite,
  markLastPingWritten,
  shouldSkipEmergencyAudit,
  markEmergencyAuditWritten,
  shouldSkipCacheReportWrite,
  markCacheReportWritten,
  shouldSkipRenderProofWrite,
  markRenderProofWritten,
  currentManifestContentRev,
  getManifestCache,
  setManifestCache,
} from './manifest-hot-cache';
// 2026-05-27 — Goodview EP6N GPIO state. Surfaced on every manifest
// branch (emergency / sports / normal) so the player applies the
// out1 / out2 lamp + horn states regardless of which path served it.
import { readGpioState } from './gpio.service';
// 2026-05-27 round 2 — auto-detect hardwareModel from the userAgent
// the player sends on /register. Closes the loop on the pair-modal
// strip (commit f293f99): operator no longer types a hardware model,
// so the server has to infer it. inferIfUnknown() returns null when
// the column is already set, so we never overwrite a manual override.
import { inferIfUnknown } from './hardware-detect';
// 2026-05-29 — render-proof heartbeat (proof-of-display). Surfaces a
// frozen-but-TCP-reachable kiosk as degraded/RED on the fleet list even
// when lastPingAt is fresh. Pure helper so the verdict is unit-tested
// without a Prisma client (same discipline as ScreenWedgeDetectorCron.decide).
import { deriveRenderHealth } from './render-proof';

const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePairingCode(length: number = 6): string {
  // sec-fix(wave1) #3: use crypto.randomInt (CSPRNG) instead of
  // Math.random() (predictable xorshift). Same alphabet; default
  // length 6 — but FIX (player-009) callers can request length 8
  // when collision-retry exhausts the 6-char namespace.
  let code = '';
  for (let i = 0; i < length; i++) {
    code += PAIRING_CODE_ALPHABET[crypto.randomInt(0, PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Verify a device JWT from the Authorization: Bearer header against the
 * given screenId. Returns { ok: true, sub } on success or { ok: false, reason }.
 * Used by the player-side endpoints that used to be unauthenticated
 * (#4 emergency-assets, #5 cache-status).
 *
 * Backward-compat: also accepts a short-lived HMAC of `${screenId}:${ts}`
 * signed with DEVICE_SECRET_KEY, passed as header X-Device-Auth:
 *   `${timestampMs}.${hex(hmac_sha256(DEVICE_SECRET_KEY, screenId + ':' + timestampMs))}`
 * Valid for 2 minutes from the signed timestamp. Preferred path is the
 * device JWT — this alt exists so already-shipped player binaries can
 * keep posting while they roll forward to the JWT-required build.
 */
function verifyDeviceForScreen(req: ExpressReq, screenId: string): { ok: true; sub: string } | { ok: false; reason: string } {
  const auth = req.headers.authorization;
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    try {
      const secret = requireSecret('DEVICE_JWT_SECRET', { devFallback: 'dev_only_device_jwt_secret_CHANGE_ME' });
      const decoded = jwt.verify(token, secret) as any;
      if (decoded?.kind !== 'device') return { ok: false, reason: 'wrong_token_kind' };
      if (decoded?.sub !== screenId) return { ok: false, reason: 'subject_mismatch' };
      return { ok: true, sub: decoded.sub };
    } catch (e) {
      return { ok: false, reason: `jwt_invalid:${(e as Error).message}` };
    }
  }

  const hmacHeader = req.headers['x-device-auth'];
  if (typeof hmacHeader === 'string' && hmacHeader.includes('.')) {
    const [tsStr, sig] = hmacHeader.split('.');
    const ts = Number(tsStr);
    if (!Number.isFinite(ts)) return { ok: false, reason: 'hmac_ts_bad' };
    if (Math.abs(Date.now() - ts) > 2 * 60 * 1000) return { ok: false, reason: 'hmac_expired' };
    const secret = requireSecret('DEVICE_SECRET_KEY', { devFallback: 'dev_only_device_secret_CHANGE_ME' });
    const expected = crypto.createHmac('sha256', secret).update(`${screenId}:${ts}`).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return { ok: false, reason: 'hmac_sig_bad' };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'hmac_sig_bad' };
    return { ok: true, sub: screenId };
  }

  return { ok: false, reason: 'no_auth' };
}

// sec-fix(P0 #7) Defense 1: per-fingerprint registration cooldown.
// @Throttle keys on IP, which is sufficient for the bulk case, but a
// single attacker with one IP rotating fingerprints could still enumerate.
// This Map adds a server-side 15-minute cooldown per fingerprint so that
// each guessed fingerprint can only be attempted once per window.
// In-memory is intentional: this is a rate-control fence, not an audit
// log. A server restart resets it, but the attacker still faces the IP
// throttle (5/hr) as the primary guard.
// Exported for unit-test access only — do not use outside this module.
export const _registerFpCooldown = new Map<string, number>(); // fingerprint → last-register ms
// 2026-05-06 (third attempt) — operator: STILL 429 even with 60 s
// cooldown. Root cause: the React app's exponential backoff caps
// at 30 s, so attempts 2/3/4 ALL fire inside the 60-s cooldown
// window from attempt 1. Once a fingerprint enters cooldown, the
// retry chain can't escape it without a 60+ s gap which the
// backoff never produces.
//
// FINAL fix: drop cooldown to 5 SECONDS. That's enough to slow
// a malicious enumeration cycle (max 1 FP attempt every 5 s = 720
// /hr per FP, well below the per-IP register cap of 300/hr) but
// short enough that ANY natural kiosk retry chain (2-30 s
// backoffs) escapes the cooldown on its very next tick.
//
// Per-FP cooldown is now a "rapid-fire same-FP" defense, not a
// "first-time bring-up gate". Aligned with how rate-limits should
// actually work for legitimate kiosks.
export const REGISTER_FP_COOLDOWN_MS = 5 * 1000; // 5 seconds (was 60 s, was 15 min)

// Sprint 13 — per-screen rate floor for CTS game-state POSTs. Map
// of screenId → last accepted POST timestamp (ms). Read + written
// only by the postGameState handler. Map is bounded at 500 entries
// with a 60s eviction sweep inside the handler.
// Exported for unit-test access only — do not use outside this module.
export const _gameStateRateMap = new Map<string, number>();

@Controller('api/v1/screens')
export class ScreensController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService,
    private readonly license: LicenseService,
    private readonly stripe: StripeService,
    private readonly menu: MenuService,
  ) {}

  private async notifySync(tenantId: string) {
    try {
      const message = this.signer.signMessage('SYNC', { source: 'screen_update' });
      await this.redisService.publish(`tenant:${tenantId}`, message);
    } catch (e) {}
  }

  // ─── PUBLIC: Device self-registration (no auth) ───
  // The player opens, sends its device info, gets back a pairing code
  // sec-fix(P0 #7) Defense 1: per-IP throttle on the register endpoint
  // + per-fingerprint 15-minute cooldown (enforced below in handler —
  // ONLY for unpaired fingerprints; see hotfix history).
  //
  // Throttle history:
  //   v1: 5/hr   — bricked a pilot kiosk during an OTA-driven
  //                re-register loop (2026-04-28 hotfix → 30/hr).
  //   v2: 30/hr  — bricked a school's NEW kiosk install on
  //                2026-05-06: school NAT means all ~10-30 existing
  //                kiosks + dashboard users share ONE public IP, and
  //                normal OTA / reboot churn easily exceeds 30/hr per
  //                IP. The new kiosk's register fired → 429 → web
  //                player stuck on "Reconnecting Registration HTTP
  //                429" with no path forward (operator has no way
  //                to reset the per-IP counter).
  //   v3: 300/hr — bricks a single hot kiosk in retry-storm mode.
  //   v4: 1500/hr — operator's IP STILL hit it after a multi-hour
  //                retry storm on a fresh TB40 sideload (cumulative
  //                count over the rolling window).
  //   v5: REMOVED — per-IP throttle dropped ENTIRELY via @SkipThrottle().
  //                The v5 comment claimed "global 600/min throttle on the
  //                controller (catches bulk bursts)" was still a defense —
  //                that was WRONG: @SkipThrottle() removes the global
  //                throttler too, so there was NO IP-based limit of ANY
  //                kind on this endpoint. Combined with the per-FP cooldown
  //                exempting brand-new/unknown fingerprints (the cooldown
  //                only slows a REPEAT of the SAME fp; a flood of UNIQUE
  //                fingerprints never trips it), a single unauthenticated
  //                source could create unbounded Screen rows (DB bloat /
  //                resource exhaustion, fills tenant screen lists).
  //                (sec P2 — 2026-07-03.)
  //   v6: 120/min PER IP (@Throttle, this window). Restores a per-IP wall
  //                that is GENEROUS enough to never brick a legit rollout
  //                yet stops the flood:
  //                • This is a PER-MINUTE window (ttl 60_000, matching the
  //                  global throttler + trust-proxy-1 → keys on the real
  //                  client IP via X-Forwarded-For). It RESETS every minute,
  //                  so unlike the old v1-v4 HOURLY windows it never
  //                  accumulates over a multi-hour retry storm — the exact
  //                  cause of the v2/v4 NAT bricking is gone.
  //                • 120/min matches player-ota `update-check` — the OTHER
  //                  public endpoint every kiosk in a NAT'd building hits on
  //                  boot. A synchronized reboot/OTA of a large building
  //                  (dozens of kiosks + dashboard users on ONE public IP)
  //                  registers ~once per kiosk; even with a retry or two it
  //                  stays well under 120/min since register is called far
  //                  LESS often than update-check. Legit installs of dozens
  //                  of screens succeed.
  //                • An attacker spamming UNIQUE fingerprints from one source
  //                  is now capped at 120 Screen rows/min/IP instead of
  //                  unbounded (600/min+ before). Defense-in-depth still
  //                  includes the per-FP 5 s cooldown (rapid same-fp) and the
  //                  natural DB-write cost. Paired kiosks re-registering are
  //                  unaffected functionally — only the rare over-limit burst
  //                  from ONE IP is 429'd, and the client retries.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('register')
  async register(@Body() body: {
    deviceFingerprint: string;
    resolution?: string;
    osInfo?: string;
    browserInfo?: string;
    userAgent?: string;
    /** sec-fix(P0 #5): Paired re-registration — caller sends its currently
     *  stored device JWT to prove possession of the prior credential.
     *  Present in kiosk builds ≥ v1.0.34; absent in older builds (handled
     *  gracefully via STRICT_REPAIR_AUTH feature flag). */
    priorDeviceToken?: string;
  }, @Req() req: ExpressReq) {
    if (!body.deviceFingerprint) {
      throw new HttpException({ code: 'SCREEN_FINGERPRINT_REQUIRED', message: 'Device fingerprint is required' }, HttpStatus.BAD_REQUEST);
    }

    // Preview mode fingerprints (set by the dashboard's "Open in Browser" button)
    // must NEVER create a Screen row or update lastPingAt on an existing row.
    // Return a synthetic not-paired payload so the preview player can still
    // render content via the manifest endpoint (using its admin JWT).
    if (body.deviceFingerprint.startsWith('preview-')) {
      return {
        screenId: null,
        pairingCode: null,
        paired: false,
        name: 'Preview',
        deviceToken: null,
        isPreview: true,
      };
    }

    // Check if this device is already registered. We do this BEFORE the
    // per-fingerprint cooldown so paired kiosks can re-register freely
    // (no enumeration risk: the FP is already known + claimed).
    const existing = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: body.deviceFingerprint },
    });

    // sec-fix(P0 #7) Defense 1: per-fingerprint cooldown — ONLY for
    // unpaired/unknown fingerprints. The cooldown defends against an
    // attacker cycling fingerprint guesses to enumerate Screen rows.
    // An already-paired kiosk re-registering (e.g. after OTA install,
    // localStorage wipe, or webview restart) is legitimate and must not
    // be blocked: that loop would brick the kiosk on every upgrade.
    // 2026-04-28 hotfix: this exemption was missing; pilot kiosk hit a
    // 429 register loop the moment v1.0.35 force-pushed.
    const fpKey = body.deviceFingerprint;
    if (!existing || !existing.tenantId) {
      const lastRegTs = _registerFpCooldown.get(fpKey);
      if (lastRegTs !== undefined && Date.now() - lastRegTs < REGISTER_FP_COOLDOWN_MS) {
        throw new HttpException({ code: 'SCREEN_REGISTER_RATE_LIMITED', message: 'Too Many Requests: fingerprint registered recently, retry after 15 minutes' }, HttpStatus.TOO_MANY_REQUESTS);
      }
      _registerFpCooldown.set(fpKey, Date.now());
      // Prune stale entries to avoid unbounded growth.
      if (_registerFpCooldown.size > 10_000) {
        const cutoff = Date.now() - REGISTER_FP_COOLDOWN_MS;
        for (const [k, ts] of _registerFpCooldown) {
          if (ts < cutoff) _registerFpCooldown.delete(k);
        }
      }
    }

    // Device JWT — tied to this screenId + fingerprint. Browser players
    // have no /devices/pair code-exchange flow (the pairing code is null'd
    // as soon as an admin claims), so /screens/register mints the token
    // here and the player stores it. Before admin claim the token can't
    // see any tenant data (manifest 404s); after claim the same token
    // gains access to the newly-bound tenant's manifest automatically.
    //
    // sec-fix(P0 #7) Defense 2: unpaired tokens expire in 15 minutes so a
    // stolen or guessed pre-claim token is worthless once the window lapses.
    //
    // sec-fix(P0 #5) Graduated trust for paired re-registration:
    //   - Caller proves possession of prior device JWT → 365-day token.
    //   - Caller has fingerprint only (no/invalid prior token) and
    //     STRICT_REPAIR_AUTH=true → 1-hour short-lived token + requiresRePair.
    //   - STRICT_REPAIR_AUTH=false (default) → preserve legacy behavior
    //     (issue 365-day token) so existing kiosks ≤ v1.0.33 keep working
    //     until a fleet-wide APK update ships priorDeviceToken support.
    //     Flip STRICT_REPAIR_AUTH=true after fleet update.
    //   - Prior token INVALID (wrong screenId) → hard 401 regardless of flag.
    //   - Prior token EXPIRED → downgrade to 1-hour fallback (don't reject,
    //     legitimate kiosk may have had its token expire mid-day).
    const strictRepairAuth = process.env.STRICT_REPAIR_AUTH === 'true';

    const deviceJwtSecret = requireSecret('DEVICE_JWT_SECRET', { devFallback: 'dev_only_device_jwt_secret_CHANGE_ME' });

    // CYCLE-3 emergency-011: include `deviceId` and `tenantId` in the payload.
    // The realtime gateway (apps/api/src/realtime/realtime.gateway.ts:125-127)
    // reads `decoded.deviceId` / `decoded.tenantId` to populate ClientContext
    // and route signed WS broadcasts via broadcastToScope. Without these
    // fields the match `ctx.deviceId === id` / `ctx.tenantId === id` always
    // fails in production and every emergency event drops on the WS path
    // (players fall back to 10s HTTP polling — life-safety regression).
    //
    // `sub` and `deviceId` carry the same screenId — `sub` is the JWT
    // standard claim and is preserved so existing verifiers
    // (player-logs.controller, verifyDeviceForScreen, verifyPriorToken,
    // JwtAuthGuard) continue to work unchanged. The dev-only
    // `dev_<screenId>_<tenantId>` token branch in the gateway already
    // populates these fields, which masked the prod bug.
    //
    // BACKWARD COMPAT: existing paired kiosks hold tokens minted before
    // this fix that lack deviceId/tenantId. Those tokens still parse
    // (additive payload only), but their WS broadcastToScope match will
    // continue to fail until the device re-fetches a token via the next
    // /screens/register or /devices/pair round-trip. HTTP-polling
    // fallback keeps those screens functional in the meantime.
    //
    // For unpaired devices (no tenant claim yet) tenantId is omitted —
    // they aren't subscribed to any tenant scope until claimed.
    const mintDeviceJwt = (
      screenId: string,
      isPaired: boolean,
      ttl?: string,
      tenantId?: string | null,
    ) => {
      const expiresIn = (ttl ?? (isPaired ? '365d' : '15m')) as import('jsonwebtoken').SignOptions['expiresIn'];
      const payload: Record<string, unknown> = {
        sub: screenId,
        deviceId: screenId,
        kind: 'device',
        fp: body.deviceFingerprint,
      };
      if (tenantId) payload.tenantId = tenantId;
      return jwt.sign(payload, deviceJwtSecret, { expiresIn });
    };

    /**
     * Validate priorDeviceToken (if supplied) against the given screenId.
     * Returns:
     *   'valid'   — token decoded, kind=device, sub===screenId, not expired
     *   'expired' — token is for correct screen but has expired (downgrade TTL)
     *   'invalid' — wrong screenId or tampered (hard 401)
     *   'absent'  — no priorDeviceToken sent
     */
    const verifyPriorToken = (screenId: string): 'valid' | 'expired' | 'invalid' | 'absent' => {
      if (!body.priorDeviceToken) return 'absent';
      try {
        const decoded = jwt.verify(body.priorDeviceToken, deviceJwtSecret) as any;
        if (decoded?.kind !== 'device') return 'invalid';
        if (decoded?.sub !== screenId) return 'invalid';
        return 'valid';
      } catch (e: any) {
        if (e?.name === 'TokenExpiredError') {
          // Decode without verification to check screenId binding.
          const decoded = jwt.decode(body.priorDeviceToken) as any;
          if (!decoded || decoded?.kind !== 'device') return 'invalid';
          if (decoded?.sub !== screenId) return 'invalid';
          return 'expired';
        }
        return 'invalid';
      }
    };

    if (existing) {
      // ── Paired re-registration — graduated trust (sec-fix P0 #5) ──────────
      if (existing.tenantId) {
        const priorStatus = verifyPriorToken(existing.id);

        if (priorStatus === 'invalid') {
          // Caller supplied a token but it binds to a different screen →
          // hard reject regardless of flag. Fingerprint alone is not enough
          // to prove identity when a token was actively presented.
          throw new HttpException({ code: 'SCREEN_TOKEN_MISMATCH', message: 'Invalid prior device token: screenId mismatch' }, HttpStatus.UNAUTHORIZED);
        }

        // Determine issued TTL:
        //   valid prior token → 365d (caller proved possession)
        //   expired prior token → 1h fallback (device woke up with stale creds)
        //   absent prior token + strictRepairAuth=false → 365d (legacy compat)
        //   absent prior token + strictRepairAuth=true → 1h + requiresRePair
        let issuedTtl: string;
        let requiresRePair = false;

        if (priorStatus === 'valid') {
          issuedTtl = '365d';
        } else if (priorStatus === 'expired') {
          // Device came back with an expired token — downgrade, don't block.
          issuedTtl = '1h';
          requiresRePair = true;
        } else {
          // absent
          if (strictRepairAuth) {
            issuedTtl = '1h';
            requiresRePair = true;
          } else {
            // Legacy path: STRICT_REPAIR_AUTH not yet enabled.
            // Issue 365d as before so kiosks ≤ v1.0.33 keep working.
            issuedTtl = '365d';
          }
        }

        // 2026-05-27 — back-fill hardwareModel if it's still null on
        // an already-paired screen (every screen paired before the
        // auto-detect landed). inferIfUnknown returns null when the
        // column already has a value, so this NEVER overwrites a
        // manual override an admin set via the dashboard.
        const detectedHardware = inferIfUnknown(
          { userAgent: body.userAgent || existing.userAgent, osInfo: body.osInfo || existing.osInfo },
          (existing as any).hardwareModel,
        );
        const updated = await this.prisma.client.screen.update({
          where: { id: existing.id },
          data: {
            resolution: body.resolution || existing.resolution,
            osInfo: body.osInfo || existing.osInfo,
            browserInfo: body.browserInfo || existing.browserInfo,
            userAgent: body.userAgent || existing.userAgent,
            ipAddress: clientIpFromRequest(req),
            lastPingAt: new Date(),
            status: 'ONLINE',
            ...(detectedHardware ? { hardwareModel: detectedHardware } : {}),
          },
        });

        return {
          screenId: updated.id,
          pairingCode: updated.pairingCode,
          paired: true,
          name: updated.name,
          deviceToken: mintDeviceJwt(updated.id, true, issuedTtl, existing.tenantId),
          ...(requiresRePair ? { requiresRePair: true } : {}),
        };
      }

      // ── Unpaired re-registration (no tenantId yet) ────────────────────────
      // 2026-05-27 — same hardware auto-detect as the paired branch.
      // inferIfUnknown returns null when the column already has a
      // value so this is back-fill-only.
      const detectedHardwareUnpaired = inferIfUnknown(
        { userAgent: body.userAgent || existing.userAgent, osInfo: body.osInfo || existing.osInfo },
        (existing as any).hardwareModel,
      );
      const updated = await this.prisma.client.screen.update({
        where: { id: existing.id },
        data: {
          resolution: body.resolution || existing.resolution,
          osInfo: body.osInfo || existing.osInfo,
          browserInfo: body.browserInfo || existing.browserInfo,
          userAgent: body.userAgent || existing.userAgent,
          ipAddress: clientIpFromRequest(req),
          lastPingAt: new Date(),
          status: 'PENDING',
          ...(detectedHardwareUnpaired ? { hardwareModel: detectedHardwareUnpaired } : {}),
        },
      });
      return {
        screenId: updated.id,
        pairingCode: updated.pairingCode,
        paired: false,
        name: updated.name,
        deviceToken: mintDeviceJwt(updated.id, false), // sec-fix(P0 #7): unpaired → 15m TTL
      };
    }

    // New device — create with pairing code.
    // FIX (player-009): the previous retry budget was 10 attempts — on
    // the 11th collision the controller fell through to a unique-index
    // 500 because the duplicate pairingCode hit the DB. The 6-char code
    // in a 32-char alphabet has a 32^6 ≈ 1.07B namespace; a real fleet
    // of 100k unpaired screens has a per-code collision rate of <1e-4,
    // and 100 retries at that rate is effectively zero (1e-400-ish).
    // We also fall back to an 8-char code after 50 collisions in case
    // the namespace is artificially exhausted (test seeding, malicious
    // pre-claiming, etc) so that an unpaired kiosk NEVER receives 500.
    let pairingCode = generatePairingCode();
    let pairingCodeLength = 6;
    for (let attempt = 0; attempt < 100; attempt++) {
      const exists = await this.prisma.client.screen.findUnique({ where: { pairingCode } });
      if (!exists) break;
      // After 50 collisions at length 6, escalate to length 8 — same
      // alphabet, ~1.1T-entry namespace. This branch is essentially
      // unreachable in practice but keeps the failure mode bounded.
      if (attempt >= 50 && pairingCodeLength === 6) {
        pairingCodeLength = 8;
      }
      pairingCode = generatePairingCode(pairingCodeLength);
    }

    // 2026-05-27 — auto-detect hardware model from the userAgent on
    // first register. existingHardwareModel is undefined here (brand
    // new row), so inferIfUnknown returns the detected value when the
    // UA matches a known device, else null (which we coerce to
    // undefined so Prisma doesn't write a null instead of skipping the
    // column default).
    const detectedHardware = inferIfUnknown(
      { userAgent: body.userAgent, osInfo: body.osInfo },
      undefined,
    );
    const screen = await this.prisma.client.screen.create({
      data: {
        name: `Screen-${pairingCode}`,
        deviceFingerprint: body.deviceFingerprint,
        pairingCode,
        status: 'PENDING',
        resolution: body.resolution || null,
        osInfo: body.osInfo || null,
        browserInfo: body.browserInfo || null,
        userAgent: body.userAgent || null,
        ipAddress: clientIpFromRequest(req),
        lastPingAt: new Date(),
        ...(detectedHardware ? { hardwareModel: detectedHardware } : {}),
      },
    });

    return {
      screenId: screen.id,
      pairingCode: screen.pairingCode,
      paired: false,
      name: screen.name,
      deviceToken: mintDeviceJwt(screen.id, false), // sec-fix(P0 #7): unpaired → 15m TTL
    };
  }

  // ─── PUBLIC: Device heartbeat / status check ───
  @Get('status/:deviceFingerprint')
  async deviceStatus(
    @Param('deviceFingerprint') fingerprint: string,
    @Query('v') versionName?: string,
    @Query('vc') versionCode?: string,
    @Query('mv') managerVersionName?: string,
    @Request() req?: any,
  ) {
    // Preview fingerprints must never write lastPingAt — they would push
    // the real paired kiosk's status to ONLINE even after closing the tab.
    if (fingerprint.startsWith('preview-')) {
      return { screenId: null, paired: false, name: 'Preview', pairingCode: null, isPreview: true };
    }

    // Phase B — wrap the 3 DB hits in this hot endpoint with bounded
    // retry. The Supabase pooler trips on prepared-statement reuse a
    // few times per hour; without retry, those become a 500 → kiosk
    // briefly shows OFFLINE on the dashboard. With retry, the second
    // attempt almost always succeeds inside 100ms and the user sees
    // nothing. See with-db-retry.ts for the transient-error classifier.
    const screen = await withDbRetry(
      () => this.prisma.client.screen.findUnique({
        where: { deviceFingerprint: fingerprint },
      }),
      { label: 'screen.findUnique[fp]' },
    );
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Update lastPingAt — and if the kiosk passed its app version on
    // this heartbeat, capture it too. Operator (2026-04-27): "we
    // shouldnt have to wait 6 hours to see an updated version, why
    // not grab that everytime the screen checks in?"
    //
    // The Kotlin HeartbeatService sends ?v=BuildConfig.VERSION_NAME
    // (and optionally ?vc=BuildConfig.VERSION_CODE) on every 30s
    // heartbeat — same fields the OTA endpoint already accepts but
    // 720× more often. Old kiosks that don't pass the params still
    // work; they just won't update the version field until their
    // next /update-check.
    const data: any = {
      lastPingAt: new Date(),
      status: screen.tenantId ? 'ONLINE' : 'PENDING',
    };
    const vn = (versionName || '').trim();
    if (vn) {
      data.playerVersion = vn;
      data.playerVersionAt = new Date();
      const vc = Number(versionCode);
      if (Number.isFinite(vc) && vc > 0) {
        data.playerVersionCode = vc;
        const priorVc = Number((screen as any).playerVersionCode || 0);
        if ((screen as any).forceApkUpdatePendingAt && vc > priorVc) {
          data.forceApkUpdatePendingAt = null;
          data.lastOtaState = 'INSTALLED';
          data.lastOtaProgress = 100;
          data.lastOtaMessage = `Installed v${vn}`;
          data.lastOtaAt = new Date();
        }
      }
    }
    // v1.0.13 — Manager APK version, queried by Player via
    // PackageManager and passed as ?mv=. v1.0.18+ Player ALSO sends
    // ?mv= (with empty value) when Manager isn't installed — that
    // empty value is the explicit "Manager was uninstalled" signal,
    // which we now use to clear the field. Operator (2026-04-28):
    // "i deleted the old manager so cant be" — dashboard chip was
    // showing v1.0.1 long after they uninstalled because we
    // intentionally never cleared the column.
    //
    //   undefined  → param NOT in query (Player v1.0.12 or earlier
    //                that doesn't know about Manager) — leave alone
    //   ''         → Player explicitly says "no Manager installed" — clear
    //   '1.0.3'    → set
    if (managerVersionName !== undefined) {
      const mv = managerVersionName.trim();
      if (mv) {
        data.managerVersion = mv;
        data.managerVersionAt = new Date();
      } else {
        // Explicit empty — Manager uninstalled. Clear so dashboard
        // chip reflects reality.
        data.managerVersion = null;
        data.managerVersionAt = null;
      }
    }
    // Diagnostic logging — used to fire on EVERY heartbeat (every 3s
    // per kiosk = ~28k Railway log lines per screen per day). 2026-05-23
    // launch audit P0 efficiency: tighten to "log only when something
    // CHANGED" so we keep the diagnostic value (which was added to
    // catch the v1.0.11 OTA-chip-stuck-blank bug on 2026-04-27) without
    // flooding logs at fleet scale.
    const fpShort = fingerprint.slice(0, 18);
    const versionChanged = vn && vn !== screen.playerVersion;
    const rawUrl = req?.originalUrl || req?.url || '(unknown)';
    const userAgent = req?.headers?.['user-agent'] || '(no-ua)';
    const isApkUa = /EduCmsPlayer/i.test(userAgent);
    if (versionChanged) {
      // Real signal: the kiosk just rolled to a new player version.
      // Worth the log line for forensics + dashboard chip diagnostics.
      console.log(
        `[heartbeat] fp=${fpShort}… v=${vn || '(NONE)'} vc=${versionCode || '(NONE)'} ` +
        `prior=${screen.playerVersion || '(none)'} changed=${versionChanged} ` +
        `apk-ua=${isApkUa} url=${String(rawUrl).slice(0, 200)}`,
      );
    }
    // Write-amplification fix (audit P0): the player heartbeats every 3s and
    // sends ?v= every time, so the old code wrote lastPingAt + playerVersion
    // on EVERY poll and then did a SECOND findUnique to re-read OTA state —
    // 3 sequential round-trips per screen per 3s (~43M queries/day at 500
    // screens) on the connection_limit=10 pool. Collapse it:
    //   • WRITE only when something meaningful changed (version / manager /
    //     OTA-install-clear) OR the 25s ping debounce is due — the same
    //     shouldSkipLastPingWrite() debounce the manifest path already uses
    //     (lastPingAt is at most ~25s stale, well within the 2-min offline
    //     threshold).
    //   • Return the OTA fields from the update's OWN select, so the third
    //     query disappears. When we skip the write, the row already fetched
    //     above (full select) serves the response.
    // Result: 1 query on the common poll (unchanged version, debounced),
    // 2 on a write — never 3. forceApkUpdatePendingAt is read from the
    // always-fresh findUnique above, so OTA pushes are still detected
    // immediately even on a debounced poll.
    const OTA_SELECT = {
      lastOtaState: true,
      lastOtaProgress: true,
      lastOtaMessage: true,
      lastOtaAt: true,
      playerVersion: true,
      managerVersion: true,
      forceApkUpdatePendingAt: true,
    } as const;

    const managerChanged =
      managerVersionName !== undefined &&
      (data.managerVersion ?? null) !== ((screen as any).managerVersion ?? null);
    const otaCleared = data.forceApkUpdatePendingAt === null;
    const mustWrite = !!versionChanged || managerChanged || otaCleared;
    const pingDue = !shouldSkipLastPingWrite(screen.id);

    let screenAfterUpdate: any = screen;
    if (mustWrite || pingDue) {
      markLastPingWritten(screen.id);
      screenAfterUpdate = await withDbRetry(
        () => this.prisma.client.screen.update({
          where: { id: screen.id },
          data,
          select: OTA_SELECT as any,
        }),
        { label: 'screen.update[heartbeat]' },
      );
    }
    // 2026-04-29 — operator (push went silent on v1.0.30 kiosk):
    // "pushed, nothing happened anywhere" + dashboard showed
    // "waiting for kiosk (≤ 35 min via periodic check)". WS push
    // is fragile — kiosk's WebSocket re-handshake after the prior
    // install can miss messages. Yodeck/Rise/etc. poll instead.
    //
    // Fix: surface forceUpdatePending on this heartbeat response.
    // Web player checks this every ~30s and fires bridge.
    // checkForUpdates locally if set. Recovers any failed-WS push
    // within one heartbeat tick. The 24h freshness window matches
    // the server-side gate in /update-check so we don't fire
    // forever on a stale flag.
    const forceAt = (screenAfterUpdate as any)?.forceApkUpdatePendingAt;
    const FORCE_FRESH_MS = 24 * 60 * 60 * 1000;
    const forceUpdatePending = !!forceAt &&
      (Date.now() - new Date(forceAt).getTime()) < FORCE_FRESH_MS;
    return {
      screenId: screen.id,
      paired: !!screen.tenantId,
      name: screen.name,
      pairingCode: screen.pairingCode,
      ota: screenAfterUpdate ? {
        state: (screenAfterUpdate as any).lastOtaState || null,
        progress: (screenAfterUpdate as any).lastOtaProgress ?? null,
        message: (screenAfterUpdate as any).lastOtaMessage || null,
        at: (screenAfterUpdate as any).lastOtaAt || null,
      } : null,
      versions: screenAfterUpdate ? {
        player: (screenAfterUpdate as any).playerVersion || null,
        manager: (screenAfterUpdate as any).managerVersion || null,
      } : null,
      // Heartbeat-driven polling fallback for missed WS pushes.
      forceUpdatePending,
      forceUpdatePendingAt: forceAt ? new Date(forceAt).toISOString() : null,
    };
  }

  // ─── PUBLIC: Per-phase OTA state report from the device ──────────
  // Called by OtaUpdateWorker on the Android player at each phase of
  // an OTA install so the dashboard can show real progress instead of
  // stopwatch theater.
  //
  // Body shape (all optional except state):
  //   { state: 'CHECKING'|'DOWNLOADING'|'VERIFYING'|'INSTALLING'|'INSTALLED'|'ERROR',
  //     progress?: 0-100,   // download %, only meaningful during DOWNLOADING
  //     message?: string }  // human-readable detail (used for ERROR)
  //
  // Public (no auth) for the same reason /screens/status is public:
  // the kiosk has a device JWT but using it adds latency; this
  // endpoint just records non-sensitive progress + is rate-limited
  // implicitly by the caller's heartbeat cadence (a worker firing
  // every minute would still only generate 5-7 reports per OTA).
  @Post('status/:deviceFingerprint/ota-state')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async reportOtaState(
    @Param('deviceFingerprint') fingerprint: string,
    @Body() body: { state?: string; progress?: number; message?: string },
  ) {
    if (fingerprint.startsWith('preview-')) return { ok: true, ignored: 'preview' };
    const screen = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: fingerprint },
      select: { id: true, name: true, lastOtaState: true, playerVersionCode: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const ALLOWED = new Set([
      'CHECKING', 'DOWNLOADING', 'VERIFYING', 'INSTALLING', 'INSTALLED', 'ERROR',
    ]);
    const state = String(body?.state || '').toUpperCase().trim();
    if (!ALLOWED.has(state)) {
      throw new HttpException({ code: 'SCREEN_OTA_STATE_INVALID', message: `Invalid state: ${state}` }, HttpStatus.BAD_REQUEST);
    }
    const progress = typeof body?.progress === 'number' && Number.isFinite(body.progress)
      ? Math.max(0, Math.min(100, Math.round(body.progress)))
      : null;
    const message = body?.message ? String(body.message).slice(0, 500) : null;

    // 2026-05-12 — operator: "the text says update complete to .54 but
    // the installed version says .52 still". Root cause: Manager's
    // SELF-update worker calls reportOtaState(INSTALLED, "Manager v...
    // (up to date)") on every periodic tick to clear its own stale
    // ERROR banner. That OVERWRITES the Player OTA state column —
    // which was sitting on INSTALLING from the actual Player upgrade
    // attempt. The web splash UI fires "Update complete to v1.0.54"
    // when it sees state=INSTALLED, regardless of whether the
    // playerVersionCode actually changed.
    //
    // Fix: discard Manager-self-update noise from the Player OTA state
    // column. Manager reports its own state with messages like
    // "Manager v1.0.17-debug (up to date)" — those are about MANAGER,
    // not Player, and must not pollute the Player upgrade state UI.
    //
    // We detect Manager self-update by the message prefix the worker
    // uses (apps/player/manager/.../ManagerSelfUpdateWorker.kt lines
    // 120, 127). If the API needs richer routing later, add a source
    // field to the request body; the prefix check is enough today.
    const isManagerSelfReport = !!message && /^Manager v/i.test(message);
    if (isManagerSelfReport) {
      console.log(
        `[ota-state] fp=${fingerprint.slice(0, 18)}… IGNORED Manager-self-update ` +
        `noise (state=${state} msg="${(message || '').slice(0, 60)}") — would have ` +
        `falsely overwritten Player OTA state column`,
      );
      return { ok: true, ignored: 'manager-self-update-noise' };
    }

    // 2026-05-12 — also guard against state=INSTALLED being written
    // when the kiosk's reported playerVersionCode hasn't actually
    // increased. The kiosk reports versionCode every heartbeat; the
    // ONLY proof an install really landed is the versionCode bump.
    // If a worker over-eagerly reports INSTALLED without an actual
    // upgrade, downgrade it to the prior state so the splash banner
    // doesn't lie. The legitimate INSTALLED is written by the
    // persistReportedVersion path (line ~500 of this file) when a
    // genuine versionCode bump is detected.
    if (state === 'INSTALLED') {
      console.log(
        `[ota-state] fp=${fingerprint.slice(0, 18)}… INSTALLED received but ` +
        `playerVersionCode=${(screen as any).playerVersionCode ?? '?'} — only ` +
        `version-bump path writes INSTALLED, ignoring this report to prevent ` +
        `false "Update complete" banner`,
      );
      return { ok: true, ignored: 'installed-without-version-bump' };
    }

    await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: {
        lastOtaState: state,
        lastOtaProgress: progress,
        lastOtaMessage: message,
        lastOtaAt: new Date(),
      } as any,
    });

    console.log(
      `[ota-state] fp=${fingerprint.slice(0, 18)}… state=${state} ` +
      `progress=${progress ?? '-'} message=${(message || '').slice(0, 80)}`,
    );

    return { ok: true };
  }

  // ─── PUBLIC: Crash report from Player or Manager APK (Phase 2) ───
  // Called by an UncaughtExceptionHandler in each APK when something
  // throws fatally. Dashboard surfaces the most recent crash so we
  // can correlate with versionCode and ship a fix without waiting
  // for an operator to hand-walk through logcat.
  //
  // Body shape:
  //   { source: 'player'|'manager',
  //     versionName: string,
  //     versionCode?: number,
  //     message: string,
  //     stack: string }
  //
  // Stack trace truncated at 8KB on the server side — large enough
  // for any Kotlin trace, small enough to keep Postgres rows from
  // bloating. Operator can pull the full trace via the existing
  // PlayerLogger.uploadDiagnostics path if more depth is needed.
  @Post('status/:deviceFingerprint/crash-report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async reportCrash(
    @Param('deviceFingerprint') fingerprint: string,
    @Body() body: {
      source?: string;
      versionName?: string;
      versionCode?: number;
      message?: string;
      stack?: string;
    },
  ) {
    if (fingerprint.startsWith('preview-')) return { ok: true, ignored: 'preview' };
    const screen = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: fingerprint },
      select: { id: true, name: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const source = (body?.source || '').toLowerCase().trim();
    if (source !== 'player' && source !== 'manager') {
      throw new HttpException({ code: 'SCREEN_CRASH_SOURCE_INVALID', message: `Invalid source: ${source} (expected player or manager)` }, HttpStatus.BAD_REQUEST);
    }
    const message = (body?.message || '').slice(0, 500) || null;
    const stack = (body?.stack || '').slice(0, 8 * 1024) || null;
    const versionName = body?.versionName ? String(body.versionName).slice(0, 40) : null;

    await this.prisma.client.screen.update({
      where: { id: screen.id },
      data: {
        lastCrashAt: new Date(),
        lastCrashSource: source,
        lastCrashVersion: versionName,
        lastCrashMessage: message,
        lastCrashStack: stack,
      } as any,
    });

    // Loud Railway log — these are real crashes; we want them
    // visible in the operator's daily-glance scroll, not buried.
    console.error(
      `[crash] fp=${fingerprint.slice(0, 18)}… source=${source} version=${versionName ?? '-'} ` +
      `message="${(message || '').slice(0, 200)}"`,
    );

    return { ok: true };
  }

  /**
   * Parse the Chromium major version out of a stored User-Agent. We already
   * capture the full UA at register/heartbeat (Screen.userAgent); this surfaces
   * the version so operators see real per-screen browser-engine compatibility
   * instead of us guessing from a months-old incident. Returns null if the UA
   * has no Chrome token (e.g. desktop Safari dev browsers).
   *
   * Engine cutoffs that matter for our widget CSS (so the dashboard can warn):
   *   < 87  → no CSS `inset` shorthand        (swept; long-hand everywhere)
   *   < 84  → no flex `gap`                    (runtime polyfill on the player)
   *   < 105 → no container-query units (cqmin/cqh) and no `:has()`
   * The lowest live box (NovaStar/rk356x LED controller) reports Chrome 83.
   */
  private chromiumMajor(ua?: string | null): number | null {
    if (!ua || typeof ua !== 'string') return null;
    const m = /Chrome\/(\d+)/.exec(ua);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  }

  // ─── ADMIN: List all screens in tenant ───
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any, @Res({ passthrough: true }) res?: any) {
    // Force-no-cache — the fleet list is a live feed. Without this some
    // intermediaries / service workers were serving the same payload
    // for minutes after it changed, so a user who uninstalled an APK
    // still saw ONLINE until they manually cleared site data.
    if (res?.setHeader) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    const rows = await this.prisma.client.screen.findMany({
      where: { tenantId: req.user.tenantId },
      // syncMode (2026-07-28): the list view badges frame-locked groups —
      // one extra scalar on an already-joined row, no new query.
      include: { screenGroup: { select: { id: true, name: true, syncMode: true } as any } },
      orderBy: { name: 'asc' },
    });
    // Pull the tenant's saved address/coords once so every screen WITHOUT
    // its own per-screen lat/lng can fall back to the building location
    // on the fleet map. Operator expectation: "I set the building's
    // address — every screen there should show up at that pin." See
    // ScreenMap.tsx for how `effectiveLatitude/Longitude` and `geoSource`
    // are consumed. Per-screen "Set location" still wins because we
    // keep `latitude/longitude` as the screen-specific coords.
    const tenantGeo = await this.prisma.client.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { latitude: true, longitude: true, address: true },
    });
    // Compute live online/offline from lastPingAt recency. The stored
    // `status` column only flips on register/pair/ping and never back,
    // so a player that dies silently was showing ONLINE forever. Two
    // minutes matches the heartbeat cadence (30s) + 4x grace.
    // Near-real-time fleet status. Heartbeat cadence is 30s; grace is
    // tightened to 35s (was 45s) so a dead player flips OFFLINE ~5s after
    // its first missed ping. Paired with the dashboard's 10s refetch,
    // worst case device-dies → admin-sees-OFFLINE is ~45s (previously
    // 55s). 5s buffer is enough for normal network jitter without
    // causing false offlines; a screen that legitimately loses a single
    // ping will recover by the next 30s tick.
    const STALE_MS = 35 * 1000;
    const now = Date.now();
    return rows.map((s) => {
      // If a device is actively pinging, mark ONLINE regardless of
      // stored column. If stale, flip to OFFLINE unless the stored
      // state is something stronger (PENDING means never paired, keep;
      // REVOKED trumps all; ONLINE that's gone stale becomes OFFLINE).
      let liveStatus: string = s.status;
      if (s.status !== 'REVOKED') {
        const last = s.lastPingAt ? new Date(s.lastPingAt).getTime() : 0;
        const isAlive = last && (now - last) < STALE_MS;
        if (isAlive && s.tenantId) liveStatus = 'ONLINE';
        else if (s.status === 'ONLINE' || s.tenantId) liveStatus = 'OFFLINE';
      }
      // ── Render-proof overlay (2026-05-29) ───────────────────────────
      // ADDITIVE: `liveStatus` (ONLINE/OFFLINE/PENDING/REVOKED) is computed
      // above from lastPingAt EXACTLY as before — untouched. Render-proof
      // is a SEPARATE `renderHealth` field that catches the failure
      // lastPingAt structurally CANNOT: a kiosk that's TCP-reachable
      // (fresh ping → ONLINE) but whose renderer is wedged showing a
      // stuck/black frame. The player advances a paint counter only when
      // it actually composites a frame and POSTs it to /render-proof; a
      // stale lastRenderedAt on an ONLINE screen means "looks online,
      // shows nothing" → STALE/RED. We do NOT mutate `status` for this
      // (the fleet map keys OFFLINE off `status !== 'ONLINE'`, and a
      // frozen screen is reachable, not offline) — UIs read renderHealth.
      const renderProof = deriveRenderHealth({
        isLiveOnline: liveStatus === 'ONLINE',
        lastRenderedAtMs: (s as any).lastRenderedAt
          ? new Date((s as any).lastRenderedAt).getTime()
          : null,
        nowMs: now,
      });
      // Strip heavyweight columns from the LIST response. The dashboard
      // polls /screens every 10s; at fleet scale these fields dominate
      // egress without ever being read by the list view:
      //   - lastCrashStack: up to 8KB Kotlin/JS stack from the player
      //     APK's last crash. Surfaced only on the per-screen detail
      //     drill-in, which fetches the screen by id directly.
      //   - lastSelfTestReport / userAgent: similar — drill-in only.
      //
      // 1k screens × 8KB stack = 8 MB per poll. With 100 admins online
      // that's 80 MB/s of pure egress on a field nobody reads from the
      // list. We deliberately KEEP lastCacheReport (used by the Map
      // view's per-pin emergency-cache badge in apps/web/src/components/
      // screens/ScreenMap.tsx).
      const { lastCrashStack: _stack, lastSelfTestReport: _self, ...rest } = s as any;
      const chromiumMajor = this.chromiumMajor((s as any).userAgent);
      // Effective geo for the fleet map: screen-specific wins, tenant
      // building location is the fallback, none → screen stays off the
      // map. geoSource lets the UI badge "building location" so the
      // operator knows it's not a precise pin.
      const hasScreenCoords = s.latitude != null && s.longitude != null;
      const hasTenantCoords =
        tenantGeo?.latitude != null && tenantGeo?.longitude != null;
      const effectiveLatitude = hasScreenCoords
        ? s.latitude
        : (hasTenantCoords ? tenantGeo!.latitude : null);
      const effectiveLongitude = hasScreenCoords
        ? s.longitude
        : (hasTenantCoords ? tenantGeo!.longitude : null);
      const effectiveAddress = hasScreenCoords
        ? (s as any).address ?? null
        : (hasTenantCoords ? tenantGeo!.address ?? null : null);
      const geoSource: 'screen' | 'tenant' | 'none' = hasScreenCoords
        ? 'screen'
        : (hasTenantCoords ? 'tenant' : 'none');
      return {
        ...rest,
        status: liveStatus,
        effectiveLatitude,
        effectiveLongitude,
        effectiveAddress,
        geoSource,
        // Render-proof (2026-05-29). Additive; status above is unchanged.
        //   renderHealth: 'OK'      — painted a frame within the window
        //                 'STALE'   — ONLINE (fresh ping) but NOT painting → RED
        //                 'UNKNOWN' — never reported render-proof (older build /
        //                              fresh pair / offline) — do NOT alarm
        //   renderStale: true only for the frozen-but-reachable case. A fresh
        //   ping ALONE never makes a screen OK or STALE here — only an actual
        //   render-proof POST does.
        renderHealth: renderProof.renderHealth,
        renderStale: renderProof.renderStale,
        renderStaleSeconds: renderProof.renderStaleSeconds,
        // Real browser-engine version + a flag the dashboard uses to warn
        // "this screen can't render container-query templates" etc.
        chromiumMajor,
        cssCompat: chromiumMajor == null
          ? null
          : {
              flexGap: chromiumMajor >= 84,
              inset: chromiumMajor >= 87,
              containerQueryUnits: chromiumMajor >= 105,
              has: chromiumMajor >= 105,
            },
      };
    });
  }

  // ─── Fleet-learned sync-trim presets (tier-2, 2026-07-28) ─────────────
  // docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §8 follow-up.
  // Different display models carry different FIXED glass latencies; when
  // operators trim them (PUT :id/sync-offset) the platform LEARNS: median
  // trim per hardware model across the whole fleet. A new screen of a
  // known-slow model gets a one-tap suggested starting trim instead of a
  // blind hunt. Returns aggregate numbers only.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Get('sync-trim-suggestions')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async syncTrimSuggestions() {
    // ten-ok: intentional CROSS-TENANT numeric aggregate — returns only
    // (hardware model, median trim ms, sample count); no tenant ids, no
    // screen ids, no names, nothing attributable. The whole point is that
    // venue B benefits from venue A having measured the same panel model
    // (the Waze model: anonymized fleet telemetry). HAVING >= 3 keeps any
    // single venue's setup from being inferable.
    const rows = await this.prisma.client.$queryRaw<
      Array<{ hardware_model: string; median_trim_ms: number; sample_count: number }>
    >`
      SELECT
        hardware_model,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY sync_offset_ms)::float8 AS median_trim_ms,
        count(*)::int AS sample_count
      FROM screens
      WHERE sync_offset_ms IS NOT NULL
        AND hardware_model IS NOT NULL
      GROUP BY hardware_model
      HAVING count(*) >= 3
    `;
    return {
      suggestions: rows.map((r) => ({
        hardwareModel: r.hardware_model,
        medianTrimMs: Math.round(r.median_trim_ms),
        sampleCount: r.sample_count,
      })),
    };
  }

  // ─── ADMIN: Fleet roll-up — HQ sees every store's screens (read-only) ───
  //
  // Manager-console pattern (Google MCC / AWS Orgs / NinjaOne): the parent
  // ("Corporate") reads ALL of its child locations' screens into ONE map +
  // list. ASYMMETRIC + READ-ONLY: a parent reads across its DIRECT children
  // (children stay sealed from each other); this endpoint NEVER mutates — any
  // action is taken by switching into the owning store (the frontend
  // deep-links into /[storeSlug]/screens). Isolation + blast-radius stay
  // intact; only the overview spans the chain. A leaf location (no children)
  // resolves to just its own screens — no cross-tenant read.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Get('fleet')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)
  async fleet(@Request() req: any, @Res({ passthrough: true }) res?: any) {
    if (res?.setHeader) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    const rootId = req.user.tenantId as string;
    const sel = { id: true, name: true, slug: true, latitude: true, longitude: true, address: true } as const;
    const self = await this.prisma.client.tenant.findUnique({ where: { id: rootId }, select: sel });
    const children = await this.prisma.client.tenant.findMany({
      // archivedAt: null — an archived child location must NOT count toward the
      // fleet, or a parent with only archived/test children reads as a
      // multi-location "HQ" and the dashboard map appears when it shouldn't
      // (the 2026-07-23 Dodgers incident: two archived test children).
      where: { parentId: rootId, archivedAt: null },
      select: sel,
      orderBy: { name: 'asc' },
    });
    const tenants = [self, ...children].filter(Boolean) as Array<{
      id: string; name: string; slug: string;
      latitude: number | null; longitude: number | null; address: string | null;
    }>;
    const tenantIds = tenants.map((t) => t.id);
    const geoByTenant = new Map(tenants.map((t) => [t.id, { latitude: t.latitude, longitude: t.longitude, address: t.address }]));
    const metaByTenant = new Map(tenants.map((t) => [t.id, { id: t.id, name: t.name, slug: t.slug }]));

    const rows = await this.prisma.client.screen.findMany({
      where: { tenantId: { in: tenantIds } },
      include: { screenGroup: { select: { id: true, name: true } } },
      orderBy: [{ tenantId: 'asc' }, { name: 'asc' }],
    });

    // Live status from lastPingAt recency — MUST mirror list()'s rule
    // (35s = 30s heartbeat + grace). Keep in sync with the GET / mapper.
    const STALE_MS = 35 * 1000;
    const now = Date.now();
    const screens = rows.map((s) => {
      let liveStatus: string = s.status;
      if (s.status !== 'REVOKED') {
        const last = s.lastPingAt ? new Date(s.lastPingAt).getTime() : 0;
        const isAlive = last && (now - last) < STALE_MS;
        if (isAlive && s.tenantId) liveStatus = 'ONLINE';
        else if (s.status === 'ONLINE' || s.tenantId) liveStatus = 'OFFLINE';
      }
      const tg = geoByTenant.get(s.tenantId as string) ?? null;
      const hasScreenCoords = s.latitude != null && s.longitude != null;
      const hasTenantCoords = tg?.latitude != null && tg?.longitude != null;
      const effectiveLatitude = hasScreenCoords ? s.latitude : (hasTenantCoords ? tg!.latitude : null);
      const effectiveLongitude = hasScreenCoords ? s.longitude : (hasTenantCoords ? tg!.longitude : null);
      const effectiveAddress = hasScreenCoords ? ((s as any).address ?? null) : (hasTenantCoords ? (tg!.address ?? null) : null);
      const geoSource: 'screen' | 'tenant' | 'none' = hasScreenCoords ? 'screen' : (hasTenantCoords ? 'tenant' : 'none');
      return {
        id: s.id,
        name: s.name,
        status: liveStatus,
        screenGroup: (s as any).screenGroup ?? null,
        lastPingAt: s.lastPingAt,
        lastCacheReport: (s as any).lastCacheReport ?? null,
        effectiveLatitude,
        effectiveLongitude,
        effectiveAddress,
        geoSource,
        // Which store this screen belongs to — drives the map cluster label
        // + the click→switch deep-link (frontend routes to its slug).
        sourceTenant: metaByTenant.get(s.tenantId as string) ?? null,
      };
    });

    const online = screens.filter((s) => s.status === 'ONLINE').length;
    const offline = screens.filter((s) => s.status === 'OFFLINE').length;
    return {
      root: metaByTenant.get(rootId) ?? null,
      locations: tenants.map((t) => ({ id: t.id, name: t.name, slug: t.slug })),
      stats: { total: screens.length, online, offline, locationCount: tenants.length },
      screens,
    };
  }

  // ─── ADMIN: Pair a screen by code ───
  // NOTE: this endpoint also handles re-pairing an existing tenant's
  // screen (e.g. the operator regenerates a code and another admin in
  // the same tenant claims it). When the resulting tenantId differs
  // from the previously-bound tenantId we publish a TENANT_CHANGED
  // signal on the OLD tenant's channel so the device wipes its USB
  // key + cache before binding to the new tenant — closes the
  // cross-tenant content leak (audit fix #6).
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('pair')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async pair(
    @Request() req: any,
    @Body() body: { pairingCode: string; name?: string; screenGroupId?: string },
  ) {
    const code = body.pairingCode?.trim().toUpperCase();
    if (!code) throw new HttpException({ code: 'SCREEN_PAIRING_CODE_REQUIRED', message: 'Pairing code is required' }, HttpStatus.BAD_REQUEST);

    const screen = await this.prisma.client.screen.findUnique({
      where: { pairingCode: code },
    });

    if (!screen) throw new HttpException({ code: 'SCREEN_PAIRING_CODE_INVALID', message: 'Invalid pairing code. Make sure the code matches what is shown on the screen.' }, HttpStatus.NOT_FOUND);

    if (screen.tenantId && screen.tenantId !== req.user.tenantId) {
      throw new HttpException({ code: 'SCREEN_ALREADY_PAIRED', message: 'This screen is already paired to another organization' }, HttpStatus.CONFLICT);
    }

    // Audit fix #10: wrap the seat-availability check + the screen claim
    // in a SERIALIZABLE transaction so two admins can't simultaneously pass
    // assertSeatAvailable and overshoot the seat limit. Two admins racing
    // the last seat each fall inside the other's predicate → PG SSI aborts
    // one (40001 → Prisma P2034). The seat ceiling always holds.
    //
    // P2-B fix: wrap the whole SERIALIZABLE tx in withDbRetry so the loser
    // of that race gets a clean retry instead of an unhandled 500. P2034 is
    // in withDbRetry's transient set, so it re-runs the ENTIRE thunk (the
    // assertSeatAvailable count AND the screen.update write) against a fresh
    // serializable snapshot. On retry either a seat has freed (succeeds) or
    // the ceiling is still hit and assertSeatAvailable throws a structured
    // 402 LICENSE_EXHAUSTED — which is a plain HttpException, NOT a transient
    // DB error, so withDbRetry re-throws it immediately (no wasteful retry).
    // The success path is unchanged: a tx that commits on the first attempt
    // returns its value with no added latency.
    // Re-pairing a screen that already belongs to this tenant is free.
    const isNewPair = !screen.tenantId;
    const updated = await withDbRetry(
      () =>
        this.prisma.client.$transaction(
          async (tx) => {
            if (isNewPair) {
              await this.license.assertSeatAvailable(req.user.tenantId, tx);
            }
            return tx.screen.update({
              where: { id: screen.id },
              data: {
                tenantId: req.user.tenantId,
                name: body.name?.trim() || screen.name,
                screenGroupId: body.screenGroupId || null,
                status: 'ONLINE',
                pairedAt: new Date(),
                pairingCode: null, // Clear the code after pairing
              },
              include: { screenGroup: { select: { id: true, name: true } } },
            });
          },
          {
            isolationLevel: 'Serializable',
            // Default is 5s but Supabase's pgbouncer + SERIALIZABLE can
            // push past that on first connection. Raise to 20s so we
            // don't 500 on slow networks; user sees a crisp error either
            // way if the actual work exceeds 20s (which means something
            // is very wrong). maxWait bumps the pool acquisition timeout
            // so we don't fail before the transaction even starts.
            timeout: 20000,
            maxWait: 10000,
          },
        ),
      { label: 'screen.pair.seatClaim' },
    );

    // Audit fix #6: if this re-pair changed the tenant, blast a
    // TENANT_CHANGED message on the OLD tenant's channel so the
    // physical device wipes its DataStore (token, tenantId,
    // usbIngestKey) and its filesDir/usb-cache before re-pairing
    // against the new tenant. Without this, a kiosk physically moved
    // between districts would keep serving its old tenant's emergency
    // assets from disk.
    const previousTenantId = screen.tenantId;
    if (previousTenantId && previousTenantId !== req.user.tenantId) {
      try {
        const signed = this.signer.signMessage('TENANT_CHANGED', {
          screenId: screen.id,
          previousTenantId,
          newTenantId: req.user.tenantId,
        });
        await this.redisService.publish(`tenant:${previousTenantId}`, signed);
      } catch (e) {
        console.warn('[pair] failed to notify previous tenant of TENANT_CHANGED', e);
      }
    }

    this.notifySync(req.user.tenantId);
    // Keep the tenant's Stripe subscription quantity in lockstep with
    // live paired-screen usage (Stripe auto-prorates). Fire-and-forget
    // — a Stripe hiccup must never block pairing. A cross-tenant
    // re-pair also re-syncs the tenant that just lost the screen.
    this.stripe.syncSubscriptionQuantity(req.user.tenantId).catch(() => {});
    if (previousTenantId && previousTenantId !== req.user.tenantId) {
      this.stripe.syncSubscriptionQuantity(previousTenantId).catch(() => {});
    }
    return updated;
  }

  /**
   * Device-initiated unpair. The player calls this when the operator
   * taps "Unpair" on the kiosk overlay. Without it, clearing the
   * device's local token + reloading just re-registers under the same
   * stable Android fingerprint and the SERVER returns paired:true
   * again — the visible "unpair" did nothing.
   *
   * Effect:
   *   - tenantId cleared → next register returns paired:false
   *   - new pairingCode generated → screen can be re-paired from any
   *     dashboard the operator has access to
   *   - schedules for this screen deleted (no point in firing alerts
   *     at a now-disowned device, and a future re-pair starts fresh)
   *   - status flipped to PENDING
   *
   * Auth: requires a valid device JWT in `Authorization: Bearer ...`
   * that binds to the same screenId as the fingerprint we found.
   * Anyone with a fingerprint alone can't unpair someone else's screen.
   *
   * 2026-05-13 — operator: "i tried to unpair a device and it didnt
   * unpair". Root cause was the missing server-side step described
   * above; this endpoint closes the loop.
   */
  @Post('unpair/:deviceFingerprint')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async deviceInitiatedUnpair(
    @Param('deviceFingerprint') fingerprint: string,
    @Req() req: ExpressReq,
  ) {
    if (fingerprint.startsWith('preview-')) {
      return { ok: true, ignored: 'preview' };
    }
    const screen = await this.prisma.client.screen.findUnique({
      where: { deviceFingerprint: fingerprint },
    });
    if (!screen) {
      // Nothing to unpair — return success (idempotent).
      return { ok: true, alreadyUnpaired: true };
    }
    // Verify the caller actually owns this screen via device JWT.
    const verified = verifyDeviceForScreen(req, screen.id);
    if (!verified.ok) {
      throw new HttpException({ code: 'SCREEN_UNPAIR_UNAUTHORIZED', message: `Unauthorized: ${verified.reason}` }, HttpStatus.UNAUTHORIZED);
    }

    const previousTenantId = screen.tenantId;

    // Generate a fresh pairing code (retry on rare collision — same
    // loop as @Post('register')'s new-device path).
    let newPairingCode = generatePairingCode();
    let codeLength = 6;
    for (let attempt = 0; attempt < 50; attempt++) {
      const exists = await this.prisma.client.screen.findUnique({
        where: { pairingCode: newPairingCode },
      });
      if (!exists || exists.id === screen.id) break;
      if (attempt >= 25 && codeLength === 6) codeLength = 8;
      newPairingCode = generatePairingCode(codeLength);
    }

    await this.prisma.client.$transaction(async (tx) => {
      // Drop schedules — operator is repurposing the screen.
      await tx.schedule.deleteMany({ where: { screenId: screen.id } });
      // Clear tenant + reissue pairing code; flip status to PENDING.
      await tx.screen.update({
        where: { id: screen.id },
        data: {
          tenantId: null,
          screenGroupId: null,
          pairingCode: newPairingCode,
          status: 'PENDING',
          lastPingAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: previousTenantId || 'unknown',
          userId: null,
          action: 'SCREEN_UNPAIRED_BY_DEVICE',
          targetType: 'Screen',
          targetId: screen.id,
          details: JSON.stringify({
            name: screen.name,
            fingerprint,
            previousTenantId,
            newPairingCode,
          }),
        },
      }).catch(() => { /* non-fatal */ });
    });

    // Notify the prior tenant's dashboard so the screen list refreshes.
    if (previousTenantId) {
      try { this.notifySync(previousTenantId); } catch { /* ignore */ }
      // The prior tenant just freed a seat — re-sync its Stripe quantity.
      this.stripe.syncSubscriptionQuantity(previousTenantId).catch(() => {});
    }

    return { ok: true, screenId: screen.id, newPairingCode };
  }

  // ─── ADMIN: Update a screen ───
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      location?: string;
      screenGroupId?: string | null;
      // 2026-05-27 — hardware identification (Agent A, c175aab). Either
      // a known model id from HARDWARE_CATALOG, OR null to clear it
      // back to "unassigned". An unknown / typo'd string returns 400.
      hardwareModel?: HardwareModel | string | null;
      // 2026-05-27 — open-shape hardware config (Agent B, 8ac813b).
      // EP6N wiring + future per-hardware keys. Allow-listed by the
      // merge step below so a stale client can't bloat the row.
      config?: Record<string, unknown> | null;
    },
  ) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Resolve hardwareModel against the catalog (Agent A). Permissive
    // case/whitespace normalization via resolveHardwareModel; unknown
    // strings return 400.
    let nextHardwareModel: string | null | undefined = undefined;
    if (body.hardwareModel === null) {
      nextHardwareModel = null;
    } else if (typeof body.hardwareModel === 'string' && body.hardwareModel.trim()) {
      const resolved = resolveHardwareModel(body.hardwareModel);
      const normalized = body.hardwareModel.trim().toLowerCase();
      const isKnown = (HARDWARE_MODELS as readonly string[]).includes(normalized);
      if (!isKnown) {
        throw new HttpException(
          {
            error: 'INVALID_HARDWARE_MODEL',
            message:
              'hardwareModel must be one of: ' + HARDWARE_MODELS.join(', '),
            received: body.hardwareModel,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      nextHardwareModel = resolved;
      if (!HARDWARE_CATALOG[resolved]) {
        throw new HttpException({ code: 'SCREEN_HARDWARE_CATALOG_DRIFT', message: 'hardware-models catalog drift detected — please report this bug' }, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }

    // 2026-05-27 — Goodview EP6N WiringPanel + future hardware-config
    // payloads (Agent B). Merge incoming `config` into the existing
    // Screen.config JSON column, but only allow-listed keys, so a
    // stale client can't bloat the row. `config: null` wipes the
    // column; sending an inner key as null deletes just that key.
    // Allow-list covers EP6N wiring today; reserved keys are documented
    // intentions for upcoming hardware features (NOT wired yet).
    const CONFIG_ALLOW_LIST = new Set([
      'wiring',          // EP6N RS232 + RS485 + GPIO routing (Agent B)
      'consoleProfile',  // which scoreboard console drives this screen
                         //   ('cts-gen6' | 'cts-wttc' | 'daktronics-allsport').
                         //   CtsBridge reads it (via the manifest) to pick
                         //   the serial settings + default tty + decoder.
      'gpioState',       // GPIO OUT live state (Agent C) — server-driven
                         //                                  but allowed
                         //                                  here for
                         //                                  forensic
                         //                                  manual edits
      'hdmiInSource',    // EP6N HDMI input passthrough (reserved)
      'audioOut',        // future per-screen audio routing (reserved)
      'usbLayout',       // future USB peripheral mapping (reserved)
    ]);

    let mergedConfig: Record<string, unknown> | null | undefined = undefined;
    if (body.config !== undefined) {
      if (body.config === null) {
        mergedConfig = null;
      } else if (typeof body.config === 'object' && !Array.isArray(body.config)) {
        const current: Record<string, unknown> = (screen as any).config
          && typeof (screen as any).config === 'object'
          && !Array.isArray((screen as any).config)
          ? { ...(screen as any).config }
          : {};
        for (const [key, value] of Object.entries(body.config)) {
          if (!CONFIG_ALLOW_LIST.has(key)) continue;
          if (value === null) {
            delete current[key];
          } else {
            current[key] = value;
          }
        }
        mergedConfig = current;
      } else {
        throw new HttpException({ code: 'SCREEN_CONFIG_INVALID', message: 'config must be an object (or null to clear)' }, HttpStatus.BAD_REQUEST);
      }
    }

    const updated = await this.prisma.client.screen.update({
      where: { id },
      data: {
        name: body.name?.trim() || screen.name,
        location: body.location !== undefined ? (body.location?.trim() || null) : screen.location,
        screenGroupId: body.screenGroupId !== undefined ? (body.screenGroupId || null) : screen.screenGroupId,
        // Only patch each hardware field when it was actually present
        // in the body — `undefined` preserves the existing column value.
        ...(nextHardwareModel !== undefined ? { hardwareModel: nextHardwareModel } : {}),
        ...(mergedConfig !== undefined ? { config: mergedConfig as any } : {}),
      },
      include: { screenGroup: { select: { id: true, name: true } } },
    });
    this.notifySync(req.user.tenantId);
    return updated;
  }

  // ─── 2026-05-24 — per-screen orientation lock ───
  // Replaces the old "let the device sensor decide" behavior on
  // stationary signage hardware (Goodview / NovaStar Taurus / BrightSign
  // / no-name Android boxes mounted on a wall) that has no useful
  // accelerometer. Operator flips orientation from the dashboard; the
  // change broadcasts via signed WS to the kiosk and persists in DB so
  // a cold-boot picks the same value from the manifest.
  //
  // Player APK maps the three string values to ActivityInfo constants:
  //   LANDSCAPE → SCREEN_ORIENTATION_LANDSCAPE
  //   PORTRAIT  → SCREEN_ORIENTATION_PORTRAIT
  //   AUTO      → SCREEN_ORIENTATION_UNSPECIFIED  (back to sensor)
  // If a stubborn ROM ignores setRequestedOrientation, the /player route
  // applies a CSS transform:rotate fallback within 2s.
  @Put(':id/orientation')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setOrientation(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { orientation?: string; reason?: string },
  ) {
    const target = String(body.orientation || '').toUpperCase().trim();
    const ALLOWED = new Set(['LANDSCAPE', 'PORTRAIT', 'AUTO']);
    if (!ALLOWED.has(target)) {
      throw new HttpException({ code: 'SCREEN_ORIENTATION_INVALID', message: 'orientation must be one of: LANDSCAPE, PORTRAIT, AUTO' }, HttpStatus.BAD_REQUEST);
    }

    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true, name: true, orientation: true, tenantId: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Update + audit in a single transaction so partial state is
    // impossible. Same pattern as the OAuth-purge audit-log sweep
    // shipped earlier today.
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const u = await tx.screen.update({
        where: { id },
        data: { orientation: target },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user?.id ?? null,
          action: 'SCREEN_ORIENTATION_CHANGED',
          targetType: 'Screen',
          targetId: id,
          details: JSON.stringify({
            from: screen.orientation,
            to: target,
            reason: body.reason ?? null,
          }),
        },
      });
      return u;
    });

    // Signed WS broadcast so any connected player flips immediately.
    // The player APK handler also re-applies on next manifest poll, so
    // a kiosk that missed the WS message (offline / Redis blip) still
    // converges within the manifest poll window (~10s).
    const signed = this.signer.signMessage('ORIENTATION_CHANGE', {
      screenId: id,
      orientation: target,
      reason: body.reason ?? null,
    });
    try {
      await this.redisService.publish(`device:${id}`, signed);
    } catch {
      // Redis blip is non-fatal — the manifest is the source of truth.
      // Player will pick up the new orientation on next manifest poll.
    }

    return updated;
  }

  /**
   * 2026-05-26 — per-screen LED canvas dimensions. Operator:
   * "put it on the screen settings from the dashboard itself".
   *
   * Some LED controllers (NovaStar Taurus, SMART LED POSTER) ship a
   * frame buffer (typically 1920×1080) that's wider than the physical
   * LED's visible pixel range. A single 320×1080 portrait panel only
   * lights the leftmost 320 px of the 1920-wide source. Daisy-chained
   * panels add 320 to the visible width per panel (1=320, 2=640, ...
   * 6=1920). When the operator picks the panel count on the dashboard,
   * we persist canvasW/canvasH here AND signed-WS broadcast to the
   * device so the kiosk applies the new canvas without waiting for
   * the next manifest poll.
   *
   * canvasW / canvasH null = use the controller's native viewport
   * (fine for regular landscape kiosks; only narrow LED chains need
   * the override).
   */
  @Put(':id/canvas')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setCanvas(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { canvasW?: number | null; canvasH?: number | null; repeats?: number; reason?: string },
  ) {
    // Accept null to CLEAR; otherwise clamp to a sane range. 32px floor
    // catches typo "0", 8192px ceiling catches typo "32000" — anything
    // outside that range is almost certainly wrong.
    const validate = (n: any): number | null => {
      if (n === null || n === undefined || n === '') return null;
      const parsed = parseInt(String(n), 10);
      if (!isFinite(parsed) || parsed < 32 || parsed > 8192) {
        throw new HttpException({ code: 'SCREEN_CANVAS_INVALID', message: 'canvasW/canvasH must be null OR an integer between 32 and 8192' }, HttpStatus.BAD_REQUEST);
      }
      return parsed;
    };
    const w = validate(body.canvasW);
    const h = validate(body.canvasH);
    // 2026-05-26 — repeats: 1..12. 1 = no tiling. Operator picks 4 for
    // a 40ft ribbon that should show the same content every 10ft.
    let repeats = 1;
    if (body.repeats !== undefined && body.repeats !== null) {
      const r = parseInt(String(body.repeats), 10);
      if (!isFinite(r) || r < 1 || r > 12) {
        throw new HttpException({ code: 'SCREEN_CANVAS_REPEATS_INVALID', message: 'repeats must be an integer between 1 and 12' }, HttpStatus.BAD_REQUEST);
      }
      repeats = r;
    }

    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true, name: true, tenantId: true, canvasW: true, canvasH: true, repeats: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const u = await tx.screen.update({
        where: { id },
        data: { canvasW: w, canvasH: h, repeats },
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user?.id ?? null,
          action: 'SCREEN_CANVAS_CHANGED',
          targetType: 'Screen',
          targetId: id,
          details: JSON.stringify({
            from: { w: screen.canvasW, h: screen.canvasH, repeats: screen.repeats },
            to: { w, h, repeats },
            reason: body.reason ?? null,
          }),
        },
      });
      return u;
    });

    // Signed WS broadcast — kiosk applies the new canvas immediately
    // (sets --led-w / --led-h CSS vars + reloads splash) without
    // waiting for the next 10s manifest poll. Same pattern as
    // ORIENTATION_CHANGE.
    const signed = this.signer.signMessage('CANVAS_CHANGE', {
      screenId: id,
      canvasW: w,
      canvasH: h,
      repeats,
      reason: body.reason ?? null,
    });
    try {
      await this.redisService.publish(`device:${id}`, signed);
    } catch {
      // Manifest poll converges within ~10s.
    }

    return updated;
  }

  /**
   * 2026-07-28 — frame-locked multi-screen sync: per-screen latency trim.
   * docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §7-8.
   *
   * Different display models add different FIXED pipeline latencies (LED
   * controller scaling, TV motion smoothing adds 30-80ms) that no browser
   * can see — two perfectly clock-synced players can still be a frame+
   * apart on glass. This is the AVR-lip-sync-style knob: the operator
   * points a phone camera at both screens and nudges until aligned.
   * Applied player-side as an offset on the shared clock (manifest
   * `sync.trimMs`); manifest ETag covers it, so screens converge within a
   * poll. Null clears back to 0. Clamped ±2000ms (a display pipeline
   * beyond 2s is broken hardware, not a trim).
   */
  @Put(':id/sync-offset')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setSyncOffset(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { syncOffsetMs?: number | null },
  ) {
    let offset: number | null = null;
    if (body.syncOffsetMs !== null && body.syncOffsetMs !== undefined) {
      const parsed = Math.round(Number(body.syncOffsetMs));
      if (!Number.isFinite(parsed) || Math.abs(parsed) > 2000) {
        throw new HttpException(
          { code: 'SCREEN_SYNC_OFFSET_INVALID', message: 'syncOffsetMs must be null OR an integer between -2000 and 2000' },
          HttpStatus.BAD_REQUEST,
        );
      }
      offset = parsed;
    }

    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true, name: true, tenantId: true, syncOffsetMs: true } as any,
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.screen.update({
        where: { id },
        data: { syncOffsetMs: offset } as any,
      });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user?.id ?? null,
          action: 'SCREEN_SYNC_OFFSET_CHANGED',
          targetType: 'Screen',
          targetId: id,
          details: JSON.stringify({
            from: (screen as any).syncOffsetMs ?? null,
            to: offset,
          }),
        },
      });
      return updated;
    });
  }

  /**
   * 2026-05-25 — device-authenticated companion to PUT /:id/orientation.
   *
   * The pairing-splash orientation picker on the player runs BEFORE an
   * operator has claimed the kiosk, so the player can't authenticate as
   * an admin yet. It can however prove device identity via the device
   * JWT it received at boot. This endpoint accepts that token, verifies
   * the JWT.sub matches the targeted screenId, and applies the same
   * persistence + signed WS broadcast + audit-log writes as the
   * operator endpoint.
   *
   * Authorization model is the same as
   * /:id/manifest + /:id/emergency-assets — verifyDeviceForScreen. Any
   * device that tries to write a different screen's orientation is
   * rejected at the auth gate.
   *
   * AuditLog row carries `source: 'device'` so a forensic reader can
   * tell operator-driven changes from kiosk-driven ones.
   */
  @Put(':id/orientation/device')
  async setOrientationFromDevice(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Body() body: { orientation?: string; reason?: string },
  ) {
    const auth = verifyDeviceForScreen(req, id);
    if (!auth.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${auth.reason})` }, HttpStatus.UNAUTHORIZED);
    }

    const target = String(body.orientation || '').toUpperCase().trim();
    const ALLOWED = new Set(['LANDSCAPE', 'PORTRAIT', 'AUTO']);
    if (!ALLOWED.has(target)) {
      throw new HttpException({ code: 'SCREEN_ORIENTATION_INVALID', message: 'orientation must be one of: LANDSCAPE, PORTRAIT, AUTO' }, HttpStatus.BAD_REQUEST);
    }

    const screen = await this.prisma.client.screen.findUnique({
      where: { id },
      select: { id: true, tenantId: true, orientation: true, name: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const u = await tx.screen.update({
        where: { id },
        data: { orientation: target },
      });
      // Only audit when there's a tenant — pre-pair screens (tenantId
      // null) still get a row but with a sentinel tenantId to keep the
      // FK happy. AuditLog requires tenantId NOT NULL per schema; for
      // pre-pair changes we skip the audit row — the persisted value
      // alone is enough forensic signal for "what did the screen pick
      // during setup" since the next manifest poll will reveal it.
      if (screen.tenantId) {
        await tx.auditLog.create({
          data: {
            tenantId: screen.tenantId,
            userId: null,
            action: 'SCREEN_ORIENTATION_CHANGED',
            targetType: 'Screen',
            targetId: id,
            details: JSON.stringify({
              from: screen.orientation,
              to: target,
              source: 'device',
              reason: body.reason ?? null,
            }),
          },
        });
      }
      return u;
    });

    // Signed WS broadcast — even though the player IS the one that
    // requested the change, broadcasting closes the loop with any
    // dashboard tabs currently watching this screen + keeps the
    // device:<id> channel as the single source of truth.
    const signed = this.signer.signMessage('ORIENTATION_CHANGE', {
      screenId: id,
      orientation: target,
      source: 'device',
      reason: body.reason ?? null,
    });
    try {
      await this.redisService.publish(`device:${id}`, signed);
    } catch { /* non-fatal — manifest poll converges */ }

    return updated;
  }

  /**
   * Sprint 13 — CTS scoreboard bridge POST endpoint.
   *
   * The Beelink mini PC running the CTS bridge POSTs decoded
   * snapshots here (see apps/web/src/components/player/CtsBridge.tsx).
   * The API signs + publishes a GAME_STATE message on the
   * `device:<screenId>` Redis channel; every player connected to
   * that screen receives the snapshot via WS within ~150ms and the
   * scoreboard widget re-renders.
   *
   * Auth: device JWT (verifyDeviceForScreen) — same model as the
   * existing /:id/manifest + /:id/emergency-assets endpoints. The
   * Beelink already holds a device token from pairing. We deliberately
   * do NOT also accept the admin JwtAuthGuard path; the bridge is the
   * only legit caller and it authenticates as the device.
   *
   * Persistence: NONE in v1. Game state is ephemeral (full snapshot
   * arrives every ~125ms while a game is live); persisting every
   * update would write ~30,000 rows / hour with no downstream reader
   * needing them. Replay is captured via the existing AuditLog stream
   * when a future Sprint 13 phase adds a `GameEvent` table.
   *
   * Rate limit: SkipThrottle + an in-handler floor (max 16 Hz per
   * screen) so a misbehaving bridge can't DOS the WS bus. The bridge
   * already throttles at 8 Hz client-side; 16 Hz here is double that
   * to absorb burst.
   */
  @Post(':id/game-state')
  @SkipThrottle()
  async postGameState(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Body() body: { source?: string; snapshot?: Record<string, unknown> },
  ) {
    const auth = verifyDeviceForScreen(req, id);
    if (!auth.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${auth.reason})` }, HttpStatus.UNAUTHORIZED);
    }
    if (!body || typeof body !== 'object' || !body.snapshot || typeof body.snapshot !== 'object') {
      throw new HttpException({ code: 'SCREEN_GAME_STATE_SNAPSHOT_REQUIRED', message: 'snapshot is required' }, HttpStatus.BAD_REQUEST);
    }

    // Per-screen rate floor: 16 Hz max. Reuses the in-memory rate
    // pattern from manifest-hot-cache.ts (single replica safe; multi-
    // replica is fine because Redis is the broadcast bus, not the
    // dedup point). Misbehaving bridges get silently capped — we
    // return 200 with `throttled: true` rather than 429 so the
    // bridge's `postCount` UI doesn't redline visually.
    const now = Date.now();
    const last = _gameStateRateMap.get(id) ?? 0;
    if (now - last < 62) {
      return { ok: true, throttled: true };
    }
    _gameStateRateMap.set(id, now);
    // Cap the in-memory map at a sane bound — most installs have <50
    // screens with CTS bridges, but in case someone bulk-installs:
    if (_gameStateRateMap.size > 500) {
      const cutoff = now - 60_000;
      for (const [k, v] of _gameStateRateMap) {
        if (v < cutoff) _gameStateRateMap.delete(k);
      }
    }

    const signed = this.signer.signMessage('GAME_STATE', {
      screenId: id,
      source: typeof body.source === 'string' ? body.source : 'cts',
      snapshot: body.snapshot,
    });
    try {
      await this.redisService.publish(`device:${id}`, signed);
    } catch {
      // Redis blip: snapshot is ephemeral, the next snapshot (≤ 125ms
      // away) will retry. No fallback needed for game state — unlike
      // emergencies, a dropped frame is a missed render, not a safety
      // issue.
    }
    return { ok: true };
  }

  /**
   * Sprint 13 — CTS celebration MANUAL cue trigger.
   *
   * Operator (or Stream Deck button, or phone tap) wants to fire a
   * specific celebration cue on a specific ribbon screen RIGHT NOW,
   * regardless of what the CTS bridge sees. This endpoint takes the
   * cueId and broadcasts a CTS_MANUAL_CUE on the device channel; the
   * player page handles it by dispatching the same
   * `edu:cts-celebration-preview` window event the orchestrator's
   * Properties-panel test buttons fire.
   *
   * Auth: admin / contributor JWT. SUPER_ADMIN / DISTRICT_ADMIN /
   * SCHOOL_ADMIN / CONTRIBUTOR — same scope as fireCue on the existing
   * scoreboard celebration system.
   *
   * Stream Deck integration: configure a Stream Deck button with the
   * Web Request action, POST to this URL with the Bearer token of a
   * dashboard user that has CONTRIBUTOR+ role, body
   * `{"cueId":"CEL_SOCCER_GOAL","team":"home"}`. Show caller hits
   * one button → ribbon fires the cinematic instantly.
   *
   * AuditLog row written on every fire so a forensics review can
   * answer "who fired which cue at what time on which screen".
   */
  @Post(':id/cts-manual-cue')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async ctsManualCue(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { cueId?: string; team?: 'home' | 'away' | 'horn' },
  ) {
    if (!body || typeof body !== 'object' || !body.cueId || typeof body.cueId !== 'string') {
      throw new HttpException({ code: 'SCREEN_GAME_STATE_CUE_ID_REQUIRED', message: 'cueId is required' }, HttpStatus.BAD_REQUEST);
    }
    const cueId = String(body.cueId).slice(0, 64);
    const team: 'home' | 'away' | 'horn' = body.team === 'away' ? 'away' : body.team === 'horn' ? 'horn' : 'home';

    // Verify the operator's tenant owns this screen — prevents a
    // contributor on tenant A from firing a cue on tenant B's ribbon.
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) {
      throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found' }, HttpStatus.NOT_FOUND);
    }

    const signed = this.signer.signMessage('CTS_MANUAL_CUE', {
      screenId: id,
      cueId,
      team,
      source: 'manual',
      firedByUserId: req.user.id,
    });
    try {
      await this.redisService.publish(`device:${id}`, signed);
    } catch {
      // Redis blip: the operator can tap again; manual cues are not
      // retried server-side (the next tap is the retry).
    }
    // Forensic audit — immutable record of every manual cue fire.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user.id,
          action: 'CTS_MANUAL_CUE_FIRED',
          targetType: 'Screen',
          targetId: id,
          details: JSON.stringify({ cueId, team }),
        },
      });
    } catch {
      // Best-effort — never let an audit failure block the cue.
    }
    return { ok: true, cueId, team };
  }

  // ─── Sprint 8 — set screen geo location (map view) ───
  // Admin types an address (or pastes lat/lng); we forward to the
  // OpenStreetMap Nominatim public endpoint to geocode, store all three.
  // Nominatim is rate-limited to ~1 req/sec per IP; the request fires
  // server-side from this NestJS process, so the rate limit is per-deploy
  // and easily fits typical admin usage.
  //
  // No third-party API key required. If Nominatim is offline or refuses,
  // we still save the raw address and any caller-provided coordinates.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Put(':id/location')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setLocation(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { address?: string | null; latitude?: number | null; longitude?: number | null; photoUrl?: string | null },
  ) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Cap the address — it is interpolated into a Nominatim query string
    // and persisted to a DB column; an unbounded value bloats both.
    // Real postal addresses are short.
    if (typeof body.address === 'string' && body.address.length > 300) {
      throw new HttpException({ code: 'SCREEN_ADDRESS_TOO_LONG', message: 'Address is too long (max 300 characters).' }, HttpStatus.BAD_REQUEST);
    }

    let lat = body.latitude ?? screen.latitude ?? null;
    let lng = body.longitude ?? screen.longitude ?? null;
    const addressChanged = body.address !== undefined && body.address !== screen.address;

    // Geocode if the operator gave us a fresh address but no explicit
    // coordinates. Use OSM Nominatim (free, no key). Polite single
    // request with a descriptive User-Agent (their ToS).
    //
    // 2026-05-23 launch audit P2 #8: route through safeFetch so the
    // hostname is DNS-pinned and a private-IP / link-local redirect
    // can't exfil internal metadata. Nominatim is a fixed public
    // hostname so the risk is low, but the project's documented rule
    // is "never call fetch(url) directly in the API" (see
    // branding/safe-fetch.ts header comment) and this was the last
    // un-audited outbound HTTP call.
    if (addressChanged && body.address && body.latitude === undefined && body.longitude === undefined) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(body.address)}`;
        const r = await safeFetch(url, {
          userAgent: 'EduCMS/1.0 (+https://educms.app)',
          timeoutMs: 5000,
          maxBytes: 64 * 1024, // tiny JSON response, cap defensively
          accept: 'application/json',
        });
        if (r.status >= 200 && r.status < 300) {
          const arr = JSON.parse(r.body.toString('utf8')) as Array<{ lat: string; lon: string }>;
          if (arr[0]) {
            lat = parseFloat(arr[0].lat);
            lng = parseFloat(arr[0].lon);
          }
        }
      } catch {
        // Geocode failure (including timeout / SSRF reject / body too
        // large) is non-fatal — the admin can still set lat/lng manually.
      }
    }

    const updated = await this.prisma.client.screen.update({
      where: { id },
      data: {
        address: body.address !== undefined ? (body.address?.trim() || null) : screen.address,
        latitude: lat,
        longitude: lng,
        photoUrl: body.photoUrl !== undefined ? (body.photoUrl?.trim() || null) : screen.photoUrl,
      },
      include: { screenGroup: { select: { id: true, name: true } } },
    });
    this.notifySync(req.user.tenantId);
    return updated;
  }

  // ─── Sprint 8b — per-screen emergency content config ───
  // Lets the operator set, for each of the 6 emergency types
  // (LOCKDOWN / EVACUATE / WEATHER / HOLD / SECURE / MEDICAL), either:
  //   • a specific Playlist id  → that playlist plays on THIS screen
  //                              when this type fires
  //   • null                    → falls back to Tenant.panic*PlaylistId
  // The manifest endpoint resolves these per-screen settings BEFORE
  // the tenant defaults so "different content per room" works without
  // a manual trigger event.
  //
  // Body shape — all 6 keys optional. Pass null to clear an override
  // (resume tenant default). Unspecified keys are left untouched.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Put(':id/emergency-content')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async setEmergencyContent(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: {
      lockdownPlaylistId?: string | null;
      evacuatePlaylistId?: string | null;
      weatherPlaylistId?: string | null;
      holdPlaylistId?: string | null;
      securePlaylistId?: string | null;
      medicalPlaylistId?: string | null;
      // Per-type custom asset URL — single uploaded image/video shown
      // full-screen for that emergency. Setting either playlistId OR
      // assetUrl for a type wins over tenant defaults; manifest checks
      // playlist first, falls back to asset, falls back to tenant.
      lockdownAssetUrl?: string | null;
      evacuateAssetUrl?: string | null;
      weatherAssetUrl?: string | null;
      holdAssetUrl?: string | null;
      secureAssetUrl?: string | null;
      medicalAssetUrl?: string | null;
      // Portrait variants. Same six types again. Manifest picks
      // landscape vs portrait based on the screen's physical
      // resolution. Operator usually configures both so the right
      // poster shows on each kiosk regardless of orientation.
      lockdownPortraitPlaylistId?: string | null;
      evacuatePortraitPlaylistId?: string | null;
      weatherPortraitPlaylistId?: string | null;
      holdPortraitPlaylistId?: string | null;
      securePortraitPlaylistId?: string | null;
      medicalPortraitPlaylistId?: string | null;
      lockdownPortraitAssetUrl?: string | null;
      evacuatePortraitAssetUrl?: string | null;
      weatherPortraitAssetUrl?: string | null;
      holdPortraitAssetUrl?: string | null;
      securePortraitAssetUrl?: string | null;
      medicalPortraitAssetUrl?: string | null;
    },
  ) {
    const tenantId = req.user.tenantId;
    const screen = await this.prisma.client.screen.findFirst({ where: { id, tenantId } });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Validate every supplied playlist id belongs to the same tenant.
    // Cross-tenant assignment is silently dropped to null with an
    // audit log entry so we know about it.
    const ids: string[] = [
      body.lockdownPlaylistId, body.evacuatePlaylistId, body.weatherPlaylistId,
      body.holdPlaylistId, body.securePlaylistId, body.medicalPlaylistId,
      body.lockdownPortraitPlaylistId, body.evacuatePortraitPlaylistId, body.weatherPortraitPlaylistId,
      body.holdPortraitPlaylistId, body.securePortraitPlaylistId, body.medicalPortraitPlaylistId,
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);
    let validIds = new Set<string>();
    if (ids.length > 0) {
      const playlists = await this.prisma.client.playlist.findMany({
        where: { id: { in: ids }, tenantId },
        select: { id: true },
      });
      validIds = new Set(playlists.map((p) => p.id));
    }
    const sanitize = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;     // leave field untouched
      if (v === null || v === '') return null;   // clear override
      return validIds.has(v) ? v : null;         // unknown id → drop to null
    };
    // Asset URLs are validated lightly — must be a non-empty string
    // that looks like a URL. The asset itself was uploaded via
    // /assets/upload (which already enforces tenant scoping + MIME
    // allowlist), so we trust the URL it returned.
    const sanitizeUrl = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return null;
      const s = v.trim();
      if (!/^(https?:\/\/|\/)/.test(s)) return null;  // reject mailto:, data:, etc.
      return s.slice(0, 2048);
    };

    const data: any = {};
    if (body.lockdownPlaylistId !== undefined) data.emergencyLockdownPlaylistId = sanitize(body.lockdownPlaylistId);
    if (body.evacuatePlaylistId !== undefined) data.emergencyEvacuatePlaylistId = sanitize(body.evacuatePlaylistId);
    if (body.weatherPlaylistId  !== undefined) data.emergencyWeatherPlaylistId  = sanitize(body.weatherPlaylistId);
    if (body.holdPlaylistId     !== undefined) data.emergencyHoldPlaylistId     = sanitize(body.holdPlaylistId);
    if (body.securePlaylistId   !== undefined) data.emergencySecurePlaylistId   = sanitize(body.securePlaylistId);
    if (body.medicalPlaylistId  !== undefined) data.emergencyMedicalPlaylistId  = sanitize(body.medicalPlaylistId);
    if (body.lockdownAssetUrl   !== undefined) data.emergencyLockdownAssetUrl   = sanitizeUrl(body.lockdownAssetUrl);
    if (body.evacuateAssetUrl   !== undefined) data.emergencyEvacuateAssetUrl   = sanitizeUrl(body.evacuateAssetUrl);
    if (body.weatherAssetUrl    !== undefined) data.emergencyWeatherAssetUrl    = sanitizeUrl(body.weatherAssetUrl);
    if (body.holdAssetUrl       !== undefined) data.emergencyHoldAssetUrl       = sanitizeUrl(body.holdAssetUrl);
    if (body.secureAssetUrl     !== undefined) data.emergencySecureAssetUrl     = sanitizeUrl(body.secureAssetUrl);
    if (body.medicalAssetUrl    !== undefined) data.emergencyMedicalAssetUrl    = sanitizeUrl(body.medicalAssetUrl);
    // Portrait variants — same model, _portrait suffix on the column.
    if (body.lockdownPortraitPlaylistId !== undefined) data.emergencyLockdownPortraitPlaylistId = sanitize(body.lockdownPortraitPlaylistId);
    if (body.evacuatePortraitPlaylistId !== undefined) data.emergencyEvacuatePortraitPlaylistId = sanitize(body.evacuatePortraitPlaylistId);
    if (body.weatherPortraitPlaylistId  !== undefined) data.emergencyWeatherPortraitPlaylistId  = sanitize(body.weatherPortraitPlaylistId);
    if (body.holdPortraitPlaylistId     !== undefined) data.emergencyHoldPortraitPlaylistId     = sanitize(body.holdPortraitPlaylistId);
    if (body.securePortraitPlaylistId   !== undefined) data.emergencySecurePortraitPlaylistId   = sanitize(body.securePortraitPlaylistId);
    if (body.medicalPortraitPlaylistId  !== undefined) data.emergencyMedicalPortraitPlaylistId  = sanitize(body.medicalPortraitPlaylistId);
    if (body.lockdownPortraitAssetUrl   !== undefined) data.emergencyLockdownPortraitAssetUrl   = sanitizeUrl(body.lockdownPortraitAssetUrl);
    if (body.evacuatePortraitAssetUrl   !== undefined) data.emergencyEvacuatePortraitAssetUrl   = sanitizeUrl(body.evacuatePortraitAssetUrl);
    if (body.weatherPortraitAssetUrl    !== undefined) data.emergencyWeatherPortraitAssetUrl    = sanitizeUrl(body.weatherPortraitAssetUrl);
    if (body.holdPortraitAssetUrl       !== undefined) data.emergencyHoldPortraitAssetUrl       = sanitizeUrl(body.holdPortraitAssetUrl);
    if (body.securePortraitAssetUrl     !== undefined) data.emergencySecurePortraitAssetUrl     = sanitizeUrl(body.securePortraitAssetUrl);
    if (body.medicalPortraitAssetUrl    !== undefined) data.emergencyMedicalPortraitAssetUrl    = sanitizeUrl(body.medicalPortraitAssetUrl);

    const updated = await this.prisma.client.screen.update({
      where: { id },
      data,
      select: {
        id: true,
        emergencyLockdownPlaylistId: true,
        emergencyEvacuatePlaylistId: true,
        emergencyWeatherPlaylistId: true,
        emergencyHoldPlaylistId: true,
        emergencySecurePlaylistId: true,
        emergencyMedicalPlaylistId: true,
        emergencyLockdownAssetUrl: true,
        emergencyEvacuateAssetUrl: true,
        emergencyWeatherAssetUrl: true,
        emergencyHoldAssetUrl: true,
        emergencySecureAssetUrl: true,
        emergencyMedicalAssetUrl: true,
        emergencyLockdownPortraitPlaylistId: true,
        emergencyEvacuatePortraitPlaylistId: true,
        emergencyWeatherPortraitPlaylistId: true,
        emergencyHoldPortraitPlaylistId: true,
        emergencySecurePortraitPlaylistId: true,
        emergencyMedicalPortraitPlaylistId: true,
        emergencyLockdownPortraitAssetUrl: true,
        emergencyEvacuatePortraitAssetUrl: true,
        emergencyWeatherPortraitAssetUrl: true,
        emergencyHoldPortraitAssetUrl: true,
        emergencySecurePortraitAssetUrl: true,
        emergencyMedicalPortraitAssetUrl: true,
      } as any,
    });

    // Audit log — operator changed which playlist plays on a specific
    // screen during a specific emergency type. Record what they set.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: req.user.id,
          action: 'UPDATE_SCREEN_EMERGENCY_CONTENT',
          targetType: 'screen',
          targetId: id,
          details: JSON.stringify({ patch: data }),
        },
      });
    } catch { /* swallow */ }

    this.notifySync(tenantId);
    return updated;
  }

  // ─── ADMIN: Push an OTA update check to paired screens ───
  // When an admin clicks "Push APK update" in the dashboard we fire a
  // signed CHECK_FOR_UPDATES WebSocket message scoped to either one
  // screen or the whole tenant. The web player's WS handler relays to
  // the native APK shell via WebAppBridge.checkForUpdates → enqueues a
  // one-shot OtaUpdateWorker run on the kiosk. Requires APK ≥ 1.0.6
  // (the bridge method didn't exist before that build); older installs
  // silently ignore the event and pick up the update on their next
  // 6h periodic poll instead.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('force-update')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async forceUpdateAll(@Request() req: any) {
    const tenantId = req.user.tenantId;
    if (!tenantId) throw new HttpException({ code: 'SCREEN_NO_TENANT_CONTEXT', message: 'No tenant context' }, HttpStatus.BAD_REQUEST);
    // Mark every screen in the tenant as force-pending so the next
    // /update-check from each one gets the latest APK (gated 30 min).
    // Safe even when tenant.autoUpdatePlayerEnabled is false — the
    // force flag is the explicit opt-in for THIS push only.
    await this.prisma.client.screen.updateMany({
      where: { tenantId },
      data: { forceApkUpdatePendingAt: new Date() } as any,
    }).catch((e) => {
      console.warn('[force-update] forceApkUpdatePendingAt write failed', (e as Error).message);
    });
    const signed = this.signer.signMessage('CHECK_FOR_UPDATES', {
      scope: 'tenant',
      scopeId: tenantId,
      requestedBy: req.user.userId || req.user.id || null,
    });
    try {
      await this.redisService.publish(`tenant:${tenantId}`, signed);
    } catch (e) {
      console.warn('[force-update] redis publish failed', (e as Error).message);
    }
    await this.prisma.client.auditLog.create({
      data: {
        action: 'FORCE_APK_UPDATE',
        targetType: 'tenant',
        targetId: tenantId,
        tenantId,
        userId: req.user.id,
        details: JSON.stringify({ scope: 'tenant' }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, scope: 'tenant' };
  }

  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post(':id/force-update')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async forceUpdateOne(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body?: { overrideWindow?: boolean },
  ) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    const overrideWindow = !!body?.overrideWindow;

    // 2026-04-29 — Correlation ID for end-to-end OTA tracing.
    // Operator: "how did everyone miss these issues on the last 4
    // builds". Answer: every layer logged in its own silo with no
    // shared identifier, so we couldn't trace a push from dashboard
    // → server → WS → kiosk → worker → server → install. This corrId
    // gets stamped into every log line in the chain. Grep one
    // value, see the entire push lifetime.
    const corrId = `ota-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const fpShort = (screen.deviceFingerprint || '').slice(0, 18);
    console.log(
      `[OTA ${corrId}] force-update REQUEST screenId=${id} fp=${fpShort}… ` +
      `screenName="${screen.name}" tenantId=${screen.tenantId} ` +
      `requestedBy=${req.user.userId || req.user.id}`,
    );

    // Set the per-screen force flag — the next update-check from
    // this kiosk returns the latest APK (gated 30 min).
    // Sprint 11 Phase A: overrideWindow=true bypasses the tenant's
    // maintenance window for this one-shot push (emergency hotfix).
    await this.prisma.client.screen.update({
      where: { id },
      data: {
        forceApkUpdatePendingAt: new Date(),
        forceApkUpdateOverrideWindow: overrideWindow,
      } as any,
    }).catch((e) => {
      console.warn(`[OTA ${corrId}] forceApkUpdatePendingAt write FAILED: ${(e as Error).message}`);
    });
    console.log(`[OTA ${corrId}] forceApkUpdatePendingAt SET (overrideWindow=${overrideWindow})`);

    const signed = this.signer.signMessage('CHECK_FOR_UPDATES', {
      scope: 'screen',
      scopeId: id,
      tenantId: screen.tenantId,
      requestedBy: req.user.userId || req.user.id || null,
      // Embed corrId in the WS payload so the kiosk can stamp it
      // into ITS logs + later /ota-state POSTs. Closes the loop.
      corrId,
    });
    // Publish on the tenant channel — all kiosks receive, but only the
    // targeted screen acts on it (the payload includes scopeId).
    try {
      await this.redisService.publish(`tenant:${screen.tenantId}`, signed);
      console.log(`[OTA ${corrId}] WS broadcast PUBLISHED on tenant:${screen.tenantId}`);
    } catch (e) {
      console.warn(`[OTA ${corrId}] redis publish FAILED: ${(e as Error).message}`);
    }

    await this.prisma.client.auditLog.create({
      data: {
        action: 'FORCE_APK_UPDATE',
        targetType: 'screen',
        targetId: id,
        tenantId: screen.tenantId!,
        userId: req.user.id,
        details: JSON.stringify({ scope: 'screen', screenName: screen.name, corrId }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, scope: 'screen', screenId: id, corrId };
  }

  // ─── ADMIN: Force web-bundle reload (Sprint 11 Phase B) ───
  // The kiosk's WebView keeps running whatever JS bundle it loaded at boot.
  // When we ship a fix to apps/web and Vercel deploys it, running kiosks
  // stay on the OLD bundle forever — there's no mechanism to push new JS to
  // an already-loaded page. Operators previously had to walk up to each
  // kiosk, tap the in-player "Sync Now" splash button (which force-reloads
  // the WebView), or wait for a power-cycle.
  //
  // These endpoints publish a signed REFRESH_WEB message on the tenant
  // channel. The web player's WS handler picks it up, optionally jitters
  // a few seconds, then calls EduCmsNative.reload() (Android shell) or
  // window.location.reload() (browser fallback). Result: fleet-wide
  // bundle refresh from one dashboard click.
  //
  // Per-screen variant for surgical reloads during pilots.
  // Tenant variant for fleet refreshes after a hotfix deploy.
  //
  // Jitter window of 8s spreads N kiosks across that window so a 1000-
  // device fleet doesn't all hit Vercel + the API simultaneously and
  // re-trigger the DATABASE_ERROR storm we just fixed.
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('refresh-web')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async refreshWebAll(@Request() req: any) {
    const tenantId = req.user.tenantId;
    if (!tenantId) throw new HttpException({ code: 'SCREEN_NO_TENANT_CONTEXT', message: 'No tenant context' }, HttpStatus.BAD_REQUEST);
    const corrId = `rw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const signed = this.signer.signMessage('REFRESH_WEB', {
      scope: 'tenant',
      scopeId: tenantId,
      requestedBy: req.user.userId || req.user.id || null,
      jitterMs: 8000,
      corrId,
    });
    try {
      await this.redisService.publish(`tenant:${tenantId}`, signed);
    } catch (e) {
      console.warn(`[refresh-web ${corrId}] redis publish failed:`, (e as Error).message);
    }
    await this.prisma.client.auditLog.create({
      data: {
        action: 'REFRESH_WEB',
        targetType: 'tenant',
        targetId: tenantId,
        tenantId,
        userId: req.user.id,
        details: JSON.stringify({ scope: 'tenant', corrId }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, scope: 'tenant', corrId };
  }

  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post(':id/refresh-web')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async refreshWebOne(@Request() req: any, @Param('id') id: string) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    const corrId = `rw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const signed = this.signer.signMessage('REFRESH_WEB', {
      scope: 'screen',
      scopeId: id,
      tenantId: screen.tenantId,
      requestedBy: req.user.userId || req.user.id || null,
      // Single-screen refreshes don't need jitter — they're already
      // a fleet-of-one. Snappy reload feedback for the operator.
      jitterMs: 0,
      corrId,
    });
    try {
      await this.redisService.publish(`tenant:${screen.tenantId}`, signed);
    } catch (e) {
      console.warn(`[refresh-web ${corrId}] redis publish failed:`, (e as Error).message);
    }
    await this.prisma.client.auditLog.create({
      data: {
        action: 'REFRESH_WEB',
        targetType: 'screen',
        targetId: id,
        tenantId: screen.tenantId!,
        userId: req.user.id,
        details: JSON.stringify({ scope: 'screen', screenName: screen.name, corrId }),
      },
    }).catch(() => { /* audit best-effort */ });
    return { ok: true, scope: 'screen', screenId: id, corrId };
  }

  // ─── ADMIN: Delete a screen ───
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    await this.prisma.client.schedule.deleteMany({ where: { screenId: id } });
    await this.prisma.client.screen.delete({ where: { id } });
    this.notifySync(req.user.tenantId);
    // Deleting a paired screen frees a seat — re-sync Stripe quantity.
    this.stripe.syncSubscriptionQuantity(req.user.tenantId).catch(() => {});
    return { deleted: true };
  }

  // ─── VenueOS Sports — synthetic scoreboard manifest ───
  // Builds a normal-shaped manifest playlist array with ONE full-screen
  // WEBPAGE zone pointing at the live scoreboard page (direct mode, so
  // the player iframes it un-proxied). The player renders this through
  // the existing template pipeline — zero player-code change.
  private buildScoreboardManifest(screen: any, game: any, surface?: string): any[] {
    // Match the synthetic template to the panel's resolution so the
    // WEBPAGE zone gets a correctly-shaped box; the surface page scales
    // its own scene to fit either way. Default to 1080p landscape.
    let w = 1920;
    let h = 1080;
    // Prefer the operator's explicit LED canvas dims (canvasW/canvasH) over the
    // device resolution. A narrow LED poster (e.g. 960×1080) reports its DEVICE
    // resolution as 1920×1080 but only physically shows the top-left
    // canvasW×canvasH region the LED controller maps; sizing the synthetic
    // scoreboard template to the canvas (not the resolution) is what makes the
    // /board surface FIT the panel instead of rendering 1920-wide and getting
    // cut off. Falls back to the parsed resolution, then 1080p. (2026-06-24 —
    // live water-polo install: scoreboard cut off on a 960×1080 LED poster.)
    const cwN = Number((screen as any).canvasW);
    const chN = Number((screen as any).canvasH);
    if (cwN > 0 && chN > 0) {
      w = Math.floor(cwN);
      h = Math.floor(chN);
    } else {
      const m = String(screen.resolution || '').trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
      if (m) {
        w = parseInt(m[1], 10);
        h = parseInt(m[2], 10);
      }
    }
    // Which sports surface this screen renders. The operator picks it
    // per-screen (BOARD full scoreboard / RIBBON LED strip / SCOREBUG
    // broadcast overlay); each is a public route the WEBPAGE zone loads
    // directly. Null / unknown reads as BOARD (back-compat).
    const s = String(surface || 'BOARD').toUpperCase();
    const route = s === 'RIBBON' ? 'ribbon' : s === 'SCOREBUG' ? 'scorebug' : 'board';
    const surfaceName =
      s === 'RIBBON' ? 'Live Ribbon' : s === 'SCOREBUG' ? 'Live Scorebug' : 'Live Scoreboard';
    return [{
      id: `${route}-${game.id}`,
      name: surfaceName,
      schedule: { daysOfWeek: null, timeStart: null, timeEnd: null, mutedOverride: null },
      totalBytes: 0,
      template: {
        // Stable per game + surface so the player's template signature
        // doesn't churn; changes when a different game OR surface is
        // pushed (so a board→ribbon switch forces a clean reload).
        id: `${route}-tpl-${game.id}`,
        name: surfaceName,
        screenWidth: w,
        screenHeight: h,
        bgColor: '#000000',
        bgGradient: null,
        bgImage: null,
        isTouchEnabled: false,
        idleResetMs: undefined,
        zones: [{
          id: `${route}-zone-${game.id}`,
          name: surfaceName,
          widgetType: 'WEBPAGE',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 0,
          sortOrder: 0,
          touchAction: null,
          sceneId: null,
          defaultConfig: { url: `/${route}/${game.id}`, direct: true },
        }],
        scenes: [],
      },
      items: [],
    }];
  }

  // ─── Player manifest (what the screen device fetches) ───
  @UseGuards(JwtAuthGuard)
  @Get(':id/manifest')
  async getManifest(@Param('id') id: string, @Req() req: ExpressReq, @Res() res: Response) {
    const activeDeviceHash = req.headers['if-none-match'];
    // Content-rev snapshot BEFORE any row is read (manifest content cache,
    // 2026-07-30): if a mutation lands while this build is in flight, the
    // entry we store carries an already-stale rev and the next poll
    // rebuilds — torn data can never be served twice.
    const manifestRevAtStart = currentManifestContentRev();

    // Phase B — same retry treatment as deviceStatus. Manifest fetch
    // is the call whose failure cascades all the way to nativeReload
    // on the kiosk (5 consecutive failures → WebView hard reload),
    // so a transient pool blip here is the single most visible
    // failure mode for the kiosk experience.
    const screen = await withDbRetry(
      () => this.prisma.client.screen.findUnique({
        where: { id },
        // 2026-05-19 — also pull the tenant name so the manifest can
        // surface "paired with: <tenant>" on the player info card.
        // Operator: "i do so much testing i cant remember where i
        // paired them anymore."
        include: { screenGroup: true, tenant: { select: { name: true } } }
      }),
      { label: 'screen.findUnique[manifest]' },
    );

    if (!screen || screen.status === 'REVOKED') {
      return res.status(403).json({ error: 'Device invalid or revoked' });
    }

    // Any successful manifest fetch means the device is alive + talking
    // to us — touch lastPingAt so the dashboard list endpoint (which
    // derives ONLINE/OFFLINE from lastPingAt < 2min) reflects reality.
    // DEBOUNCED to at most once per 25s per screen: the 2min ONLINE
    // threshold tolerates up to 25s of staleness, and the previous
    // unthrottled write-per-poll pattern was saturating the Supabase
    // pool (500 screens × 5s polls = 100 writes/sec, each grabbing a
    // connection). Non-blocking either way — if Prisma hiccups we
    // still return the manifest; next fetch re-checks the debounce.
    if (!shouldSkipLastPingWrite(screen.id)) {
      markLastPingWritten(screen.id);
      this.prisma.client.screen
        .update({ where: { id: screen.id }, data: { lastPingAt: new Date() } })
        .catch(() => { /* non-fatal; next manifest fetch will retry */ });
    }

    // MED-1 audit fix: tenant-scope the read so a user from Tenant A can't
    // fetch Tenant B's manifest by guessing the screen UUID. Three valid
    // callers:
    //   1. Device JWT (kind: 'device', sub: screenId) — must match this
    //      screen.id directly.
    //   2. SUPER_ADMIN — cross-tenant by design.
    //   3. User JWT — req.user.tenantId must match screen.tenantId.
    const u: any = (req as any).user;
    if (u) {
      const isDeviceJwt = u.kind === 'device';
      const isSuper = u.role === AppRole.SUPER_ADMIN;
      if (isDeviceJwt) {
        if (u.sub !== screen.id) {
          return res.status(403).json({ error: 'Device token does not match screen' });
        }
      } else if (!isSuper) {
        const callerTenantId = u.schoolId || u.tenantId || u.districtId;
        if (!screen.tenantId || screen.tenantId !== callerTenantId) {
          return res.status(404).json({ error: 'Screen not found' }); // 404 not 403 to avoid existence-leak
        }
      }
    }

    // ─── Sprint 8b — per-screen emergency override (PRECEDES tenant-wide) ───
    // The player checks for a row in ScreenEmergencyOverride scoped to
    // this exact screen FIRST. If one exists and isn't expired, we
    // synthesize the same emergency state shape the tenant-wide path
    // produces, but using the override's type/severity/playlist. The
    // tenant-wide block below stays untouched — if no per-screen
    // override is active we fall through to it like always.
    //
    // This is the load-bearing change for Sprint 8b: "different alert
    // per room" works because the manifest path always picks per-screen
    // before tenant. No additional protocol on the player side — same
    // emergencyStatus shape goes out the door.
    let activeScreenOverride: any = null;
    try {
      activeScreenOverride = await (this.prisma.client as any).screenEmergencyOverride.findUnique({
        where: { screenId: screen.id },
      });
      if (activeScreenOverride?.expiresAt) {
        const exp = new Date(activeScreenOverride.expiresAt).getTime();
        if (Number.isFinite(exp) && exp < Date.now()) {
          // Expired override — treat as cleared. Don't delete here
          // (manifest endpoint should be read-only); a janitor / cron
          // can prune. Just ignore for this manifest fetch.
          activeScreenOverride = null;
        }
      }
    } catch { /* schema mismatch / missing table — fall back to tenant-wide */ }

    if (screen.tenantId) {
      // Hot-path cache: the emergency-state lookup for this tenant is
      // shared across every screen in the tenant polling manifest.
      // Cache for 2s; emergency controllers explicitly invalidate on
      // trigger/all-clear so the state propagates faster than TTL.
      let tenant = getTenantState(screen.tenantId) as any;
      if (!tenant) {
        tenant = await this.prisma.client.tenant.findUnique({
          where: { id: screen.tenantId },
          // Pull both orientation pointers so we can pick the right one
          // for this specific screen. Cast select through `any` so the
          // controller compiles even before @prisma/client picks up the
          // new emergency_portrait_playlist_id column (handled by the
          // 20260420180000_add_emergency_portrait_variants migration +
          // db:generate on next boot).
          select: {
            emergencyStatus: true,
            // 2026-07-25 — the INCIDENT TYPE (LOCKDOWN / EVACUATE / ...). Must be
            // selected explicitly or `tenant.emergencyType` is undefined and the
            // manifest silently falls back to the severity again.
            emergencyType: true,
            emergencyPlaylistId: true,
            emergencyPortraitPlaylistId: true,
            // Sprint 8b — location-based mode toggle. When false, the
            // manifest treats every screen as if it has no per-screen
            // overrides set (admin hasn't opted in yet, or has opted
            // back out — flipping the toggle off should immediately
            // restore the simpler "every screen plays the tenant
            // default" behavior without needing to wipe data).
            locationBasedEmergencyEnabled: true,
          } as any,
        }) as any;
        if (tenant) setTenantState(screen.tenantId, tenant);
      }

      // Sprint 8b — per-screen override wins over tenant-wide. If we
      // found a non-expired ScreenEmergencyOverride for this screen
      // above, treat the manifest as if an emergency is active
      // EVEN WHEN the tenant-wide status is INACTIVE. The override's
      // type becomes the surfaced emergencyStatus; its playlist (if
      // set) is preferred over the tenant default. Critical: a
      // per-screen override may also be in effect during a tenant-wide
      // alert — in that case the per-screen content trumps. e.g.,
      // tenant is in WEATHER but the gym screen carries a LOCKDOWN
      // override because of a localized incident. The gym renders
      // LOCKDOWN, every other screen renders WEATHER.
      const emergencyActiveForThisScreen =
        !!activeScreenOverride ||
        (tenant?.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE');

      if (emergencyActiveForThisScreen) {
        let playlists: any[] = [];

        // Parse the screen's stored resolution ("2160×3840" / "2160x3840")
        // to decide which playlist variant to serve. Portrait = height
        // strictly greater than width. If resolution is null or
        // unparseable we default to landscape (safe: the original
        // emergencyPlaylistId is what every tenant already has wired up).
        const isPortrait = (() => {
          // Prefer the operator's explicit LED canvas dims: a 960×1080 poster
          // reports DEVICE resolution 1920×1080 (landscape) but is physically
          // portrait — same precedence the scoreboard manifest + board page use.
          // Fall back to stored resolution when no canvas is configured.
          const cw = Number((screen as any).canvasW);
          const ch = Number((screen as any).canvasH);
          if (Number.isFinite(cw) && Number.isFinite(ch) && cw > 0 && ch > 0) return ch > cw;
          const r = (screen.resolution || '').trim();
          const m = r.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
          if (!m) return false;
          return parseInt(m[2], 10) > parseInt(m[1], 10);
        })();

        // Sprint 8b — per-screen emergency content config takes
        // priority over the tenant defaults. FOUR tiers, in order:
        //   1. Per-trigger override `playlistId`  (manual incident)
        //   2. Per-screen `emergency*PlaylistId`   (config column)
        //   3. Per-screen `emergency*AssetUrl`     (single uploaded file)
        //   4. Tenant-wide `panic*PlaylistId`      (school-wide default)
        // Operator can mix-and-match: gym screens can show a custom
        // "evacuate via north exit" playlist on EVACUATE while every
        // other screen uses the tenant default — no manual trigger
        // required, configured once and forgotten.
        const screenAny = screen as any;
        const emergencyTypeKey = (activeScreenOverride?.type || tenant?.emergencyStatus || '').toUpperCase();
        // Operator can configure separate landscape + portrait variants
        // per emergency type per screen. The screen's actual physical
        // orientation (computed below from `screen.resolution`) decides
        // which set the manifest reads. We FALL BACK to the other
        // orientation if only one was configured — mirrors the tenant-
        // wide behavior where a single configured orientation covers
        // every kiosk regardless of mounting.
        const perScreenForType = ((): string | null => {
          if (isPortrait) {
            switch (emergencyTypeKey) {
              case 'LOCKDOWN': return screenAny.emergencyLockdownPortraitPlaylistId || screenAny.emergencyLockdownPlaylistId || null;
              case 'EVACUATE': return screenAny.emergencyEvacuatePortraitPlaylistId || screenAny.emergencyEvacuatePlaylistId || null;
              case 'WEATHER':  return screenAny.emergencyWeatherPortraitPlaylistId  || screenAny.emergencyWeatherPlaylistId  || null;
              case 'HOLD':     return screenAny.emergencyHoldPortraitPlaylistId     || screenAny.emergencyHoldPlaylistId     || null;
              case 'SECURE':   return screenAny.emergencySecurePortraitPlaylistId   || screenAny.emergencySecurePlaylistId   || null;
              case 'MEDICAL':  return screenAny.emergencyMedicalPortraitPlaylistId  || screenAny.emergencyMedicalPlaylistId  || null;
              default:         return null;
            }
          }
          switch (emergencyTypeKey) {
            case 'LOCKDOWN': return screenAny.emergencyLockdownPlaylistId || screenAny.emergencyLockdownPortraitPlaylistId || null;
            case 'EVACUATE': return screenAny.emergencyEvacuatePlaylistId || screenAny.emergencyEvacuatePortraitPlaylistId || null;
            case 'WEATHER':  return screenAny.emergencyWeatherPlaylistId  || screenAny.emergencyWeatherPortraitPlaylistId  || null;
            case 'HOLD':     return screenAny.emergencyHoldPlaylistId     || screenAny.emergencyHoldPortraitPlaylistId     || null;
            case 'SECURE':   return screenAny.emergencySecurePlaylistId   || screenAny.emergencySecurePortraitPlaylistId   || null;
            case 'MEDICAL':  return screenAny.emergencyMedicalPlaylistId  || screenAny.emergencyMedicalPortraitPlaylistId  || null;
            default:         return null;
          }
        })();
        const perScreenAssetForType = ((): string | null => {
          if (isPortrait) {
            switch (emergencyTypeKey) {
              case 'LOCKDOWN': return screenAny.emergencyLockdownPortraitAssetUrl || screenAny.emergencyLockdownAssetUrl || null;
              case 'EVACUATE': return screenAny.emergencyEvacuatePortraitAssetUrl || screenAny.emergencyEvacuateAssetUrl || null;
              case 'WEATHER':  return screenAny.emergencyWeatherPortraitAssetUrl  || screenAny.emergencyWeatherAssetUrl  || null;
              case 'HOLD':     return screenAny.emergencyHoldPortraitAssetUrl     || screenAny.emergencyHoldAssetUrl     || null;
              case 'SECURE':   return screenAny.emergencySecurePortraitAssetUrl   || screenAny.emergencySecureAssetUrl   || null;
              case 'MEDICAL':  return screenAny.emergencyMedicalPortraitAssetUrl  || screenAny.emergencyMedicalAssetUrl  || null;
              default:         return null;
            }
          }
          switch (emergencyTypeKey) {
            case 'LOCKDOWN': return screenAny.emergencyLockdownAssetUrl || screenAny.emergencyLockdownPortraitAssetUrl || null;
            case 'EVACUATE': return screenAny.emergencyEvacuateAssetUrl || screenAny.emergencyEvacuatePortraitAssetUrl || null;
            case 'WEATHER':  return screenAny.emergencyWeatherAssetUrl  || screenAny.emergencyWeatherPortraitAssetUrl  || null;
            case 'HOLD':     return screenAny.emergencyHoldAssetUrl     || screenAny.emergencyHoldPortraitAssetUrl     || null;
            case 'SECURE':   return screenAny.emergencySecureAssetUrl   || screenAny.emergencySecurePortraitAssetUrl   || null;
            case 'MEDICAL':  return screenAny.emergencyMedicalAssetUrl  || screenAny.emergencyMedicalPortraitAssetUrl  || null;
            default:         return null;
          }
        })();

        // Sprint 8b mode gate. Per-screen config columns (and per-screen
        // custom uploads) only matter if the tenant has opted into
        // location-based mode. The columns themselves are kept (so
        // toggling the mode back on is non-destructive), but the
        // manifest behaves like they're empty until the flag flips.
        // Per-trigger ScreenEmergencyOverride entries are ALWAYS
        // honored — those are explicit, audit-logged operator actions
        // that pre-date the per-screen-config layer and must never be
        // gated by a settings toggle.
        const locationModeOn = !!tenant?.locationBasedEmergencyEnabled;
        const effectivePerScreenPlaylist = locationModeOn ? perScreenForType : null;
        const effectivePerScreenAsset    = locationModeOn ? perScreenAssetForType : null;

        // Pick the playlist for this screen's orientation. Graceful
        // fallback in BOTH directions: a portrait screen uses the
        // landscape playlist if no portrait was configured, and
        // vice-versa.
        const chosenPlaylistId =
          activeScreenOverride?.playlistId ||                          // 1. manual trigger override (always honored)
          effectivePerScreenPlaylist ||                                 // 2. per-screen config (gated by location mode)
          (isPortrait                                                   // 3. tenant default
            ? (tenant?.emergencyPortraitPlaylistId || tenant?.emergencyPlaylistId || null)
            : (tenant?.emergencyPlaylistId || tenant?.emergencyPortraitPlaylistId || null));

        if (chosenPlaylistId) {
          const emergencyPlaylist = await this.prisma.client.playlist.findUnique({
            where: { id: chosenPlaylistId },
            include: {
              items: {
                // Sprint 1.5 approval gate. Issue #1: previously the
                // manifest delivered every item regardless of asset
                // approval state — meaning a CONTRIBUTOR's pending
                // asset reached screens before any admin approved it.
                // Filter to PUBLISHED only. Emergency assets are
                // admin-uploaded and auto-publish so this is a strict
                // tightening with no behavior change for the existing
                // admin-content path.
                where: { asset: { status: 'PUBLISHED' } },
                include: { asset: true },
                orderBy: { sequenceOrder: 'asc' }
              }
            }
          });

          if (emergencyPlaylist && emergencyPlaylist.items.length > 0) {
            playlists = [{
              id: emergencyPlaylist.id,
              name: emergencyPlaylist.name,
              items: emergencyPlaylist.items.map(item => ({
                item_id: item.id,
                asset_id: item.assetId,
                asset_hash: item.asset.fileHash ?? null,
                url: item.asset.fileUrl,
                duration_ms: item.durationMs,
                sequence: item.sequenceOrder,
                mime_type: item.asset.mimeType ?? null,
                transition_type: item.transitionType ?? null,
              }))
            }];
          }
        }

        // If no playlist was selected/found AND the operator uploaded a
        // single custom asset for this emergency type, synthesize a
        // one-item playlist around it. The player renders the asset
        // full-screen for the standard emergency duration. Image vs
        // video MIME is inferred from the URL extension. Gated by the
        // same location-mode toggle as the playlist column above —
        // see `effectivePerScreenAsset` for rationale.
        const effectiveOverrideAsset = activeScreenOverride?.mediaUrl || null;
        if (playlists.length === 0 && (effectiveOverrideAsset || effectivePerScreenAsset)) {
          const url = (effectiveOverrideAsset || effectivePerScreenAsset)!;
          const ext = (url.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
          const mime =
            ['mp4','mov','webm','m4v'].includes(ext) ? `video/${ext === 'mov' ? 'quicktime' : ext}` :
            ['png','jpg','jpeg','webp','gif','svg','bmp'].includes(ext) ? `image/${ext === 'jpg' ? 'jpeg' : ext}` :
            ext === 'pdf' ? 'application/pdf' :
            null;
          playlists = [{
            id: `screen-asset-${emergencyTypeKey.toLowerCase()}`,
            name: `${emergencyTypeKey} (custom asset)`,
            items: [{
              item_id: `screen-asset-${screen.id}-${emergencyTypeKey.toLowerCase()}`,
              asset_id: null,
              asset_hash: null,
              url,
              duration_ms: 60_000,  // 60s default for a single-asset emergency loop
              sequence: 0,
              mime_type: mime,
              transition_type: null,
            }],
          }];
        }

        // Effective emergency type for THIS screen — per-screen
        // override wins; falls back to the tenant-wide emergencyStatus.
        // Per-screen override wins; then the tenant's INCIDENT TYPE; only then
        // the legacy emergencyStatus (which holds the SEVERITY, so it renders
        // "CRITICAL PROTOCOL ACTIVE" — kept last purely for rows written before
        // Tenant.emergencyType existed).
        const effectiveType =
          activeScreenOverride?.type ||
          (tenant as any)?.emergencyType ||
          tenant?.emergencyStatus ||
          'EMERGENCY';
        const effectiveSeverity =
          activeScreenOverride?.severity ||
          tenant?.emergencyStatus ||
          'HIGH';

        // BULLETPROOF FALLBACK: If the admin failed to assign an emergency playlist or it was empty,
        // we MUST still lock the screen down to protect the school.
        // Swap template width/height for portrait screens so the TEXT
        // zone fills the full canvas correctly (1920×1080 → 1080×1920).
        // The per-screen override's textBlob (operator-typed message)
        // and scope_note land in the fallback content so the rendered
        // text matches the trigger UX exactly.
        if (playlists.length === 0) {
          // 2026-06-28 (Greg live P0 — lockdown rendered at 1920 on the
          // 960×1080 LED): the fallback template MUST be authored at the
          // screen's REAL visible canvas, not a hardcoded 1920/1080. The
          // player's TemplateScaler sizes the scene to designW=template.
          // screenWidth; when that was 1920 the lockdown was laid out for a
          // 1920 frame buffer and only the left ~960 showed on the panel. Use
          // the operator-set canvasW/canvasH (e.g. 960×1080) so the fallback
          // emergency fills the actual LED exactly; fall back to the
          // portrait/landscape default only when the screen has no canvas set.
          const canvasW =
            screen.canvasW && screen.canvasW > 0 ? screen.canvasW : (isPortrait ? 1080 : 1920);
          const canvasH =
            screen.canvasH && screen.canvasH > 0 ? screen.canvasH : (isPortrait ? 1920 : 1080);
          // Pick the most specific text we have — operator's textBlob
          // first, then the scope_note ("Gym wing — hold position"),
          // then a SYSTEM DEFAULT message that includes the type.
          const fallbackContent =
            activeScreenOverride?.textBlob
              ? activeScreenOverride.textBlob
              : activeScreenOverride?.scopeNote
                ? `${effectiveType} — ${activeScreenOverride.scopeNote}\n\nFollow standard procedures.`
                : `EMERGENCY NOTIFICATION\n\n${effectiveType} PROTOCOL ACTIVE\n\nPlease follow standard procedures`;
          const fallbackBg =
            effectiveSeverity === 'CRITICAL' ? '#dc2626' :
            effectiveSeverity === 'HIGH'     ? '#dc2626' :
            effectiveSeverity === 'MEDIUM'   ? '#d97706' :
            '#d97706';
          playlists = [{
             id: "DEFAULT_EMERGENCY",
             name: `SYSTEM DEFAULT - ${effectiveType}`,
             template: {
               name: "EMERGENCY OVERRIDE",
               bgColor: fallbackBg,
               screenWidth: canvasW,
               screenHeight: canvasH,
               zones: [
                 {
                   id: "emergency-zone",
                   x: 0, y: 0, width: 100, height: 100, zIndex: 1,
                   widgetType: "TEXT",
                   // 2026-06-27 (LANE 1 life-safety) — route through the
                   // signage-design ENGINE text path (`sizeMode: 'absolute'`)
                   // so the message ALWAYS fits its zone via FitScaler
                   // (measure + transform:scale, Chromium-83/Taurus-safe),
                   // never clipping. The legacy TEXT path hard-CLAMPS
                   // fontSize to 3em (~48px) AND wraps inside an
                   // `overflow:hidden` box with NO shrink — so a long
                   // operator-typed lockdown message (textBlob) was cut off
                   // top/bottom on any canvas where the wrapped text ran
                   // taller than the zone (the exact clip class Greg caught
                   // on the 960×1080 LED). `fontSize` here is the INTENDED
                   // size; FitScaler shrinks it down to fit. fontWeight 800
                   // replaces the legacy `bold` flag (the absolute path reads
                   // a numeric weight, not the toggle).
                   defaultConfig: {
                     sizeMode: "absolute",
                     content: fallbackContent,
                     fontSize: isPortrait ? 140 : 100,
                     fontWeight: 800,
                     color: "white",
                     alignment: "center",
                     lineHeight: 1.15
                   }
                 }
               ]
             },
             items: []
          }];
        }

        return res.status(200).json({
          screenId: screen.id,
          generatedAt: new Date().toISOString(),
          isEmergency: true,
          // Sprint 8b — surface the active type so the player can show
          // the right banner / icon. Per-screen wins over tenant.
          emergencyType: effectiveType,
          emergencySeverity: effectiveSeverity,
          // Operator-typed scope note ("Gym — hold position") so the
          // player can render it as a sub-banner. Empty when only the
          // tenant-wide alert is active.
          emergencyScopeNote: activeScreenOverride?.scopeNote || null,
          // Tells the player whether it's running a per-screen or
          // tenant-wide override. Useful for the Stopped splash too.
          emergencyScope: activeScreenOverride ? 'screen' : 'tenant',
          // 2026-05-26 audit — surface the per-screen override's expiry
          // (UNIX seconds) so the player's emergency-cache layer at
          // apps/web/.../player/page.tsx:451 anchors the cache TTL to
          // the server-issued absolute time instead of the device's
          // wall clock. The reader (page.tsx:2711) already expects this
          // field; only emit it when there's actually a per-screen
          // override with an expiry (tenant-wide alerts don't auto-
          // expire — they last until explicit ALL_CLEAR). Null when
          // absent so the player falls through to its 4h fallback TTL,
          // matching pre-existing behavior for tenant-wide alerts.
          emergencyExpiresAt: activeScreenOverride?.expiresAt
            ? Math.floor(new Date(activeScreenOverride.expiresAt).getTime() / 1000)
            : null,
          orientation: isPortrait ? 'portrait' : 'landscape',
          // 2026-06-25 — carry the LED canvas dims + tile-repeat on the
          // EMERGENCY manifest too (scoreboard + normal playlist branches
          // already do). Without these the player's TemplateScaler renders the
          // emergency playlist at device resolution (1920) → the alert is cut
          // off on a narrow LED poster (e.g. the live 960×1080 water-polo wall).
          // Life-safety: an alert that doesn't fit is an alert unseen.
          canvasW: (screen as any).canvasW ?? null,
          canvasH: (screen as any).canvasH ?? null,
          repeats: (screen as any).repeats ?? 1,
          // 2026-05-27 — EP6N GPIO output state. The player applies
          // these to the Phoenix terminal's relay outputs. Emergency
          // branch must carry the same state as the normal branch so
          // a status lamp that was lit via gpio-set doesn't blink
          // off when the screen flips into emergency mode.
          gpio: (() => {
            const s = readGpioState((screen as any).config);
            return { out1: s.out1, out2: s.out2 };
          })(),
          playlists
        });
      }
    }

    // ─── VenueOS Sports — scoreboard push (PRECEDED by emergency) ───
    // If an operator pushed a live game to this screen, serve the
    // synthetic scoreboard manifest instead of the scheduled playlist.
    // This is reached ONLY when no emergency is active — the emergency
    // branch above already returned if one was — so an alert always
    // wins. A stale / cross-tenant game id is ignored and we fall
    // through to the normal scheduled-content path below.
    if (screen.tenantId && (screen as any).activeBoardGameId) {
      const boardGame = await this.prisma.client.game.findFirst({
        where: { id: (screen as any).activeBoardGameId, tenantId: screen.tenantId },
        select: { id: true },
      });
      if (boardGame) {
        const boardPayload: Record<string, any> = {
          version: '1.0',
          screenId: id,
          tenantId: screen.tenantId,
          tenantName: (screen as any).tenant?.name || null,
          generatedAt: new Date().toISOString(),
          // 2026-05-24 — orientation lock for sports-mode screens too.
          orientation: (screen as any).orientation || 'LANDSCAPE',
          // 2026-06-24 — carry the LED canvas dims + tile-repeat on the
          // SCOREBOARD manifest too (the normal playlist branch already does).
          // Without these the player's TemplateScaler keeps a stale/empty
          // canvas and renders the board at the device resolution (1920) →
          // cut off on a narrow LED poster (960×1080). Pairs with the
          // canvas-aware synthetic-template sizing in buildScoreboardManifest.
          canvasW: (screen as any).canvasW ?? null,
          canvasH: (screen as any).canvasH ?? null,
          repeats: (screen as any).repeats ?? 1,
          // 2026-05-27 — EP6N GPIO output state (status lamp / horn).
          // Same shape across every manifest branch.
          gpio: (() => {
            const s = readGpioState((screen as any).config);
            return { out1: s.out1, out2: s.out2 };
          })(),
          playlists: this.buildScoreboardManifest(
            screen,
            boardGame,
            (screen as any).activeBoardSurface,
          ),
        };
        // 2026-07-02 (efficiency #2 pre-req) — hash the WHOLE payload minus
        // the per-request timestamp, not just playlists. A playlists-only
        // hash 304s away orientation / canvas / gpio changes the moment a
        // client actually sends If-None-Match (which the player now does).
        const { generatedAt: _volatileBoardTs, ...hashableBoardPayload } = boardPayload;
        const boardHash = crypto
          .createHash('sha256')
          .update(JSON.stringify(hashableBoardPayload) + id)
          .digest('hex');
        res.setHeader('ETag', boardHash);
        if (activeDeviceHash === boardHash) {
          return res.status(304).send();
        }
        boardPayload['hash'] = boardHash;
        return res.status(200).json(boardPayload);
      }
    }

    // ─── Manifest content cache (Supabase egress diet — 2026-07-30) ───
    // Every early-return above (revoked, auth mismatch, EMERGENCY branch,
    // sports scoreboard) has already run, so a cache hit can only ever
    // serve the normal scheduled-content manifest. The screen row, the
    // per-screen override row and the tenant emergency state were still
    // read LIVE on this very poll; what a hit skips is the schedule→
    // playlist→items→asset→template→zones fan-out (~7 queries, ~100 KB DB
    // egress per poll — ~25 GB/mo at five always-on screens, the entire
    // July-2026 Supabase overage). Invalidation contract (see
    // manifest-hot-cache.ts): any content mutation via Prisma busts on the
    // next poll; scheduled go-lives/stops land on time via boundaryAt;
    // TTL bounds everything else. ETag semantics identical to a rebuild —
    // same hashable payload object, same sha256.
    const cachedManifest = getManifestCache(screen.id);
    if (cachedManifest) {
      if (cachedManifest.kind === 'empty') {
        return res.status(200).json(cachedManifest.body);
      }
      res.setHeader('ETag', cachedManifest.etag);
      if (activeDeviceHash === cachedManifest.etag) {
        return res.status(304).send();
      }
      return res.status(200).json({
        ...cachedManifest.hashablePayload,
        generatedAt: new Date().toISOString(),
        hash: cachedManifest.etag,
      });
    }

    const now = new Date();
    // SECURITY (multi-tenant isolation): a schedule targets exactly
    // ONE thing — a specific screen (screenId) or a group
    // (screenGroupId); schedule creation enforces one or the other.
    // The group clause must ONLY be added when this screen is actually
    // in a group: Prisma treats `{ screenGroupId: null }` as "match
    // every row whose screenGroupId IS NULL", and EVERY screen-pinned
    // schedule carries screenGroupId = null — so a groupless screen
    // matching `{ screenGroupId: screen.screenGroupId }` with a null
    // group would inherit every screen-pinned schedule, in EVERY
    // tenant (a freshly-added screen would auto-play another account's
    // content). The query is tenant-scoped too, as defense in depth.
    const scheduleTargetOr: any[] = [{ screenId: screen.id }];
    if (screen.screenGroupId) {
      scheduleTargetOr.push({ screenGroupId: screen.screenGroupId });
    }
    const schedules = await this.prisma.client.schedule.findMany({
      where: {
        AND: [
          ...(screen.tenantId ? [{ tenantId: screen.tenantId }] : []),
          { OR: scheduleTargetOr },
          { startTime: { lte: now } },
          { OR: [{ endTime: { gte: now } }, { endTime: null }] },
          { isActive: true },
        ]
      },
      include: {
        playlist: {
          include: {
            // Sprint 1.5 approval gate (Issue #1). PENDING_APPROVAL
            // assets are silently dropped from the manifest so a
            // CONTRIBUTOR's submitted-but-not-yet-approved content
            // never reaches a screen. Approve flips the asset's status
            // PENDING_APPROVAL→PUBLISHED and the next manifest poll
            // includes it. All admin-uploaded assets land directly at
            // PUBLISHED so this is a strict tightening with no impact
            // on the existing admin-content flow.
            items: {
              where: { asset: { status: 'PUBLISHED' } },
              orderBy: { sequenceOrder: 'asc' },
              include: { asset: true },
            },
            template: {
              include: {
                zones: { orderBy: { sortOrder: 'asc' } },
                // 2026-05-14 — D2 touch-scenes were stored on the
                // Template but never INCLUDED in the manifest query,
                // so the player couldn't filter zones by sceneId or
                // handle goto-template touch actions. Same audit as
                // the isTouchEnabled / touchAction passthrough fix.
                scenes: { orderBy: { sortOrder: 'asc' } },
              },
            },
          }
        }
      }
    });

    // Next schedule boundary for THIS screen's targets: the earliest
    // future startTime (a scheduled go-live) or future endTime (an active
    // window expiring). The cached manifest must not outlive it — a
    // campaign scheduled for 3:00 must appear on the first poll after
    // 3:00 exactly like the uncached path did. Two 1-row indexed lookups,
    // and they only run on a REBUILD (cache miss), never on a hit.
    // (Fine-grained daysOfWeek/timeStart windows are evaluated player-side
    // from fields already in the payload — no server rebuild needed.)
    let nextScheduleBoundaryAt: number | null = null;
    try {
      const boundaryWhereBase: any = {
        AND: [
          ...(screen.tenantId ? [{ tenantId: screen.tenantId }] : []),
          { OR: scheduleTargetOr },
          { isActive: true },
        ],
      };
      const [nextStart, nextEnd] = await Promise.all([
        this.prisma.client.schedule.findFirst({
          where: { ...boundaryWhereBase, startTime: { gt: now } },
          orderBy: { startTime: 'asc' },
          select: { startTime: true },
        }),
        this.prisma.client.schedule.findFirst({
          where: { ...boundaryWhereBase, endTime: { gt: now } },
          orderBy: { endTime: 'asc' },
          select: { endTime: true },
        }),
      ]);
      const boundaryCandidates = [nextStart?.startTime, nextEnd?.endTime]
        .filter((d): d is Date => !!d)
        .map((d) => new Date(d).getTime())
        .filter((t) => Number.isFinite(t));
      if (boundaryCandidates.length) nextScheduleBoundaryAt = Math.min(...boundaryCandidates);
    } catch {
      // Boundary probe failed (transient DB blip) — cache only briefly so
      // a pending go-live can't be missed for long.
      nextScheduleBoundaryAt = Date.now() + 60_000;
    }

    if (!schedules.length) {
      // 200 with empty playlists — NOT 404. A paired screen with no
      // scheduled content is a valid "waiting for assignment" state,
      // not a connection failure. Previously the player saw 404 and
      // displayed 'Unable to Connect' which looked identical to a
      // real network/auth error — admin had no way to tell the
      // difference.
      const emptyBody = {
        screenId: screen.id,
        tenantId: screen.tenantId,
        tenantName: (screen as any).tenant?.name || null,
        playlists: [],
        // 2026-05-26 P0-2 — be explicit about no-emergency so the
        // player's manifest handler can clear any stale local state
        // without needing to infer from absence-of-fields.
        isEmergency: false,
        emergencyStatus: 'INACTIVE',
        emptyReason: 'NO_SCHEDULE',
        message: 'This screen is paired but no playlist is scheduled. Assign a playlist from the dashboard.',
        hash: 'empty',
      };
      // Fully static body — cache and replay verbatim until content
      // changes or the next schedule boundary (an upcoming go-live is
      // exactly the transition that turns this empty manifest non-empty).
      setManifestCache(
        screen.id,
        { kind: 'empty', body: emptyBody, boundaryAt: nextScheduleBoundaryAt },
        manifestRevAtStart,
      );
      return res.status(200).json(emptyBody);
    }

    // Sum item file sizes per playlist so the player can show operators
    // how much disk a playlist uses from the Stopped splash. Items with
    // no captured fileSize (e.g. URL-type assets, pre-hash uploads)
    // simply contribute 0.
    const dynamicPlaylists = schedules.map(s => {
    // 2026-05-05 — schedule-level audio override.
    // Null = honor each PlaylistItem.muted (current behavior).
    // True = force every video on this schedule muted.
    // False = force every video unmuted.
    // Lets one playlist publish to lobby muted + cafeteria with
    // sound from the same source content.
    const scheduleMute = (s as any).mutedOverride;
    return ({
      id: s.playlistId,
      // Name + schedule metadata — lets the player surface "what's
      // loaded and when it plays" without a separate API round-trip.
      // Operator-facing fields, not load-bearing for playback, so
      // omitting any of them is safe.
      name: s.playlist.name,
      schedule: {
        daysOfWeek: s.daysOfWeek || null,  // "Mon,Tue,Wed,Thu,Fri" or null
        timeStart: s.timeStart || null,    // "08:00" or null
        timeEnd: s.timeEnd || null,        // "15:00" or null
        mutedOverride: scheduleMute ?? null, // operator-facing
      },
      totalBytes: s.playlist.items.reduce(
        (sum, pi) => sum + (pi.asset.fileSize || 0),
        0,
      ),
      // Include template data when playlist is template-based
      ...(s.playlist.template ? {
        template: {
          id: s.playlist.template.id,
          name: s.playlist.template.name,
          screenWidth: s.playlist.template.screenWidth,
          screenHeight: s.playlist.template.screenHeight,
          bgColor: s.playlist.template.bgColor,
          bgGradient: s.playlist.template.bgGradient,
          bgImage: s.playlist.template.bgImage,
          // 2026-05-14 — operator: "i created a touch template and
          // everytime i tap the screen this menu pops up, something
          // is very broken in our touch workflow". Root cause was
          // here: isTouchEnabled + idleResetMs were stored on the
          // Template row but NEVER serialized into the manifest
          // payload, so the player's `playlist.template.isTouchEnabled`
          // read as undefined → falsy → the canvas onClick fell back
          // to the operator-info overlay toggle instead of letting
          // taps reach the touch widgets. Wiring them in here is the
          // whole fix.
          isTouchEnabled: !!(s.playlist.template as any).isTouchEnabled,
          idleResetMs: (s.playlist.template as any).idleResetMs ?? undefined,
          zones: s.playlist.template.zones.map(z => ({
            id: z.id,
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex,
            sortOrder: z.sortOrder,
            // Surface touchAction on each zone too — D1 phase added
            // per-zone tap dispatchers. Same audit miss as above:
            // the field existed in the DB + builder but never made
            // it through the manifest serializer.
            touchAction: (z as any).touchAction ?? null,
            // sceneId from D2 touch-scene support. Player groups
            // zones by sceneId for the active-scene render filter.
            sceneId: (z as any).sceneId ?? null,
            defaultConfig: z.defaultConfig ? JSON.parse(z.defaultConfig) : null,
          })),
          // Scene metadata for D2 touch-navigation. Empty array for
          // non-multi-scene templates.
          scenes: Array.isArray((s.playlist.template as any).scenes)
            ? (s.playlist.template as any).scenes
            : [],
        },
      } : {}),
      items: s.playlist.items.map(pi => ({
        item_id: pi.id,
        asset_id: pi.assetId,
        asset_hash: pi.asset.fileHash ?? null,
        url: pi.asset.fileUrl,
        duration_ms: pi.durationMs,
        sequence: pi.sequenceOrder,
        // Surface mimeType so the player knows whether to render the
        // item as <video>, <img>, or <iframe>. Without this the player
        // had to guess from the URL extension (`/\.(mp4|webm)$/i`),
        // which breaks for URL assets (text/html — no extension match
        // → silently rendered as a broken <img>) and PDF assets.
        // The Asset row always has a real mimeType set: 'text/html'
        // for URL assets via /assets/url, 'application/pdf' for PDFs,
        // 'video/*' or 'image/*' for uploads.
        mime_type: pi.asset.mimeType ?? null,
        transition_type: pi.transitionType ?? null,
        // 2026-05-05 — final muted resolution.
        // Precedence: schedule.mutedOverride > item.muted > true.
        // Operator can publish the SAME playlist to two screens with
        // different audio settings by flipping mutedOverride at the
        // schedule level — no per-item edits required.
        muted: typeof scheduleMute === 'boolean'
          ? scheduleMute
          : ((pi as any).muted ?? true),
      }))
    });
    });

    const manifestPayload: Record<string, any> = {
      version: "1.0",
      screenId: id,
      tenantId: screen.tenantId,
      tenantName: (screen as any).tenant?.name || null,
      generatedAt: now.toISOString(),
      // 2026-05-26 P0-2 — explicit no-emergency signal so the player
      // can confidently clear any stale local emergency state without
      // inferring from absence-of-fields. The "isEmergency: true" branch
      // above (line ~2277) returns early; reaching this normal-manifest
      // path means there's definitively no emergency.
      isEmergency: false,
      // 2026-05-24 — operator-controlled orientation lock. Player APK
      // applies on boot and on every manifest poll (cheap setter — only
      // calls setRequestedOrientation if the value changed). Older APKs
      // (no orientation field expected) ignore unknown fields.
      orientation: (screen as any).orientation || 'LANDSCAPE',
      // 2026-05-26 — LED canvas dimensions for narrow-chain panels.
      // Null = use controller's native viewport. Player reads these
      // on every manifest poll and applies via document.documentElement
      // CSS vars + reloads splash. Operator sets via dashboard
      // /screens UI; signed WS broadcast (CANVAS_CHANGE) also pushes
      // the new value within ~150ms of the operator's tap.
      canvasW: (screen as any).canvasW ?? null,
      canvasH: (screen as any).canvasH ?? null,
      // 2026-05-26 — content tile-repeat count for ribbons. Default 1
      // = no tiling. > 1 = player wraps content in flex grid with N
      // children, each rendering same template at canvasW/repeats.
      // Operator's 40ft × 1m ribbon with repeats=4: each 10ft segment
      // gets the same score / sponsor / celebration. Viewing angle
      // problem solved (no one's far from a visible repeat).
      repeats: (screen as any).repeats ?? 1,
      // 2026-05-27 — Goodview EP6N hardware state surfaced to the player.
      //   gpio   — current OUT pin state (Agent C). Player applies
      //            out1 / out2 to the Phoenix terminal's relay outputs.
      //   wiring — operator-set serial / RS485 / GPIO mappings (Agent B).
      //            CtsBridge reads wiring.rs232_1 / rs232_2 to route
      //            CTS vs Stream Deck vs aux-debug.
      // Older hardware models (Taurus / Pi5 / generic Android / web)
      // ignore unknown manifest fields. Defaults: gpio out=low,
      // wiring=null (CtsBridge treats null as the legacy single-port
      // path — backward compatible).
      gpio: (() => {
        const s = readGpioState((screen as any).config);
        return { out1: s.out1, out2: s.out2 };
      })(),
      wiring: ((screen as any).config && typeof (screen as any).config === 'object'
        && !Array.isArray((screen as any).config)
        && (screen as any).config.wiring
        && typeof (screen as any).config.wiring === 'object')
        ? (screen as any).config.wiring
        : null,
      // 2026-06-01 — which scoreboard console drives this screen, from
      // Screen.config.consoleProfile. CtsBridge reads it to pick the
      // serial settings + default tty (Gen 6/Daktronics → native ttyS1;
      // WTTC → USB-serial ttyUSB0) + decoder. Null = CtsBridge default
      // ('cts-gen6'), so existing installs are unchanged. Older APKs
      // ignore unknown manifest keys.
      consoleProfile: ((screen as any).config && typeof (screen as any).config === 'object'
        && !Array.isArray((screen as any).config)
        && typeof (screen as any).config.consoleProfile === 'string')
        ? (screen as any).config.consoleProfile
        : null,
      // 2026-05-27 — surface the chosen hardware model so the player /
      // KioskSplash can gate hardware-specific UI:
      //  - Suppresses the "LED canvas not set" banner on LCD-driven
      //    boxes (goodview-ep6n, pi5, generic-android, web) where the
      //    daisy-chained-panels math doesn't apply.
      //  - Drives the per-model integration affordances (dual RS232 on
      //    EP6N, no GPIO on Taurus, etc).
      // Older APKs ignore unknown manifest keys, so this is safe to
      // ship without a player-side migration.
      hardwareModel: (screen as any).hardwareModel ?? null,
      // 2026-07-28 — frame-locked multi-screen sync config
      // (docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §7).
      // enabled ⟵ ScreenGroup.syncMode === 'locked' (the group toggle);
      // trimMs ⟵ Screen.syncOffsetMs (per-screen display-latency trim).
      // Older players ignore unknown manifest keys (same contract as
      // hardwareModel/gpio above). Deliberately part of the hashed
      // payload: flipping the toggle or nudging the trim busts the ETag
      // so screens pick it up on their next poll. No volatile clock
      // field here — players sample the clock via WS TIME_PING or
      // GET /realtime/time, never the manifest (would break 304s).
      sync: (() => {
        const g: any = (screen as any).screenGroup;
        if (!g || g.syncMode !== 'locked') return { enabled: false };
        return {
          enabled: true,
          groupId: g.id,
          trimMs: (screen as any).syncOffsetMs ?? 0,
        };
      })(),
      playlists: dynamicPlaylists
    };

    // 2026-07-02 (efficiency #2 pre-req) — the hash MUST cover every field
    // applyManifest consumes (isEmergency, orientation, canvasW/H, repeats,
    // gpio, wiring, consoleProfile, hardwareModel, playlists…), minus the
    // per-request generatedAt timestamp. The old playlists-only hash was
    // harmless while no client sent If-None-Match, but the player now does —
    // and a 304 computed from playlists alone would suppress the emergency
    // ALL-CLEAR (isEmergency:false) on the HTTP polling backstop. (The
    // emergency-ACTIVE branch above always returns a full 200 with no ETag,
    // so triggering is never suppressed; the client clears its stored ETag
    // on any 200 without one.)
    const { generatedAt: _volatileTs, ...hashablePayload } = manifestPayload;
    const signatureString = JSON.stringify(hashablePayload) + id;
    const versionHash = crypto.createHash('sha256').update(signatureString).digest('hex');
    // Store the freshly-built manifest for subsequent polls (see the cache
    // block above the fan-out). hashablePayload is exactly what the ETag
    // covers, so cached serves are hash-stable with rebuilds.
    setManifestCache(
      screen.id,
      { kind: 'full', hashablePayload, etag: versionHash, boundaryAt: nextScheduleBoundaryAt },
      manifestRevAtStart,
    );
    res.setHeader('ETag', versionHash);

    if (activeDeviceHash === versionHash) {
      return res.status(304).send();
    }

    manifestPayload['hash'] = versionHash;
    return res.status(200).json(manifestPayload);
  }

  // ─── Admin: per-screen cache readiness report ───
  // Surfaces in the dashboard so admins can verify each screen has actually
  // pre-cached the emergency assets. The screen reports back via
  // POST /:id/cache-status; we just read what was last reported.
  @Get(':id/cache-status')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async getCacheStatus(@Param('id') id: string, @Request() req: any) {
    const screen = await this.prisma.client.screen.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true, name: true, lastCacheReport: true, lastCacheReportAt: true },
    });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const report = (screen.lastCacheReport as any) || null;
    return {
      screenId: screen.id,
      screenName: screen.name,
      reportedAt: screen.lastCacheReportAt,
      report,
      // Compute "all emergency assets cached?" against the current emergency
      // asset set so the dashboard can show a green check or red warning.
      emergencyReady: !!(report && report.emergency && report.emergency.count > 0),
    };
  }

  // The player POSTs a small status payload here ~every 30s so admins can
  // see which screens are actually serving offline.
  //
  // sec-fix(wave1) #5: now requires a device JWT whose `sub` equals the
  // screenId. Without this, any unauthenticated client could spoof
  // "offline" or "emergency cached" statuses for any screen in the fleet
  // and cripple the admin dashboard's ability to detect real outages.
  @Post(':id/cache-status')
  async reportCacheStatus(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Body() body: { playlist?: { count: number; bytes: number }; emergency?: { count: number; bytes: number } },
  ) {
    const authResult = verifyDeviceForScreen(req, id);
    if (!authResult.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${authResult.reason})` }, HttpStatus.UNAUTHORIZED);
    }
    // DB-efficiency (2026-06-15): coalesce the every-30s identical cache report.
    // Same payload within 120s → no DB at all (was ~42% of total DB time). A
    // content change or the 120s window elapsing writes through; the 5-min
    // wedge detector tolerates the gap.
    const sig = JSON.stringify(body ?? {});
    if (shouldSkipCacheReportWrite(id, sig)) return { ok: true };
    const screen = await this.prisma.client.screen.findUnique({ where: { id }, select: { id: true } });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    await withDbRetry(() =>
      this.prisma.client.screen.update({
        where: { id },
        data: {
          lastCacheReport: body as any,
          lastCacheReportAt: new Date(),
        },
      }),
    );
    markCacheReportWritten(id, sig);
    return { ok: true };
  }

  // ─── PUBLIC: Render-proof heartbeat (proof-of-display) ───────────────
  // Closes the #1 player-reliability gap: a frozen kiosk still answers TCP
  // reads, so lastPingAt stays fresh and the fleet map shows it ONLINE/green
  // while it's actually showing a stuck / black frame.
  //
  // The player advances a requestAnimationFrame-driven paint counter that
  // ONLY increments when the browser/WebView actually composites a frame
  // (rAF callbacks are suppressed when the renderer is frozen, the tab is
  // hidden, or the compositor is wedged) and POSTs it here every ~30s WHILE
  // it is rendering content. We record lastRenderedAt (server clock) so the
  // fleet list (deriveRenderHealth) can flag the screen render-STALE/RED when
  // this timestamp goes stale EVEN IF lastPingAt is fresh.
  //
  // Auth: device JWT bound to this screenId (or the short-lived HMAC fallback)
  // — IDENTICAL to /cache-status. Without this, any unauthenticated client
  // could spoof a fresh render-proof and mask a real freeze for any screen in
  // the fleet, defeating the whole point of the signal.
  //
  // Strictly additive + safe: this is a NEW endpoint + 3 NEW nullable columns.
  // It touches NOTHING about lastPingAt, status, the emergency path, or the
  // manifest. It does NOT update lastPingAt (so it can never paper over a real
  // network outage) and is best-effort from the player's side — if it never
  // POSTs, the screen reads renderHealth UNKNOWN, never falsely RED.
  //
  // Body shape (all optional):
  //   { frames?: number,    // monotonic painted-frame counter (forensics/liveness delta)
  //     hash?: string,      // short signature of the content on screen (proof-of-display)
  //     contentKind?: string } // 'template' | 'video' | 'image' | 'emergency' | 'url' (diagnostics)
  @Post(':id/render-proof')
  // 2026-07-25 — was `limit: 10`, which SILENTLY KILLED proof-of-display at every
  // multi-screen site. The throttler's default tracker keys on the client's
  // public IP, and a venue's whole fleet shares one NAT address; each screen
  // POSTs ~2/min, so any site with >=6 screens blew a 10/min cap and got 429s.
  // The bigger the fleet, the more certainly its render health went blind —
  // exactly backwards. Sized for a ~300-screen site (600/min ≈ 10 rps from one
  // IP) so it still bounds an accidental flood.
  //
  // The RIGHT fix is a per-device tracker (this route is device-authenticated
  // and carries the screen id in the path). That is systemic — EVERY per-route
  // @Throttle in the app is IP-keyed, so every limit is per-SITE not per-device.
  // Tracked in docs/research/2026-07-25-launch-readiness-audit/00-AUDIT.md.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async reportRenderProof(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Body() body: {
      frames?: number;
      hash?: string;
      contentKind?: string;
      // 2026-07-28 — frame-locked sync telemetry (optional; only sent
      // while the screen's group has syncMode='locked'). Stored on
      // Screen.lastSyncReport for the dashboard's "IN SYNC ±Xms" badge.
      sync?: {
        locked?: boolean;
        errMs?: number | null;
        clockUncertaintyMs?: number | null;
        rttMs?: number | null;
        contentSig?: string | null;
        renderLeadMs?: number | null;
        skewPpm?: number | null;
      };
    },
  ) {
    const authResult = verifyDeviceForScreen(req, id);
    if (!authResult.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${authResult.reason})` }, HttpStatus.UNAUTHORIZED);
    }
    // DB-efficiency (2026-06-15): coalesce the every-30s render-proof write to
    // ≤1 per 40s (was ~17% of total DB time). lastRenderedAt stays < ~60s old
    // so a healthy screen never false-REDs (STALE window is 90s); a real freeze
    // stops the POSTs entirely, so this never masks one.
    if (shouldSkipRenderProofWrite(id)) return { ok: true };
    const screen = await this.prisma.client.screen.findUnique({ where: { id }, select: { id: true } });
    if (!screen) throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    // Sanitize: clamp the frame counter to a sane non-negative int and cap
    // the content hash so a misbehaving / hostile device can't bloat the row.
    const frames =
      typeof body?.frames === 'number' && Number.isFinite(body.frames) && body.frames >= 0
        ? Math.min(Math.floor(body.frames), Number.MAX_SAFE_INTEGER)
        : null;
    const hash = body?.hash ? String(body.hash).slice(0, 128) : null;

    // Frame-locked sync telemetry — sanitize with the same hostile-device
    // posture as frames/hash: every number clamped, every string sliced,
    // whole object rebuilt (never store the raw client payload).
    let syncReport: Record<string, unknown> | null = null;
    if (body?.sync && typeof body.sync === 'object') {
      const s: any = body.sync;
      const num = (v: unknown, lo: number, hi: number): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null;
      syncReport = {
        locked: s.locked === true,
        errMs: num(s.errMs, 0, 60_000),
        clockUncertaintyMs: num(s.clockUncertaintyMs, 0, 600_000),
        rttMs: num(s.rttMs, 0, 60_000),
        contentSig: s.contentSig ? String(s.contentSig).slice(0, 32) : null,
        // Tier-1 self-calibration readouts (2026-07-28).
        renderLeadMs: num(s.renderLeadMs, 0, 1_000),
        skewPpm: num(s.skewPpm, -500, 500),
      };
    }

    await withDbRetry(() =>
      this.prisma.client.screen.update({
      where: { id },
      data: {
        lastRenderedAt: new Date(),
        ...(frames != null ? { lastRenderedFrames: frames } : {}),
        ...(hash != null ? { lastRenderedHash: hash } : {}),
        ...(syncReport ? { lastSyncReport: syncReport, lastSyncReportAt: new Date() } : {}),
      } as any,
      }),
    );
    markRenderProofWritten(id);
    return { ok: true };
  }

  // ─── PUBLIC: Emergency assets list (for offline pre-cache) ───
  // The player calls this on startup AND after every successful manifest sync
  // to keep its `emergency-assets` Service-Worker cache tier hot. The cache
  // tier is NEVER evicted, so when an emergency fires the player can serve
  // every asset from local disk in under a second — no network required.
  //
  // Returns assets across all 4 panic-type playlists configured on the
  // tenant (lockdown / evacuate / weather / emergency-default), each with a
  // SHA-256 hash so the SW can detect tampered or stale files and re-download.
  @Get(':id/emergency-assets')
  async getEmergencyAssets(@Param('id') id: string, @Req() req: ExpressReq) {
    // sec-fix(wave1) #4: this endpoint previously had NO auth — any
    // unauthenticated caller could enumerate emergency media URLs for
    // any screen in any tenant. Now requires a device JWT bound to the
    // screenId (or the short-lived HMAC fallback for backward compat).
    // Every successful fetch is audit-logged so we can forensically
    // answer "who asked for the lockdown video set, and when?"
    const authResult = verifyDeviceForScreen(req, id);
    if (!authResult.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${authResult.reason})` }, HttpStatus.UNAUTHORIZED);
    }

    // 2026-05-23 launch audit P0 (efficiency): previously this fetched
    // the screen, THEN the tenant — two sequential DB round-trips just
    // to read the screen's per-screen-emergency columns + the tenant's
    // tenant-wide-emergency columns. Collapse into one Prisma query
    // with `include: { tenant: { select: ... } }` so it's a single
    // round-trip. Saves ~1 RTT (~40ms at typical Supabase pooler
    // latency) per emergency-asset poll (every 5 min per kiosk).
    const screen = await (this.prisma.client.screen as any).findUnique({
      where: { id },
      select: {
        tenantId: true,
        emergencyLockdownPlaylistId: true,
        emergencyEvacuatePlaylistId: true,
        emergencyWeatherPlaylistId: true,
        emergencyHoldPlaylistId: true,
        emergencySecurePlaylistId: true,
        emergencyMedicalPlaylistId: true,
        emergencyLockdownPortraitPlaylistId: true,
        emergencyEvacuatePortraitPlaylistId: true,
        emergencyWeatherPortraitPlaylistId: true,
        emergencyHoldPortraitPlaylistId: true,
        emergencySecurePortraitPlaylistId: true,
        emergencyMedicalPortraitPlaylistId: true,
        emergencyLockdownAssetUrl: true,
        emergencyEvacuateAssetUrl: true,
        emergencyWeatherAssetUrl: true,
        emergencyHoldAssetUrl: true,
        emergencySecureAssetUrl: true,
        emergencyMedicalAssetUrl: true,
        emergencyLockdownPortraitAssetUrl: true,
        emergencyEvacuatePortraitAssetUrl: true,
        emergencyWeatherPortraitAssetUrl: true,
        emergencyHoldPortraitAssetUrl: true,
        emergencySecurePortraitAssetUrl: true,
        emergencyMedicalPortraitAssetUrl: true,
        tenant: {
          select: {
            id: true,
            emergencyPlaylistId: true,
            emergencyPortraitPlaylistId: true,
            panicLockdownPlaylistId: true,
            panicEvacuatePlaylistId: true,
            panicWeatherPlaylistId: true,
            panicHoldPlaylistId: true,
            panicSecurePlaylistId: true,
            panicMedicalPlaylistId: true,
            panicLockdownPortraitPlaylistId: true,
            panicEvacuatePortraitPlaylistId: true,
            panicWeatherPortraitPlaylistId: true,
            panicHoldPortraitPlaylistId: true,
            panicSecurePortraitPlaylistId: true,
            panicMedicalPortraitPlaylistId: true,
          },
        },
      },
    });
    if (!screen?.tenantId) {
      throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found or not paired' }, HttpStatus.NOT_FOUND);
    }
    const tenant = (screen as any).tenant;
    if (!tenant) {
      throw new HttpException({ code: 'SCREEN_TENANT_NOT_FOUND', message: 'Tenant not found' }, HttpStatus.NOT_FOUND);
    }

    const playlistIds = [
      tenant.emergencyPlaylistId,
      (tenant as any).emergencyPortraitPlaylistId,
      tenant.panicLockdownPlaylistId,
      tenant.panicEvacuatePlaylistId,
      tenant.panicWeatherPlaylistId,
      (tenant as any).panicHoldPlaylistId,
      (tenant as any).panicSecurePlaylistId,
      (tenant as any).panicMedicalPlaylistId,
      (tenant as any).panicLockdownPortraitPlaylistId,
      (tenant as any).panicEvacuatePortraitPlaylistId,
      (tenant as any).panicWeatherPortraitPlaylistId,
      (tenant as any).panicHoldPortraitPlaylistId,
      (tenant as any).panicSecurePortraitPlaylistId,
      (tenant as any).panicMedicalPortraitPlaylistId,
      (screen as any).emergencyLockdownPlaylistId,
      (screen as any).emergencyEvacuatePlaylistId,
      (screen as any).emergencyWeatherPlaylistId,
      (screen as any).emergencyHoldPlaylistId,
      (screen as any).emergencySecurePlaylistId,
      (screen as any).emergencyMedicalPlaylistId,
      (screen as any).emergencyLockdownPortraitPlaylistId,
      (screen as any).emergencyEvacuatePortraitPlaylistId,
      (screen as any).emergencyWeatherPortraitPlaylistId,
      (screen as any).emergencyHoldPortraitPlaylistId,
      (screen as any).emergencySecurePortraitPlaylistId,
      (screen as any).emergencyMedicalPortraitPlaylistId,
    ].filter((x): x is string => !!x);

    const assets: Array<{ url: string; sha256: string | null; size: number; kind: string }> = [];
    const seen = new Set<string>();

    if (playlistIds.length > 0) {
      const playlists = await this.prisma.client.playlist.findMany({
        where: { id: { in: playlistIds } },
        include: {
          items: {
            include: {
              asset: { select: { fileUrl: true, fileSize: true, mimeType: true, fileHash: true } },
            },
          },
        },
      });
      for (const pl of playlists) {
        for (const item of pl.items) {
          if (!item.asset?.fileUrl) continue;
          if (seen.has(item.asset.fileUrl)) continue;
          seen.add(item.asset.fileUrl);
          // P0-1 (2026-05-28): ship the canonical SHA-256 of the file BODY,
          // never a URL-derived digest. The SW recomputes the digest from the
          // downloaded bytes and refuses to cache on mismatch
          // (sw-player.js fetchAndStore). A URL-derived hash can NEVER equal
          // the body's real SHA-256, so synthesizing one guaranteed every
          // such emergency asset failed the integrity check, degraded the
          // screen to text-only, and (because the set-hash never committed)
          // re-attempted the full precache every 5 min forever.
          //
          // When `Asset.fileHash` is genuinely null (legacy / external-URL
          // rows the upload pipeline never hashed), send `sha256: null`. The
          // SW skips the integrity check for null-hash assets and caches the
          // body as-is, rather than computing a fake hash it would then
          // reject. (Recommend backfilling fileHash for null rows — see
          // report; do NOT fabricate one here.)
          assets.push({
            url: item.asset.fileUrl,
            sha256: item.asset.fileHash ?? null,
            size: item.asset.fileSize ?? 0,
            kind: item.asset.mimeType?.startsWith('video/') ? 'video' : 'image',
          });
        }
      }
    }

    const screenAssetUrls = [
      (screen as any).emergencyLockdownAssetUrl,
      (screen as any).emergencyEvacuateAssetUrl,
      (screen as any).emergencyWeatherAssetUrl,
      (screen as any).emergencyHoldAssetUrl,
      (screen as any).emergencySecureAssetUrl,
      (screen as any).emergencyMedicalAssetUrl,
      (screen as any).emergencyLockdownPortraitAssetUrl,
      (screen as any).emergencyEvacuatePortraitAssetUrl,
      (screen as any).emergencyWeatherPortraitAssetUrl,
      (screen as any).emergencyHoldPortraitAssetUrl,
      (screen as any).emergencySecurePortraitAssetUrl,
      (screen as any).emergencyMedicalPortraitAssetUrl,
    ].filter((url): url is string => typeof url === 'string' && url.trim().length > 0);

    // P0-1 (2026-05-28): per-screen emergency asset URLs (Sprint 8b scoped
    // media — "evacuate via north exit" etc.) are stored as raw URL strings on
    // the Screen row, not FK references. Previously we UNCONDITIONALLY
    // synthesized a `${url}:screen-emergency` digest as the sha256 — which the
    // SW's body-recompute integrity check could never match, so per-screen
    // emergency media NEVER cached and the screen silently degraded to
    // text-only in exactly the localized-threat scenarios these assets exist
    // for. Look up the owning Asset.fileHash by fileUrl and ship the real body
    // hash; fall back to `sha256: null` (SW skips verification) when the asset
    // wasn't hashed or isn't a managed Asset row. Single batched query — no
    // N+1.
    const screenAssetHashByUrl = new Map<string, string | null>();
    const uncachedScreenUrls = screenAssetUrls.filter((url) => !seen.has(url));
    if (uncachedScreenUrls.length > 0) {
      try {
        const ownedAssets = await this.prisma.client.asset.findMany({
          where: { fileUrl: { in: uncachedScreenUrls } },
          select: { fileUrl: true, fileHash: true, fileSize: true },
        });
        for (const a of ownedAssets) {
          // First match wins; fileUrl should be unique per asset row.
          if (!screenAssetHashByUrl.has(a.fileUrl)) {
            screenAssetHashByUrl.set(a.fileUrl, a.fileHash ?? null);
          }
        }
      } catch (e) {
        // Non-fatal: if the lookup fails we ship null hashes (SW caches
        // without integrity check) rather than blocking emergency precache.
        console.warn('[emergency-assets] per-screen asset hash lookup failed', (e as Error).message);
      }
    }

    for (const url of screenAssetUrls) {
      if (seen.has(url)) continue;
      seen.add(url);
      const clean = url.split('?')[0].split('#')[0].toLowerCase();
      const kind = /\.(mp4|webm|mov|m4v)$/.test(clean) ? 'video'
        : /\.pdf$/.test(clean) ? 'pdf'
          : 'image';
      assets.push({
        url,
        // Real body SHA-256 when this URL maps to a managed Asset row;
        // otherwise null so the SW skips integrity verification (it cannot
        // verify a hash we don't have) rather than rejecting a fabricated one.
        sha256: screenAssetHashByUrl.has(url) ? screenAssetHashByUrl.get(url)! : null,
        size: 0,
        kind,
      });
    }

    // Stable hash of the whole asset set so the player can short-circuit
    // pre-cache when nothing has changed. A null body-hash contributes the
    // literal token "null" — deterministic, so the set-change short-circuit
    // still works for null-hash (unhashed) assets.
    const setHash = crypto
      .createHash('sha256')
      .update(assets.map(a => `${a.url}:${a.sha256 ?? 'null'}`).sort().join('|'))
      .digest('hex');

    // sec-fix(wave1) #4: audit every emergency-asset fetch. Forensically
    // crucial — if someone abuses a stolen device token to enumerate
    // lockdown media, we need the log trail.
    //
    // 2026-04-24: Debounce the write to at-most-once-per-(screen,setHash)
    // per 15 minutes. A paired screen re-calls this every 5 minutes by
    // design; without the debounce the audit table (and the dashboard's
    // Recent Activity card) was filling with identical entries. A genuine
    // content change produces a different setHash and therefore a fresh
    // audit row, so we don't lose the forensic signal.
    try {
      if (!shouldSkipEmergencyAudit(id, setHash)) {
        markEmergencyAuditWritten(id, setHash);
        await this.prisma.client.auditLog.create({
          data: {
            action: 'DEVICE_FETCH_EMERGENCY_ASSETS',
            targetType: 'screen',
            targetId: id,
            tenantId: tenant.id,
            details: JSON.stringify({ assetCount: assets.length, setHash }),
          },
        });
      }
    } catch (e) {
      // Non-fatal: we prefer to serve the player even if audit logging
      // is degraded.
      console.warn('[emergency-assets] audit log failed', (e as Error).message);
    }

    return {
      tenantId: tenant.id,
      screenId: id,
      generatedAt: new Date().toISOString(),
      assets,
      assetCount: assets.length,
      totalBytes: assets.reduce((sum, a) => sum + a.size, 0),
      setHash,
    };
  }

  // ─── DEVICE-AUTHED: per-location resolved menu ─────────────────────
  //
  // Menu-mgmt-at-scale (2026-05-29) — the Tier-0 unblock. Before this,
  // MenuBoardWidget on a real kiosk fetched the SESSION-authed
  // /api/v1/pos/items with a token the player doesn't have → 403 →
  // hardcoded DEMO_ITEMS on every wall. This endpoint accepts a DEVICE
  // token (the same `verifyDeviceForScreen` model as /:id/manifest and
  // /:id/emergency-assets) and returns the RESOLVED menu for the
  // screen's location: per-location prices, 86'd items hidden,
  // dayparted sections filtered by the location's local time.
  //
  // Location resolution (no client input — all from the verified screen):
  //   • location tenant = the screen's posLocation.locationTenantId if
  //     the screen is mapped to a POS location, else the screen's own
  //     tenantId.
  //   • catalog-owning (chain) tenant = the location tenant's parent
  //     (Tenant.parentId) if it has one, else the location tenant itself.
  //   This lets a 50-store chain design ONE catalog on the parent tenant
  //   and have every store screen resolve its own per-location prices.
  @Get(':id/menu')
  async getMenu(
    @Param('id') id: string,
    @Req() req: ExpressReq,
    @Query('includeUnavailable') includeUnavailable?: string,
  ) {
    const authResult = verifyDeviceForScreen(req, id);
    if (!authResult.ok) {
      throw new HttpException({ code: 'SCREEN_DEVICE_AUTH_REQUIRED', message: `Device auth required (${authResult.reason})` }, HttpStatus.UNAUTHORIZED);
    }

    // When set (?includeUnavailable=1|true), 86'd / sold-out items are
    // INCLUDED in the feed flagged `available:false` so a menu board can
    // grey them out instead of dropping them. Default (absent) keeps the
    // existing behavior: unavailable items are omitted entirely.
    const wantUnavailable = includeUnavailable === '1' || includeUnavailable === 'true';

    // Single round-trip: the screen + its POS-location mapping + the
    // location-tenant's parent (chain) id.
    const screen = await (this.prisma.client.screen as any).findUnique({
      where: { id },
      select: {
        tenantId: true,
        posLocationId: true,
        posLocation: { select: { locationTenantId: true } },
        tenant: { select: { id: true, parentId: true } },
      },
    });
    if (!screen?.tenantId) {
      throw new HttpException({ code: 'SCREEN_NOT_FOUND', message: 'Screen not found or not paired' }, HttpStatus.NOT_FOUND);
    }

    // The screen's effective location tenant: the POS-location mapping
    // wins (operator assigned this screen to a specific store), else the
    // screen's own tenant is the location.
    const locationTenantId: string =
      screen.posLocation?.locationTenantId || screen.tenantId;

    // The catalog-owning tenant: the location's parent (chain) if any,
    // else the location tenant itself (single-location operator).
    const catalogTenantId: string =
      screen.tenant?.parentId || locationTenantId;

    const resolved = await this.menu.resolveMenuForLocation(locationTenantId, {
      catalogTenantId,
      includeUnavailable: wantUnavailable,
    });

    // Shape compatible with what MenuBoardWidget maps (name / description
    // / priceCents / badges). `badges` mirrors PosMenuItem's contract so
    // the existing renderer drops in; we alias allergens+tags → badges.
    return {
      screenId: id,
      tenantId: screen.tenantId,
      locationTenantId,
      generatedAt: resolved.generatedAt,
      categories: resolved.categories,
      items: resolved.items.map((it) => ({
        id: it.id,
        externalId: it.externalId,
        name: it.name,
        description: it.description ?? undefined,
        priceCents: it.priceCents,
        priceOverridden: it.priceOverridden,
        category: it.category ?? undefined,
        imageUrl: it.imageUrl ?? undefined,
        // The widget reads `badges`; surface allergens + tags there.
        badges: [...it.allergens, ...it.tags],
        allergens: it.allergens,
        tags: it.tags,
        // Pass through the resolver's flags. When includeUnavailable is
        // off, every item is available:true (86'd items were dropped);
        // when on, 86'd items appear flagged available:false so the board
        // can grey them out. soldOut distinguishes a timed temp-86.
        available: it.available,
        soldOut: it.soldOut,
        ...(it.variants ? { variants: it.variants } : {}),
      })),
    };
  }
}
