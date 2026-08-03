import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeGateway } from './realtime.gateway';
import { RedisService } from './redis.service';
import { TimeSyncService } from './time-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebSocket } from 'ws';
import * as jwt from 'jsonwebtoken';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { GATEWAY_OPTIONS } from '@nestjs/websockets/constants';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(async () => {
    // Mock RedisService
    redisService = {
      publisher: {
        sadd: jest.fn().mockResolvedValue(1),
        hset: jest.fn().mockResolvedValue(1),
        publish: jest.fn().mockResolvedValue(1),
      } as any,
      subscriber: {} as any,
      setGateway: jest.fn(),
      // Must resolve: processAck chains .catch() onto it.
      publish: jest.fn().mockResolvedValue(undefined),
      // processHello now checks jwt_revoked_list via sismember (F-2 2026-05-30 —
      // JWT revocation enforced in EVERY env). 0 = not revoked → auth proceeds.
      // Without this stub the call threw ("Revocation check unavailable") and
      // every valid-JWT auth test failed closed. Individual tests can override
      // to mockResolvedValue(1) to exercise the revoked-token reject path.
      sismember: jest.fn().mockResolvedValue(0),
    } as any;

    // Mock PrismaService — added in 769400b for the WS screen-existence
    // check on auth. processHello looks the screen up by decoded.deviceId
    // and then rejects ('Screen tenant changed') if decoded.tenantId differs
    // from the DB row's tenantId. The handleHello test signs a JWT with
    // deviceId='dev_123', tenantId='tenant_1', so the default screen row MUST
    // match BOTH or auth fails closed. Individual tests can override
    // findUnique to simulate unpair / tenant-rebind paths.
    const prismaService = {
      client: {
        screen: {
          findUnique: jest.fn().mockResolvedValue({ id: 'dev_123', tenantId: 'tenant_1' }),
        },
      },
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        {
          provide: RedisService,
          useValue: redisService,
        },
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          // 2026-07-28 — frame-locked sync. Gateway serves AUTH_OK.serverTime
          // + TIME_PONG from the Redis-aligned clock; local clock is a fine
          // stand-in for unit tests.
          provide: TimeSyncService,
          useValue: {
            now: () => Date.now(),
            status: () => ({ offsetMs: 0, sampledAt: 0, rttMs: null, source: 'local' as const }),
          },
        },
      ],
    }).compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
  });

  afterEach(() => {
    // Open-handle hygiene: handleConnection arms a 10s auth timeout that
    // is only cleared on successful auth or on disconnect. Tests that
    // leave a client unauthenticated (e.g. the invalid-JWT reject path)
    // would otherwise leave that timer pending and keep the Jest worker
    // alive ("A worker process has failed to exit gracefully…"). Clear
    // every connected client's timer the way handleDisconnect would.
    const clients = (gateway as any).clients as Map<
      unknown,
      { authTimeout?: NodeJS.Timeout }
    >;
    for (const ctx of clients.values()) {
      if (ctx.authTimeout) clearTimeout(ctx.authTimeout);
    }
    clients.clear();
  });

  describe('handleConnection', () => {
    it('should initialize connection and set timeout', () => {
      jest.useFakeTimers();
      const mockWs = { close: jest.fn(), on: jest.fn() } as unknown as WebSocket;

      gateway.handleConnection(mockWs);
      const clients = (gateway as any).clients;
      const ctx = clients.get(mockWs);

      expect(ctx).toBeDefined();
      expect(ctx.isAuthenticated).toBe(false);

      // Verify the auth timeout closes connection if not authenticated
      jest.advanceTimersByTime(10000);
      expect(mockWs.close).toHaveBeenCalledWith(4001, 'Auth Timeout');

      jest.useRealTimers();
    });
  });

  describe('handleHello', () => {
    it('should authenticate correctly with valid JWT', async () => {
      const mockWs = { send: jest.fn(), close: jest.fn(), on: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;
      // requireSecret enforces a 16-char minimum (sec-fix wave1 #2);
      // the old 'dev_secret' value silently fell through to the devFallback,
      // making jwt.verify reject the test token. Use a real-shaped key.
      const secret = 'test_device_jwt_secret_at_least_32_chars_long_xx';
      process.env.DEVICE_JWT_SECRET = secret;

      const token = jwt.sign(
        { deviceId: 'dev_123', tenantId: 'tenant_1', groupId: 'group_1' },
        secret,
        { expiresIn: '1h' },
      );

      // Setup connection context
      gateway.handleConnection(mockWs);

      await (gateway as any).processHello(mockWs, { token, idempotencyKey: 'idempotency-123' });

      const ctx = (gateway as any).clients.get(mockWs);
      expect(ctx.isAuthenticated).toBe(true);
      expect(ctx.deviceId).toBe('dev_123');

      // The AUTH_OK message should have been sent
      expect(mockWs.send).toHaveBeenCalled();
      const sentRaw = (mockWs.send as jest.Mock).mock.calls[0][0];
      const sent = JSON.parse(sentRaw);

      expect(sent.type).toBe('AUTH_OK');
      expect(sent.payload.deviceId).toBe('dev_123');
      // serverTime ships so the player can compute a clock-skew offset —
      // signage devices boot without NTP and would otherwise drop every
      // SENSITIVE WS event past the 30s staleness gate.
      expect(typeof sent.payload.serverTime).toBe('number');
      expect(Math.abs(Date.now() - sent.payload.serverTime)).toBeLessThan(2_000);

      // Asserts redis operations
      expect(redisService.publisher!.sadd).toHaveBeenCalledWith('tenant:tenant_1:devices', 'dev_123');
    });

    /**
     * 2026-07-28 — frame-locked multi-screen sync clock transport.
     * TIME_PING must echo the client's t0 (its performance.now() at send —
     * the client computes rtt = t1 - t0 from the echo) alongside serverNow,
     * as a DIRECT socket reply. Pre-auth sockets get silence: the
     * unauthenticated surface stays zero.
     */
    it('answers TIME_PING with an echoed-t0 TIME_PONG, only after auth', async () => {
      const mockWs = { send: jest.fn(), close: jest.fn(), on: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;
      const secret = 'test_device_jwt_secret_at_least_32_chars_long_xx';
      process.env.DEVICE_JWT_SECRET = secret;
      const token = jwt.sign({ deviceId: 'dev_123', tenantId: 'tenant_1' }, secret, { expiresIn: '1h' });

      gateway.handleConnection(mockWs);

      // Pre-auth: no reply at all.
      (gateway as any).processTimePing(mockWs, { t0: 123.456 });
      expect(mockWs.send).not.toHaveBeenCalled();

      await (gateway as any).processHello(mockWs, { token });
      (mockWs.send as jest.Mock).mockClear();

      (gateway as any).processTimePing(mockWs, { t0: 4242.25 });
      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const pong = JSON.parse((mockWs.send as jest.Mock).mock.calls[0][0]);
      expect(pong.type).toBe('TIME_PONG');
      expect(pong.payload.t0).toBe(4242.25);
      expect(typeof pong.payload.serverNow).toBe('number');
      expect(Math.abs(Date.now() - pong.payload.serverNow)).toBeLessThan(2_000);

      // Garbage t0 → still answers with serverNow, just no echo field.
      (mockWs.send as jest.Mock).mockClear();
      (gateway as any).processTimePing(mockWs, { t0: 'not-a-number' });
      const pong2 = JSON.parse((mockWs.send as jest.Mock).mock.calls[0][0]);
      expect(pong2.type).toBe('TIME_PONG');
      expect(pong2.payload.t0).toBeUndefined();
      expect(typeof pong2.payload.serverNow).toBe('number');
    });

    /**
     * Group-scoped realtime delivery (2026-06-01). The WS gateway already
     * matched type==='group' && ctx.groupId===id in broadcastToScope, and
     * redis already psubscribes group:* — but ctx.groupId was only ever set
     * from decoded.groupId (the JWT), which the device token never carried,
     * so group-scoped emergencies (e.g. a hallway-group lockdown) never
     * reached a connected device over WS/SSE. The fix sources the group from
     * the LIVE screen row (not the JWT) so it works for the whole already-
     * paired fleet and never goes stale when a screen is moved between groups.
     */
    it('group scope: populates ctx.groupId from the LIVE screen row (ignoring any JWT claim) and delivers group broadcasts', async () => {
      const mockWs = { send: jest.fn(), close: jest.fn(), on: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;
      const secret = 'test_device_jwt_secret_at_least_32_chars_long_xx';
      process.env.DEVICE_JWT_SECRET = secret;

      // DB is the source of truth: this screen currently lives in 'grp-hallway'.
      // The JWT below carries a STALE group claim that MUST be ignored.
      (gateway as any).prisma.client.screen.findUnique.mockResolvedValueOnce({
        id: 'dev_123', tenantId: 'tenant_1', screenGroupId: 'grp-hallway',
      });

      const token = jwt.sign(
        { deviceId: 'dev_123', tenantId: 'tenant_1', groupId: 'STALE-do-not-use' },
        secret,
        { expiresIn: '1h' },
      );

      gateway.handleConnection(mockWs);
      await (gateway as any).processHello(mockWs, { token });

      const ctx = (gateway as any).clients.get(mockWs);
      expect(ctx.isAuthenticated).toBe(true);
      // Live row wins over the stale JWT claim (no canTriggerPanic-style staleness).
      expect(ctx.groupId).toBe('grp-hallway');
      // Group-membership set registered (metrics).
      expect(redisService.publisher!.sadd).toHaveBeenCalledWith('group:grp-hallway:devices', 'dev_123');

      // A group-scoped emergency now actually reaches this connected device.
      (mockWs.send as jest.Mock).mockClear();
      gateway.broadcastToScope('group', 'grp-hallway', {
        type: 'EMERGENCY_OVERRIDE',
        payload: { type: 'LOCKDOWN', severity: 'CRITICAL' },
      });
      expect(mockWs.send).toHaveBeenCalledTimes(1);
      expect(JSON.parse((mockWs.send as jest.Mock).mock.calls[0][0]).type).toBe('EMERGENCY_OVERRIDE');
    });

    /**
     * EMERGENCY-PATH regression (2026-07-04). A device JWT can carry the screen
     * id in EITHER `deviceId` OR the registered `sub` claim — the screen-lookup
     * above already resolves `decoded.deviceId || decoded.sub`, but ctx.deviceId
     * was set from `decoded.deviceId` ALONE. Android kiosks whose token uses
     * `sub` got ctx.deviceId=undefined, so they never registered in the device
     * set AND never matched a per-DEVICE emergency (broadcastToScope
     * type==='device' && ctx.deviceId===id) — a silent per-screen alert miss.
     */
    it('device scope: resolves ctx.deviceId from the JWT `sub` claim (not just deviceId) and delivers per-device emergencies', async () => {
      const mockWs = { send: jest.fn(), close: jest.fn(), on: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;
      const secret = 'test_device_jwt_secret_at_least_32_chars_long_xx';
      process.env.DEVICE_JWT_SECRET = secret;

      // The paired screen id lives in the token's `sub` (the Android-kiosk shape).
      (gateway as any).prisma.client.screen.findUnique.mockResolvedValueOnce({
        id: 'screen-sub-999', tenantId: 'tenant_1', screenGroupId: null,
      });

      // NOTE: no `deviceId` claim — only `sub`.
      const token = jwt.sign(
        { sub: 'screen-sub-999', tenantId: 'tenant_1' },
        secret,
        { expiresIn: '1h' },
      );

      gateway.handleConnection(mockWs);
      await (gateway as any).processHello(mockWs, { token });

      const ctx = (gateway as any).clients.get(mockWs);
      expect(ctx.isAuthenticated).toBe(true);
      // THE FIX: ctx.deviceId falls back to `sub` (was undefined before).
      expect(ctx.deviceId).toBe('screen-sub-999');
      // Registered in the tenant device set (the `if (ctx.deviceId && …)` guard
      // was false when deviceId was undefined, so this never ran before).
      expect(redisService.publisher!.sadd).toHaveBeenCalledWith('tenant:tenant_1:devices', 'screen-sub-999');

      // A per-DEVICE emergency (scopeType:'device', scopeId:<screenId>) now
      // actually reaches this connected Android kiosk.
      (mockWs.send as jest.Mock).mockClear();
      gateway.broadcastToScope('device', 'screen-sub-999', {
        type: 'EMERGENCY_OVERRIDE',
        payload: { type: 'LOCKDOWN', severity: 'CRITICAL' },
      });
      expect(mockWs.send).toHaveBeenCalledTimes(1);
      expect(JSON.parse((mockWs.send as jest.Mock).mock.calls[0][0]).type).toBe('EMERGENCY_OVERRIDE');
    });

    it('should reject invalid JWT and close connection', async () => {
      const mockWs = { send: jest.fn(), close: jest.fn(), on: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;

      gateway.handleConnection(mockWs);
      await (gateway as any).processHello(mockWs, { token: 'invalid_token' });

      const ctx = (gateway as any).clients.get(mockWs);
      // Wait, ctx is still there until disconnect handler?
      // but the close is called
      expect(mockWs.close).toHaveBeenCalledWith(4001, 'Unauthorized');
      
      const sentRaw = (mockWs.send as jest.Mock).mock.calls[0][0];
      const sent = JSON.parse(sentRaw);
      expect(sent.type).toBe('AUTH_FAIL');
    });
  });

  describe('broadcastToScope', () => {
    it('should target proper clients', async () => {
      const wsTenant1 = { send: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;
      const wsTenant2 = { send: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;

      const clients = (gateway as any).clients;
      clients.set(wsTenant1, { isAuthenticated: true, tenantId: 'tenant_1', socket: wsTenant1 });
      clients.set(wsTenant2, { isAuthenticated: true, tenantId: 'tenant_2', socket: wsTenant2 });

      gateway.broadcastToScope('tenant', 'tenant_1', {
        type: 'OVERRIDE',
        payload: { critical: true },
      });

      expect(wsTenant1.send).toHaveBeenCalled();
      const sentRaw = (wsTenant1.send as jest.Mock).mock.calls[0][0];
      expect(JSON.parse(sentRaw).type).toBe('OVERRIDE');

      expect(wsTenant2.send).not.toHaveBeenCalled();
    });

    /**
     * Regression test for P0 audit fix #6:
     * broadcastToScope was stripping `signature` and `eventId` from signed
     * emergency envelopes before delivering them to players. Without these
     * fields the player's verifyMessage() call always returns false and no
     * emergency content is displayed — a critical life-safety failure.
     *
     * This test:
     * 1. Signs a message via WebsocketSignerService (same path used by
     *    EmergencyService before publishing to Redis).
     * 2. Calls broadcastToScope with the full signed envelope.
     * 3. Asserts the captured socket frame contains BOTH `signature` AND
     *    `eventId` with the exact values that were signed.
     */
    it('P0 #6: preserves signature and eventId in signed emergency envelope', () => {
      process.env.DEVICE_SECRET_KEY = 'test_device_secret_key_at_least_32_chars_xx';

      const signer = new WebsocketSignerService();
      const signedEnvelope = signer.signMessage('EMERGENCY_OVERRIDE', {
        type: 'LOCKDOWN',
        severity: 'CRITICAL',
        textBlob: 'Lockdown in effect. Stay in place.',
      });

      // signedEnvelope = { eventId, timestamp, type, payload, signature }
      expect(signedEnvelope.signature).toBeDefined();
      expect(signedEnvelope.eventId).toBeDefined();

      const mockWs = { send: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;
      const clients = (gateway as any).clients;
      clients.set(mockWs, { isAuthenticated: true, tenantId: 'tenant_abc', socket: mockWs });

      // Redis publishes the full signed envelope; handleRedisMessage calls
      // broadcastToScope(type, id, signedEnvelope) with the entire object.
      gateway.broadcastToScope('tenant', 'tenant_abc', signedEnvelope);

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const frame = JSON.parse((mockWs.send as jest.Mock).mock.calls[0][0]);

      // Core assertion: player MUST receive signature + eventId intact
      expect(frame.signature).toBe(signedEnvelope.signature);
      expect(frame.eventId).toBe(signedEnvelope.eventId);

      // Sanity: message type and payload also survive
      expect(frame.type).toBe('EMERGENCY_OVERRIDE');
      expect(frame.payload.type).toBe('LOCKDOWN');
    });

    /**
     * Regression test for 2026-05-26 audit P0-1.
     *
     * Before the fix, broadcastToScope did NOT pass the envelope's
     * timestamp to send(), and send() rewrote `timestamp` as
     * Math.floor(Date.now() / 1000) — SECONDS. Every other consumer of
     * msg.timestamp in this codebase uses MILLISECONDS (player freshness
     * gate, WebsocketSignerService.verifyMessage, ws-signature.ts). The
     * difference between an ms value (~1.7e12) and a seconds value
     * (~1.7e9) is always >30_000, so the player dropped every signed
     * SENSITIVE_TYPES message with "[Player WS] dropped stale/future
     * event" — and emergency fan-out fell back to the 5–10s HTTP poll
     * instead of the advertised 200ms WS path.
     *
     * Two assertions:
     *  1. Signed-envelope path: frame.timestamp === signedEnvelope.timestamp
     *     (the signature is computed against the envelope's timestamp;
     *     anything else is fiction).
     *  2. Unit sanity: timestamp is in milliseconds for both signed +
     *     unsigned, i.e. close to Date.now() in ms, not seconds.
     */
    it('P0-1: preserves envelope timestamp in ms (not seconds) for signed messages', () => {
      process.env.DEVICE_SECRET_KEY = 'test_device_secret_key_at_least_32_chars_xx';

      const signer = new WebsocketSignerService();
      const signedEnvelope = signer.signMessage('EMERGENCY_OVERRIDE', {
        type: 'LOCKDOWN',
        severity: 'CRITICAL',
      });

      const mockWs = { send: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;
      const clients = (gateway as any).clients;
      clients.set(mockWs, { isAuthenticated: true, tenantId: 'tenant_abc', socket: mockWs });

      gateway.broadcastToScope('tenant', 'tenant_abc', signedEnvelope);

      const frame = JSON.parse((mockWs.send as jest.Mock).mock.calls[0][0]);

      // 1. Timestamp pass-through: must exactly equal what the signature covers.
      expect(frame.timestamp).toBe(signedEnvelope.timestamp);

      // 2. Unit sanity: ms (close to Date.now()), not seconds.
      //    ms today is ~1.7e12, seconds is ~1.7e9 — 1000x apart.
      expect(frame.timestamp).toBeGreaterThan(1e12);
      expect(Math.abs(Date.now() - frame.timestamp)).toBeLessThan(2_000);
    });

    it('P0-1: unsigned control messages get fresh Date.now() in ms', () => {
      const mockWs = { send: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;
      const clients = (gateway as any).clients;
      clients.set(mockWs, { isAuthenticated: true, tenantId: 'tenant_abc', socket: mockWs });

      gateway.broadcastToScope('tenant', 'tenant_abc', {
        type: 'CHECK_FOR_UPDATES',
        payload: { version: 2 },
      });

      const frame = JSON.parse((mockWs.send as jest.Mock).mock.calls[0][0]);

      // Unsigned messages don't have an envelope timestamp to preserve —
      // gateway generates a fresh Date.now() in ms. Player doesn't gate
      // on timestamp for non-SENSITIVE_TYPES, but unit consistency keeps
      // any future client-side timestamp-using code from breaking.
      expect(frame.timestamp).toBeGreaterThan(1e12);
      expect(Math.abs(Date.now() - frame.timestamp)).toBeLessThan(2_000);
    });

    it('should not include signature/eventId on unsigned control messages', () => {
      const mockWs = { send: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;
      const clients = (gateway as any).clients;
      clients.set(mockWs, { isAuthenticated: true, tenantId: 'tenant_abc', socket: mockWs });

      // Unsigned message (no signature / eventId fields)
      gateway.broadcastToScope('tenant', 'tenant_abc', {
        type: 'CHECK_FOR_UPDATES',
        payload: { version: 2 },
      });

      expect(mockWs.send).toHaveBeenCalledTimes(1);
      const frame = JSON.parse((mockWs.send as jest.Mock).mock.calls[0][0]);

      expect(frame.signature).toBeUndefined();
      expect(frame.eventId).toBeUndefined();
    });
  });

  /**
   * R-03 — unauthenticated 100 MiB frames.
   *
   * @nestjs/platform-ws hands gateway options straight to `ws`, whose
   * maxPayload DEFAULT is 104857600 bytes, and the raw message handler runs
   * toString() + JSON.parse BEFORE any auth. An anonymous socket could put
   * 100 MiB of memory + event-loop pressure on the same process that serves
   * the emergency manifest poll.
   */
  describe('R-03: inbound frame size cap', () => {
    /** Grab the raw `message` listener handleConnection registers. */
    function messageListener(ws: any): (raw: any) => void {
      const call = (ws.on as jest.Mock).mock.calls.find((c: any[]) => c[0] === 'message');
      expect(call).toBeDefined();
      return call![1];
    }

    it('declares a bounded maxPayload on the gateway (ws default is 100 MiB)', () => {
      const options = Reflect.getMetadata(GATEWAY_OPTIONS, RealtimeGateway) as any;
      expect(options).toBeDefined();
      expect(options.path).toBe('/realtime');
      expect(typeof options.maxPayload).toBe('number');
      expect(options.maxPayload).toBe(64 * 1024);
      expect(options.maxPayload).toBeLessThan(104857600);
    });

    it('drops an oversized frame WITHOUT parsing it, and closes the socket', () => {
      const mockWs = {
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn(),
        readyState: WebSocket.OPEN,
      } as any;
      gateway.handleConnection(mockWs);
      const onMessage = messageListener(mockWs);

      // A frame one byte over the cap. If the handler ever toString()s +
      // JSON.parses this first, the whole point of the cap is gone.
      const huge = Buffer.alloc(64 * 1024 + 1, 0x41);
      const parseSpy = jest.spyOn(JSON, 'parse');
      const toStringSpy = jest.spyOn(huge, 'toString');

      onMessage(huge);

      expect(parseSpy).not.toHaveBeenCalled();
      expect(toStringSpy).not.toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalledWith(1009, 'Frame Too Large');
      // Nothing was routed: the socket is still unauthenticated.
      expect((gateway as any).clients.get(mockWs).isAuthenticated).toBe(false);

      parseSpy.mockRestore();
      toStringSpy.mockRestore();
    });

    it('measures oversized STRING frames too (not just Buffers)', () => {
      const mockWs = {
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn(),
        readyState: WebSocket.OPEN,
      } as any;
      gateway.handleConnection(mockWs);
      const parseSpy = jest.spyOn(JSON, 'parse');

      messageListener(mockWs)('x'.repeat(64 * 1024 + 1));

      expect(parseSpy).not.toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalledWith(1009, 'Frame Too Large');
      parseSpy.mockRestore();
    });

    it('still routes a normally-sized frame', async () => {
      const secret = 'test_device_jwt_secret_at_least_32_chars_long_xx';
      process.env.DEVICE_JWT_SECRET = secret;
      const token = jwt.sign({ deviceId: 'dev_123', tenantId: 'tenant_1' }, secret, {
        expiresIn: '1h',
      });

      const mockWs = {
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn(),
        readyState: WebSocket.OPEN,
      } as any;
      gateway.handleConnection(mockWs);

      messageListener(mockWs)(Buffer.from(JSON.stringify({ event: 'HELLO', data: { token } })));
      await new Promise((r) => setImmediate(r));

      expect(mockWs.close).not.toHaveBeenCalledWith(1009, 'Frame Too Large');
      expect((gateway as any).clients.get(mockWs).isAuthenticated).toBe(true);
    });
  });

  /**
   * R-07 — unbounded Redis writes via ACK / HEARTBEAT.
   *
   * Neither handler was size-capped or rate-limited, so a single compromised
   * kiosk could park an arbitrarily large `metrics` blob in Redis and rewrite
   * it as fast as it could send frames.
   */
  describe('R-07: telemetry write limits', () => {
    /** Authenticated context, as handleConnection + processHello would build it. */
    function authedClient() {
      const ws = {
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn(),
        readyState: WebSocket.OPEN,
      } as unknown as WebSocket;
      gateway.handleConnection(ws);
      const ctx = (gateway as any).clients.get(ws);
      ctx.isAuthenticated = true;
      ctx.deviceId = 'dev_123';
      ctx.tenantId = 'tenant_1';
      return ws;
    }

    it('caps the metrics blob a device can park in Redis', () => {
      const ws = authedClient();
      const oversized = { blob: 'A'.repeat(8 * 1024) };

      (gateway as any).processHeartbeat(ws, { metrics: oversized });

      expect(redisService.publisher!.hset).toHaveBeenCalledTimes(1);
      const args = (redisService.publisher!.hset as jest.Mock).mock.calls[0];
      const stored = args[args.indexOf('metrics') + 1];
      expect(Buffer.byteLength(stored, 'utf8')).toBeLessThanOrEqual(4 * 1024);
      expect(JSON.parse(stored).rejected).toBe('oversized');
      // The oversized blob itself never reaches Redis.
      expect(stored).not.toContain('AAAAAAAA');
    });

    it('stores normal-sized metrics unchanged', () => {
      const ws = authedClient();
      (gateway as any).processHeartbeat(ws, { metrics: { cpu: 12, freeMb: 400 } });

      const args = (redisService.publisher!.hset as jest.Mock).mock.calls[0];
      const stored = args[args.indexOf('metrics') + 1];
      expect(JSON.parse(stored)).toEqual({ cpu: 12, freeMb: 400 });
    });

    it('rate-limits a HEARTBEAT flood from one socket', () => {
      const ws = authedClient();
      for (let i = 0; i < 500; i++) {
        (gateway as any).processHeartbeat(ws, { metrics: { i } });
      }
      // 30-deep bucket refilling 1/sec — a tight loop can't exceed the burst
      // by more than a token or two of wall-clock refill.
      const writes = (redisService.publisher!.hset as jest.Mock).mock.calls.length;
      expect(writes).toBeLessThanOrEqual(32);
      expect(writes).toBeGreaterThan(0);
    });

    it('rate-limits an ACK flood from one socket', () => {
      const ws = authedClient();
      for (let i = 0; i < 500; i++) {
        (gateway as any).processAck(ws, { receivedEventId: `e${i}`, status: 'ok' });
      }
      const publishes = (redisService.publish as jest.Mock).mock.calls.length;
      expect(publishes).toBeLessThanOrEqual(32);
      expect(publishes).toBeGreaterThan(0);
    });

    it('throttles only the noisy socket, never a well-behaved neighbour', () => {
      const noisy = authedClient();
      for (let i = 0; i < 500; i++) {
        (gateway as any).processAck(noisy, { receivedEventId: `e${i}`, status: 'ok' });
      }
      (redisService.publish as jest.Mock).mockClear();

      const quiet = authedClient();
      (gateway as any).processAck(quiet, { receivedEventId: 'e0', status: 'ok' });
      expect(redisService.publish).toHaveBeenCalledTimes(1);
    });

    it('still ignores telemetry from an UNAUTHENTICATED socket', () => {
      const ws = {
        send: jest.fn(),
        close: jest.fn(),
        on: jest.fn(),
        readyState: WebSocket.OPEN,
      } as unknown as WebSocket;
      gateway.handleConnection(ws);

      (gateway as any).processHeartbeat(ws, { metrics: {} });
      (gateway as any).processAck(ws, { receivedEventId: 'e', status: 'ok' });

      expect(redisService.publisher!.hset).not.toHaveBeenCalled();
      expect(redisService.publish).not.toHaveBeenCalled();
    });
  });
});
