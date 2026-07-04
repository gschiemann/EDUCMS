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
 * flood the database with PLAYER_DIAGNOSTICS rows.
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
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { requireSecret } from '../security/required-secret';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';

/** Maximum log body accepted (1 MB). Enforced before DB write. */
const MAX_BODY_BYTES = 1_048_576;

/** Maximum characters stored in AuditLog.details (10 KB). */
const DETAILS_TRUNCATE = 10_240;

/**
 * Verify a device JWT from the Authorization: Bearer header AND assert that
 * its `sub` claim matches the screenId from the request path.
 *
 * Returns the verified screenId on success, or null on ANY failure (missing
 * header, wrong token kind, invalid signature, OR subject mismatch).
 *
 * Mirror of the inline verifyDeviceForScreen() in screens.controller.ts,
 * extracted here for use without importing that module.
 *
 * SECURITY (sec-fix P1, 2026-07-03): the `sub === screenId` check is
 * defense-in-depth — even a VALID device token can only attribute a log
 * upload to its OWN screen, never to an arbitrary victim screen supplied
 * in the path param. A caller with no token at all returns null here and
 * is NEVER trusted to resolve a real tenant (see ingestLog).
 */
function verifyDeviceJwt(authHeader: string | undefined, screenId: string): string | null {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.slice(7).trim();
  try {
    const secret = requireSecret('DEVICE_JWT_SECRET', {
      devFallback: 'dev_only_device_jwt_secret_CHANGE_ME',
    });
    const decoded = jwt.verify(token, secret) as any;
    if (decoded?.kind !== 'device') return null;
    if (typeof decoded?.sub !== 'string') return null;
    // The token must be bound to the screen named in the path. A token
    // minted for screen A cannot report logs for screen B.
    if (decoded.sub !== screenId) return null;
    return decoded.sub as string;
  } catch {
    return null;
  }
}

@Controller('api/v1/player-logs')
export class PlayerLogsController {
  private readonly logger = new Logger('PlayerLogs');

  constructor(private readonly prisma: PrismaService) {}

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
  ): Promise<{ stored: boolean; rows: number }> {
    // Collect raw body. Express is configured with bodyParser.text() or
    // bodyParser.raw() for this content type in main.ts; if neither is
    // present the body will be undefined and we store an empty payload.
    // We check size here rather than relying on body-parser limit so the
    // endpoint is safe regardless of global parser config.
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
    const jwtSub = verifyDeviceJwt(req.headers.authorization, screenId);
    const attributedScreenId = jwtSub ?? screenId;

    // Resolve the screen's tenantId so the AuditLog row is scoped correctly.
    // AuditLog.tenantId is non-nullable — we use a sentinel value when the
    // screen can't be looked up (unpaired device, DB hiccup) rather than
    // dropping the upload entirely. Only a VERIFIED device (jwtSub !== null)
    // is trusted to resolve a real tenant; an unverified upload stays on the
    // sentinel and never reaches a real tenant's audit trail.
    const UNRESOLVED_TENANT = 'unresolved';
    let tenantId: string = UNRESOLVED_TENANT;
    if (jwtSub !== null) {
      try {
        const screen = await this.prisma.client.screen.findUnique({
          where: { id: attributedScreenId },
          select: { tenantId: true },
        });
        if (screen?.tenantId) tenantId = screen.tenantId;
      } catch (err) {
        this.logger.warn(`Could not resolve tenantId for screen ${attributedScreenId}: ${(err as Error).message}`);
      }
    }

    // Truncate to DETAILS_TRUNCATE chars before potential write.
    const logTail = rawBody.length > DETAILS_TRUNCATE
      ? rawBody.slice(rawBody.length - DETAILS_TRUNCATE) // keep tail (most recent)
      : rawBody;

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
    const looksLikeCrash =
      /FATAL EXCEPTION|FATAL\b|E\/AndroidRuntime|java\.lang\.\w+Exception|kotlin\.\w+Exception|OutOfMemoryError|StackOverflowError|ANR in|Process .* died|signal 11|SIGSEGV/i
        .test(rawBody);

    // SECURITY (sec-fix P1, 2026-07-03): only a VERIFIED device (a valid
    // device token bound to this exact :screenId) may write an immutable
    // AuditLog row. An unauthenticated / invalid-token upload is never
    // written to the audit trail at all — not even to the sentinel tenant —
    // so a remote attacker who guessed a screen UUID can neither forge a
    // crash record into a victim tenant NOR inject 10 KB of attacker text
    // into the immutable forensic log. Unverified uploads still succeed
    // (early-boot / unpaired diagnostics keep working); they are logged to
    // the console only, exactly like a routine heartbeat.
    if (looksLikeCrash && jwtSub !== null) {
      const detailsJson = JSON.stringify({
        source: 'android_apk',
        screenId: attributedScreenId,
        jwtVerified: jwtSub !== null,
        bodyBytes: Buffer.byteLength(rawBody, 'utf8'),
        truncated: rawBody.length > DETAILS_TRUNCATE,
        crashDetected: true,
        log: logTail,
      });
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId,
            userId: null,
            action: 'PLAYER_DIAGNOSTICS_CRASH',
            targetType: 'Screen',
            targetId: attributedScreenId,
            details: detailsJson,
          },
        });
      } catch (err) {
        this.logger.error(`Failed to write PLAYER_DIAGNOSTICS_CRASH AuditLog for screen ${attributedScreenId}: ${(err as Error).message}`);
        return { stored: false, rows: 0 };
      }
      this.logger.warn(
        `PLAYER_DIAGNOSTICS_CRASH stored for screen=${attributedScreenId} ` +
        `tenant=${tenantId} bytes=${Buffer.byteLength(rawBody, 'utf8')}`,
      );
      return { stored: true, rows: 1 };
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
}
