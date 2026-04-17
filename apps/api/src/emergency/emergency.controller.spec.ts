import { Test, TestingModule } from '@nestjs/testing';
import { EmergencyController } from './emergency.controller';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { JwtService } from '@nestjs/jwt';

describe('EmergencyController', () => {
  let controller: EmergencyController;
  let redisService: jest.Mocked<RedisService>;
  let prismaService: any;
  let signerService: any;

  beforeEach(async () => {
    redisService = {
      publish: jest.fn().mockResolvedValue(true),
      sismember: jest.fn().mockResolvedValue(false),
    } as any;

    prismaService = {
      client: {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({ id: 't1', panicLockdownPlaylistId: null, emergencyStatus: 'INACTIVE', emergencyPlaylistId: null }),
          update: jest.fn().mockResolvedValue({}),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        emergencyMessage: {
          create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
          findUnique: jest.fn().mockResolvedValue({
            id: 'msg_1', tenantId: 't1', scopeType: 'tenant', scopeId: 't1', type: 'TEXT_BROADCAST',
          }),
          update: jest.fn().mockResolvedValue({}),
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
    };

    signerService = {
      signMessage: jest.fn().mockImplementation((type, payload) => ({
        type,
        payload,
        eventId: 'test-event-id',
        timestamp: Date.now(),
        signature: 'test-signature',
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmergencyController],
      providers: [
        {
          provide: RedisService,
          useValue: redisService,
        },
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: WebsocketSignerService,
          useValue: signerService,
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verifyAsync: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<EmergencyController>(EmergencyController);
  });

  it('should publish signed OVERRIDE to redis', async () => {
    const req = { user: { id: 'admin1', schoolId: 'sch1' } };
    const payload = {
      scopeType: 'tenant' as const,
      scopeId: 't1',
      overridePayload: {
        overrideId: 'o1',
        severity: 'CRITICAL' as const,
        textBlob: 'EMERGENCY'
      }
    };
    const response = await controller.triggerEmergency(payload, req);

    expect(response.success).toBe(true);
    expect(response.overrideId).toBe('o1');
    expect(redisService.publish).toHaveBeenCalledWith(
      'tenant:t1',
      expect.objectContaining({
        type: 'OVERRIDE',
        payload: expect.objectContaining({
          overrideId: 'o1',
        }),
      }),
    );
  });

  it('should publish ALL_CLEAR to redis', async () => {
    const req = { user: { id: 'admin1' } };
    const payload = {
      scopeType: 'group' as const,
      scopeId: 'g1'
    };
    
    const response = await controller.clearEmergency('o1', payload, req);
    expect(response.success).toBe(true);

    expect(redisService.publish).toHaveBeenCalledWith('group:g1', expect.objectContaining({
      type: 'ALL_CLEAR',
      payload: {
        overrideId: 'o1',
        clearedBy: 'admin1'
      }
    }));
  });

  // ──────────────────────────────────────────────────────────
  // Sprint 5: SOS / broadcast / media-alert
  // Guard enforcement (@RequireRoles) is covered in rbac.guard.spec.ts —
  // here we assert controller-side contract: audit logs, signed payloads,
  // publish to correct channel, HTTP polling fallback returns active rows.
  // ──────────────────────────────────────────────────────────

  it('SOS endpoint creates audit log, persists message, and publishes signed payload', async () => {
    const req = { user: { id: 'staff1', email: 'teacher@school.edu', tenantId: 't1', schoolId: 't1' } };
    const res = await controller.triggerSos({ location: 'Room 203' }, req);

    expect(res.success).toBe(true);
    expect(prismaService.client.emergencyMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'SOS', severity: 'CRITICAL', scopeType: 'tenant', scopeId: 't1' }) }),
    );
    expect(prismaService.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'SOS_TRIGGER', tenantId: 't1', userId: 'staff1' }) }),
    );
    expect(signerService.signMessage).toHaveBeenCalledWith('SOS', expect.objectContaining({ severity: 'CRITICAL' }));
    expect(redisService.publish).toHaveBeenCalledWith('tenant:t1', expect.objectContaining({ type: 'SOS' }));
  });

  it('SOS rejects when user has no tenant context', async () => {
    const req = { user: { id: 'orphan' } };
    const res = await controller.triggerSos({}, req);
    expect(res.success).toBe(false);
  });

  it('broadcast creates audit log, persists message, and publishes signed TEXT_BROADCAST', async () => {
    const req = { user: { id: 'admin1', schoolId: 't1' } };
    const res = await controller.broadcastText(
      { scopeType: 'tenant', scopeId: 't1', text: 'All staff report to gym', severity: 'WARN', durationMs: 120000 } as any,
      req,
    );

    expect(res.success).toBe(true);
    expect(prismaService.client.emergencyMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'TEXT_BROADCAST', severity: 'WARN' }) }),
    );
    expect(prismaService.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'BROADCAST_TEXT' }) }),
    );
    expect(signerService.signMessage).toHaveBeenCalledWith('TEXT_BROADCAST', expect.any(Object));
    expect(redisService.publish).toHaveBeenCalledWith('tenant:t1', expect.objectContaining({ type: 'TEXT_BROADCAST' }));
  });

  it('media-alert creates audit log, persists message with media urls, and publishes signed payload', async () => {
    const req = { user: { id: 'admin1', schoolId: 't1' } };
    const res = await controller.mediaAlert(
      {
        scopeType: 'tenant',
        scopeId: 't1',
        mediaUrls: ['https://cdn/1.jpg', 'https://cdn/2.mp4'],
        audioUrl: 'https://cdn/a.mp3',
        textBlob: 'SHELTER IN PLACE',
        severity: 'CRITICAL',
      } as any,
      req,
    );

    expect(res.success).toBe(true);
    const createArg = prismaService.client.emergencyMessage.create.mock.calls[0][0];
    expect(createArg.data.type).toBe('MEDIA_ALERT');
    expect(JSON.parse(createArg.data.mediaUrls)).toEqual(['https://cdn/1.jpg', 'https://cdn/2.mp4']);
    expect(signerService.signMessage).toHaveBeenCalledWith('MEDIA_ALERT', expect.any(Object));
  });

  it('all-clear on a message marks it cleared, audit-logs, and publishes ALL_CLEAR', async () => {
    const req = { user: { id: 'admin1' } };
    const res = await controller.clearMessage('msg_1', req);

    expect(res.success).toBe(true);
    expect(prismaService.client.emergencyMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'msg_1' }, data: expect.objectContaining({ clearedByUserId: 'admin1' }) }),
    );
    expect(prismaService.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'CLEAR_EMERGENCY_MESSAGE' }) }),
    );
    expect(signerService.signMessage).toHaveBeenCalledWith('ALL_CLEAR', expect.objectContaining({ messageId: 'msg_1' }));
  });

  it('HTTP polling /status returns active (uncleared, unexpired) emergency messages', async () => {
    prismaService.client.emergencyMessage.findMany.mockResolvedValueOnce([
      {
        id: 'msg_a', tenantId: 't1', type: 'TEXT_BROADCAST', severity: 'WARN',
        textBlob: 'Hi', mediaUrls: null, audioUrl: null, scopeType: 'tenant',
        scopeId: 't1', expiresAt: new Date(Date.now() + 60000), createdAt: new Date(),
        triggeredByUserId: 'u1', clearedAt: null, clearedByUserId: null,
      },
    ]);

    const res = await controller.status('t1');

    expect(prismaService.client.emergencyMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 't1', clearedAt: null }),
      }),
    );
    expect(res.active).toHaveLength(1);
    expect(res.active[0].id).toBe('msg_a');
    expect(res.tenantStatus).toBe('INACTIVE');
  });
});
