/**
 * Player Diagnostics Log ingestion endpoint.
 *
 * Accepts plain-text log uploads from the Android kiosk APK for
 * server-side storage and field diagnostics on Goodview / NovaStar /
 * TCL displays that have no physical ADB access.
 *
 * Auth: device JWT in Authorization: Bearer header (same pattern as
 * /api/v1/screens/:id/cache-status). The request is exempt from CSRF
 * enforcement (see csrf.middleware.ts) because the native HTTP client
 * (Kotlin HttpURLConnection) has no cookie jar for the CSRF round-trip.
 *
 * Phase 1 storage: inserts an AuditLog row with action=PLAYER_DIAGNOSTICS
 * and the first 10 KB of the log body as the details field. This keeps
 * the Prisma model surface at zero and the implementation trivially
 * auditable. Phase 2 can add Supabase object-storage write for full log
 * retention without changing this endpoint's contract.
 *
 * Rate limiting: @Throttle({ default: { limit: 6, ttl: 60_000 } }) —
 * 6 uploads per minute per IP. A runaway crash loop could otherwise
 * flood the database with PLAYER_DIAGNOSTICS rows. Since 2026-10-03 the
 * rows themselves are capped too (player-logs-limits.ts): 8 per upload and
 * 24 per screen per hour, with a Redis claim per event instead of a
 * `details LIKE` scan per line.
 *
 * Body: `text/plain`, parsed by the route-scoped parser in
 * player-logs-body.ts, which main.ts mounts before the global JSON parser.
 * Until 2026-10-03 nothing parsed it, so every upload arrived empty.
 */

import {
  Controller,
  Post,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import type { Request } from 'express';
// DT-05 (2026-08-03): this file used to carry its own copy of the device
// verifier that checked only signature + kind + sub. It now shares the one
// implementation, which additionally enforces the revocation list, the
// REVOKED status and the credential epoch.
import { verifyDeviceForScreen } from '../screens/device-auth';
import {
  DiagnosticsLimiter,
  MAX_AUDIT_ROWS_PER_UPLOAD,
  recoverySeenKey,
  type DiagnosticsRedis,
} from './player-logs-limits';
import { auditLine, auditTail } from './player-logs-redact';

/** Maximum log body accepted (1 MB). Enforced before DB write. */
const MAX_BODY_BYTES = 1_048_576;

/** Maximum characters stored in AuditLog.details (10 KB). */
const DETAILS_TRUNCATE = 10_240;

/** Maximum characters of one recovery marker line stored. */
const RECOVERY_LINE_MAX = 1024;

/** A line that marks a host crash — same alternatives as the whole-body test. */
const CRASH_LINE =
  /FATAL EXCEPTION|FATAL\b|E\/AndroidRuntime|java\.lang\.\w+Exception|kotlin\.\w+Exception|OutOfMemoryError|StackOverflowError|ANR in|Process .* died|signal 11|SIGSEGV/i;

/** Newest recovery marker lines examined per upload. */
const MAX_RECOVERY_CANDIDATES = 32;

@Controller('api/v1/player-logs')
export class PlayerLogsController {
  private readonly logger = new Logger('PlayerLogs');
  private readonly limits: DiagnosticsLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    this.limits = new DiagnosticsLimiter(
      () => (this.redisService?.publisher ?? null) as unknown as DiagnosticsRedis | null,
    );
  }

  /**
   * Verify a device credential bound to `screenId`.
   *
   * Returns the verified screenId AND the tenant resolved FROM THE LIVE
   * SCREEN ROW, or null on ANY failure (missing header, wrong token kind,
   * invalid signature, subject mismatch, revoked token, REVOKED screen,
   * stale credential epoch, deleted screen).
   *
   * SECURITY (sec-fix P1, 2026-07-03): the `sub === screenId` check is
   * defense-in-depth — even a VALID device token can only attribute a log
   * upload to its OWN screen, never to an arbitrary victim screen supplied
   * in the path param. A caller with no token at all returns null here and
   * is NEVER trusted to resolve a real tenant (see ingestLog).
   *
   * DT-05 (2026-08-03): the four extra checks above came from replacing
   * this file's private copy of the verifier with the shared one. A device
   * whose credential an operator has revoked can no longer write into the
   * immutable forensic log of the tenant it used to belong to.
   */
  private async verifyDevice(
    req: Request,
    screenId: string,
  ): Promise<{ sub: string; tenantId: string | null } | null> {
    const auth = await verifyDeviceForScreen(
      { prisma: this.prisma, redis: this.redisService },
      req,
      screenId,
      // SEC-001 (2026-09-04) — `allowUnpaired: true` is prior behaviour, now
      // stated (the shared verifier's default flipped to fail-closed). An
      // UNPROVEN credential is refused: returning null here is already the
      // designed "accepted but never attributed to a tenant, never audited"
      // path, so a fingerprint holder can no longer write into another
      // tenant's immutable forensic log — it just lands unattributed.
      { allowUnpaired: true },
    );
    return auth.ok ? { sub: auth.sub, tenantId: auth.tenantId } : null;
  }

  /**
   * POST /api/v1/player-logs/:screenId
   *
   * Body: raw text/plain — the tail of the on-device rotating log file.
   * Up to 1 MB accepted; excess bytes are rejected with 400.
   *
   * Auth: device JWT (Authorization: Bearer <token>) where the JWT sub
   * must match :screenId. Unauthenticated requests are still ACCEPTED (so a
   * device can upload early-boot diagnostics before it is paired), but they
   * are NEVER attributed to a real tenant and NEVER write an immutable
   * AuditLog row — only a verified device bound to this screen can do that
   * (sec-fix P1, 2026-07-03). Unverified uploads are logged to the server
   * console only.
   *
   * Returns 201 on success with { stored: true, rows: 1 }.
   */
  @Post(':screenId')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async ingestLog(
    @Param('screenId') screenId: string,
    @Req() req: Request,
  ): Promise<{ stored: boolean; rows: number; capped?: true }> {
    // Collect raw body. main.ts mounts a text parser for this route
    // (player-logs-body.ts); a content type it does not claim leaves the
    // body undefined and we store an empty payload. We check size here
    // rather than relying on body-parser limit so the endpoint is safe
    // regardless of global parser config.
    let rawBody: string;
    if (typeof req.body === 'string') {
      rawBody = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf8');
    } else if (req.body && typeof req.body === 'object') {
      rawBody = JSON.stringify(req.body);
    } else {
      rawBody = '';
    }

    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      throw new BadRequestException({ code: 'PLAYER_LOGS_BODY_TOO_LARGE', message: 'Log body exceeds 1 MB limit' });
    }

    // Verify device JWT if present. We don't hard-reject on missing auth
    // because a device may upload before it has a JWT (early diagnostics).
    //
    // SECURITY (sec-fix P1, 2026-07-03 — unauthenticated cross-tenant write):
    // `verifyDeviceJwt` now returns the screenId ONLY when a valid device
    // token bound to THIS path's :screenId is present; otherwise null. We
    // MUST NOT fall back to the raw, attacker-supplied path param to resolve
    // a real tenant — doing so let an unauthenticated remote attacker who
    // guessed any screen UUID forge an immutable PLAYER_DIAGNOSTICS_CRASH
    // AuditLog row (with up to 10 KB of attacker text) into that screen's
    // VICTIM tenant. So:
    //   • jwtSub !== null → verified device for its own screen: resolve the
    //     real tenant and attribute the crash row exactly as before.
    //   • jwtSub === null → unauthenticated / invalid / mismatched token:
    //     attribute to the sentinel UNRESOLVED tenant and NEVER touch a real
    //     tenant's forensic trail. The upload still succeeds (early-boot
    //     uploads before pairing keep working) — it just cannot be pinned
    //     to any real tenant.
    const verified = await this.verifyDevice(req, screenId);
    const jwtSub = verified?.sub ?? null;
    const attributedScreenId = jwtSub ?? screenId;

    // The screen's tenantId scopes the AuditLog row. AuditLog.tenantId is
    // non-nullable — we use a sentinel when the screen can't be resolved
    // (unpaired device, DB hiccup) rather than dropping the upload. Only a
    // VERIFIED device is trusted to resolve a real tenant; an unverified
    // upload stays on the sentinel and never reaches a real tenant's
    // forensic trail. The tenant comes from the shared verifier's LIVE row
    // read, never from a token claim (DT-03).
    const UNRESOLVED_TENANT = 'unresolved';
    const tenantId: string = verified?.tenantId ?? UNRESOLVED_TENANT;

    // Pre-launch audit-spam fix (2026-04-27). Operator: "no extra api
    // calls or audits like we see happening in the audit section with
    // screens writing logs over and over."
    //
    // Every paired Android player uploads its rolling diag log on a
    // ~5-minute heartbeat. Previously each upload became a fresh
    // AuditLog row, so a fleet of 20 screens would generate ~5,800
    // PLAYER_DIAGNOSTICS rows per day — flooding the dashboard's
    // Recent Activity card and bloating the audit table.
    //
    // PLAYER_DIAGNOSTICS is operational telemetry, NOT a security
    // event. We now ONLY write to AuditLog when the upload contains
    // a clear failure signature (FATAL / FATAL EXCEPTION / E/AndroidRuntime
    // / CRASH / OutOfMemoryError). Routine heartbeat uploads still
    // succeed; they just don't pollute the audit trail.
    //
    // For Phase-2 full retention we'll write the raw log to Supabase
    // object storage (separate bucket, not AuditLog).
    // The JVM crash handler never sees an isolated WebView renderer death.
    // Native recovery writes these bounded, timestamped markers to disk.
    const recoveryLines = rawBody.split('\n').filter(line =>
      /PLAYER_RENDERER_TERMINATED|PLAYER_PLAYBACK_FAILURE|PLAYER_PROCESS_EXIT/.test(line))
      .slice(-MAX_RECOVERY_CANDIDATES);
    const looksLikeCrash = CRASH_LINE.test(rawBody);

    // SECURITY (sec-fix P1, 2026-07-03): only a VERIFIED device (a valid
    // device token bound to this exact :screenId) may write an immutable
    // AuditLog row. An unauthenticated / invalid-token upload is never
    // written to the audit trail at all — not even to the sentinel tenant —
    // so a remote attacker who guessed a screen UUID can neither forge a
    // crash record into a victim tenant NOR inject 10 KB of attacker text
    // into the immutable forensic log. Unverified uploads still succeed
    // (early-boot / unpaired diagnostics keep working); they are logged to
    // the console only, exactly like a routine heartbeat.
    if (jwtSub !== null && (recoveryLines.length > 0 || looksLikeCrash)) {
      const outcome = await this.persistVerified(
        tenantId, attributedScreenId, rawBody, recoveryLines, looksLikeCrash,
      );
      return outcome.capped
        ? { stored: outcome.stored, rows: outcome.rows, capped: true }
        : { stored: outcome.stored, rows: outcome.rows };
    }

    // Routine heartbeat — log to console only. The body is bounded at
    // 1 MB and we already truncated for storage; the console line just
    // confirms ingest happened so kiosk-side debugging still has a
    // server-side breadcrumb.
    this.logger.log(
      `PLAYER_DIAGNOSTICS heartbeat screen=${attributedScreenId} ` +
      `tenant=${tenantId} bytes=${Buffer.byteLength(rawBody, 'utf8')} ` +
      `jwtVerified=${jwtSub !== null}`,
    );

    return { stored: true, rows: 0 };
  }

  /**
   * Write a verified device's recovery events and crash record (2026-10-03).
   *
   *   - Dedupe: a Redis claim per event (`SET NX EX`) replaces the
   *     `details LIKE` scan; Redis unavailable → "not seen".
   *   - At most MAX_AUDIT_ROWS_PER_UPLOAD rows, one of them kept for the
   *     crash record so a burst of renderer markers can never crowd out a
   *     simultaneous JVM fatal exception; at most
   *     MAX_AUDIT_ROWS_PER_SCREEN_HOUR per screen per hour.
   *   - Under a cap the NEWEST events win; they are still written in log
   *     order. A claim whose row is not written is given back, so a later
   *     upload records it.
   *   - Stored text is redacted (player-logs-redact.ts) and held to the same
   *     bounds as before: 1 024 characters per recovery line, 10 KB of tail
   *     for a crash record.
   */
  private async persistVerified(
    tenantId: string,
    screenId: string,
    rawBody: string,
    recoveryLines: string[],
    looksLikeCrash: boolean,
  ): Promise<{ stored: boolean; rows: number; capped: boolean }> {
    // ONE crash record per crash, not one per upload (2026-10-04). The APK
    // uploads the tail of a ROTATING log, so the same crash line rides along
    // in every upload until it rotates out — each one used to write another
    // 10 KB row into a table that can never be pruned. The newest crash line
    // (it carries the log's own timestamp) is claimed like a recovery event;
    // a NEW crash is a new line and is recorded. Redis unavailable → "not
    // seen", bounded by the hourly cap, as for recovery events.
    let crashKey: string | null = null;
    if (looksLikeCrash) {
      const lines = rawBody.split('\n');
      let newest = '';
      for (let i = lines.length - 1; i >= 0; i--) {
        if (CRASH_LINE.test(lines[i])) { newest = lines[i]; break; }
      }
      const key = recoverySeenKey(
        tenantId, screenId, 'crash:' + createHash('sha256').update(newest).digest('hex'),
      );
      if (await this.limits.claimNew(key)) crashKey = key;
      else looksLikeCrash = false;
    }
    const recoveryBudget = MAX_AUDIT_ROWS_PER_UPLOAD - (looksLikeCrash ? 1 : 0);
    const claimed: Array<{ line: string; recoveryEventId: string; key: string }> = [];
    for (let i = recoveryLines.length - 1; i >= 0 && claimed.length < recoveryBudget; i--) {
      const line = recoveryLines[i];
      const recoveryEventId = createHash('sha256').update(line).digest('hex');
      const key = recoverySeenKey(tenantId, screenId, recoveryEventId);
      if (await this.limits.claimNew(key)) claimed.push({ line, recoveryEventId, key });
    }
    // Unseen markers beyond the per-upload budget were never claimed, so the
    // next upload records them. `capped` reports the HOURLY cap only.
    let capped = false;

    const wanted = claimed.length + (looksLikeCrash ? 1 : 0);
    const granted = await this.limits.reserve(screenId, wanted);
    const writeCrash = looksLikeCrash && granted > 0;
    // A crash claim whose row will not be written is given back.
    if (crashKey && !writeCrash) await this.limits.release(crashKey);
    const keep = Math.max(0, granted - (writeCrash ? 1 : 0));
    if (granted < wanted) {
      capped = true;
      for (const dropped of claimed.slice(keep)) await this.limits.release(dropped.key);
      this.logger.warn(
        `PLAYER_DIAGNOSTICS hourly cap reached for screen ${screenId}: ` +
        `${wanted - granted} of ${wanted} audit rows not written`,
      );
    }
    // Newest first was the claim order; write in log order.
    const toWrite = claimed.slice(0, keep).reverse();

    let rows = 0;
    for (let i = 0; i < toWrite.length; i++) {
      const { line, recoveryEventId } = toWrite[i];
      try {
        await this.prisma.client.auditLog.create({
          data: { tenantId, userId: null, action: 'PLAYER_RECOVERY_EVENT', targetType: 'Screen', targetId: screenId,
            details: JSON.stringify({ source: 'android_apk', screenId,
              jwtVerified: true, recoveryEventId, crashDetected: false, log: auditLine(line, RECOVERY_LINE_MAX) }) },
        });
        rows += 1;
      } catch (err) {
        for (const unwritten of toWrite.slice(i)) await this.limits.release(unwritten.key);
        if (crashKey) await this.limits.release(crashKey);
        this.logger.error(`Player diagnostics persistence failed for screen ${screenId}: ${(err as Error).message}`);
        return { stored: false, rows, capped };
      }
    }
    // A simultaneous host fatal exception must not be swallowed just because
    // a renderer event in the same rotating log was already uploaded.
    if (writeCrash) {
      try {
        await this.prisma.client.auditLog.create({
          data: { tenantId, userId: null, action: 'PLAYER_DIAGNOSTICS_CRASH',
            targetType: 'Screen', targetId: screenId,
            details: JSON.stringify({ source: 'android_apk', screenId,
              jwtVerified: true, bodyBytes: Buffer.byteLength(rawBody, 'utf8'),
              truncated: rawBody.length > DETAILS_TRUNCATE, crashDetected: true,
              log: auditTail(rawBody, DETAILS_TRUNCATE) }) },
        });
        rows += 1;
      } catch (err) {
        if (crashKey) await this.limits.release(crashKey);
        this.logger.error(`Player diagnostics persistence failed for screen ${screenId}: ${(err as Error).message}`);
        return { stored: false, rows, capped };
      }
    }
    return { stored: true, rows, capped };
  }
}
