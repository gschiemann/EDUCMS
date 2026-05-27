/**
 * GpioService unit tests — Goodview EP6N GPIO IN/OUT routing.
 *
 * Coverage:
 *   - fire_alarm dry-contact → triggers EVACUATE override (HIGH severity)
 *   - panic_button dry-contact → triggers LOCKDOWN override (HIGH severity)
 *   - GPIO IN with no wiring → action: 'logged', no override
 *   - GPIO IN with wiring but state not active (low / edge_falling)
 *     → action: 'ignored', no override
 *   - Rate limit: 11th event in 60s window → action: 'rate_limited',
 *     still audit-logged, no override
 *   - setOutput → persists state + broadcasts signed GPIO_SET
 *   - driveStatusLampForEmergency → flips every status_lamp screen
 *     to the requested state, leaves non-lamp screens untouched, and
 *     does NOT throw if a single lamp's setOutput fails
 *
 * Mocks PrismaService, RedisService, WebsocketSignerService directly.
 */

import { Test, TestingModule } from '@nestjs/testing';

import {
  GpioService,
  GPIO_INPUT_RATE_LIMIT,
  _inputRateMap,
  readGpioState,
  readWiring,
} from './gpio.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';

describe('GpioService', () => {
  let service: GpioService;
  let prismaService: any;
  let redisService: jest.Mocked<RedisService>;
  let signerService: any;

  const TENANT_ID = 't1';
  const SCREEN_ID = 'screen-1';

  beforeEach(async () => {
    // Clear the in-memory rate map so each test starts at zero events.
    _inputRateMap.clear();

    redisService = {
      publish: jest.fn().mockResolvedValue(true),
    } as any;

    signerService = {
      signMessage: jest.fn().mockImplementation((type: string, payload: any) => ({
        type,
        payload,
        eventId: 'test-event-id',
        timestamp: Date.now(),
        signature: 'test-signature',
      })),
    };

    prismaService = {
      client: {
        screen: {
          findUnique: jest.fn().mockResolvedValue({
            id: SCREEN_ID,
            config: { wiring: { gpio_out1: 'status_lamp' } },
          }),
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn().mockResolvedValue({}),
        },
        screenEmergencyOverride: {
          upsert: jest.fn().mockResolvedValue({}),
        },
        auditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn().mockImplementation((opsOrFn: any) => {
          if (typeof opsOrFn === 'function') return opsOrFn(prismaService.client);
          return Promise.all(opsOrFn);
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GpioService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: WebsocketSignerService, useValue: signerService },
      ],
    }).compile();

    service = module.get<GpioService>(GpioService);
  });

  // ─── readWiring / readGpioState pure helpers ───────────────────

  describe('readWiring', () => {
    it('returns the mapped value for a valid in-pin config', () => {
      expect(readWiring({ wiring: { gpio_in1: 'fire_alarm' } }, 'in1')).toBe('fire_alarm');
      expect(readWiring({ wiring: { gpio_in2: 'panic_button' } }, 'in2')).toBe('panic_button');
    });
    it('returns the mapped value for a valid out-pin config', () => {
      expect(readWiring({ wiring: { gpio_out1: 'status_lamp' } }, 'out1')).toBe('status_lamp');
      expect(readWiring({ wiring: { gpio_out2: 'horn' } }, 'out2')).toBe('horn');
    });
    it('rejects out-mapping read against an in-pin (direction sanity)', () => {
      // operator hand-edits gpio_in1 = 'status_lamp' (invalid)
      expect(readWiring({ wiring: { gpio_in1: 'status_lamp' } }, 'in1')).toBeNull();
    });
    it('returns null for missing config / wiring blob', () => {
      expect(readWiring(null, 'in1')).toBeNull();
      expect(readWiring({}, 'in1')).toBeNull();
      expect(readWiring({ wiring: {} }, 'in1')).toBeNull();
    });
  });

  describe('readGpioState', () => {
    it('defaults to low/low when no state is set', () => {
      expect(readGpioState(null)).toEqual({ out1: 'low', out2: 'low', updatedAt: null });
      expect(readGpioState({})).toEqual({ out1: 'low', out2: 'low', updatedAt: null });
    });
    it('reads persisted state', () => {
      const cfg = { gpioState: { out1: 'high', out2: 'low', updatedAt: '2026-05-27T00:00:00Z' } };
      expect(readGpioState(cfg)).toEqual({ out1: 'high', out2: 'low', updatedAt: '2026-05-27T00:00:00Z' });
    });
    it('ignores invalid state values', () => {
      const cfg = { gpioState: { out1: 'GARBAGE', out2: 42 } };
      expect(readGpioState(cfg)).toEqual({ out1: 'low', out2: 'low', updatedAt: null });
    });
  });

  // ─── handleInputEvent ──────────────────────────────────────────

  describe('handleInputEvent', () => {
    it('fire_alarm dry-contact (edge_rising) triggers EVACUATE override', async () => {
      const result = await service.handleInputEvent({
        screenId: SCREEN_ID,
        tenantId: TENANT_ID,
        event: { pin: 'in1', state: 'edge_rising' },
        config: { wiring: { gpio_in1: 'fire_alarm' } },
      });

      expect(result.accepted).toBe(true);
      expect(result.action).toBe('emergency_triggered');
      expect(result.overrideId).toMatch(/^ovr_gpio_/);

      // ScreenEmergencyOverride.upsert was called with type EVACUATE.
      const upsertCall = prismaService.client.screenEmergencyOverride.upsert.mock.calls[0][0];
      expect(upsertCall.where.screenId).toBe(SCREEN_ID);
      expect(upsertCall.create.type).toBe('EVACUATE');
      expect(upsertCall.create.severity).toBe('HIGH');
      expect(upsertCall.create.tenantId).toBe(TENANT_ID);
      expect(upsertCall.create.triggeredByUserId).toBe('gpio_system');

      // Signed OVERRIDE message published on device:<screenId> channel.
      expect(signerService.signMessage).toHaveBeenCalledWith('OVERRIDE', expect.objectContaining({
        type: 'EVACUATE',
        severity: 'HIGH',
        source: 'gpio',
      }));
      expect(redisService.publish).toHaveBeenCalledWith(`device:${SCREEN_ID}`, expect.any(Object));
    });

    it('panic_button dry-contact (high) triggers LOCKDOWN override', async () => {
      const result = await service.handleInputEvent({
        screenId: SCREEN_ID,
        tenantId: TENANT_ID,
        event: { pin: 'in2', state: 'high' },
        config: { wiring: { gpio_in2: 'panic_button' } },
      });

      expect(result.action).toBe('emergency_triggered');
      const upsertCall = prismaService.client.screenEmergencyOverride.upsert.mock.calls[0][0];
      expect(upsertCall.create.type).toBe('LOCKDOWN');
      expect(upsertCall.create.severity).toBe('HIGH');
      expect(upsertCall.create.scopeNote).toContain('panic_button');
    });

    it('unmapped pin → action: logged, no emergency triggered', async () => {
      const result = await service.handleInputEvent({
        screenId: SCREEN_ID,
        tenantId: TENANT_ID,
        event: { pin: 'in1', state: 'edge_rising' },
        config: { wiring: {} }, // no mapping
      });

      expect(result.action).toBe('logged');
      expect(result.overrideId).toBeUndefined();
      expect(prismaService.client.screenEmergencyOverride.upsert).not.toHaveBeenCalled();
      expect(redisService.publish).not.toHaveBeenCalled();
      // Audit row still written.
      expect(prismaService.client.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'gpio.input_event',
            targetId: SCREEN_ID,
            tenantId: TENANT_ID,
          }),
        }),
      );
    });

    it('mapped pin but inactive state (low) → ignored, no override', async () => {
      const result = await service.handleInputEvent({
        screenId: SCREEN_ID,
        tenantId: TENANT_ID,
        event: { pin: 'in1', state: 'low' },
        config: { wiring: { gpio_in1: 'fire_alarm' } },
      });

      expect(result.action).toBe('ignored');
      expect(prismaService.client.screenEmergencyOverride.upsert).not.toHaveBeenCalled();
    });

    it('mapped pin but inactive state (edge_falling) → ignored', async () => {
      const result = await service.handleInputEvent({
        screenId: SCREEN_ID,
        tenantId: TENANT_ID,
        event: { pin: 'in1', state: 'edge_falling' },
        config: { wiring: { gpio_in1: 'panic_button' } },
      });

      expect(result.action).toBe('ignored');
    });

    it('rate-limit: 11th event in 60s → action: rate_limited', async () => {
      const cfg = { wiring: { gpio_in1: 'fire_alarm' } };

      // First N events all accepted (some triggered, some not depending on state).
      // We use 'low' for the first N so we don't fire 10 overrides; the rate
      // map increments on every call regardless of mapping/state — that's the
      // anti-flap guarantee.
      for (let i = 0; i < GPIO_INPUT_RATE_LIMIT; i++) {
        const r = await service.handleInputEvent({
          screenId: SCREEN_ID,
          tenantId: TENANT_ID,
          event: { pin: 'in1', state: 'low' },
          config: cfg,
        });
        expect(r.action).toBe('ignored');
      }

      // The 11th event in the same window — even with active state — is
      // rate-limited.
      const overflow = await service.handleInputEvent({
        screenId: SCREEN_ID,
        tenantId: TENANT_ID,
        event: { pin: 'in1', state: 'edge_rising' },
        config: cfg,
      });
      expect(overflow.action).toBe('rate_limited');
      expect(prismaService.client.screenEmergencyOverride.upsert).not.toHaveBeenCalled();
      expect(redisService.publish).not.toHaveBeenCalled();

      // The audit row for the rate-limited event still exists.
      const rateLimitedAuditCall = prismaService.client.auditLog.create.mock.calls.find(
        (call: any) => JSON.parse(call[0].data.details).result === 'rate_limited',
      );
      expect(rateLimitedAuditCall).toBeDefined();
    });
  });

  // ─── setOutput + driveStatusLampForEmergency ───────────────────

  describe('setOutput', () => {
    it('persists new state and broadcasts signed GPIO_SET', async () => {
      prismaService.client.screen.findUnique.mockResolvedValueOnce({
        id: SCREEN_ID,
        config: { wiring: { gpio_out1: 'status_lamp' }, gpioState: { out1: 'low', out2: 'low' } },
      });

      const result = await service.setOutput({
        screenId: SCREEN_ID,
        tenantId: TENANT_ID,
        pin: 'out1',
        state: 'high',
        userId: 'admin-1',
        source: 'operator',
      });

      expect(result).toEqual({ success: true, previous: 'low', mapping: 'status_lamp' });

      // Screen.update called with the new state in config.gpioState.
      const updateCall = prismaService.client.screen.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe(SCREEN_ID);
      expect(updateCall.data.config.gpioState.out1).toBe('high');
      expect(updateCall.data.config.gpioState.out2).toBe('low');
      expect(typeof updateCall.data.config.gpioState.updatedAt).toBe('string');

      // AuditLog row written with from/to + mapping.
      const auditCall = prismaService.client.auditLog.create.mock.calls[0][0];
      expect(auditCall.data.action).toBe('gpio.output_set');
      expect(auditCall.data.userId).toBe('admin-1');
      const auditDetails = JSON.parse(auditCall.data.details);
      expect(auditDetails).toMatchObject({
        pin: 'out1',
        from: 'low',
        to: 'high',
        mapping: 'status_lamp',
        source: 'operator',
      });

      // Signed GPIO_SET broadcast.
      expect(signerService.signMessage).toHaveBeenCalledWith('GPIO_SET', expect.objectContaining({
        screenId: SCREEN_ID,
        pin: 'out1',
        state: 'high',
        source: 'operator',
      }));
      expect(redisService.publish).toHaveBeenCalledWith(`device:${SCREEN_ID}`, expect.any(Object));
    });
  });

  describe('driveStatusLampForEmergency', () => {
    it('flips every screen with a status_lamp mapping to the requested state', async () => {
      prismaService.client.screen.findMany.mockResolvedValueOnce([
        // wired status_lamp on out1
        { id: 's1', tenantId: TENANT_ID, config: { wiring: { gpio_out1: 'status_lamp' } } },
        // wired status_lamp on out2
        { id: 's2', tenantId: TENANT_ID, config: { wiring: { gpio_out2: 'status_lamp' } } },
        // no wiring → skipped
        { id: 's3', tenantId: TENANT_ID, config: null },
        // wired but to horn (not lamp) → skipped
        { id: 's4', tenantId: TENANT_ID, config: { wiring: { gpio_out1: 'horn' } } },
      ]);

      // setOutput uses screen.findUnique to read the existing row — return
      // the same shape we declared above.
      prismaService.client.screen.findUnique
        .mockResolvedValueOnce({ id: 's1', config: { wiring: { gpio_out1: 'status_lamp' } } })
        .mockResolvedValueOnce({ id: 's2', config: { wiring: { gpio_out2: 'status_lamp' } } });

      const result = await service.driveStatusLampForEmergency({
        tenantId: TENANT_ID,
        state: 'high',
        reason: 'emergency_trigger',
      });

      expect(result.touched).toBe(2); // s1 + s2

      // Two screen.update calls (one per matching screen).
      expect(prismaService.client.screen.update).toHaveBeenCalledTimes(2);

      // Both pins were flipped to high.
      const updateCalls = prismaService.client.screen.update.mock.calls;
      expect(updateCalls[0][0].data.config.gpioState.out1).toBe('high');
      expect(updateCalls[1][0].data.config.gpioState.out2).toBe('high');

      // Two signed GPIO_SET broadcasts (one per touched screen).
      const setBroadcasts = signerService.signMessage.mock.calls.filter((c: any) => c[0] === 'GPIO_SET');
      expect(setBroadcasts).toHaveLength(2);
      for (const call of setBroadcasts) {
        expect(call[1].source).toBe('emergency_auto');
        expect(call[1].state).toBe('high');
      }
    });

    it('does NOT throw if a single screen update fails — emergency path must keep going', async () => {
      prismaService.client.screen.findMany.mockResolvedValueOnce([
        { id: 's1', tenantId: TENANT_ID, config: { wiring: { gpio_out1: 'status_lamp' } } },
        { id: 's2', tenantId: TENANT_ID, config: { wiring: { gpio_out1: 'status_lamp' } } },
      ]);

      // First screen.findUnique succeeds, second one throws.
      prismaService.client.screen.findUnique
        .mockResolvedValueOnce({ id: 's1', config: { wiring: { gpio_out1: 'status_lamp' } } })
        .mockRejectedValueOnce(new Error('db blip'));

      const result = await service.driveStatusLampForEmergency({
        tenantId: TENANT_ID,
        state: 'high',
        reason: 'emergency_trigger',
      });

      // s1 succeeded, s2 failed → touched: 1, but no throw.
      expect(result.touched).toBe(1);
    });

    it('flips lamps back to low on all-clear', async () => {
      prismaService.client.screen.findMany.mockResolvedValueOnce([
        { id: 's1', tenantId: TENANT_ID, config: { wiring: { gpio_out1: 'status_lamp' } } },
      ]);
      prismaService.client.screen.findUnique.mockResolvedValueOnce({
        id: 's1',
        config: { wiring: { gpio_out1: 'status_lamp' }, gpioState: { out1: 'high', out2: 'low' } },
      });

      await service.driveStatusLampForEmergency({
        tenantId: TENANT_ID,
        state: 'low',
        reason: 'emergency_all_clear',
      });

      const updateCall = prismaService.client.screen.update.mock.calls[0][0];
      expect(updateCall.data.config.gpioState.out1).toBe('low');
      // out2 (unrelated) preserved from the persisted row.
      expect(updateCall.data.config.gpioState.out2).toBe('low');
    });
  });
});
