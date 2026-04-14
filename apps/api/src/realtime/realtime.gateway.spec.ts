import { Test, TestingModule } from '@nestjs/testing';
import { RealtimeGateway } from './realtime.gateway';
import { RedisService } from './redis.service';
import { WebSocket } from 'ws';
import * as jwt from 'jsonwebtoken';

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        {
          provide: RedisService,
          useValue: redisService,
        },
      ],
    }).compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
  });

  describe('handleConnection', () => {
    it('should initialize connection and set timeout', () => {
      jest.useFakeTimers();
      const mockWs = { close: jest.fn() } as unknown as WebSocket;

      gateway.handleConnection(mockWs);
      const clients = (gateway as any).clients;
      const ctx = clients.get(mockWs);

      expect(ctx).toBeDefined();
      expect(ctx.isAuthenticated).toBe(false);

      // Verify the auth timeout closes connection if not authenticated
      jest.advanceTimersByTime(5000);
      expect(mockWs.close).toHaveBeenCalledWith(4001, 'Auth Timeout');

      jest.useRealTimers();
    });
  });

  describe('handleHello', () => {
    it('should authenticate correctly with valid JWT', async () => {
      const mockWs = { send: jest.fn(), close: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;
      const secret = 'dev_secret';
      process.env.DEVICE_JWT_SECRET = secret;

      const token = jwt.sign(
        { deviceId: 'dev_123', tenantId: 'tenant_1', groupId: 'group_1' },
        secret,
        { expiresIn: '1h' },
      );

      // Setup connection context
      gateway.handleConnection(mockWs);

      await gateway.handleHello({ token, idempotencyKey: 'idempotency-123' }, mockWs);

      const ctx = (gateway as any).clients.get(mockWs);
      expect(ctx.isAuthenticated).toBe(true);
      expect(ctx.deviceId).toBe('dev_123');

      // The AUTH_OK message should have been sent
      expect(mockWs.send).toHaveBeenCalled();
      const sentRaw = (mockWs.send as jest.Mock).mock.calls[0][0];
      const sent = JSON.parse(sentRaw);

      expect(sent.type).toBe('AUTH_OK');
      expect(sent.idempotencyKey).toBe('idempotency-123');
      expect(sent.payload.deviceId).toBe('dev_123');
      
      // Asserts redis operations
      expect(redisService.publisher.sadd).toHaveBeenCalledWith('tenant:tenant_1:devices', 'dev_123');
    });

    it('should reject invalid JWT and close connection', async () => {
      const mockWs = { send: jest.fn(), close: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;

      gateway.handleConnection(mockWs);
      await gateway.handleHello({ token: 'invalid_token' }, mockWs);

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
  });
});
