import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
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
        screenGroup: {
          // Default: group 'g1' belongs to tenant 't1'
          findUnique: jest.fn().mockResolvedValue({ tenantId: 't1' }),
        },
        screen: {
          // Default: screen 'dev1' belongs to tenant 't1'
          findUnique: jest.fn().mockResolvedValue({ tenantId: 't1' }),
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
        // After audit fix #12 the trigger/all-clear flow wraps state +
        // audit writes in a $transaction. Mock accepts the array form
        // (Promise.all-style) or the interactive callback form.
        $transaction: jest.fn().mockImplementation((opsOrFn: any) => {
          if (typeof opsOrFn === 'function') return opsOrFn(prismaService.client);
          return Promise.all(opsOrFn);
        }),
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
    const req = { user: { id: 'admin1', tenantId: 't1', schoolId: 't1' } };
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

  it('should publish SIGNED ALL_CLEAR to redis (life-safety regression)', async () => {
    // Regression: pre-fix the controller published unsigned plain JSON
    // for ALL_CLEAR. The player drops every unsigned SENSITIVE event,
    // so screens stayed stuck on lockdown until the 10s HTTP poll
    // noticed the tenant emergencyStatus had flipped. This test
    // asserts the message goes through WebsocketSignerService
    // (signature + eventId + timestamp present) so the player accepts
    // it on the WS path.
    // Group 'g1' belongs to tenant 't1' (default mock) — caller must be on 't1'
    const req = { user: { id: 'admin1', tenantId: 't1' } };
    const payload = {
      scopeType: 'group' as const,
      scopeId: 'g1'
    };

    const response = await controller.clearEmergency('o1', payload, req);
    expect(response.success).toBe(true);

    expect(redisService.publish).toHaveBeenCalledWith('group:g1', expect.objectContaining({
      type: 'ALL_CLEAR',
      payload: expect.objectContaining({
        overrideId: 'o1',
        clearedBy: 'admin1',
      }),
      signature: expect.any(String),
      eventId: expect.any(String),
      timestamp: expect.any(Number),
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
    // Message belongs to 't1' (default mock) — caller must be on same tenant
    const req = { user: { id: 'admin1', tenantId: 't1' } };
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

    // After audit fix #1, /status derives tenantId from req.user (not the
    // query string) for non-SUPER callers. Pass a req with the user's
    // tenant context so the test mirrors real auth.
    const req = { user: { id: 'admin1', tenantId: 't1', schoolId: 't1' } };
    const res = await controller.status(req, 't1');

    expect(prismaService.client.emergencyMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 't1', clearedAt: null }),
      }),
    );
    expect(res.active).toHaveLength(1);
    expect(res.active[0].id).toBe('msg_a');
    expect(res.tenantStatus).toBe('INACTIVE');
  });

  it('HTTP polling /status refuses to enumerate other tenants for non-SUPER users', async () => {
    // Audit fix #1: the tenantId query param is IGNORED for non-SUPER
    // callers; we always lock to the caller's own tenant.
    prismaService.client.emergencyMessage.findMany.mockResolvedValueOnce([]);
    const req = { user: { id: 'admin1', role: 'DISTRICT_ADMIN', tenantId: 'my-tenant', schoolId: 'my-tenant' } };
    await controller.status(req, 'attacker-target-tenant');
    expect(prismaService.client.emergencyMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'my-tenant' }),
      }),
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Security regression tests: cross-tenant calls must be rejected with 403.
  // Same-tenant calls must still work. Unknown scopeType → 400.
  // Non-existent scope → 404. Guards against regressions of audit P0 #5.
  // ──────────────────────────────────────────────────────────────────────────

  describe('resolveScopeTenant — cross-tenant access control', () => {
    it('/trigger rejects cross-tenant call with ForbiddenException', async () => {
      const req = { user: { id: 'attacker', role: 'DISTRICT_ADMIN', tenantId: 'evil-tenant' } };
      const payload = {
        scopeType: 'tenant' as const,
        scopeId: 'victim-tenant',
        overridePayload: { severity: 'CRITICAL' as const },
      };
      await expect(controller.triggerEmergency(payload, req)).rejects.toThrow(ForbiddenException);
      expect(prismaService.client.$transaction).not.toHaveBeenCalled();
    });

    it('/trigger allows same-tenant call (regression guard against over-fixing)', async () => {
      const req = { user: { id: 'admin1', role: 'SCHOOL_ADMIN', tenantId: 't1' } };
      const payload = {
        scopeType: 'tenant' as const,
        scopeId: 't1',
        overridePayload: { overrideId: 'o2', severity: 'CRITICAL' as const },
      };
      const result = await controller.triggerEmergency(payload, req);
      expect(result.success).toBe(true);
    });

    it('/trigger allows SUPER_ADMIN to target any tenant', async () => {
      prismaService.client.tenant.findUnique.mockResolvedValueOnce({
        id: 'any-other-tenant', panicLockdownPlaylistId: null,
      });
      const req = { user: { id: 'super1', role: 'SUPER_ADMIN', tenantId: 'super-tenant' } };
      const payload = {
        scopeType: 'tenant' as const,
        scopeId: 'any-other-tenant',
        overridePayload: { overrideId: 'o3', severity: 'CRITICAL' as const },
      };
      const result = await controller.triggerEmergency(payload, req);
      expect(result.success).toBe(true);
    });

    it('/trigger rejects cross-tenant group scope with ForbiddenException', async () => {
      prismaService.client.screenGroup.findUnique.mockResolvedValueOnce({ tenantId: 't1' });
      const req = { user: { id: 'attacker', role: 'DISTRICT_ADMIN', tenantId: 'evil-tenant' } };
      const payload = {
        scopeType: 'group' as const,
        scopeId: 'g1',
        overridePayload: { severity: 'CRITICAL' as const },
      };
      await expect(controller.triggerEmergency(payload, req)).rejects.toThrow(ForbiddenException);
    });

    it('/trigger rejects cross-tenant device scope with ForbiddenException', async () => {
      prismaService.client.screen.findUnique.mockResolvedValueOnce({ tenantId: 't1' });
      const req = { user: { id: 'attacker', role: 'DISTRICT_ADMIN', tenantId: 'evil-tenant' } };
      const payload = {
        scopeType: 'device' as const,
        scopeId: 'dev1',
        overridePayload: { severity: 'CRITICAL' as const },
      };
      await expect(controller.triggerEmergency(payload, req)).rejects.toThrow(ForbiddenException);
    });

    it('/trigger returns BadRequestException for unknown scopeType', async () => {
      const req = { user: { id: 'admin1', role: 'SCHOOL_ADMIN', tenantId: 't1' } };
      const payload = {
        scopeType: 'building' as any,
        scopeId: 'b1',
        overridePayload: { severity: 'CRITICAL' as const },
      };
      await expect(controller.triggerEmergency(payload, req)).rejects.toThrow(BadRequestException);
    });

    it('/trigger returns NotFoundException for non-existent group scope', async () => {
      prismaService.client.screenGroup.findUnique.mockResolvedValueOnce(null);
      const req = { user: { id: 'admin1', role: 'SCHOOL_ADMIN', tenantId: 't1' } };
      const payload = {
        scopeType: 'group' as const,
        scopeId: 'ghost-group',
        overridePayload: { severity: 'CRITICAL' as const },
      };
      await expect(controller.triggerEmergency(payload, req)).rejects.toThrow(NotFoundException);
    });

    it('/trigger returns NotFoundException for non-existent device scope', async () => {
      prismaService.client.screen.findUnique.mockResolvedValueOnce(null);
      const req = { user: { id: 'admin1', role: 'SCHOOL_ADMIN', tenantId: 't1' } };
      const payload = {
        scopeType: 'device' as const,
        scopeId: 'ghost-screen',
        overridePayload: { severity: 'CRITICAL' as const },
      };
      await expect(controller.triggerEmergency(payload, req)).rejects.toThrow(NotFoundException);
    });

    it('/:overrideId/all-clear rejects cross-tenant call with ForbiddenException', async () => {
      const req = { user: { id: 'attacker', role: 'DISTRICT_ADMIN', tenantId: 'evil-tenant' } };
      const body = { scopeType: 'tenant' as const, scopeId: 'victim-tenant' };
      await expect(controller.clearEmergency('o1', body, req)).rejects.toThrow(ForbiddenException);
      expect(prismaService.client.$transaction).not.toHaveBeenCalled();
    });

    it('/:overrideId/all-clear allows same-tenant call', async () => {
      const req = { user: { id: 'admin1', role: 'SCHOOL_ADMIN', tenantId: 't1' } };
      const body = { scopeType: 'tenant' as const, scopeId: 't1' };
      const result = await controller.clearEmergency('o1', body, req);
      expect(result.success).toBe(true);
    });

    it('/broadcast rejects cross-tenant call with ForbiddenException', async () => {
      const req = { user: { id: 'attacker', role: 'DISTRICT_ADMIN', tenantId: 'evil-tenant' } };
      const body = { scopeType: 'tenant' as const, scopeId: 'victim-tenant', text: 'hijack', severity: 'WARN' as const } as any;
      await expect(controller.broadcastText(body, req)).rejects.toThrow(ForbiddenException);
    });

    it('/broadcast allows same-tenant call', async () => {
      const req = { user: { id: 'admin1', tenantId: 't1' } };
      const body = { scopeType: 'tenant' as const, scopeId: 't1', text: 'Fire drill in 5 min', severity: 'WARN' as const } as any;
      const result = await controller.broadcastText(body, req);
      expect(result.success).toBe(true);
    });

    it('/media-alert rejects cross-tenant call with ForbiddenException', async () => {
      const req = { user: { id: 'attacker', role: 'DISTRICT_ADMIN', tenantId: 'evil-tenant' } };
      const body = { scopeType: 'tenant' as const, scopeId: 'victim-tenant', mediaUrls: [], textBlob: 'hijack', severity: 'CRITICAL' as const } as any;
      await expect(controller.mediaAlert(body, req)).rejects.toThrow(ForbiddenException);
    });

    it('/media-alert allows same-tenant call', async () => {
      const req = { user: { id: 'admin1', tenantId: 't1' } };
      const body = { scopeType: 'tenant' as const, scopeId: 't1', mediaUrls: ['https://cdn/img.jpg'], textBlob: 'SHELTER IN PLACE', severity: 'CRITICAL' as const } as any;
      const result = await controller.mediaAlert(body, req);
      expect(result.success).toBe(true);
    });

    it('/messages/:id/all-clear rejects cross-tenant message clear with ForbiddenException', async () => {
      prismaService.client.emergencyMessage.findUnique.mockResolvedValueOnce({
        id: 'msg_x', tenantId: 't1', scopeType: 'tenant', scopeId: 't1', type: 'SOS',
      });
      const req = { user: { id: 'attacker', role: 'DISTRICT_ADMIN', tenantId: 'evil-tenant' } };
      await expect(controller.clearMessage('msg_x', req)).rejects.toThrow(ForbiddenException);
    });

    it('/messages/:id/all-clear allows same-tenant message clear', async () => {
      prismaService.client.emergencyMessage.findUnique.mockResolvedValueOnce({
        id: 'msg_y', tenantId: 't1', scopeType: 'tenant', scopeId: 't1', type: 'SOS',
      });
      const req = { user: { id: 'admin1', tenantId: 't1' } };
      const result = await controller.clearMessage('msg_y', req);
      expect(result.success).toBe(true);
    });

    it('/messages/:id/all-clear returns NotFoundException for unknown message id', async () => {
      prismaService.client.emergencyMessage.findUnique.mockResolvedValueOnce(null);
      const req = { user: { id: 'admin1', tenantId: 't1' } };
      await expect(controller.clearMessage('ghost-msg', req)).rejects.toThrow(NotFoundException);
    });
  });
});
