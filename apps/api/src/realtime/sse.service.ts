import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';

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
 *     (tenant:<id>) and OPTIONALLY one device scope (device:<screenId>).
 *   - When a Redis pmessage arrives on `tenant:X` or `device:Y`, the
 *     RedisService calls `broadcastToScope` which we re-fan to every
 *     matching SSE client.
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
  deviceId: string | null;
  res: Response;
  /** When this client connected (ms epoch) — useful for telemetry. */
  connectedAt: number;
}

@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);
  private readonly clients = new Map<string, SseClient>();
  private keepaliveTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Process-internal keepalive ticker. ":<comment>" SSE lines are
    // ignored by EventSource but keep upstream proxies' connection
    // tracker alive. 25s is below most defaults (30s for AWS ELB,
    // 60s for Cloudflare, ~30s for Squid/nginx).
    this.keepaliveTimer = setInterval(() => this.tickKeepalive(), 25_000);
    this.keepaliveTimer.unref?.();
  }

  /** Total number of currently-connected SSE clients (telemetry). */
  size(): number {
    return this.clients.size;
  }

  /** Register a new SSE client. Returns its id for later removal. */
  register(opts: {
    tenantId: string | null;
    deviceId: string | null;
    res: Response;
  }): string {
    const id = `sse-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    const client: SseClient = {
      id,
      tenantId: opts.tenantId,
      deviceId: opts.deviceId,
      res: opts.res,
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
      const match =
        (type === 'tenant' && client.tenantId === id) ||
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
}
