import { Controller, Get, Query, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { SseService } from './sse.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from './redis.service';
import { requireSecret } from '../security/required-secret';
import { verifyStreamTicket } from '../screens/stream-ticket';
import { epochFromClaim, isEpochAcceptable } from '../screens/device-auth';

/**
 * SSE realtime endpoint — Sprint 11 Phase B.
 *
 *   GET /api/v1/realtime/sse?ticket=<streamTicket>      ← the supported path
 *   GET /api/v1/realtime/sse?token=<deviceJwt>          ← legacy, see below
 *
 * ── DT-08: why a TICKET and not the device credential ────────────────────
 * `EventSource` cannot set request headers (by design — it keeps the SSE
 * wire format trivially proxy-cacheable), so whatever authenticates this
 * stream has to travel in the URL. URLs are not a credential store: they
 * land in Railway/Vercel HTTP access logs, in on-path proxy logs, in
 * Android WebView history and in `Referer` headers. Putting the kiosk's
 * 180-day device JWT there means anyone who can read any of those holds a
 * fleet credential.
 *
 * The fix is NOT to move the same credential somewhere else — it is to
 * stop putting a long-lived credential in a URL at all:
 *
 *   1. the player POSTs `/api/v1/screens/:id/stream-ticket` with its device
 *      token in the `Authorization` header (a normal fetch — no EventSource
 *      limitation applies) and receives an opaque 60-second ticket;
 *   2. the player opens `…/sse?ticket=<ticket>`.
 *
 * A ticket grants exactly one thing — "open the event stream for this one
 * screen" — for 60 seconds, and it carries the screen's `credentialEpoch`
 * so revoking a screen (DT-01) also kills every ticket already minted for
 * it. See `apps/api/src/screens/stream-ticket.ts`.
 *
 * ── The legacy `?token=` leg (still accepted — deliberately) ─────────────
 * `apps/web/src/app/player/page.tsx` (`tryOpenSse`, ~line 4918) still builds
 * `…/sse?token=<deviceJwt>` and has NO code that mints a ticket. Removing
 * the `?token=` leg from here alone would take the SSE tier — the middle
 * transport that carries emergency pushes through school proxies that block
 * the WS upgrade — offline for every browser/kiosk player, dropping them to
 * the 5 s HTTP poll. So the leg stays until the player is taught to mint a
 * ticket; what changed here is that it is no longer a weaker gate than the
 * rest of the device surface:
 *
 *   • it now re-reads the LIVE screen row and refuses a `REVOKED` screen;
 *   • it now checks the token's `ep` (credential-epoch) claim, so a
 *     credential retired by `revokeScreenCredentials()` cannot open a new
 *     stream — previously only the exact token STRING was checked, and an
 *     epoch bump left the string untouched.
 *
 * To retire the leg, `apps/web` needs (see the fix report):
 *   • `tryOpenSse` → async: `POST ${apiRoot}/api/v1/screens/${screenId}/stream-ticket`
 *     with `Authorization: Bearer <deviceToken>`, then open
 *     `…/sse?ticket=${encodeURIComponent(ticket)}`;
 *   • on `es.onerror`, CLOSE the EventSource before retrying — its built-in
 *     auto-reconnect replays the same (by then expired) ticket URL forever.
 * Once that ships, delete the `token` branch below and the `@Query('token')`
 * parameter. Nothing else consumes it.
 *
 * Output: text/event-stream with `event:` lines for each broadcast message.
 * Client maps these to `addEventListener('SYNC', ...)` etc.
 */
@Controller('api/v1/realtime')
export class SseController {
  private readonly logger = new Logger(SseController.name);
  /** One-shot deprecation notice per process, not per connection. */
  private warnedLegacyToken = false;

  constructor(
    private readonly sse: SseService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * The live screen row every admission path needs. Deliberately a direct
   * read rather than `loadDeviceCredentialState`'s 5 s memo: an SSE open is
   * a rare event (WS has to fail three times first), and admission to a
   * long-lived stream should see the current row, not a cached one.
   */
  private loadScreen(screenId: string) {
    // and this read EXISTS to derive tenantId from the live row (DT-03) —
    // constraining by tenantId here would be circular. Caller then enforces
    // status !== REVOKED and ticket epoch === row.credentialEpoch.
    return this.prisma.client.screen.findUnique({ // ten-ok: identity-derived — screenId comes from a verified stream ticket and this read DERIVES tenantId (DT-03)
      where: { id: screenId },
      select: {
        tenantId: true,
        screenGroupId: true,
        status: true,
        credentialEpoch: true,
        credentialEpochRotatedAt: true,
      } as any,
    }) as Promise<{
      tenantId: string | null;
      screenGroupId: string | null;
      status?: string | null;
      credentialEpoch?: number | null;
      credentialEpochRotatedAt?: Date | null;
    } | null>;
  }

  @Get('sse')
  async sseStream(
    @Query('ticket') ticket: string | undefined,
    @Query('token') token: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    let tenantId: string | null = null;
    let deviceId: string | null = null;
    let groupId: string | null = null;
    let credentialEpoch: number | null = null;

    if (ticket) {
      // ── Stream-ticket admission (DT-08) ────────────────────────────────
      const verdict = verifyStreamTicket(ticket);
      if (!verdict.ok) {
        this.logger.warn(`[SSE] ticket rejected: ${verdict.reason}`);
        res.status(401).json({ error: 'invalid ticket' });
        return;
      }
      const screen = await this.loadScreen(verdict.screenId);
      if (!screen?.tenantId) {
        res.status(404).json({ error: 'screen not found / unpaired' });
        return;
      }
      if (String(screen.status ?? '') === 'REVOKED') {
        this.logger.warn(`[SSE] ticket rejected: screen ${verdict.screenId} is REVOKED`);
        res.status(401).json({ error: 'invalid ticket' });
        return;
      }
      // STRICT epoch equality, not the rotation grace window used for
      // long-lived credentials. A ticket lives 60 s and is cheap to re-mint,
      // so there is no legitimate holder of a superseded one — and the grace
      // window would otherwise let a JUST-revoked screen (revocation = one
      // epoch bump) keep opening streams for the length of that window.
      const liveEpoch = Number(screen.credentialEpoch ?? 0) || 0;
      if (verdict.credentialEpoch !== liveEpoch) {
        this.logger.warn(
          `[SSE] ticket rejected: epoch ${verdict.credentialEpoch} != live ${liveEpoch} (screen ${verdict.screenId})`,
        );
        res.status(401).json({ error: 'invalid ticket' });
        return;
      }
      deviceId = verdict.screenId;
      tenantId = screen.tenantId;
      groupId = screen.screenGroupId ?? null;
      credentialEpoch = liveEpoch;
    } else if (token) {
      // ── Legacy device-JWT admission (see the file header) ──────────────
      if (!this.warnedLegacyToken) {
        this.warnedLegacyToken = true;
        this.logger.warn(
          '[SSE] a client opened the stream with ?token=<deviceJwt>. That puts a ' +
            'long-lived device credential in access logs (DT-08); the player should ' +
            'mint a ticket via POST /api/v1/screens/:id/stream-ticket and use ?ticket=. ' +
            'This warning logs once per process.',
        );
      }
      try {
        const secret = requireSecret('DEVICE_JWT_SECRET');
        const payload = jwt.verify(token, secret) as any;
        // Device JWT shape: { kind: 'device', sub: screenId, ep?: number }
        if (payload?.kind !== 'device' || !payload?.sub) {
          throw new Error('not a device token');
        }
        // Lane-1 P1 (final audit): check the JWT revocation set so a revoked
        // device token can't keep streaming. Fail-closed on Redis error —
        // same posture as jwt-auth.guard.ts.
        //
        // 2026-05-29 (Audit 38-authz LOW #1): the NODE_ENV==='production'
        // wrapper was removed so revocation runs in ALL envs — matching the
        // jwt-auth.guard.ts P1-4 change. A revoked device token must not keep
        // an SSE stream open in staging/dev either.
        try {
          if (await this.redis.sismember('jwt_revoked_list', token)) {
            throw new Error('token revoked');
          }
        } catch (e) {
          if ((e as Error)?.message === 'token revoked') throw e;
          throw new Error('revocation check unavailable');
        }
        deviceId = payload.sub;
        // Look up the tenant from the screen — kiosk JWT alone doesn't
        // include it. (Tenants can rotate; the screen → tenant mapping
        // is the source of truth.)
        const screen = await this.loadScreen(deviceId!);
        if (!screen?.tenantId) {
          res.status(404).json({ error: 'screen not found / unpaired' });
          return;
        }
        // DT-01 parity (2026-08-03): the token-string denylist above can only
        // burn the ONE string it is holding. `revokeScreenCredentials()` bumps
        // `Screen.credentialEpoch` and flips `status`, and this endpoint used
        // to check neither — so a revoked screen kept a full-fidelity realtime
        // stream. Both checks now run here exactly as `verifyDeviceForScreen`
        // runs them everywhere else.
        if (String(screen.status ?? '') === 'REVOKED') throw new Error('screen revoked');
        const epochState = {
          credentialEpoch: Number(screen.credentialEpoch ?? 0) || 0,
          credentialEpochRotatedAt: screen.credentialEpochRotatedAt ?? null,
        };
        if (!isEpochAcceptable(epochFromClaim(payload), epochState)) {
          throw new Error('credential epoch stale');
        }
        tenantId = screen.tenantId;
        // Group scope from the LIVE screen row (not the JWT — see
        // realtime.gateway.ts processHello for the rationale: avoids a stale
        // group claim and works for already-paired devices). Lets a
        // group-scoped emergency (e.g. hallway-group lockdown) reach this
        // SSE stream in real time instead of only via the manifest poll.
        groupId = screen.screenGroupId ?? null;
        credentialEpoch = epochState.credentialEpoch;
      } catch (e) {
        this.logger.warn(`[SSE] auth failed: ${(e as Error)?.message}`);
        res.status(401).json({ error: 'invalid token' });
        return;
      }
    } else {
      res.status(401).json({ error: 'ticket required' });
      return;
    }

    // SSE response headers. `text/event-stream` is the trigger; the
    // remaining fields keep proxies + browsers from buffering or
    // closing the long-lived connection.
    //
    //   Cache-Control: prevents any intermediary from caching the
    //     stream (would be catastrophic — clients would receive a
    //     prior tenant's events).
    //   Connection: keep-alive — explicit, required by some HTTP/1.1
    //     proxies that downgrade from HTTP/2.
    //   X-Accel-Buffering: off — disables nginx proxy_buffering when
    //     the server sits behind nginx (which it doesn't on Railway,
    //     but cheap insurance for self-hosters).
    //   Access-Control-Allow-Origin: same wildcard as the Express
    //     CORS layer uses; SSE inherits CORS like any cross-origin
    //     fetch, so for kiosks loading from a different origin this
    //     has to be permissive.
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.flushHeaders();

    // Hand off to the SSE service. It tracks the client, fires keepalives,
    // and writes broadcast events when Redis fan-out arrives.
    //
    // `token` is passed so the service can re-check the denylist on an open
    // stream (S15); a ticket-authed stream has no token, which is exactly why
    // `credentialEpoch` is passed too — that is what the sweep uses to close
    // a stream whose screen was revoked after it opened.
    this.sse.register({ tenantId, groupId, deviceId, res, token: ticket ? null : token, credentialEpoch });

    // Don't return — let the stream stay open until the client
    // disconnects. The `close` event in SseService.register handles
    // cleanup.
  }
}
