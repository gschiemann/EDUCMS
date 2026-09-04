import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { RedisService } from './redis.service';
import { TimeSyncService } from './time-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import * as Sentry from '@sentry/nestjs';
import { stampPushConnected } from './push-health';
import {
  admitDeviceCredential,
  isRetiredDeviceCredentialReason,
  DEVICE_IDENTITY_CREDENTIAL_MAX_AGE_MS,
} from '../screens/device-auth';

interface ClientContext {
  connectionId: string;
  deviceId?: string;
  tenantId?: string;
  groupId?: string;
  isAuthenticated: boolean;
  socket: WebSocket;
  authTimeout?: NodeJS.Timeout;
  /** R-07 token bucket for the Redis-writing telemetry events (ACK/HEARTBEAT). */
  telemetryTokens: number;
  telemetryRefilledAt: number;
  /**
   * SEC-001 realtime (2026-09-04) — the device JWT this socket was admitted
   * with, retained so the periodic sweep can RE-RUN the same admission against
   * the live row. `null` for the dev-only unsigned `dev_` branch, which has no
   * credential to re-verify (and cannot exist in production).
   */
  deviceToken?: string | null;
}

/**
 * R-03 — hard ceiling on an inbound WS frame.
 *
 * @nestjs/platform-ws passes gateway options straight to `ws`, whose
 * `maxPayload` DEFAULT is 100 MiB. The raw `message` handler below runs
 * `toString()` + `JSON.parse` BEFORE any auth, so an anonymous socket could
 * put 100 MiB of memory + event-loop pressure on the same process that serves
 * the emergency manifest poll. Every legitimate frame (HELLO / HEARTBEAT /
 * ACK / TIME_PING) is a few hundred bytes; 64 KiB is ~100× headroom.
 */
const MAX_WS_FRAME_BYTES = 64 * 1024;

/**
 * R-07 — cap the metrics blob a device can park in Redis
 * (`device:<id>:status` hash). Real player metrics are a few hundred bytes.
 */
const MAX_HEARTBEAT_METRICS_BYTES = 4 * 1024;

/**
 * R-07 — per-socket token bucket on the two events that write to Redis.
 * 30-deep burst, refilled 1/sec: a legit player (heartbeat every ~15-30s,
 * an ACK per delivered event) never touches it; a compromised kiosk is
 * capped at ~1 Redis write/sec instead of an unbounded rewrite loop.
 */
/**
 * RT-02 (2026-08-04) — concurrent-socket ceiling per paired device.
 *
 * Every other realtime guard is PER SOCKET: the R-07 telemetry token bucket
 * and the RT-01 HELLO limits all hang off `ctx`. So opening a second socket
 * re-mints a full bucket and resets every per-socket cap — which made "open
 * more sockets" the way around all of them, and nothing bounded that.
 *
 * A real player holds exactly ONE socket (`apps/web/src/app/player/page.tsx`
 * has a single `new WebSocket`). Three covers a reconnect overlapping a
 * not-yet-reaped zombie plus a transient double-mount, with room to spare.
 *
 * EVICT-OLDEST, never refuse-newest. The player reconnects on any close code,
 * so refusing the new socket would let a half-open zombie hold a kiosk's slot
 * and lock it out of the push tier — an outage on the channel that carries
 * lockdown alerts. Evicting the oldest always leaves the freshest socket live.
 *
 * NOT paired with a per-IP ceiling, deliberately: a district's entire kiosk
 * fleet shares one NAT egress IP, so any per-IP limit low enough to matter
 * would black out a school, and `socket.remoteAddress` is a proxy hop under
 * Railway anyway (see security/client-ip.ts) — doing it correctly would mean
 * re-implementing X-Forwarded-For hop counting in a WS context, i.e. inventing
 * a new spoofing surface. The per-device cap already bounds the credentialed
 * attacker, who is the only one that reaches this code.
 */
const MAX_SOCKETS_PER_DEVICE = 3;

const TELEMETRY_BUCKET_CAPACITY = 30;
const TELEMETRY_REFILL_INTERVAL_MS = 1_000;

/**
 * SEC-001 realtime (2026-09-04) — how often OPEN sockets are re-checked
 * against the live credential.
 *
 * Admission was the only gate a WS socket ever passed, so a revoke, an unpair,
 * a screen delete or a credential-epoch rotation had no effect on a connection
 * that was already up — it kept receiving the tenant's emergency traffic until
 * the client happened to reconnect, which a wall-mounted kiosk may not do for
 * weeks. 30 s matches `SseService.REVOCATION_SWEEP_MS`, so both realtime
 * transports converge on a withdrawn credential in the same window.
 */
const CREDENTIAL_SWEEP_MS = 30_000;

/**
 * Byte length of a raw `ws` frame WITHOUT decoding it to a string. `ws` can
 * hand us a Buffer (default), a string, an ArrayBuffer, or a Buffer[]
 * fragment list depending on `binaryType` — measure all of them.
 */
function frameByteLength(raw: unknown): number {
  if (typeof raw === 'string') return Buffer.byteLength(raw, 'utf8');
  if (Buffer.isBuffer(raw)) return raw.length;
  if (Array.isArray(raw)) return raw.reduce((n: number, b: any) => n + frameByteLength(b), 0);
  if (raw instanceof ArrayBuffer) return raw.byteLength;
  if (ArrayBuffer.isView(raw)) return raw.byteLength;
  return 0;
}

@WebSocketGateway({ path: '/realtime', maxPayload: MAX_WS_FRAME_BYTES })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  private clients: Map<WebSocket, ClientContext> = new Map();

  /** SEC-001 realtime — the open-socket credential re-validation ticker. */
  private credentialSweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
    private readonly timeSync: TimeSyncService,
  ) {
    this.redisService.setGateway(this);

    // ── NO LEADER LEASE, DELIBERATELY (multi-replica wave 2026-09-02) ──
    // This is PER-CONNECTION work on sockets THIS process holds. `clients` is
    // an in-process Map, so a follower's sockets are invisible to the leader;
    // leasing this would leave every non-leader replica delivering emergency
    // traffic to revoked devices. Same reasoning as `SseService`'s two timers,
    // which carry the identical comment.
    this.credentialSweepTimer = setInterval(() => {
      void this.tickCredentialRevalidation();
    }, CREDENTIAL_SWEEP_MS);
    this.credentialSweepTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.credentialSweepTimer) {
      clearInterval(this.credentialSweepTimer);
      this.credentialSweepTimer = null;
    }
  }

  handleConnection(client: WebSocket) {
    const connectionId = crypto.randomUUID();
    this.logger.log(`[WS] New connection: ${connectionId}`);

    const authTimeout = setTimeout(() => {
      const ctx = this.clients.get(client);
      if (ctx && !ctx.isAuthenticated) {
        this.logger.warn(`[WS] Auth timeout for ${connectionId} — closing`);
        client.close(4001, 'Auth Timeout');
      }
    }, 10000); // 10 seconds — generous for slow mobile connections

    this.clients.set(client, {
      connectionId,
      isAuthenticated: false,
      socket: client,
      authTimeout,
      telemetryTokens: TELEMETRY_BUCKET_CAPACITY,
      telemetryRefilledAt: Date.now(),
    });

    // ─── RAW MESSAGE HANDLER ───
    // NestJS @SubscribeMessage decorators are unreliable with the native ws adapter.
    // Handle messages directly on the socket for guaranteed routing.
    client.on('message', (raw: Buffer | string) => {
      // R-03: size-check the RAW frame before toString()/JSON.parse — the
      // whole point is not to materialize an attacker-sized string on an
      // unauthenticated socket. `maxPayload` above makes ws close the socket
      // itself; this is the belt-and-braces for any adapter/transport that
      // hands us a frame anyway.
      const bytes = frameByteLength(raw);
      if (bytes > MAX_WS_FRAME_BYTES) {
        this.logger.warn(
          `[WS] Oversized frame (${bytes}B > ${MAX_WS_FRAME_BYTES}B) from ${connectionId} — closing`,
        );
        try {
          client.close(1009, 'Frame Too Large');
        } catch { /* socket already gone */ }
        return;
      }
      try {
        const text = typeof raw === 'string' ? raw : raw.toString();
        const msg = JSON.parse(text);
        const event = msg.event || msg.type;
        const data = msg.data || msg.payload || {};

        switch (event) {
          case 'HELLO':
            this.processHello(client, data);
            break;
          case 'HEARTBEAT':
            this.processHeartbeat(client, data);
            break;
          case 'ACK':
            this.processAck(client, data);
            break;
          case 'TIME_PING':
            this.processTimePing(client, data);
            break;
          default:
            this.logger.debug(`[WS] Unknown event: ${event}`);
        }
      } catch (e) {
        this.logger.error(`[WS] Failed to parse message: ${e}`);
      }
    });
  }

  /**
   * RT-02 — close the oldest sockets for a device once it exceeds the cap.
   *
   * `this.clients` is a Map, so its iteration order IS connect order — the
   * oldest qualifying socket comes first and no extra timestamp is needed.
   *
   * The victim is removed from `clients` BEFORE `close()` so it stops being
   * counted and stops receiving fan-out immediately, rather than lingering
   * until the close handshake completes. That makes handleDisconnect's lookup
   * return undefined for it, so its `authTimeout` is cleared here instead —
   * handleDisconnect is otherwise a no-op-safe path.
   */
  private enforceDeviceSocketCap(newest: ClientContext) {
    if (!newest.deviceId) return;

    const mine: ClientContext[] = [];
    for (const ctx of this.clients.values()) {
      if (ctx.isAuthenticated && ctx.deviceId === newest.deviceId) mine.push(ctx);
    }
    if (mine.length <= MAX_SOCKETS_PER_DEVICE) return;

    for (const victim of mine.slice(0, mine.length - MAX_SOCKETS_PER_DEVICE)) {
      if (victim === newest) continue; // never evict the socket we just admitted
      this.logger.warn(
        `[WS] device=${newest.deviceId} over socket cap (${mine.length}) — closing ${victim.connectionId}`,
      );
      if (victim.authTimeout) clearTimeout(victim.authTimeout);
      this.clients.delete(victim.socket);
      try {
        victim.socket.close(4009, 'Too Many Connections');
      } catch {
        /* socket already gone — nothing to do */
      }
    }
  }

  handleDisconnect(client: WebSocket) {
    const ctx = this.clients.get(client);
    if (ctx) {
      if (ctx.authTimeout) clearTimeout(ctx.authTimeout);
      this.logger.log(`[WS] Disconnected: ${ctx.connectionId} (device=${ctx.deviceId}, tenant=${ctx.tenantId})`);
    }
    this.clients.delete(client);
  }

  // ─── HELLO: Authenticate the device ───
  private async processHello(client: WebSocket, payload: any) {
    const ctx = this.clients.get(client);
    if (!ctx) return;

    // RT-01 (2026-08-04) — HELLO WAS UNBOUNDED, AND IT IS THE EXPENSIVE FRAME.
    //
    // The raw dispatcher routed every HELLO here with no state check and no
    // rate limit, and this method is fire-and-forget (not awaited), so inbound
    // frames were never back-pressured. Each call unconditionally does a Redis
    // `sismember`, a `screen.findUnique`, a `stampPushConnected(..., {force:true})`
    // — force deliberately bypasses the 60s debounce, so that IS a DB write
    // every time — and two more Redis `sadd`s.
    //
    // Two Prisma queries per frame, concurrent and unbounded, against a pool
    // pinned at connection_limit=10. One socket looping HELLO saturates it in
    // under a second, and every other consumer then fails with "Timed out
    // fetching a new connection from the connection pool" — including
    // GET /screens/:id/manifest, which is the HTTP-polling backstop that
    // carries emergency lockdown state when WS is down. A device-controlled
    // frame could take out the life-safety fallback path.
    //
    // A real player sends exactly ONE HELLO per connection, so neither guard
    // changes legitimate behaviour:
    //   1. idempotent per socket — re-HELLO on an authenticated socket has no
    //      legitimate purpose, and
    //   2. the existing R-07 token bucket (wired only to HEARTBEAT and ACK)
    //      now also caps PRE-auth retries at ~1/sec on a single socket.
    if (ctx.isAuthenticated) return;
    if (!this.consumeTelemetryToken(ctx, 'HELLO')) return;

    try {
      const token = payload.token;
      if (!token) throw new Error('Missing token');

      let decoded: any;
      // SECURITY (sec-fix wave1 #1): unauthenticated `dev_` token branch
      // used to accept ANY client claiming to be a device without JWT
      // verification. In production this is NEVER allowed. In dev it's
      // off by default and must be opted into via DEV_WS_ALLOW=true —
      // and even then we log a loud warning every time it's used.
      const isProd = process.env.NODE_ENV === 'production';
      const devWsAllow = process.env.DEV_WS_ALLOW === 'true';
      if (token.startsWith('dev_') && !isProd && devWsAllow) {
        this.logger.warn(
          `[WS][SECURITY] DEV_WS_ALLOW is enabled — accepting unsigned dev_ token for ${ctx.connectionId}. This path MUST be disabled in production.`,
        );
        const parts = token.split('_');
        decoded = { deviceId: parts[1], tenantId: parts.slice(2).join('_') };
        // No credential to re-verify — the sweep below skips this socket.
        ctx.deviceToken = null;
      } else {
        // ── SEC-001 realtime (2026-09-04) — THE SHARED ADMISSION ───────────
        //
        // This branch used to be a hand-rolled copy of "verify a device
        // token": `jwt.verify` with no algorithm allowlist, the exact-token
        // denylist, a `findUnique` for the tenant binding, and then
        // `isAuthenticated = true`. It never checked `kind`, `Screen.status`,
        // `credentialEpoch`, or the SEC-001 `unproven` / bootstrap-audience
        // markers — so a credential minted from a leaked device FINGERPRINT
        // (`POST /screens/register {deviceFingerprint}`, a value the dashboard
        // shows with a copy button) was refused by every HTTP route and yet
        // became a full realtime principal here: it received the screen's
        // tenant/group/device emergency traffic, could forge delivery ACKs and
        // heartbeat liveness so a dark screen reported healthy, and counted
        // against MAX_SOCKETS_PER_DEVICE — so repeated connects EVICTED the
        // real kiosk and pushed it down to the polling fallback.
        //
        // It now calls the one function `verifyDeviceForScreen` and the SSE
        // controller call. Never re-inline these checks: three drifted copies
        // of this predicate is precisely finding DT-05.
        //
        // `allowUnpaired: true` preserves today's behaviour on purpose — a
        // screen sitting on the pairing splash has no tenant yet and still
        // legitimately holds a socket for its own device-scoped commands
        // (REFRESH_WEB / CHECK_FOR_UPDATES). Unproven is orthogonal to
        // unpaired and is still refused.
        //
        // The credential snapshot is read at the extended (cross-replica)
        // freshness the global device interceptor uses, not a fresh Postgres
        // read: HELLO is the frame RT-01 hardened because it is the expensive
        // one, and every revocation writer explicitly invalidates BOTH cache
        // tiers, so a revoked screen is still refused on its very next HELLO.
        const admitted = await admitDeviceCredential(
          { prisma: this.prisma, redis: this.redisService },
          token,
          {
            allowUnpaired: true,
            credentialMaxAgeMs: DEVICE_IDENTITY_CREDENTIAL_MAX_AGE_MS,
          },
        );
        if (!admitted.ok) throw new Error(`device credential refused: ${admitted.reason}`);

        // Tenant rebind since the JWT was minted → force re-auth rather than
        // silently re-scoping a live socket. Pre-existing behaviour, kept.
        if (admitted.decoded?.tenantId && admitted.decoded.tenantId !== admitted.tenantId) {
          throw new Error('Screen tenant changed');
        }

        decoded = admitted.decoded;
        // Identity comes from the LIVE ROW, never from a claim (DT-03). The
        // device JWT deliberately does not carry the group: a token minted
        // before a screen was moved between groups would be stale, and
        // already-paired devices would never get group delivery until re-pair.
        // redis psubscribes group:* and broadcastToScope() matches
        // type==='group' && ctx.groupId===id.
        decoded.tenantId = admitted.tenantId;
        decoded.groupId = admitted.screenGroupId ?? undefined;
        decoded.sub = admitted.screenId;
        decoded.deviceId = admitted.screenId;
        ctx.deviceToken = admitted.token;
      }

      // EMERGENCY-PATH FIX (2026-07-04): resolve the device identity the SAME
      // way the screenId is resolved above (line ~147) — `decoded.deviceId ||
      // decoded.sub`. A device JWT can carry the screen id in EITHER claim;
      // Android kiosks whose token uses `sub` were getting ctx.deviceId=undefined,
      // so they (a) never registered in the tenant/group device sets below and
      // (b) never matched a per-device emergency in broadcastToScope()
      // (`type==='device' && ctx.deviceId===id`) — a silent per-screen alert miss.
      ctx.deviceId = decoded.deviceId || decoded.sub;
      ctx.tenantId = decoded.tenantId;
      ctx.groupId = decoded.groupId;
      ctx.isAuthenticated = true;

      // RT-02 — bound concurrent sockets for this device. Runs BEFORE AUTH_OK
      // so the socket we just admitted is never the one evicted.
      this.enforceDeviceSocketCap(ctx);

      if (ctx.authTimeout) {
        clearTimeout(ctx.authTimeout);
        ctx.authTimeout = undefined;
      }

      this.logger.log(`[WS] Authenticated: ${ctx.connectionId} → device=${ctx.deviceId}, tenant=${ctx.tenantId}`);

      // Push-health stamp (2026-07-31): a successful device auth means a
      // live push channel exists for this screen RIGHT NOW. Fire-and-forget
      // telemetry — never blocks or fails the handshake.
      stampPushConnected(this.prisma.client, ctx.deviceId, ctx.tenantId, { force: true });

      this.send(client, 'AUTH_OK', {
        deviceId: ctx.deviceId,
        expiresAt: decoded.exp,
        // Ship server-time so the player can compute a local-clock
        // offset. Android signage devices frequently boot with no
        // NTP sync and drift minutes from wall-clock; without this
        // the player's Math.abs(Date.now() - msg.timestamp) > 30s
        // staleness gate would drop every emergency event on a
        // wrong-clock kiosk. Player applies the offset before
        // comparing.
        // 2026-07-28 — served from TimeSyncService (Redis-aligned) so
        // every replica hands out the SAME clock. Falls back to local
        // Date.now() when Redis is absent — identical to the old value.
        serverTime: this.timeSync.now(),
      });

      // Register in redis for metrics
      if (ctx.deviceId && this.redisService.publisher) {
        try {
          await this.redisService.publisher.sadd(`tenant:${ctx.tenantId}:devices`, ctx.deviceId);
          if (ctx.groupId) {
            await this.redisService.publisher.sadd(`group:${ctx.groupId}:devices`, ctx.deviceId);
          }
        } catch { /* redis optional */ }
      }
    } catch (e) {
      this.logger.warn(`[WS] Auth failed for ${ctx.connectionId}: ${e}`);
      this.send(client, 'AUTH_FAIL', { code: 401, reason: 'INVALID_TOKEN' });
      client.close(4001, 'Unauthorized');
    }
  }

  /**
   * SEC-001 realtime (2026-09-04) — RE-VALIDATE ALREADY-OPEN SOCKETS.
   *
   * Admission was the only gate a WS socket ever passed. An operator revoke, an
   * unpair, a screen delete or a credential-epoch rotation therefore had no
   * effect on a connection that was already up: it kept receiving the tenant's
   * emergency traffic and kept stamping push-health until the client happened
   * to reconnect — which a wall-mounted kiosk may not do for weeks. The SSE
   * transport has had this sweep since S15/DT-01; the WS transport, which is
   * the PRIMARY push channel, did not.
   *
   * POSTURE, and it is deliberately not the admission posture:
   *   • close ONLY on a definitive retirement (`isRetiredDeviceCredentialReason`
   *     — revoked token, revoked/deleted/unpaired screen, stale epoch, an
   *     unproven credential that somehow got in, a subject that stopped
   *     matching);
   *   • KEEP the socket on an infrastructure fault (Redis/Postgres unreachable
   *     → `revocation_check_unavailable`, or a thrown Prisma error) and on
   *     plain token expiry. Dropping the whole fleet's push tier because a
   *     store blinked would take out the channel that carries lockdown alerts
   *     during exactly the incident most likely to coincide with a real
   *     emergency. Same fail-open choice `SseService.tickRevocation` documents.
   *
   * A refused socket is told `AUTH_FAIL` before the close so the player runs
   * its existing single-flight credential recovery (`attemptCredentialRecovery`)
   * instead of blind-reconnect churn.
   *
   * Returns the connection ids it closed, so a test can assert on them.
   */
  async tickCredentialRevalidation(): Promise<string[]> {
    if (this.clients.size === 0) return [];
    const closed: string[] = [];

    for (const ctx of [...this.clients.values()]) {
      if (!ctx.isAuthenticated) continue;
      // The dev-only unsigned branch (never reachable in production) holds no
      // credential; there is nothing to re-verify.
      if (!ctx.deviceToken) continue;

      let verdict: Awaited<ReturnType<typeof admitDeviceCredential>>;
      try {
        verdict = await admitDeviceCredential(
          { prisma: this.prisma, redis: this.redisService },
          ctx.deviceToken,
          {
            expectedScreenId: ctx.deviceId,
            allowUnpaired: true,
            credentialMaxAgeMs: DEVICE_IDENTITY_CREDENTIAL_MAX_AGE_MS,
          },
        );
      } catch (e) {
        // Fail OPEN on an infra fault — see the posture note above.
        this.logger.debug(
          `[WS] credential re-validation errored for ${ctx.connectionId}: ${(e as Error)?.message}`,
        );
        continue;
      }

      if (verdict.ok) {
        // A tenant rebind must not silently re-scope a live socket onto
        // another district's emergency channel — the DT-03 failure class.
        // Close it; the player reconnects and re-registers into the new tenant.
        if ((verdict.tenantId ?? undefined) !== ctx.tenantId) {
          this.closeForRetiredCredential(ctx, 'screen tenant changed');
          closed.push(ctx.connectionId);
          continue;
        }
        // A group move stays inside the tenant, so it is a routing update, not
        // a trust change: keep the socket and follow the live row.
        ctx.groupId = verdict.screenGroupId ?? undefined;
        continue;
      }

      if (!isRetiredDeviceCredentialReason(verdict.reason)) {
        this.logger.debug(
          `[WS] credential re-validation inconclusive for ${ctx.connectionId}: ${verdict.reason} — socket kept`,
        );
        continue;
      }

      this.closeForRetiredCredential(ctx, verdict.reason);
      closed.push(ctx.connectionId);
    }

    return closed;
  }

  /** Tell the client why, then drop it. Mirrors the AUTH_FAIL the player already handles. */
  private closeForRetiredCredential(ctx: ClientContext, reason: string) {
    this.logger.warn(
      `[WS] closing ${ctx.connectionId} (device=${ctx.deviceId}) — credential retired: ${reason}`,
    );
    if (ctx.authTimeout) clearTimeout(ctx.authTimeout);
    this.clients.delete(ctx.socket);
    try {
      this.send(ctx.socket, 'AUTH_FAIL', { code: 401, reason: 'CREDENTIAL_REVOKED' });
    } catch {
      /* socket already gone */
    }
    try {
      ctx.socket.close(4001, 'Unauthorized');
    } catch {
      /* socket already gone */
    }
  }

  // ─── HEARTBEAT ───
  private processHeartbeat(client: WebSocket, payload: any) {
    const ctx = this.clients.get(client);
    if (!ctx || !ctx.isAuthenticated) return;
    if (!this.consumeTelemetryToken(ctx, 'HEARTBEAT')) return;

    // ACK the heartbeat (2026-08-15). The player's dead-connection detector
    // (player/page.tsx ~L5470) force-closes the socket after 60s without ANY
    // inbound message — and until this reply existed, a screen with sync
    // disabled and no events flowing heard NOTHING after AUTH_OK, so every
    // such screen tore down and re-authenticated a perfectly healthy socket
    // every ~75s, forever (measured fleet-wide). The player refreshes its
    // watchdog on any inbound frame (onmessage stamps lastWsMessageAt before
    // parsing), so this single unsigned control frame — same class as
    // AUTH_OK / TIME_PONG — ends the churn with zero player changes. Sits
    // AFTER the telemetry-token gate so a heartbeat flood earns no
    // amplification. Deliberately carries no timestamp: TIME_PONG is the
    // only clock authority (sync rule #3), and a bare ack cannot be misread
    // as one.
    this.send(client, 'HEARTBEAT_ACK', {});

    // Keep the push-health stamp fresh while the socket lives (debounced
    // to one write per screen per minute inside the helper).
    stampPushConnected(this.prisma.client, ctx.deviceId, ctx.tenantId);

    if (ctx.deviceId && this.redisService.publisher) {
      this.redisService.publisher.hset(`device:${ctx.deviceId}:status`,
        'lastSeen', Date.now(),
        'metrics', this.cappedMetrics(ctx, payload?.metrics)
      ).catch((err: Error) => {
        Sentry.withScope((s) => {
          s.setTag('realtime.publish', `device:${ctx.deviceId}:status`);
          Sentry.captureException(err);
        });
        this.logger.warn(`realtime publish failed: ${err?.message ?? err}`);
      });
    }
  }

  // ─── ACK ───
  private processAck(client: WebSocket, payload: any) {
    const ctx = this.clients.get(client);
    if (!ctx || !ctx.isAuthenticated) return;
    if (!this.consumeTelemetryToken(ctx, 'ACK')) return;

    this.redisService.publish('metrics:ack', {
      deviceId: ctx.deviceId,
      tenantId: ctx.tenantId,
      eventId: payload.receivedEventId,
      status: payload.status,
      timestamp: Date.now()
    }).catch((err: Error) => {
      Sentry.withScope((s) => {
        s.setTag('realtime.publish', 'metrics:ack');
        Sentry.captureException(err);
      });
      this.logger.warn(`realtime publish failed: ${err?.message ?? err}`);
    });
  }

  // ─── R-07: per-socket rate limit on the Redis-writing telemetry events ───
  // Neither ACK nor HEARTBEAT was limited, so one compromised kiosk could
  // rewrite its Redis status hash (and spray metrics:ack publishes) as fast
  // as it could send frames. Token bucket, per socket, so a noisy device
  // throttles only itself.
  private consumeTelemetryToken(ctx: ClientContext, event: string): boolean {
    const now = Date.now();
    // Tolerate a context created outside handleConnection (older code paths /
    // test harnesses) — start it full rather than silently disabling the cap.
    if (!Number.isFinite(ctx.telemetryTokens)) {
      ctx.telemetryTokens = TELEMETRY_BUCKET_CAPACITY;
      ctx.telemetryRefilledAt = now;
    }
    const elapsed = now - ctx.telemetryRefilledAt;
    if (elapsed > 0) {
      ctx.telemetryTokens = Math.min(
        TELEMETRY_BUCKET_CAPACITY,
        ctx.telemetryTokens + elapsed / TELEMETRY_REFILL_INTERVAL_MS,
      );
      ctx.telemetryRefilledAt = now;
    }
    if (ctx.telemetryTokens < 1) {
      // debug, not warn: a device-controlled event must never be able to
      // flood the logs (that's the same class of problem as the Redis write).
      this.logger.debug(`[WS] ${event} rate-limited for ${ctx.connectionId} (device=${ctx.deviceId})`);
      return false;
    }
    ctx.telemetryTokens -= 1;
    return true;
  }

  // ─── R-07: bound the metrics blob parked in Redis ───
  // `hset(..., 'metrics', JSON.stringify(payload.metrics))` had no size cap,
  // so a device could store an arbitrarily large value (and rewrite it at
  // will). Oversized blobs are REPLACED by a small marker — we keep the
  // heartbeat (liveness is what matters) and drop the payload.
  private cappedMetrics(ctx: ClientContext, metrics: unknown): string {
    let serialized: string;
    try {
      serialized = JSON.stringify(metrics ?? {}) ?? '{}';
    } catch {
      return JSON.stringify({ rejected: 'unserializable' });
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_HEARTBEAT_METRICS_BYTES) {
      this.logger.debug(
        `[WS] HEARTBEAT metrics over ${MAX_HEARTBEAT_METRICS_BYTES}B from ${ctx.deviceId} — storing marker`,
      );
      return JSON.stringify({
        rejected: 'oversized',
        bytes: Buffer.byteLength(serialized, 'utf8'),
      });
    }
    return serialized;
  }

  // ─── TIME_PING: clock-sync sample (frame-locked multi-screen sync) ───
  // 2026-07-28 — docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §4.
  // The player sends { event: 'TIME_PING', data: { t0 } } and we reply
  // IMMEDIATELY on the same socket with the echoed t0 + our Redis-aligned
  // serverNow. The client computes rtt = t1 - t0 and Cristian-filters the
  // samples (min-RTT selection) into a millisecond-grade shared clock.
  //
  // Direct socket reply — never touches Redis fan-out, so the HMAC
  // broadcast gate is not applicable; it's an unsigned control message
  // exactly like AUTH_OK (whose serverTime the player already trusts for
  // the emergency freshness gate — same blast radius, no new surface).
  // Auth-gated: pre-AUTH sockets get no reply (keeps the unauthenticated
  // surface at zero and makes an unauth flood cost nothing but a parse).
  private processTimePing(client: WebSocket, payload: any) {
    const ctx = this.clients.get(client);
    if (!ctx || !ctx.isAuthenticated) return;

    const t0 = typeof payload?.t0 === 'number' && Number.isFinite(payload.t0) ? payload.t0 : null;
    this.send(client, 'TIME_PONG', {
      ...(t0 !== null ? { t0 } : {}),
      serverNow: this.timeSync.now(),
    });
  }

  // ─── Broadcast to all clients matching a scope ───
  public broadcastToScope(type: string, id: string, message: any) {
    let sent = 0;
    let total = 0;
    for (const [, ctx] of this.clients.entries()) {
      total++;
      if (!ctx.isAuthenticated) continue;

      let match = false;
      if (type === 'tenant' && ctx.tenantId === id) match = true;
      if (type === 'group' && ctx.groupId === id) match = true;
      if (type === 'device' && ctx.deviceId === id) match = true;

      if (match) {
        // Preserve signature + eventId AND the envelope timestamp from
        // the signed message. Previously signature/eventId were dropped
        // (audit fix #6); the timestamp was REWRITTEN to seconds in
        // send() while the player's freshness check uses milliseconds —
        // so every SENSITIVE_TYPES message (OVERRIDE, TENANT_CHANGED)
        // was silently dropped client-side and the "200ms fan-out"
        // claim was effectively a 5-10s HTTP-poll backstop in practice.
        // The signature is computed over the envelope's timestamp —
        // anything else is fiction. (Audit 2026-05-26, P0-1.)
        this.send(
          ctx.socket,
          message.type,
          message.payload,
          crypto.randomUUID(),
          message.signature,
          message.eventId,
          message.timestamp,
        );
        sent++;
      }
    }
    this.logger.log(`[WS] broadcastToScope(${type}:${id}, ${message.type}) → sent to ${sent}/${total} clients`);
  }

  // ─── Send a typed message to a single client ───
  // signature, eventId, and signedTimestamp are optional — present for
  // signed emergency envelopes, absent for internal control messages
  // (AUTH_OK, HEARTBEAT_ACK, etc.).
  //
  // CRITICAL (audit fix 2026-05-26, P0-1): every consumer of
  // msg.timestamp in this codebase expects MILLISECONDS:
  //   - Player freshness gate at apps/web/.../player/page.tsx:3424
  //     uses `Math.abs(Date.now() + offset - msg.timestamp) > 30_000`
  //   - ws-signature.ts:71 verifyWsHmac uses Date.now()-message.timestamp
  // Only this `send` was emitting seconds, which made every signed
  // SENSITIVE_TYPES message land ~1.7×10¹² ms "in the past" on the
  // player and get dropped. Default is now Date.now() in ms; for
  // signed envelopes we pass the envelope's ORIGINAL signed timestamp
  // through unchanged (since that's what the signature covers).
  private send(
    client: WebSocket,
    type: string,
    payload: any,
    idempotencyKey?: string,
    signature?: string,
    eventId?: string,
    signedTimestamp?: number,
  ) {
    if (client.readyState === WebSocket.OPEN) {
      const frame: Record<string, unknown> = {
        type,
        payload,
        idempotencyKey: idempotencyKey || crypto.randomUUID(),
        timestamp: typeof signedTimestamp === 'number' ? signedTimestamp : Date.now(),
      };
      // Include signing fields only when present so unsigned control
      // messages (AUTH_OK, HEARTBEAT_ACK, etc.) are not affected.
      if (signature !== undefined) frame.signature = signature;
      if (eventId !== undefined) frame.eventId = eventId;
      client.send(JSON.stringify(frame));
    }
  }
}
