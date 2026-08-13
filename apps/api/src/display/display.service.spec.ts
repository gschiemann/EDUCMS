/**
 * DisplayService unit tests — the safety contract for remotely driving a
 * wall-mounted screen nobody can physically reach.
 *
 * Coverage:
 *   - capability truth-gate: an action the verdict does not support throws
 *     DisplayActionUnsupportedError (→ 409) and NEVER publishes
 *   - a screen that has never reported supports NOTHING (no optimistic fire)
 *   - REBOOT writes an AuditLog row under its own greppable action string,
 *     on the dispatch path AND on the refusal path
 *   - MIN_SAFE_BRIGHTNESS floor clamps a remote 0%, and `allowBlack` is the
 *     only way past it (and is recorded)
 *   - the audit row is written BEFORE the publish, so a Redis outage cannot
 *     lose the record of who asked for what
 *   - a capability report writes only the two telemetry-only columns, and
 *     audits only when the verdict actually CHANGED
 */

import { Test } from '@nestjs/testing';

import { MIN_SAFE_BRIGHTNESS_PERCENT } from '@cms/api-types';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import {
  DISPLAY_AUDIT_ACTIONS,
  DisplayActionUnsupportedError,
  DisplayService,
  normalizeCapabilityReport,
  verdictChanged,
  verdictFromStored,
} from './display.service';

const SCREEN_ID = 'screen-1';
const TENANT_ID = 'tenant-1';
const USER_ID = 'user-1';

/** A box with everything: writable backlight node + device owner. */
const FULL_VERDICT = {
  volume: 'audiomanager',
  brightness: 'sysfs',
  screenBlank: 'device-owner',
  reboot: 'device-owner',
  hardPowerOff: 'serial-candidate',
  deviceOwnerPath: 'held',
};

/** The realistic floor: no admin, no owner, composition-only dimming. */
const BARE_VERDICT = {
  volume: 'audiomanager',
  brightness: 'software-dim',
  screenBlank: 'none',
  reboot: 'none',
  hardPowerOff: 'none',
  deviceOwnerPath: 'provisionable-after-factory-reset',
};

const stored = (verdict: Record<string, string>) => ({
  schema: 1,
  probedAt: 1,
  reportedAt: 2,
  build: { manufacturer: 'Goodview', model: 'EP6N' },
  verdict,
});

describe('DisplayService', () => {
  let service: DisplayService;
  let prisma: any;
  let redis: any;
  let signer: any;

  beforeEach(async () => {
    redis = { publish: jest.fn().mockResolvedValue(true) };
    signer = {
      signMessage: jest
        .fn()
        .mockImplementation((type: string, payload: any) => ({
          type,
          payload,
          eventId: 'evt-1',
          timestamp: Date.now(),
          signature: 'sig',
        })),
    };
    prisma = {
      client: {
        screen: { update: jest.fn().mockResolvedValue({}) },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DisplayService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: WebsocketSignerService, useValue: signer },
      ],
    }).compile();

    service = moduleRef.get(DisplayService);
  });

  const apply = (over: Record<string, unknown> = {}) =>
    service.applyAction({
      screenId: SCREEN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      action: 'BLANK',
      capabilities: stored(FULL_VERDICT),
      ...over,
    } as any);

  // ── capability truth-gate ────────────────────────────────────────────

  it('refuses an action the reported verdict does not support, and never publishes', async () => {
    await expect(
      apply({ action: 'BLANK', capabilities: stored(BARE_VERDICT) }),
    ).rejects.toBeInstanceOf(DisplayActionUnsupportedError);
    expect(redis.publish).not.toHaveBeenCalled();
    expect(signer.signMessage).not.toHaveBeenCalled();
  });

  it('refuses REBOOT on a box without device owner — there is no fallback', async () => {
    await expect(
      apply({ action: 'REBOOT', capabilities: stored(BARE_VERDICT) }),
    ).rejects.toMatchObject({ code: 'DISPLAY_ACTION_UNSUPPORTED' });
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('supports NOTHING on a screen that has never reported — no optimistic fire', async () => {
    for (const action of [
      'SET_VOLUME',
      'SET_BRIGHTNESS',
      'BLANK',
      'WAKE',
      'REBOOT',
    ]) {
      await expect(
        apply({ action, percent: 50, capabilities: null }),
      ).rejects.toMatchObject({
        code: 'DISPLAY_CAPABILITIES_UNKNOWN',
      });
    }
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('treats a malformed capability document as unknown rather than permissive', async () => {
    for (const bad of [
      'nonsense',
      42,
      [],
      { verdict: 'yes' },
      { verdict: { volume: 1 } },
    ]) {
      expect(verdictFromStored(bad)).toBeNull();
      await expect(
        apply({ action: 'WAKE', capabilities: bad }),
      ).rejects.toMatchObject({
        code: 'DISPLAY_CAPABILITIES_UNKNOWN',
      });
    }
  });

  it('dispatches a supported action on device:<screenId> with the resolved mechanism', async () => {
    const res = await apply({ action: 'BLANK' });
    expect(res.success).toBe(true);
    expect(res.mechanism).toBe('device-owner');
    expect(res.delivered).toBe(true);
    expect(signer.signMessage).toHaveBeenCalledWith(
      'DISPLAY_CONTROL',
      expect.objectContaining({ screenId: SCREEN_ID, action: 'BLANK' }),
    );
    expect(redis.publish).toHaveBeenCalledWith(
      `device:${SCREEN_ID}`,
      expect.any(Object),
    );
  });

  // ── audit ────────────────────────────────────────────────────────────

  it('audits REBOOT under its own action string, with the actor and the mechanism', async () => {
    const res = await apply({ action: 'REBOOT' });
    const rows = prisma.client.auditLog.create.mock.calls.map(
      (c: any[]) => c[0].data,
    );
    const reboot = rows.find(
      (r: any) => r.action === DISPLAY_AUDIT_ACTIONS.REBOOT,
    );
    expect(reboot).toBeDefined();
    expect(reboot.targetType).toBe('screen');
    expect(reboot.targetId).toBe(SCREEN_ID);
    expect(reboot.tenantId).toBe(TENANT_ID);
    expect(reboot.userId).toBe(USER_ID);
    const details = JSON.parse(reboot.details);
    expect(details).toMatchObject({
      requested: 'REBOOT',
      outcome: 'dispatched',
      actionId: res.actionId,
      mechanism: 'device-owner',
    });
    // …and it is NOT filed under the generic control action, so
    // "who rebooted that screen" stays a one-line grep.
    expect(
      rows.some((r: any) => r.action === DISPLAY_AUDIT_ACTIONS.CONTROL),
    ).toBe(false);
  });

  it('audits a REFUSED reboot too — the attempt is the forensic signal', async () => {
    await expect(
      apply({ action: 'REBOOT', capabilities: stored(BARE_VERDICT) }),
    ).rejects.toBeInstanceOf(DisplayActionUnsupportedError);
    const row = prisma.client.auditLog.create.mock.calls[0][0].data;
    expect(row.action).toBe(DISPLAY_AUDIT_ACTIONS.REBOOT);
    expect(JSON.parse(row.details)).toMatchObject({
      outcome: 'refused',
      code: 'DISPLAY_ACTION_UNSUPPORTED',
    });
  });

  it('writes the audit row even when the WS publish fails', async () => {
    redis.publish.mockRejectedValueOnce(new Error('redis down'));
    const res = await apply({ action: 'BLANK' });
    expect(res.delivered).toBe(false);
    expect(res.success).toBe(true); // the local scheduler + poll are the backstop
    expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(1);
  });

  // ── brightness floor ─────────────────────────────────────────────────

  it('clamps a remote 0% brightness to the safety floor — a black screen is a truck roll', async () => {
    const res = await apply({ action: 'SET_BRIGHTNESS', percent: 0 });
    expect(res.percent).toBe(MIN_SAFE_BRIGHTNESS_PERCENT);
    expect(res.clamped).toBe(true);
    expect(signer.signMessage.mock.calls[0][1].percent).toBe(
      MIN_SAFE_BRIGHTNESS_PERCENT,
    );
    expect(
      JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details),
    ).toMatchObject({
      requestedPercent: 0,
      appliedPercent: MIN_SAFE_BRIGHTNESS_PERCENT,
      clamped: true,
    });
  });

  it('honours an explicit allowBlack, and records that it was used', async () => {
    const res = await apply({
      action: 'SET_BRIGHTNESS',
      percent: 0,
      allowBlack: true,
    });
    expect(res.percent).toBe(0);
    expect(res.clamped).toBe(false);
    expect(
      JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details),
    ).toMatchObject({
      allowBlack: true,
    });
  });

  it('leaves a value at or above the floor untouched, and never clamps volume', async () => {
    expect(
      (await apply({ action: 'SET_BRIGHTNESS', percent: 5 })).percent,
    ).toBe(5);
    expect(
      (await apply({ action: 'SET_BRIGHTNESS', percent: 80 })).clamped,
    ).toBe(false);
    // Volume 0 = mute, which is recoverable from the dashboard. Not clamped.
    expect((await apply({ action: 'SET_VOLUME', percent: 0 })).percent).toBe(0);
  });

  it('carries the dead-man revert window through to the device message', async () => {
    const res = await apply({ action: 'BLANK', revertAfterMs: 30_000 });
    expect(res.revertAfterMs).toBe(30_000);
    expect(signer.signMessage.mock.calls[0][1].revertAfterMs).toBe(30_000);
  });

  // ── capability report ────────────────────────────────────────────────

  it('persists ONLY the two telemetry-only columns on a capability report', async () => {
    const report = normalizeCapabilityReport(
      {
        schema: 1,
        probedAt: 111,
        build: { manufacturer: 'TCL' },
        verdict: FULL_VERDICT,
      } as any,
      999,
    );
    await service.recordCapabilities({
      screenId: SCREEN_ID,
      tenantId: TENANT_ID,
      previous: null,
      report,
    });
    const data = prisma.client.screen.update.mock.calls[0][0].data;
    // If this ever grows a third key, SCREEN_TELEMETRY_ONLY_FIELDS no longer
    // covers the write and every capability report starts busting the
    // manifest hot cache fleet-wide (the 25 GB/mo egress bug).
    expect(Object.keys(data).sort()).toEqual([
      'displayCapabilities',
      'displayCapabilitiesAt',
    ]);
  });

  it('audits a capability report only when the verdict actually changed', async () => {
    const report = normalizeCapabilityReport(
      { verdict: FULL_VERDICT } as any,
      1,
    );

    const first = await service.recordCapabilities({
      screenId: SCREEN_ID,
      tenantId: TENANT_ID,
      previous: null,
      report,
    });
    expect(first.changed).toBe(true);
    expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.client.auditLog.create.mock.calls[0][0].data.action).toBe(
      DISPLAY_AUDIT_ACTIONS.CAPABILITIES,
    );

    // Same verdict on the next boot → no new row. A report per boot is normal
    // traffic; an audit row per boot would bury the signal we want.
    const again = await service.recordCapabilities({
      screenId: SCREEN_ID,
      tenantId: TENANT_ID,
      previous: stored(FULL_VERDICT),
      report,
    });
    expect(again.changed).toBe(false);
    expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('detects the regressions worth alerting on (lost device owner, lost sysfs)', () => {
    expect(verdictChanged(FULL_VERDICT as any, FULL_VERDICT as any)).toBe(
      false,
    );
    expect(verdictChanged(FULL_VERDICT as any, BARE_VERDICT as any)).toBe(true);
    expect(
      verdictChanged(
        FULL_VERDICT as any,
        { ...FULL_VERDICT, reboot: 'none' } as any,
      ),
    ).toBe(true);
    expect(verdictChanged(null, BARE_VERDICT as any)).toBe(true);
  });
});
