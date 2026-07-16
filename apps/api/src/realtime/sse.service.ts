import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Response } from 'express';
import { RedisService } from './redis.service';

/**
 * SseService — Sprint 11 Phase B realtime fallback.
 *
 * Server-sent events (text/event-stream over chunked HTTP) as a middle
 * tier between the primary WebSocket realtime and the HTTP-polling
 * floor. SSE works through ~95% of corporate firewalls / school
 * proxies that block WS upgrade handshakes (Squid 3.x with default
 * config strips Connection:Upgrade; ZScaler / iboss / GoGuardian
 * commonly block ws:// while leaving HTTP keep-alive intact).
 *
 * Why a separate service from the WS gateway:
 *
 *   - SSE is uni-directional (server → client only). No JSON framing,
 *     no ACK, no heartbeat exchange. Just `data:` lines.
 *   - SSE clients are plain Express Response objects, NOT a `ws.Socket`.
 *     Different lifecycle: must be kept open with periodic comment
 *     pings, must explicitly flush, must handle res.write() failures.
 *   - We never want SSE clients in the WS client map — different
 *     auth model (no HELLO/AUTH_OK handshake), different keep-alive,
 *     different teardown.
 *
 * Subscription model:
 *
 *   - Each connected SSE client subscribes to ONE tenant scope
 *     (tenant:<id>), OPTIONALLY one group scope (group:<screenGroupId>),
 *     and OPTIONALLY one device scope (device:<screenId>). This mirrors
 *     the WS gateway's three-scope ClientContext (tenant/group/device).
 *   - When a Redis pmessage arrives on `tenant:X`, `group:Y`, or
 *     `device:Z`, the RedisService calls `broadcastToScope` which we
 *     re-fan to every matching SSE client.
 *   - On disconnect (res.on('close')), the entry is removed; if the
 *     last subscriber to a tenant departs, the scope key is deleted
 *     so we don't accumulate empty buckets.
 *
 * Keep-alive: SSE connections look dead to many intermediaries after
 * 30s of silence. We write a `:keepalive\n\n` comment every 25s on
 * every active connection so reverse proxies + CDNs don't half-close
 * idle clients.
 */
interface SseClient {
  id: string;
  tenantId: string | null;
  groupId: string | null;
  deviceId: string | null;
  res: Response;
  /** The device JWT this stream authenticated with — re-checked for
   *  revocation periodically (S15). Absent for internal/test clients. */
  token: string | null;
  /** When this client connected (ms epoch) — useful for telemetry. */
  connectedAt: number;
}

@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);
  private readonly clients = new Map<string, SseClient>();
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private revocationTimer: NodeJS.Timeout | null = null;

  // How often to re-check open streams for a now-revoked device token (S15).
  private static readonly REVOCATION_SWEEP_MS = 30_000;

  constructor(@Optional() private readonly redis?: RedisService) {
    // Process-internal keepalive ticker. ":<comment>" SSE lines are
    // ignored by EventSource but keep upstream proxies' connection
    // tracker alive. 25s is below most defaults (30s for AWS ELB,
    // 60s for Cloudflare, ~30s for Squid/nginx).
    this.keepaliveTimer = setInterval(() => this.tickKeepalive(), 25_000);
    this.keepaliveTimer.unref?.();

    // S15 (launch-readiness): the controller checks jwt_revoked_list once at
    // stream OPEN, but an already-open stream would keep delivering after a
    // device token is revoked/unpaired until the client happened to reconnect.
    // Re-check every 30s so a revoked device stops receiving within ~30s.
    // FAIL-OPEN (unlike the open gate): a transient Redis error must NOT drop a
    // legitimate device's emergency stream — we only close on a definitive
    // "revoked". The open gate remains the strong fail-closed admission check.
    this.revocationTimer = setInterval(() => {
      void this.tickRevocation();
    }, SseService.REVOCATION_SWEEP_MS);
    this.revocationTimer.unref?.();
  }

  /** Total number of currently-connected SSE clients (telemetry). */
  size(): number {
    return this.clients.size;
  }

  /** Register a new SSE client. Returns its id for later removal. */
  register(opts: {
    tenantId: string | null;
    // Optional group scope (group:<screenGroupId>). When the caller can
    // resolve the client's screen group it is passed here so group-scoped
    // broadcasts (e.g. a hallway-group lockdown) reach this stream in
    // real-time instead of only via the 5-10s manifest poll. Mirrors the
    // WS gateway's optional ClientContext.groupId.
    groupId?: string | null;
    deviceId: string | null;
    res: Response;
    /** The device JWT this stream authenticated with (for periodic
     *  revocation re-checks). Optional so internal callers/tests can omit it. */
    token?: string | null;
  }): string {
    const id = `sse-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    const client: SseClient = {
      id,
      tenantId: opts.tenantId,
      groupId: opts.groupId ?? null,
      deviceId: opts.deviceId,
      res: opts.res,
      token: opts.token ?? null,
      connectedAt: Date.now(),
    };
    this.clients.set(id, client);

    // Tear down on res close — connection lost, browser tab closed,
    // server-side flush errored. Cleanup is idempotent.
    opts.res.on('close', () => {
      this.clients.delete(id);
      this.logger.debug(`[SSE] disconnect id=${id} remaining=${this.clients.size}`);
    });

    this.logger.log(
      `[SSE] connect id=${id} tenant=${opts.tenantId || '-'} ` +
      `group=${opts.groupId || '-'} ` +
      `device=${opts.deviceId || '-'} total=${this.clients.size}`,
    );

    // Initial event so the client's EventSource fires `onopen`
    // immediately rather than waiting for the first real message.
    this.writeEvent(client, 'AUTH_OK', { ts: Date.now() });

    return id;
  }

  /**
   * Called by RedisService when a `tenant:*`, `group:*`, or `device:*`
   * pmessage arrives. We fan-out to every SSE client whose scope
   * matches. Signature mirrors WS gateway's `broadcastToScope`.
   */
  broadcastToScope(type: string, id: string, payload: any): void {
    if (this.clients.size === 0) return;
    let matched = 0;
    for (const client of this.clients.values()) {
      // Mirror the WS gateway's three-scope match (tenant/group/device)
      // so a group-scoped emergency (hallway-group lockdown) is pushed in
      // real-time over SSE instead of being dropped to the manifest poll.
      const match =
        (type === 'tenant' && client.tenantId === id) ||
        (type === 'group' && client.groupId === id) ||
        (type === 'device' && client.deviceId === id);
      if (!match) continue;
      matched += this.writeEvent(client, payload?.type || 'MESSAGE', payload) ? 1 : 0;
    }
    if (matched > 0) {
      this.logger.debug(`[SSE] broadcast ${type}:${id} → ${matched} clients`);
    }
  }

  private writeEvent(client: SseClient, eventType: string, payload: any): boolean {
    try {
      // SSE wire format: optional `event:` line + one or more `data:`
      // lines + blank line terminator. EventSource will dispatch this
      // as an event of type `eventType` to the client's
      // `addEventListener(eventType, ...)` handler.
      const json = JSON.stringify(payload);
      client.res.write(`event: ${eventType}\n`);
      client.res.write(`data: ${json}\n\n`);
      return true;
    } catch (e) {
      this.logger.debug(
        `[SSE] write failed id=${client.id} err=${(e as Error)?.message}`,
      );
      // The underlying socket is dead — pull the client immediately so
      // we don't keep retrying on every broadcast.
      try { client.res.end(); } catch { /* swallow */ }
      this.clients.delete(client.id);
      return false;
    }
  }

  private tickKeepalive() {
    if (this.clients.size === 0) return;
    for (const client of this.clients.values()) {
      try {
        client.res.write(`: keepalive ${Date.now()}\n\n`);
      } catch {
        // Dead connection — let the next broadcast or the `close`
        // handler do final cleanup.
      }
    }
  }

  /**
   * Periodically close any open stream whose device token has since been
   * revoked (S15). Mirrors the controller's open-time
   * `sismember('jwt_revoked_list', token)` check. FAIL-OPEN: a Redis error
   * or missing client leaves the stream untouched — we only disconnect on a
   * definitive revoked=true, so an emergency stream is never dropped on a
   * transient blip. Exposed for tests via the return of closed client ids.
   */
  async tickRevocation(): Promise<string[]> {
    if (this.clients.size === 0 || !this.redis) return [];
    const closed: string[] = [];
    for (const client of [...this.clients.values()]) {
      if (!client.token) continue; // internal/test client — nothing to re-check
      let revoked = false;
      try {
        revoked = await this.redis.sismember('jwt_revoked_list', client.token);
      } catch {
        continue; // fail-open: transient Redis error must not drop the stream
      }
      if (!revoked) continue;
      // Definitive revocation — tell the client and close the stream.
      this.writeEvent(client, 'TOKEN_REVOKED', { ts: Date.now(), reason: 'device token revoked' });
      try { client.res.end(); } catch { /* swallow */ }
      this.clients.delete(client.id);
      closed.push(client.id);
      this.logger.log(`[SSE] closed revoked stream id=${client.id} device=${client.deviceId || '-'}`);
    }
    return closed;
  }
}
