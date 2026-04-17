import { Test, TestingModule } from '@nestjs/testing';
import { EmergencyController } from './emergency.controller';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { JwtService } from '@nestjs/jwt';

describe('EmergencyController', () => {
  let controller: EmergencyController;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(async () => {
    redisService = {
      publish: jest.fn().mockResolvedValue(true),
      sismember: jest.fn().mockResolvedValue(false),
    } as any;

    const prismaService = {
      client: {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({ id: 't1', panicLockdownPlaylistId: null }),
          update: jest.fn().mockResolvedValue({}),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      },
    };

    const signerService = {
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
});
