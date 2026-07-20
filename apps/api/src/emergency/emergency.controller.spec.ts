import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { EmergencyController } from './emergency.controller';
import { RedisService } from '../realtime/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { WebhookDispatchService } from '../webhooks/webhook-dispatch.service';
import { GpioService } from '../screens/gpio.service';
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
          findUnique: jest.fn().mockResolvedValue({ id: 't1', panicLockdownPlaylistId: null, emergencyStatus: 'INACTIVE', emergencyPlaylistId: null, locationBasedEmergencyEnabled: false }),
          update: jest.fn().mockResolvedValue({}),
        },
        screenGroup: {
          // Default: group 'g1' belongs to tenant 't1'
          findUnique: jest.fn().mockResolvedValue({ tenantId: 't1' }),
        },
        screen: {
          // Default: screen 'dev1' belongs to tenant 't1'
          findUnique: jest.fn().mockResolvedValue({ tenantId: 't1' }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        screenEmergencyOverride: {
          upsert: jest.fn().mockResolvedValue({}),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        // Playlist-ownership validation on /trigger (Lane-1 P0): the override's
        // playlistId must belong to the scope's tenant. Default: found/owned.
        playlist: {
          findFirst: jest.fn().mockResolvedValue({ id: 'pl-ok' }),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
        emergencyMessage: {
          create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
          findUnique: jest.fn().mockResolvedValue({
            id: 'msg_1', tenantId: 't1', scopeType: 'tenant', scopeId: 't1', type: 'TEXT_BROADCAST',
          }),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
        // 2026-05-25 — outbound webhook on emergency.triggered / .cleared.
        // Stubbed so the spec compiles after EmergencyController grew this dep.
        {
          provide: WebhookDispatchService,
          useValue: { dispatch: jest.fn().mockResolvedValue(undefined) },
        },
        // 2026-05-27 — GPIO status-lamp auto-drive on emergency trigger /
        // all-clear. Stubbed so the spec compiles after the new dep landed.
        {
          provide: GpioService,
          useValue: {
            driveStatusLampForEmergency: jest.fn().mockResolvedValue({ touched: 0 }),
          },
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

  it('materializes location-based tenant triggers into per-screen overrides', async () => {
    prismaService.client.tenant.findUnique.mockResolvedValueOnce({
      id: 't1',
      locationBasedEmergencyEnabled: true,
      panicEvacuatePlaylistId: 'tenant-evacuate-landscape',
      panicEvacuatePortraitPlaylistId: 'tenant-evacuate-portrait',
    });
    prismaService.client.screen.findMany.mockResolvedValueOnce([
      {
        id: 'east',
        tenantId: 't1',
        resolution: '1920x1080',
        emergencyEvacuateAssetUrl: 'https://cdn.school/east-route.png',
      },
      {
        id: 'west',
        tenantId: 't1',
        resolution: '1080x1920',
        emergencyEvacuatePortraitPlaylistId: 'west-portrait-playlist',
      },
      {
        id: 'cafeteria',
        tenantId: 't1',
        resolution: '1920x1080',
      },
    ]);

    const req = { user: { id: 'admin1', tenantId: 't1', schoolId: 't1' } };
    const payload = {
      scopeType: 'tenant' as const,
      scopeId: 't1',
      overridePayload: {
        overrideId: 'o-loc',
        type: 'evacuate' as const,
        severity: 'CRITICAL' as const,
      },
    };

    await controller.triggerEmergency(payload, req);

    expect(prismaService.client.screenEmergencyOverride.upsert).toHaveBeenCalledTimes(3);
    expect(prismaService.client.screenEmergencyOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { screenId: 'east' },
        create: expect.objectContaining({
          type: 'EVACUATE',
          playlistId: null,
          mediaUrl: 'https://cdn.school/east-route.png',
        }),
      }),
    );
    expect(prismaService.client.screenEmergencyOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { screenId: 'west' },
        create: expect.objectContaining({
          type: 'EVACUATE',
          playlistId: 'west-portrait-playlist',
          mediaUrl: null,
        }),
      }),
    );
    expect(prismaService.client.screenEmergencyOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { screenId: 'cafeteria' },
        create: expect.objectContaining({
          type: 'EVACUATE',
          playlistId: 'tenant-evacuate-landscape',
          mediaUrl: null,
        }),
      }),
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Group/device-scoped emergencies must reach the HTTP-poll manifest backstop
  // too (2026-06-01, task #222). Before this, the else branch wrote only an
  // audit row — so the manifest (Tenant.emergencyStatus, untouched for
  // group/device, + per-screen ScreenEmergencyOverride, not created) showed
  // nothing. A poll-only kiosk (WS AND SSE both blocked) missed a group/device
  // lockdown entirely. These pin: trigger materializes per-screen override rows
  // for every affected screen; group all-clear deletes them again.
  // ──────────────────────────────────────────────────────────────────────────

  it('group trigger materializes per-screen overrides so the poll backstop reflects the lockdown', async () => {
    prismaService.client.screenGroup.findUnique.mockResolvedValueOnce({ tenantId: 't1' });
    prismaService.client.screen.findMany.mockResolvedValueOnce([
      { id: 'gym', tenantId: 't1', resolution: '1920x1080' },
      { id: 'hall', tenantId: 't1', resolution: '1080x1920' },
    ]);
    const req = { user: { id: 'admin1', role: 'SCHOOL_ADMIN', tenantId: 't1' } };
    const payload = {
      scopeType: 'group' as const,
      scopeId: 'g1',
      overridePayload: { overrideId: 'o-grp', type: 'lockdown' as const, severity: 'CRITICAL' as const, playlistId: 'lock-pl' },
    };

    const res = await controller.triggerEmergency(payload, req);
    expect(res.success).toBe(true);

    // realtime path (already worked before this fix)
    expect(redisService.publish).toHaveBeenCalledWith('group:g1', expect.objectContaining({ type: 'OVERRIDE' }));
    // Tenant-wide status must NOT be touched by a group-scoped trigger.
    expect(prismaService.client.tenant.update).not.toHaveBeenCalled();

    // NEW: poll backstop — one per-screen override per group member screen.
    expect(prismaService.client.screenEmergencyOverride.upsert).toHaveBeenCalledTimes(2);
    expect(prismaService.client.screenEmergencyOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { screenId: 'gym' },
        create: expect.objectContaining({ screenId: 'gym', tenantId: 't1', type: 'LOCKDOWN', severity: 'CRITICAL', playlistId: 'lock-pl' }),
      }),
    );
    expect(prismaService.client.screenEmergencyOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { screenId: 'hall' } }),
    );
  });

  it('device trigger writes a per-screen override (poll backstop) for the targeted screen', async () => {
    prismaService.client.screen.findMany.mockResolvedValueOnce([
      { id: 'dev1', tenantId: 't1', resolution: '1920x1080' },
    ]);
    const req = { user: { id: 'admin1', role: 'SCHOOL_ADMIN', tenantId: 't1' } };
    const payload = {
      scopeType: 'device' as const,
      scopeId: 'dev1',
      overridePayload: {
        overrideId: 'o-dev',
        type: 'lockdown' as const,
        severity: 'CRITICAL' as const,
        mediaUrl: 'https://proj.supabase.co/storage/v1/object/public/media/lock.png',
      },
    };

    const res = await controller.triggerEmergency(payload, req);
    expect(res.success).toBe(true);
    expect(redisService.publish).toHaveBeenCalledWith('device:dev1', expect.objectContaining({ type: 'OVERRIDE' }));
    expect(prismaService.client.screenEmergencyOverride.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { screenId: 'dev1' },
        create: expect.objectContaining({
          screenId: 'dev1',
          tenantId: 't1',
          type: 'LOCKDOWN',
          mediaUrl: 'https://proj.supabase.co/storage/v1/object/public/media/lock.png',
          playlistId: null,
        }),
      }),
    );
  });

  it('group all-clear deletes the per-screen overrides for the group (poll backstop clears too)', async () => {
    prismaService.client.screenGroup.findUnique.mockResolvedValueOnce({ tenantId: 't1' });
    prismaService.client.screen.findMany.mockResolvedValueOnce([{ id: 'gym' }, { id: 'hall' }]);
    const req = { user: { id: 'admin1', role: 'SCHOOL_ADMIN', tenantId: 't1' } };

    const res = await controller.clearEmergency('o-grp', { scopeType: 'group', scopeId: 'g1' }, req);
    expect(res.success).toBe(true);
    expect(prismaService.client.screenEmergencyOverride.deleteMany).toHaveBeenCalledWith({
      where: { screenId: { in: ['gym', 'hall'] } },
    });
    expect(redisService.publish).toHaveBeenCalledWith('group:g1', expect.objectContaining({ type: 'ALL_CLEAR' }));
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
        // URLs must clear the SSRF media-url allowlist (media-url-guard.ts):
        // https + a *.supabase.co host. The guard runs before any mutation,
        // so emergency media has to come from tenant storage.
        mediaUrls: [
          'https://proj.supabase.co/storage/v1/object/public/media/1.jpg',
          'https://proj.supabase.co/storage/v1/object/public/media/2.mp4',
        ],
        audioUrl: 'https://proj.supabase.co/storage/v1/object/public/media/a.mp3',
        textBlob: 'SHELTER IN PLACE',
        severity: 'CRITICAL',
      } as any,
      req,
    );

    expect(res.success).toBe(true);
    const createArg = prismaService.client.emergencyMessage.create.mock.calls[0][0];
    expect(createArg.data.type).toBe('MEDIA_ALERT');
    expect(JSON.parse(createArg.data.mediaUrls)).toEqual([
      'https://proj.supabase.co/storage/v1/object/public/media/1.jpg',
      'https://proj.supabase.co/storage/v1/object/public/media/2.mp4',
    ]);
    expect(signerService.signMessage).toHaveBeenCalledWith('MEDIA_ALERT', expect.any(Object));
  });

  it('all-clear on a message marks it cleared, audit-logs, and publishes ALL_CLEAR_MESSAGE', async () => {
    // Message belongs to 't1' (default mock) — caller must be on same tenant
    const req = { user: { id: 'admin1', tenantId: 't1' } };
    const res = await controller.clearMessage('msg_1', req);

    expect(res.success).toBe(true);
    // Tenant-scoped clear (TEN-001 burn-down): the where MUST carry the
    // verified owning tenant, not just the bare message id.
    expect(prismaService.client.emergencyMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'msg_1', tenantId: 't1' }, data: expect.objectContaining({ clearedByUserId: 'admin1' }) }),
    );
    expect(prismaService.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'CLEAR_EMERGENCY_MESSAGE' }) }),
    );
    // Must publish ALL_CLEAR_MESSAGE (not bare ALL_CLEAR) — that's the type the
    // player listens for to drop a pushed SOS/broadcast/media overlay. Bare
    // ALL_CLEAR is the OVERRIDE-lockdown manifest-refetch path and never clears
    // a pushed message, which left overlays stuck on screen.
    expect(signerService.signMessage).toHaveBeenCalledWith('ALL_CLEAR_MESSAGE', expect.objectContaining({ messageId: 'msg_1' }));
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
      expect(prismaService.client.screenEmergencyOverride.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 't1' },
      });
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
      // Supabase-storage host clears the media-url-guard SSRF allowlist.
      const body = { scopeType: 'tenant' as const, scopeId: 't1', mediaUrls: ['https://proj.supabase.co/storage/v1/object/public/media/img.jpg'], textBlob: 'SHELTER IN PLACE', severity: 'CRITICAL' as const } as any;
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

  // ──────────────────────────────────────────────────────────────────────────
  // P0-2 (life-safety): GET /emergency/messages — DEVICE-authenticated poll.
  // Paired kiosks carry a device JWT (kind:'device', sub:screenId), not a
  // user session, so the existing GET /status 401'd for them and the
  // <EmergencyOverlay> swallowed it → SOS/broadcast/media never reached the
  // wall when the WS was down. These tests pin the device-only auth, the
  // LIVE-row tenant resolution, and — critically — the per-scope filter that
  // stops a per-screen message for screen B leaking onto screen A.
  // ──────────────────────────────────────────────────────────────────────────
  describe('deviceMessages — device-authed emergency poll', () => {
    const deviceReq = (sub: string, tenantClaim?: string) => ({
      user: { kind: 'device', sub, tenantId: tenantClaim },
    });

    it('rejects a non-device (user session) token with ForbiddenException', async () => {
      const req = { user: { id: 'admin1', role: 'SCHOOL_ADMIN', tenantId: 't1', schoolId: 't1' } };
      await expect(controller.deviceMessages(req)).rejects.toThrow(ForbiddenException);
      // Must NOT touch the screen/message tables on a rejected token.
      expect(prismaService.client.screen.findUnique).not.toHaveBeenCalled();
      expect(prismaService.client.emergencyMessage.findMany).not.toHaveBeenCalled();
    });

    it('rejects a device token with no subject', async () => {
      await expect(controller.deviceMessages({ user: { kind: 'device' } })).rejects.toThrow(ForbiddenException);
    });

    it('returns empty (not error) for an unpaired screen (no tenant)', async () => {
      prismaService.client.screen.findUnique.mockResolvedValueOnce({
        id: 'scr1', tenantId: null, screenGroupId: null, status: 'PENDING',
      });
      const res = await controller.deviceMessages(deviceReq('scr1'));
      expect(res.active).toEqual([]);
      expect(res.tenantId).toBeNull();
      // No message query for a screen we can't scope.
      expect(prismaService.client.emergencyMessage.findMany).not.toHaveBeenCalled();
    });

    it('returns empty for a REVOKED screen', async () => {
      prismaService.client.screen.findUnique.mockResolvedValueOnce({
        id: 'scr1', tenantId: 't1', screenGroupId: null, status: 'REVOKED',
      });
      const res = await controller.deviceMessages(deviceReq('scr1'));
      expect(res.active).toEqual([]);
      expect(prismaService.client.emergencyMessage.findMany).not.toHaveBeenCalled();
    });

    it('returns empty for an unknown screen id', async () => {
      prismaService.client.screen.findUnique.mockResolvedValueOnce(null);
      const res = await controller.deviceMessages(deviceReq('ghost'));
      expect(res.active).toEqual([]);
      expect(prismaService.client.emergencyMessage.findMany).not.toHaveBeenCalled();
    });

    it('resolves tenant from the LIVE screen row, NOT the token tenantId claim (re-pair safety)', async () => {
      // Token still claims the OLD tenant ('stale-tenant'); the screen has
      // since been re-paired to 'real-tenant'. We must query 'real-tenant'
      // so a rotated-away device can never read its former tenant's alerts.
      prismaService.client.screen.findUnique.mockResolvedValueOnce({
        id: 'scr1', tenantId: 'real-tenant', screenGroupId: null, status: 'ACTIVE',
      });
      prismaService.client.emergencyMessage.findMany.mockResolvedValueOnce([]);
      const res = await controller.deviceMessages(deviceReq('scr1', 'stale-tenant'));

      expect(prismaService.client.screen.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'scr1' } }),
      );
      const where = prismaService.client.emergencyMessage.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe('real-tenant');
      expect(where.tenantId).not.toBe('stale-tenant');
      expect(res.tenantId).toBe('real-tenant');
    });

    it('scopes the query to tenant + device + group channels the screen belongs to', async () => {
      prismaService.client.screen.findUnique.mockResolvedValueOnce({
        id: 'scr1', tenantId: 't1', screenGroupId: 'grp9', status: 'ACTIVE',
      });
      prismaService.client.emergencyMessage.findMany.mockResolvedValueOnce([]);
      await controller.deviceMessages(deviceReq('scr1'));

      const where = prismaService.client.emergencyMessage.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe('t1');
      expect(where.clearedAt).toBeNull();
      // The per-scope OR must include exactly: this tenant, this device,
      // and this screen's group — and nothing else.
      const scopeOr = where.AND[0].OR;
      expect(scopeOr).toEqual(
        expect.arrayContaining([
          { scopeType: 'tenant', scopeId: 't1' },
          { scopeType: 'device', scopeId: 'scr1' },
          { scopeType: 'group', scopeId: 'grp9' },
        ]),
      );
      expect(scopeOr).toHaveLength(3);
    });

    it('omits the group scope when the screen is in no group', async () => {
      prismaService.client.screen.findUnique.mockResolvedValueOnce({
        id: 'scr1', tenantId: 't1', screenGroupId: null, status: 'ACTIVE',
      });
      prismaService.client.emergencyMessage.findMany.mockResolvedValueOnce([]);
      await controller.deviceMessages(deviceReq('scr1'));

      const scopeOr = prismaService.client.emergencyMessage.findMany.mock.calls[0][0].where.AND[0].OR;
      expect(scopeOr).toEqual([
        { scopeType: 'tenant', scopeId: 't1' },
        { scopeType: 'device', scopeId: 'scr1' },
      ]);
    });

    it('maps active rows into the same wire shape <EmergencyOverlay> parses', async () => {
      const exp = new Date(Date.now() + 60_000);
      const created = new Date();
      prismaService.client.screen.findUnique.mockResolvedValueOnce({
        id: 'scr1', tenantId: 't1', screenGroupId: null, status: 'ACTIVE',
      });
      prismaService.client.emergencyMessage.findMany.mockResolvedValueOnce([
        {
          id: 'media_1', tenantId: 't1', type: 'MEDIA_ALERT', severity: 'CRITICAL',
          textBlob: 'SHELTER IN PLACE', mediaUrls: JSON.stringify(['https://cdn/x.jpg']),
          audioUrl: null, scopeType: 'tenant', scopeId: 't1',
          expiresAt: exp, createdAt: created, triggeredByUserId: 'u1', clearedAt: null,
        },
      ]);
      const res = await controller.deviceMessages(deviceReq('scr1'));

      expect(res.active).toHaveLength(1);
      expect(res.active[0]).toEqual(
        expect.objectContaining({
          id: 'media_1',
          type: 'MEDIA_ALERT',
          severity: 'CRITICAL',
          textBlob: 'SHELTER IN PLACE',
          mediaUrls: ['https://cdn/x.jpg'],
          expiresAt: Math.floor(exp.getTime() / 1000),
          createdAt: created.toISOString(),
        }),
      );
    });
  });
});
