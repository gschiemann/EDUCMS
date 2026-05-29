import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeGateway } from './realtime.gateway';
import { RedisService } from './redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebSocket } from 'ws';
import * as jwt from 'jsonwebtoken';
import { WebsocketSignerService } from '../security/websocket-signer.service';

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
      publish: jest.fn(),
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
      ],
    }).compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
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
});
