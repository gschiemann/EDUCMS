import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { clientIpFromRequest } from '../security/client-ip';
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
  /**
   * P0-7 finding #4 (2026-09-05) — pre-auth bookkeeping.
   *
   * `helloAt` is what separates the two pre-auth populations that used to
   * share ONE 10 s timer: a socket that has said nothing (idle or hostile,
   * closed fast) and a socket whose HELLO is being admitted right now (a real
   * kiosk waiting on a cold API, given a much longer ceiling — the 10 s timer
   * is a prime suspect for the 49 of 1,000 screens that had not
   * re-authenticated 15 s after the measured restart drill).
   */
  helloAt?: number;
  /** Single-flight: one HELLO admission in flight per socket, ever. */
  helloInFlight?: boolean;
  /** Right-counted client address, for the pre-auth per-IP bound only. */
  remoteIp?: string;
  /** Connect order, so an eviction can pick the oldest without a sort. */
  connectedAt: number;
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

/**
 * ── P0-7 finding #4 (2026-09-05) — BOUNDING THE PRE-AUTH SOCKET ──────────
 *
 * THE LEVER. `handleConnection` accepted a socket and gave it up to 10 s
 * before requiring authentication. Nothing bounded how many such sockets one
 * caller could hold, so an anonymous client could park connections — file
 * descriptors, `ws` buffers and a `clients` entry each — at whatever rate it
 * could open them, on the same process that serves the emergency manifest
 * poll. Connection exhaustion needed no credential at all.
 *
 * THE SHAPE OF THE FIX. The old 10 s timer treated two completely different
 * populations identically:
 *
 *   SILENT   — connected, never sent HELLO. A real player sends HELLO
 *              synchronously from `ws.onopen` (`player/page.tsx`), so a
 *              legitimate socket is silent for a round trip, not for seconds.
 *              This population is the exhaustion lever, and it is bounded
 *              here THREE ways: a short timeout, a per-IP ceiling and a
 *              global ceiling, all evict-OLDEST.
 *   ADMITTING — sent HELLO, waiting on `admitDeviceCredential`. This is a
 *              real kiosk, and under a full-fleet reconnect against a cold
 *              pool that admission can genuinely take a while. The measured
 *              restart drill left 49 of 1,000 screens un-authenticated at
 *              15 s; a 10 s guillotine on this population is a plausible
 *              cause and is certainly not a defence. It now gets a LONGER
 *              ceiling and is exempt from eviction.
 *
 * A garbage HELLO costs nothing to refuse — `admitDeviceCredential` fails at
 * `jwt.verify`, before any Redis or Postgres work — so "send junk to become
 * eviction-exempt" buys an attacker a few microseconds and then a close.
 */
/** Silent (no HELLO yet) socket lifetime. Was 10 s for every pre-auth socket. */
const PREAUTH_SILENT_TIMEOUT_MS = 5_000;
/** Ceiling for a socket whose HELLO is being admitted. Deliberately > the old 10 s. */
const PREAUTH_ADMISSION_TIMEOUT_MS = 30_000;
/**
 * Silent pre-auth sockets one address may hold at once.
 *
 * Counts only the SILENT population: a district's whole fleet shares one NAT
 * address, but its screens are silent for one round trip each.
 */
const MAX_SILENT_PREAUTH_PER_IP = 32;
/** Same, across every address — bounds a distributed opener too. */
const MAX_SILENT_PREAUTH_TOTAL = 512;
/**
 * ⚠️ MEASURED CORRECTION (2026-09-05) — the eviction GRACE FLOOR.
 *
 * The cap above shipped with the claim that "32 is ~two orders of magnitude
 * above anything a 1,000-screen simultaneous reconnect produces in that
 * state". **The load test disproved it.** A 1,000-screen synchronised
 * reconnect against a restarting API produced this, four times:
 *
 *   [WS] silent pre-auth cap (ip=…) — closing <id> (no HELLO after 78ms)
 *
 * 78–107 ms is not an idle socket, it is a real kiosk whose HELLO is still on
 * the wire. Accepting a connection and then killing it a tenth of a second
 * later, during exactly the reconnect storm this whole finding exists to make
 * survivable, is a REGRESSION — it evicts the population it is meant to
 * protect. (The count was small only because the harness's WS upgrade sends no
 * `X-Forwarded-For`, so every screen in the fleet shared ONE bucket and the
 * bucket hovered right at the cap. A real venue with more than ~32 screens
 * behind one public address reaches the same place, and so does any fleet
 * whose upgrades share an edge address.)
 *
 * So the cap now only ever evicts a socket that has been silent LONG ENOUGH
 * TO BE SUSPICIOUS. A caller parking connections holds them silent for the
 * whole `PREAUTH_SILENT_TIMEOUT_MS`, so it becomes evictable here after
 * `PREAUTH_EVICT_GRACE_MS`; a real kiosk that speaks within a round trip never
 * does. The exhaustion bound survives, stated honestly: an attacker may hold
 * `cap + (its open rate × grace)` silent sockets per address, and the 5 s
 * timeout still reaps everything it opens.
 *
 * 1 s is ~10× the slowest handshake observed in the drill and 1/5 of the
 * silent timeout, so the two thresholds cannot invert.
 */
const PREAUTH_EVICT_GRACE_MS = 1_000;

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

  /**
   * P0-7 finding #4 — O(1) index of AUTHENTICATED sockets by device.
   *
   * `enforceDeviceSocketCap` used to walk EVERY entry of `clients` to count
   * one device's sockets, once per successful AUTH — so full-fleet reconnect
   * handling was O(fleet²): ~10⁶ iterations at 1,000 screens (measured in the
   * restart drill's ~20 s window), ~10⁸ at 10,000, on the same event loop that
   * serves the emergency manifest poll.
   *
   * A `Set` keeps insertion order, so it preserves the "oldest first" property
   * the cap's evict-oldest posture depends on — the property `clients`'
   * iteration order was silently providing.
   *
   * `clients` REMAINS THE AUTHORITY for `broadcastToScope`: this index is
   * bookkeeping for the cap, not a delivery path. An index bug must never be
   * able to make a screen miss a lockdown, so the fan-out still iterates the
   * one map that admission itself writes.
   */
  private socketsByDevice: Map<string, Set<ClientContext>> = new Map();

  /** Pre-auth sockets that have not sent HELLO yet, in connect order. */
  private silentPreAuth: Set<ClientContext> = new Set();
  /** The same population, bucketed by right-counted client address. */
  private silentPreAuthByIp: Map<string, Set<ClientContext>> = new Map();

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

  handleConnection(client: WebSocket, req?: { headers?: Record<string, unknown>; socket?: { remoteAddress?: unknown } }) {
    const connectionId = crypto.randomUUID();
    this.logger.log(`[WS] New connection: ${connectionId}`);

    // P0-7 #4 — SILENT pre-auth timer. Only fires for a socket that has not
    // sent HELLO; one that has is on the longer admission ceiling below, so a
    // slow cold-pool admission can no longer be guillotined mid-flight.
    const authTimeout = setTimeout(() => {
      const ctx = this.clients.get(client);
      if (ctx && !ctx.isAuthenticated && ctx.helloAt === undefined) {
        this.logger.warn(`[WS] Auth timeout for ${connectionId} (no HELLO in ${PREAUTH_SILENT_TIMEOUT_MS}ms) — closing`);
        this.dropSocket(ctx, 4001, 'Auth Timeout');
      }
    }, PREAUTH_SILENT_TIMEOUT_MS);

    const ctx: ClientContext = {
      connectionId,
      isAuthenticated: false,
      socket: client,
      authTimeout,
      connectedAt: Date.now(),
      // Right-counted (`TRUSTED_PROXY_HOPS`) so the pre-auth bound keys on the
      // same address the HTTP throttler and the AuditLog use, rather than on a
      // rotating internal proxy hop. Never used for authorization.
      remoteIp: clientIpFromRequest(req) ?? 'unknown',
      telemetryTokens: TELEMETRY_BUCKET_CAPACITY,
      telemetryRefilledAt: Date.now(),
    };
    this.clients.set(client, ctx);
    this.trackSilentPreAuth(ctx);
    this.enforceSilentPreAuthCaps(ctx);

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

  // ── Bookkeeping (P0-7 #4) ───────────────────────────────────────────────
  //
  // Three indexes, all derived from `clients` and all maintained in ONE place
  // each, so there is exactly one add site and one remove site per index. None
  // of them is a delivery path: `broadcastToScope` still walks `clients`.

  private trackSilentPreAuth(ctx: ClientContext) {
    this.silentPreAuth.add(ctx);
    const ip = ctx.remoteIp ?? 'unknown';
    let bucket = this.silentPreAuthByIp.get(ip);
    if (!bucket) {
      bucket = new Set();
      this.silentPreAuthByIp.set(ip, bucket);
    }
    bucket.add(ctx);
  }

  /** Leave the silent population — on HELLO, on auth, or on close. */
  private untrackSilentPreAuth(ctx: ClientContext) {
    if (!this.silentPreAuth.delete(ctx)) return;
    const ip = ctx.remoteIp ?? 'unknown';
    const bucket = this.silentPreAuthByIp.get(ip);
    if (!bucket) return;
    bucket.delete(ctx);
    if (bucket.size === 0) this.silentPreAuthByIp.delete(ip);
  }

  private trackAuthenticated(ctx: ClientContext) {
    if (!ctx.deviceId) return;
    let set = this.socketsByDevice.get(ctx.deviceId);
    if (!set) {
      set = new Set();
      this.socketsByDevice.set(ctx.deviceId, set);
    }
    set.add(ctx);
  }

  private untrackAuthenticated(ctx: ClientContext) {
    if (!ctx.deviceId) return;
    const set = this.socketsByDevice.get(ctx.deviceId);
    if (!set) return;
    set.delete(ctx);
    if (set.size === 0) this.socketsByDevice.delete(ctx.deviceId);
  }

  /**
   * THE one place a socket leaves this process. Removing it from `clients`
   * BEFORE `close()` is the RT-02 behaviour, kept verbatim: it stops being
   * counted and stops receiving fan-out immediately rather than lingering
   * until the close handshake completes.
   */
  private dropSocket(ctx: ClientContext, code: number, reason: string) {
    if (ctx.authTimeout) {
      clearTimeout(ctx.authTimeout);
      ctx.authTimeout = undefined;
    }
    this.clients.delete(ctx.socket);
    this.untrackSilentPreAuth(ctx);
    this.untrackAuthenticated(ctx);
    try {
      ctx.socket.close(code, reason);
    } catch {
      /* socket already gone — nothing to do */
    }
  }

  /**
   * Bound the SILENT pre-auth population, per address and globally.
   *
   * Evict-OLDEST, matching RT-02's posture: the newest socket is always the
   * one most likely to be a real kiosk reconnecting, and refusing it is how a
   * zombie locks a screen out of the push tier. A socket that has sent HELLO
   * is not in this population at all and can never be evicted here.
   *
   * …and neither is a socket that has been silent for less than
   * `PREAUTH_EVICT_GRACE_MS` — see that constant for the measurement that
   * added it. Being over the cap with nothing old enough to evict is a
   * legitimate state (a fleet reconnecting), and the right response is to
   * accept it: the 5 s silent timeout still reaps everything, so the
   * population cannot grow without bound either way.
   */
  private enforceSilentPreAuthCaps(newest: ClientContext) {
    const ip = newest.remoteIp ?? 'unknown';
    const bucket = this.silentPreAuthByIp.get(ip);
    if (bucket && bucket.size > MAX_SILENT_PREAUTH_PER_IP) {
      this.evictOldestSilent(bucket, bucket.size - MAX_SILENT_PREAUTH_PER_IP, newest, `ip=${ip}`);
    }
    if (this.silentPreAuth.size > MAX_SILENT_PREAUTH_TOTAL) {
      this.evictOldestSilent(
        this.silentPreAuth,
        this.silentPreAuth.size - MAX_SILENT_PREAUTH_TOTAL,
        newest,
        'global',
      );
    }
  }

  private evictOldestSilent(
    population: Set<ClientContext>,
    count: number,
    keep: ClientContext,
    scope: string,
  ) {
    let evicted = 0;
    const now = Date.now();
    // Sets iterate in insertion order, so this is oldest-first without a sort.
    for (const victim of population) {
      if (evicted >= count) break;
      if (victim === keep) continue;
      const silentFor = now - victim.connectedAt;
      // The grace floor. Oldest-first means everything after this point in the
      // iteration is YOUNGER, so nothing further along can be evictable
      // either — stop rather than continue.
      if (silentFor < PREAUTH_EVICT_GRACE_MS) break;
      this.logger.warn(
        `[WS] silent pre-auth cap (${scope}) — closing ${victim.connectionId} (no HELLO after ${silentFor}ms)`,
      );
      this.dropSocket(victim, 4001, 'Too Many Unauthenticated Connections');
      evicted += 1;
    }
  }

  /**
   * RT-02 — close the oldest sockets for a device once it exceeds the cap.
   *
   * P0-7 #4: now an O(1) lookup in `socketsByDevice` instead of a walk of the
   * whole client map. A `Set` preserves insertion order, so "oldest first" is
   * unchanged — that property used to come from `clients`' iteration order.
   *
   * The victim leaves through `dropSocket`, which removes it from every index
   * BEFORE `close()`, so handleDisconnect's later lookup is a no-op-safe miss.
   */
  private enforceDeviceSocketCap(newest: ClientContext) {
    if (!newest.deviceId) return;

    const mine = this.socketsByDevice.get(newest.deviceId);
    if (!mine || mine.size <= MAX_SOCKETS_PER_DEVICE) return;

    let toClose = mine.size - MAX_SOCKETS_PER_DEVICE;
    for (const victim of [...mine]) {
      if (toClose <= 0) break;
      if (victim === newest) continue; // never evict the socket we just admitted
      this.logger.warn(
        `[WS] device=${newest.deviceId} over socket cap (${mine.size}) — closing ${victim.connectionId}`,
      );
      this.dropSocket(victim, 4009, 'Too Many Connections');
      toClose -= 1;
    }
  }

  handleDisconnect(client: WebSocket) {
    const ctx = this.clients.get(client);
    if (ctx) {
      if (ctx.authTimeout) clearTimeout(ctx.authTimeout);
      this.untrackSilentPreAuth(ctx);
      this.untrackAuthenticated(ctx);
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
    // P0-7 #4 — SINGLE-FLIGHT. `processHello` is fire-and-forget, and
    // `isAuthenticated` only becomes true after the awaits below, so the
    // idempotence guard above could not see a HELLO that was still in the air.
    // The R-07 bucket allowed a 30-deep burst, i.e. up to 30 CONCURRENT
    // admissions on one anonymous socket. One at a time, always.
    if (ctx.helloInFlight) return;
    if (!this.consumeTelemetryToken(ctx, 'HELLO')) return;
    ctx.helloInFlight = true;

    // Leaving the SILENT population: this caller has stated its intent, so it
    // stops counting against the anonymous-connection bounds and moves to the
    // longer admission ceiling — a cold-pool admission must not be guillotined
    // at 10 s the way the single old timer did it.
    if (ctx.helloAt === undefined) {
      ctx.helloAt = Date.now();
      this.untrackSilentPreAuth(ctx);
      if (ctx.authTimeout) clearTimeout(ctx.authTimeout);
      ctx.authTimeout = setTimeout(() => {
        const live = this.clients.get(client);
        if (live && !live.isAuthenticated) {
          this.logger.warn(
            `[WS] admission timeout for ${live.connectionId} (HELLO ${PREAUTH_ADMISSION_TIMEOUT_MS}ms ago, never authenticated) — closing`,
          );
          this.dropSocket(live, 4001, 'Auth Timeout');
        }
      }, PREAUTH_ADMISSION_TIMEOUT_MS);
    }

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
      // A socket admitted between the HELLO and here (evicted by a cap, closed
      // by the peer) must not be resurrected into the index — `dropSocket`
      // removed it from `clients`, and that map stays the authority.
      if (!this.clients.has(client)) throw new Error('socket closed during admission');
      this.trackAuthenticated(ctx);

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
      // Close, but leave the context in `clients` exactly as before this
      // change: the SEC-001 acceptance spec reads a REFUSED socket's context
      // back to prove it never became a principal, and `handleDisconnect`
      // (or the admission timer still armed above) reaps it either way.
      client.close(4001, 'Unauthorized');
    } finally {
      // Released either way: a refused socket is closed above, and a socket
      // that somehow survives may re-HELLO exactly once per token bucket tick.
      ctx.helloInFlight = false;
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
    // Remove from `clients` (and every index) BEFORE the AUTH_FAIL, exactly as
    // this method has always done, so the socket stops receiving fan-out the
    // instant the verdict lands rather than at the end of the close handshake.
    if (ctx.authTimeout) {
      clearTimeout(ctx.authTimeout);
      ctx.authTimeout = undefined;
    }
    this.clients.delete(ctx.socket);
    this.untrackSilentPreAuth(ctx);
    this.untrackAuthenticated(ctx);
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
