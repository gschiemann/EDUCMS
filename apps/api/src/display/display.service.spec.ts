/**
 * DisplayService unit tests — the safety contract for remotely driving a
 * wall-mounted screen nobody can physically reach.
 *
 * ⚠️ REWRITTEN 2026-08-13 against the LEAD'S CORRECTED CONTRACT. The original
 * suite was internally consistent but encoded a gate the review proved
 * dangerous, so several expectations here are deliberate REVERSALS of what
 * this file used to assert. Do not "restore" them:
 *
 *   C3. BLANK and WAKE are ALWAYS available — the software floor (window
 *       brightness + overlay) cannot fail, so `screenBlank:'none'` names the
 *       absence of a PRIVILEGED mechanism, not the absence of the action.
 *       The old suite asserted BLANK is refused on a bare box; refusing WAKE
 *       on that same verdict left a schedule-blanked panel unrecoverable.
 *   C4. Unknown verdict is FAIL-OPEN FOR RECOVERY, FAIL-CLOSED FOR RISK.
 *       The old suite asserted "supports NOTHING" for all five actions; that
 *       produced a dark screen with no dashboard path back, because the
 *       manifest ships schedules to a never-probed screen regardless.
 *
 * Coverage:
 *   - capability truth-gate: an action the verdict does not support throws
 *     DisplayActionUnsupportedError (→ 409) and NEVER publishes
 *   - WAKE always resolves; BLANK/SET_VOLUME/REBOOT need an observed verdict
 *   - a brightness RAISE is accepted on an unknown verdict; a lower is not
 *   - REBOOT is refused with its own code on today's no-device-owner fleet
 *   - REBOOT writes an AuditLog row under its own greppable action string,
 *     on the dispatch path AND on the refusal path
 *   - MIN_SAFE_BRIGHTNESS floor clamps a remote 0%; `allowBlack` is the only
 *     way past it, is recorded, and REQUIRES a dead-man revert window
 *   - the audit row is written BEFORE the publish, so a Redis outage cannot
 *     lose the record of who asked for what — and `delivered` tells the truth
 *     when the fan-out is down rather than auditing a drop as 'dispatched'
 *   - a capability report writes only the two telemetry-only columns, stores
 *     a BOUNDED document, and audits only when the verdict actually CHANGED
 */

import { Test } from '@nestjs/testing';

import {
  DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT,
  MIN_SAFE_BRIGHTNESS_PERCENT,
} from '@cms/api-types';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import {
  DISPLAY_AUDIT_ACTIONS,
  DisplayActionUnsupportedError,
  DisplayService,
  boundInventoryReport,
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
    redis = {
      publish: jest.fn().mockResolvedValue(true),
      // The real RedisService.publish does NOT throw when Redis is down, so
      // delivery is read off this accessor rather than inferred from the
      // absence of a throw. Default: fan-out up.
      isConnected: jest.fn().mockReturnValue(true),
    };
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
    // Volume is the honest "this box has no such control" case — unlike
    // blank/brightness there is no software floor underneath it.
    await expect(
      apply({
        action: 'SET_VOLUME',
        percent: 40,
        capabilities: stored({ ...BARE_VERDICT, volume: 'none' }),
      }),
    ).rejects.toBeInstanceOf(DisplayActionUnsupportedError);
    expect(redis.publish).not.toHaveBeenCalled();
    expect(signer.signMessage).not.toHaveBeenCalled();
  });

  it('BLANK and WAKE always resolve — screenBlank:none names the mechanism, not the availability (C3)', async () => {
    // THE REVERSAL. A bare box (no device admin, no owner) still blanks and
    // wakes through the software floor. The old contract 409'd WAKE here,
    // which meant a schedule-blanked panel could never be lit from the
    // dashboard — a truck roll on a wall mount.
    const blank = await apply({
      action: 'BLANK',
      capabilities: stored(BARE_VERDICT),
    });
    expect(blank.mechanism).toBe('software-dim');

    const wake = await apply({
      action: 'WAKE',
      capabilities: stored(BARE_VERDICT),
    });
    expect(wake.mechanism).toBe('software-dim');
    expect(redis.publish).toHaveBeenCalledTimes(2);
  });

  it('names the privileged mechanism when the box has one', async () => {
    expect((await apply({ action: 'BLANK' })).mechanism).toBe('device-owner');
    expect(
      (
        await apply({
          action: 'WAKE',
          capabilities: stored({
            ...FULL_VERDICT,
            screenBlank: 'device-admin',
          }),
        })
      ).mechanism,
    ).toBe('device-admin');
  });

  it('refuses REBOOT on a box without device owner, under its OWN code', async () => {
    // NO-DEVICE-OWNER PIVOT: this is the shape of the whole fleet today, so
    // the refusal must read as a product fact an operator can act on, not as
    // a generic "unsupported".
    await expect(
      apply({ action: 'REBOOT', capabilities: stored(BARE_VERDICT) }),
    ).rejects.toMatchObject({ code: 'DISPLAY_REBOOT_UNAVAILABLE' });
    await expect(
      apply({ action: 'REBOOT', capabilities: stored(BARE_VERDICT) }),
    ).rejects.toThrow(/device-owner or platform-signed/i);
    expect(redis.publish).not.toHaveBeenCalled();
  });

  // ── unknown verdict: fail-open for recovery, fail-closed for risk (C4) ──

  it('accepts WAKE on a screen that has never reported — recovery is never refused', async () => {
    const res = await apply({ action: 'WAKE', capabilities: null });
    expect(res.success).toBe(true);
    expect(res.mechanism).toBe('software-dim');
    expect(redis.publish).toHaveBeenCalledWith(
      `device:${SCREEN_ID}`,
      expect.any(Object),
    );
  });

  it('accepts a brightness RAISE on an unknown verdict, and refuses a lower one', async () => {
    const raise = await apply({
      action: 'SET_BRIGHTNESS',
      percent: DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT,
      capabilities: null,
    });
    expect(raise.percent).toBe(DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT);

    await expect(
      apply({
        action: 'SET_BRIGHTNESS',
        percent: DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT - 1,
        capabilities: null,
      }),
    ).rejects.toMatchObject({ code: 'DISPLAY_CAPABILITIES_UNKNOWN' });
  });

  it('still refuses the RISK actions on a screen that has never reported', async () => {
    // BLANK / SET_VOLUME / REBOOT can never light a dark panel, so they stay
    // closed until the hardware has been observed.
    for (const action of ['BLANK', 'SET_VOLUME', 'REBOOT']) {
      await expect(
        apply({ action, percent: 50, capabilities: null }),
      ).rejects.toMatchObject({ code: 'DISPLAY_CAPABILITIES_UNKNOWN' });
    }
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('refuses allowBlack outright on a screen that has never reported', async () => {
    await expect(
      apply({
        action: 'SET_BRIGHTNESS',
        percent: 0,
        allowBlack: true,
        revertAfterMs: 30_000,
        capabilities: null,
      }),
    ).rejects.toMatchObject({ code: 'DISPLAY_CAPABILITIES_UNKNOWN' });
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
      // Unknown ⇒ risk is refused…
      await expect(
        apply({ action: 'BLANK', capabilities: bad }),
      ).rejects.toMatchObject({ code: 'DISPLAY_CAPABILITIES_UNKNOWN' });
      // …but the recovery direction still works, which is the whole point.
      await expect(
        apply({ action: 'WAKE', capabilities: bad }),
      ).resolves.toMatchObject({ success: true });
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
      // Its own code since the no-device-owner pivot — see the REBOOT test
      // above. Was DISPLAY_ACTION_UNSUPPORTED.
      code: 'DISPLAY_REBOOT_UNAVAILABLE',
    });
  });

  it('writes the audit row even when the WS publish throws, and CORRECTS the outcome', async () => {
    redis.publish.mockRejectedValueOnce(new Error('redis down'));
    const res = await apply({ action: 'BLANK' });
    expect(res.delivered).toBe(false);
    expect(res.deliveryReason).toBe('publish_failed');
    expect(res.success).toBe(true); // the decision stands; delivery does not

    // TWO rows: the decision row (written BEFORE the publish so an outage
    // cannot lose it) and a correction row, because AuditLog is append-only.
    // The original suite asserted exactly ONE row here — that assertion held
    // only because a failed publish used to leave 'dispatched' standing in
    // the log for a message that never went out.
    const rows = prisma.client.auditLog.create.mock.calls.map((c: any[]) =>
      JSON.parse(c[0].data.details),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ outcome: 'dispatched', delivered: true });
    expect(rows[1]).toMatchObject({
      outcome: 'undelivered',
      delivered: false,
      deliveryReason: 'publish_failed',
      actionId: res.actionId,
    });
  });

  it('reports delivered:false when the Redis fan-out is DOWN — publish never throws there', async () => {
    // THE LIE THIS KILLS. RedisService.publish takes an `else` branch when
    // Redis is unavailable and hands the envelope to THIS replica's local
    // gateway, resolving normally. A screen socketed to another replica gets
    // nothing, and there is no manifest backstop for immediate actions — so
    // inferring delivery from "did not throw" audited a dropped WAKE as
    // 'dispatched' and left the operator with a green toast and a dark wall.
    redis.isConnected.mockReturnValue(false);
    const res = await apply({ action: 'WAKE' });

    expect(res.delivered).toBe(false);
    expect(res.deliveryReason).toBe('redis_unavailable');
    // Still published — the local fallback may reach a co-resident screen,
    // which beats dropping the message. We just do not claim it.
    expect(redis.publish).toHaveBeenCalledTimes(1);

    const details = JSON.parse(
      prisma.client.auditLog.create.mock.calls[0][0].data.details,
    );
    expect(details).toMatchObject({
      outcome: 'undelivered',
      delivered: false,
      deliveryReason: 'redis_unavailable',
    });
    expect(details.outcome).not.toBe('dispatched');
  });

  it('never claims delivery when the transport cannot be interrogated at all', async () => {
    // Fail-safe default: an absent accessor reports NOT delivered rather
    // than optimistically true.
    delete redis.isConnected;
    const res = await apply({ action: 'WAKE' });
    expect(res.delivered).toBe(false);
    expect(res.deliveryReason).toBe('redis_unavailable');
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

  it('honours an explicit allowBlack that carries a dead-man revert, and records it', async () => {
    const res = await apply({
      action: 'SET_BRIGHTNESS',
      percent: 0,
      allowBlack: true,
      revertAfterMs: 30_000,
    });
    expect(res.percent).toBe(0);
    expect(res.clamped).toBe(false);
    expect(
      JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details),
    ).toMatchObject({ allowBlack: true, revertAfterMs: 30_000 });
  });

  it('REFUSES allowBlack without a dead-man revert — no path may mint a permanent blackout', async () => {
    // The dead-man is the thing that makes allowBlack survivable, and the
    // API is the only place that can enforce the conjunction (the player
    // cannot invent a revert window the operator never sent). Without it a
    // UI bug or a replayed curl produces a permanently black wall-mounted
    // panel whose only recovery is a second successful WS delivery.
    await expect(
      apply({ action: 'SET_BRIGHTNESS', percent: 0, allowBlack: true }),
    ).rejects.toMatchObject({
      code: 'DISPLAY_ALLOW_BLACK_REQUIRES_REVERT',
    });
    expect(redis.publish).not.toHaveBeenCalled();
    expect(signer.signMessage).not.toHaveBeenCalled();
    // …and the attempt is on the record.
    expect(
      JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details),
    ).toMatchObject({
      outcome: 'refused',
      code: 'DISPLAY_ALLOW_BLACK_REQUIRES_REVERT',
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

  it('BOUNDS the persisted document — junk nested under `verdict` is dropped, not stored', async () => {
    // MEASURED BUG (2026-08-13 review). `verdict` was assigned wholesale
    // while `build` was rebuilt field by field, and the schema keeps
    // .passthrough() on both for APK forward-compat — so a paired screen
    // could park megabytes in Screen.displayCapabilities. getManifest reads
    // the FULL screen row live on every 5 s poll, OUTSIDE the hot cache, so
    // that is ~70 GB/day of Supabase egress from one device.
    const junk = 'x'.repeat(200_000);
    const report = normalizeCapabilityReport(
      {
        schema: 1,
        build: { manufacturer: 'Goodview', HUGE: junk },
        verdict: { ...FULL_VERDICT, HUGE: junk, nested: { HUGE: junk } },
        HUGE: junk,
      } as any,
      999,
    );

    expect(Object.keys(report.verdict).sort()).toEqual([
      'brightness',
      'deviceOwnerPath',
      'hardPowerOff',
      'reboot',
      'screenBlank',
      'volume',
    ]);
    expect(JSON.stringify(report).length).toBeLessThan(2_000);
    expect(JSON.stringify(report)).not.toContain(junk.slice(0, 500));
  });

  it('coerces an unknown mechanism to the LEAST capable value, never a permissive one', async () => {
    const report = normalizeCapabilityReport(
      {
        verdict: {
          volume: 'telepathy',
          brightness: 'laser',
          screenBlank: 'device-owner-ish',
          reboot: 'sudo',
          hardPowerOff: 'axe',
          deviceOwnerPath: 'yes',
        },
      } as any,
      1,
    );
    expect(report.verdict).toEqual({
      volume: 'none',
      brightness: 'software-dim',
      screenBlank: 'none',
      reboot: 'none',
      hardPowerOff: 'none',
      deviceOwnerPath: 'provisionable-after-factory-reset',
    });
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

describe('boundInventoryReport — bounded by construction, never by trust', () => {
  it('keeps the recipe-authoring sections and drops everything else', () => {
    const out = boundInventoryReport({
      schema: 1,
      verdict: { volume: 'audiomanager' },
      build: { model: 'M43GUQ' },
      admin: { deviceOwnerPackage: 'com.gv.mdm', deviceOwnerDetected: true },
      vendorPackages: { enumerable: true, visibleCount: 41, candidates: ['com.gv.powerctl'] },
      settingsKeys: { power_on_time: '07:00', power_off_time: '22:00' },
      serial: { devNodes: [{ path: '/dev/ttyS4', readable: true, writable: true }] },
      totallyUnknownSection: { huge: 'thing' },
    });
    expect(out).not.toBeNull();
    expect((out as any).admin.deviceOwnerPackage).toBe('com.gv.mdm');
    expect((out as any).vendorPackages.candidates).toEqual(['com.gv.powerctl']);
    expect((out as any).settingsKeys.power_on_time).toBe('07:00');
    expect((out as any).serial.devNodes[0].path).toBe('/dev/ttyS4');
    // The verdict/build already live on the Screen row; unknown sections are
    // never stored at all.
    expect(out).not.toHaveProperty('verdict');
    expect(out).not.toHaveProperty('build');
    expect(out).not.toHaveProperty('totallyUnknownSection');
  });

  it('returns null when no known section is present (browser player, bare verdict)', () => {
    expect(boundInventoryReport({ schema: 1, verdict: {} })).toBeNull();
    expect(boundInventoryReport(null)).toBeNull();
    expect(boundInventoryReport('not an object')).toBeNull();
    expect(boundInventoryReport([1, 2, 3])).toBeNull();
  });

  it('caps a hostile body: long strings, wide arrays, deep nesting, key floods', () => {
    const hostile = {
      settingsKeys: Object.fromEntries(
        Array.from({ length: 500 }, (_, i) => [`key_${i}`, 'x'.repeat(10_000)]),
      ),
      vendorPackages: {
        candidates: Array.from({ length: 5_000 }, (_, i) => `com.evil.pkg${i}`),
      },
      power: { a: { b: { c: { d: { e: { f: { g: 'too deep' } } } } } } },
    };
    const out = boundInventoryReport(hostile) as any;
    expect(out).not.toBeNull();
    expect(Object.keys(out.settingsKeys).length).toBeLessThanOrEqual(64);
    expect(out.settingsKeys.key_0.length).toBeLessThanOrEqual(200);
    expect(out.vendorPackages.candidates.length).toBeLessThanOrEqual(64);
    // Depth cap: the too-deep leaf is gone, the structure above survives.
    expect(JSON.stringify(out.power)).not.toContain('too deep');
    // The whole document respects the byte ceiling with margin.
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(32 * 1024);
  });

  it('a 4MB junk payload can never store more than the ceiling', () => {
    const junk: Record<string, unknown> = {};
    for (const section of ['admin', 'settingsKeys', 'features', 'displays', 'serial']) {
      junk[section] = Object.fromEntries(
        Array.from({ length: 64 }, (_, i) => [`k${i}`, 'y'.repeat(200)]),
      );
    }
    const out = boundInventoryReport(junk);
    expect(out).not.toBeNull();
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(32 * 1024);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Field incident, 2026-08-25 (G43) — BLANK via device-admin on a panel whose
// device OWNER is another app latched the vendor firmware into panel standby
// (glass dark, LED blinking, power button dead) while Android stayed online;
// WAKE delivered and could not reverse it. An action whose undo provably
// fails on a hardware class is refused outright on that class.
// ─────────────────────────────────────────────────────────────────────────
describe('foreign-owner admin-lock guard (G43 incident)', () => {
  const G43_VERDICT = {
    volume: 'audiomanager',
    brightness: 'settings',
    screenBlank: 'device-admin',
    reboot: 'none',
    hardPowerOff: 'serial-candidate',
    deviceOwnerPath: 'blocked-other-owner',
  };
  let service: DisplayService;
  let prisma: any;
  let redis: any;
  let signer: any;
  beforeEach(async () => {
    redis = { publish: jest.fn().mockResolvedValue(true), isConnected: jest.fn().mockReturnValue(true) };
    signer = { signMessage: jest.fn().mockImplementation((type: string, payload: any) => ({ type, payload, eventId: 'evt-1', timestamp: Date.now(), signature: 'sig' })) };
    prisma = { client: { screen: { update: jest.fn().mockResolvedValue({}) }, auditLog: { create: jest.fn().mockResolvedValue({}) } } };
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
      capabilities: stored(G43_VERDICT),
      ...over,
    } as any);

  it('REFUSES BLANK: device-admin mechanism + foreign owner → 409 code, no publish, forensic audit row', async () => {
    await expect(apply()).rejects.toMatchObject({
      code: 'DISPLAY_BLANK_ADMIN_LOCK_FOREIGN_OWNER',
    });
    expect(redis.publish).not.toHaveBeenCalled();
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(
      JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details),
    ).toMatchObject({
      outcome: 'refused',
      code: 'DISPLAY_BLANK_ADMIN_LOCK_FOREIGN_OWNER',
      mechanism: 'device-admin',
      deviceOwnerPath: 'blocked-other-owner',
    });
  });

  it('WAKE on the same panel stays available — recovery is never gated', async () => {
    await expect(apply({ action: 'WAKE' })).resolves.toBeDefined();
    expect(redis.publish).toHaveBeenCalled();
  });

  it('device-admin blank with OUR OWN owner path held is NOT refused (the lock is reversible there)', async () => {
    await expect(
      apply({ capabilities: stored({ ...G43_VERDICT, deviceOwnerPath: 'held' }) }),
    ).resolves.toBeDefined();
  });

  it('vendor-recipe blank on a foreign-owner panel is NOT refused (mechanism, not ownership, is the hazard)', async () => {
    await expect(
      apply({ capabilities: stored({ ...G43_VERDICT, screenBlank: 'vendor-recipe' }) }),
    ).resolves.toBeDefined();
  });
});
