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
 * ⚠️ AMENDED AGAIN 2026-08-25 — THE BLANK/POWER SPLIT. Several BLANK
 * expectations here are deliberate reversals of what this file asserted
 * TWELVE DAYS ago, and of what it asserted earlier the SAME NIGHT:
 *
 *   • BLANK/WAKE no longer resolve a hardware mechanism. Both answer
 *     `mechanism: 'web-overlay'` on every verdict AND on none, because the
 *     player's own page draws the black — there is no device call left.
 *   • BLANK is therefore no longer a fail-closed risk action on an unknown
 *     verdict. POWER_OFF took that seat.
 *   • The four "foreign-owner admin-lock guard (G43)" specs are GONE, with
 *     the reasoning recorded at the block that replaced them.
 *
 * What did NOT change, and must not: the emergency interlock (both
 * directions), the allowBlack dead-man requirement, and every audit-row
 * expectation.
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
  DISPLAY_BRIGHTNESS_MECHANISMS,
  DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT,
  MIN_SAFE_BRIGHTNESS_PERCENT,
  isBrightnessMechanismProven,
  displayActionSupport,
} from '@cms/api-types';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import {
  DISPLAY_AUDIT_ACTIONS,
  PUSH_SOCKET_FRESH_MS,
  DisplayActionUnsupportedError,
  DisplayService,
  boundInventoryReport,
  hasFreshPushSocket,
  isDarkeningAction,
  normalizeCapabilityReport,
  verdictChanged,
  verdictFromStored,
} from './display.service';

/**
 * Partial mocks — only the two invalidation entry points are replaced, so
 * everything else in these modules keeps its real behaviour. `jest.mock` is
 * hoisted above the imports, which is why the handles below are resolved
 * lazily rather than captured here.
 */
jest.mock('../screens/manifest-hot-cache', () => ({
  ...jest.requireActual('../screens/manifest-hot-cache'),
  invalidateManifestCache: jest.fn(),
}));
jest.mock('./display-manifest', () => ({
  ...jest.requireActual('./display-manifest'),
  invalidateDisplayManifestBlock: jest.fn(),
}));

const hotCache = jest.requireMock('../screens/manifest-hot-cache') as {
  invalidateManifestCache: jest.Mock;
};
const blockCache = jest.requireMock('./display-manifest') as {
  invalidateDisplayManifestBlock: jest.Mock;
};

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

/**
 * The panel at the centre of the 2026-08-25 incident: an Android device-admin
 * lock as the ONLY hard blank path, another app holding device owner, and a
 * serial port nobody has proven. The Mobile A-Frame that latched the same way
 * differs from this only in `deviceOwnerPath` — which is precisely why the
 * first, shape-based guard did not protect it.
 */
const G43_VERDICT = {
  volume: 'audiomanager',
  brightness: 'settings',
  screenBlank: 'device-admin',
  reboot: 'none',
  hardPowerOff: 'serial-candidate',
  deviceOwnerPath: 'blocked-other-owner',
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
    hotCache.invalidateManifestCache.mockReset();
    blockCache.invalidateDisplayManifestBlock.mockReset();
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
      // A HEALTHY screen by default (2026-08-25): `delivered` now requires
      // BOTH a live fan-out AND a fresh push socket for this screen, so the
      // baseline fixture has to represent a panel with a live WS/SSE
      // channel — otherwise every case in this file would silently be
      // testing the poll-only path. The grading matrix itself is pinned in
      // its own describe block below.
      lastPushConnectedAt: new Date(),
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

  it('BLANK and WAKE always resolve — and are SOFT on every verdict (C3, 2026-08-25)', async () => {
    // THE REVERSAL, twice over. First (2026-08-13): a bare box still blanks
    // and wakes; the old contract 409'd WAKE here, so a schedule-blanked
    // panel could never be lit from the dashboard. Second (2026-08-25): the
    // mechanism is no longer read from the verdict AT ALL — both verbs
    // resolve to the web overlay, on every model.
    const blank = await apply({
      action: 'BLANK',
      capabilities: stored(BARE_VERDICT),
    });
    expect(blank.mechanism).toBe('web-overlay');

    const wake = await apply({
      action: 'WAKE',
      capabilities: stored(BARE_VERDICT),
    });
    expect(wake.mechanism).toBe('web-overlay');
    expect(redis.publish).toHaveBeenCalledTimes(2);
  });

  it('names the privileged mechanism for the POWER pair — that is where hardware went', async () => {
    expect(
      (
        await apply({
          action: 'POWER_OFF',
          capabilities: stored({ ...FULL_VERDICT, screenBlank: 'vendor-recipe' }),
        })
      ).mechanism,
    ).toBe('vendor-recipe');
    expect(
      (
        await apply({
          action: 'POWER_ON',
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
    // 'web-overlay' since the 2026-08-25 split (was 'software-dim').
    expect(res.mechanism).toBe('web-overlay');
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
    // POWER_OFF / SET_VOLUME / REBOOT all reach real hardware and can never
    // light a dark panel, so they stay closed until it has been observed.
    // BLANK is deliberately NOT in this list any more (2026-08-25): it is a
    // black div in our own page, so there is no unobserved hardware to
    // fail-close against — see the soft-blank matrix below.
    for (const action of ['POWER_OFF', 'SET_VOLUME', 'REBOOT']) {
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
      // Unknown ⇒ HARDWARE risk is refused…
      await expect(
        apply({ action: 'POWER_OFF', capabilities: bad }),
      ).rejects.toMatchObject({ code: 'DISPLAY_CAPABILITIES_UNKNOWN' });
      // …but the recovery direction still works, which is the whole point.
      await expect(
        apply({ action: 'WAKE', capabilities: bad }),
      ).resolves.toMatchObject({ success: true });
      // …and the SOFT blank works too — a malformed document cannot make a
      // black overlay in our own page any riskier than it already is.
      await expect(
        apply({ action: 'BLANK', capabilities: bad }),
      ).resolves.toMatchObject({ success: true, mechanism: 'web-overlay' });
    }
  });

  it('dispatches a supported action on device:<screenId> with the resolved mechanism', async () => {
    const res = await apply({ action: 'BLANK' });
    expect(res.success).toBe(true);
    expect(res.mechanism).toBe('web-overlay');
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

  // ── per-screen push-socket grading (2026-08-25) ──────────────────────
  //
  // THE SECOND LIE. `fanoutUp` is a fact about the SERVER; it proves a
  // published message can cross replicas and proves NOTHING about whether
  // this screen has a socket on any of them. A panel on the HTTP-poll tier
  // receives no DISPLAY_CONTROL frame at all — and nothing replays it, since
  // the manifest carries schedules only — yet the dashboard reported
  // `delivered:true` and painted the green "sent" row. These pin the full
  // matrix: socket fresh / stale / never, crossed with the fan-out.

  it('FRESH push socket + fan-out up → delivered:true (the healthy panel)', async () => {
    const res = await apply({
      action: 'WAKE',
      lastPushConnectedAt: new Date(Date.now() - 9_000), // the live 8-17s shape
    });
    expect(res.delivered).toBe(true);
    expect(res.deliveryReason).toBeNull();
  });

  it('STALE push socket (> 10 min) → delivered:false / no_push_socket', async () => {
    // The poll-only dongle. Fan-out is up, publish resolves, and no screen
    // is listening on device:<id>. Reporting this as a delivery is the exact
    // "the dashboard lied to me" failure.
    const res = await apply({
      action: 'WAKE',
      lastPushConnectedAt: new Date(Date.now() - PUSH_SOCKET_FRESH_MS - 1_000),
    });
    expect(res.delivered).toBe(false);
    expect(res.deliveryReason).toBe('no_push_socket');
    // STILL PUBLISHED — behaviour is unchanged, only the verdict is honest.
    // If the screen reconnects mid-flight it may yet catch the frame; we
    // simply do not claim it.
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });

  it('NEVER-stamped push socket → delivered:false / no_push_socket', async () => {
    // null is not "unknown, assume fine" — stamping is server-side and
    // universal (WS gateway + SSE service), so on this deployment a null
    // means the screen has never held a push channel.
    const res = await apply({ action: 'WAKE', lastPushConnectedAt: null });
    expect(res.delivered).toBe(false);
    expect(res.deliveryReason).toBe('no_push_socket');
  });

  it('an OMITTED lastPushConnectedAt is fail-safe, not optimistic', async () => {
    const res = await service.applyAction({
      screenId: SCREEN_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      action: 'WAKE',
      capabilities: stored(FULL_VERDICT),
    } as any);
    expect(res.delivered).toBe(false);
    expect(res.deliveryReason).toBe('no_push_socket');
  });

  it('a DEAD fan-out outranks a dead socket — the bigger failure is the headline', async () => {
    redis.isConnected.mockReturnValue(false);
    const res = await apply({ action: 'WAKE', lastPushConnectedAt: null });
    expect(res.delivered).toBe(false);
    expect(res.deliveryReason).toBe('redis_unavailable');
  });

  it('audits the EVIDENCE behind an undelivered verdict, not just the verdict', async () => {
    const at = new Date(Date.now() - 30 * 60_000);
    await apply({ action: 'WAKE', lastPushConnectedAt: at });
    const details = JSON.parse(
      prisma.client.auditLog.create.mock.calls[0][0].data.details,
    );
    expect(details).toMatchObject({
      outcome: 'undelivered',
      delivered: false,
      deliveryReason: 'no_push_socket',
      fanoutUp: true,
      pushConnectedAt: at.toISOString(),
    });
  });

  describe('hasFreshPushSocket', () => {
    const NOW = 1_700_000_000_000;

    it('grades fresh / stale exactly at the 10-minute boundary', () => {
      expect(hasFreshPushSocket(new Date(NOW - 1_000), NOW)).toBe(true);
      expect(
        hasFreshPushSocket(new Date(NOW - PUSH_SOCKET_FRESH_MS + 1), NOW),
      ).toBe(true);
      // The boundary itself is stale — `<`, not `<=`.
      expect(hasFreshPushSocket(new Date(NOW - PUSH_SOCKET_FRESH_MS), NOW)).toBe(
        false,
      );
    });

    it('accepts the shapes a Prisma row / JSON payload can actually carry', () => {
      expect(hasFreshPushSocket(new Date(NOW - 1_000).toISOString(), NOW)).toBe(true);
      expect(hasFreshPushSocket(NOW - 1_000, NOW)).toBe(true);
    });

    it('treats null / undefined / garbage as NO socket', () => {
      expect(hasFreshPushSocket(null, NOW)).toBe(false);
      expect(hasFreshPushSocket(undefined, NOW)).toBe(false);
      expect(hasFreshPushSocket('not-a-date', NOW)).toBe(false);
    });

    it('stays pinned to the number the rest of the product uses', () => {
      // ScreenWedgeDetectorCron.PUSH_STALE_MS and the fleet list's
      // pushChannel derivation both use 10 min. A delivery verdict that
      // disagreed with the "poll-only" chip on the same row is its own lie.
      expect(PUSH_SOCKET_FRESH_MS).toBe(10 * 60_000);
    });
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

  // ── verdict change → targeted manifest invalidation (2026-08-25) ──────
  // The manifest's `display` block now routes a screen's on/off windows onto
  // the HARD or SOFT array from this verdict, so a change to it is content
  // for that one screen. It stays on SCREEN_TELEMETRY_ONLY_FIELDS (off it,
  // every boot report bumps the process-wide rev = the 25 GB/mo egress), and
  // this narrow invalidation covers the gap instead.
  describe('verdict change invalidates THAT screen’s manifest, and only then', () => {
    const reportWith = (verdict: any) =>
      normalizeCapabilityReport({ schema: 1, verdict } as any, 999);

    const record = (previous: unknown, verdict: any) =>
      service.recordCapabilities({
        screenId: SCREEN_ID,
        tenantId: TENANT_ID,
        previous,
        report: reportWith(verdict),
      });

    it('invalidates on a CHANGED verdict', async () => {
      const { changed } = await record(
        { verdict: { ...FULL_VERDICT, screenBlank: 'vendor-recipe' } },
        FULL_VERDICT,
      );
      expect(changed).toBe(true);
      expect(hotCache.invalidateManifestCache).toHaveBeenCalledWith(SCREEN_ID);
      expect(blockCache.invalidateDisplayManifestBlock).toHaveBeenCalledWith(
        SCREEN_ID,
      );
    });

    it('invalidates on the FIRST report — null → a verdict is a change', async () => {
      const { changed } = await record(null, FULL_VERDICT);
      expect(changed).toBe(true);
      expect(hotCache.invalidateManifestCache).toHaveBeenCalledWith(SCREEN_ID);
    });

    it('invalidates NOTHING on an identical re-report — the morning power-on wave', async () => {
      // This is the case that must stay free. A fleet re-reporting the same
      // verdict on boot has to cost zero cache churn or the egress bug the
      // hot cache exists to prevent comes straight back.
      const { changed } = await record({ verdict: FULL_VERDICT }, FULL_VERDICT);
      expect(changed).toBe(false);
      expect(hotCache.invalidateManifestCache).not.toHaveBeenCalled();
      expect(blockCache.invalidateDisplayManifestBlock).not.toHaveBeenCalled();
    });

    it('never lets an invalidation failure lose the verdict write', async () => {
      // Belt and braces on a wall-mounted screen: the row is the durable
      // record, the cache is an optimisation. Losing the former to protect
      // the latter would be exactly backwards.
      hotCache.invalidateManifestCache.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      await expect(record(null, FULL_VERDICT)).resolves.toEqual({
        changed: true,
      });
      expect(prisma.client.screen.update).toHaveBeenCalled();
    });
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

  // ── THE v1.1.5 EVIDENCE WAVE (2026-08-25) ────────────────────────────
  //
  // Three sections were added for the wide rollout. Each one exists to end
  // a specific question the server previously could not answer about a
  // panel nobody is standing next to, so each one gets a spec that says so.

  it('keeps per-command outcomes — the ONLY record that a mechanism did anything', () => {
    // THE FAILURE THIS ENDS: `delivered:true` has only ever meant "the
    // fan-out was up". A mechanism that reported success and moved nothing
    // (a Settings brightness write on a read-only-backlight panel) was
    // indistinguishable from one that worked, and the evidence died in a
    // console on a wall-mounted kiosk.
    const out = boundInventoryReport({
      verdict: { brightness: 'settings' },
      commandOutcomes: [
        {
          actionId: 'act-1',
          action: 'SET_BRIGHTNESS',
          via: 'WS',
          at: '2026-08-25T12:00:00.000Z',
          status: 'device',
          mechanism: 'settings',
          applied: true,
          changed: false,
          evidence: { before: { settings: { screen_brightness: 200 } }, after: { settings: { screen_brightness: 200 } } },
        },
      ],
    }) as any;
    expect(out).not.toBeNull();
    expect(out.commandOutcomes).toHaveLength(1);
    expect(out.commandOutcomes[0].actionId).toBe('act-1');
    expect(out.commandOutcomes[0].mechanism).toBe('settings');
    // `applied: true` with `changed: false` IS the silent no-op. Both
    // fields have to survive bounding or the pair means nothing.
    expect(out.commandOutcomes[0].applied).toBe(true);
    expect(out.commandOutcomes[0].changed).toBe(false);
  });

  it('keeps the app + setup sections (silent-update readiness, ceremony result)', () => {
    const out = boundInventoryReport({
      app: {
        installerOfRecord: 'com.educms.player',
        selfIsInstallerOfRecord: true,
        silentUpdateArmed: true,
        sdkInt: 33,
      },
      setup: {
        granted: 3,
        required: 4,
        complete: false,
        steps: [{ key: 'writeSettingsPromptShown', held: false, launch: 'fallback' }],
      },
    }) as any;
    expect(out).not.toBeNull();
    // "will this panel's next OTA need a tap?" — answerable without a cable.
    expect(out.app.silentUpdateArmed).toBe(true);
    expect(out.app.installerOfRecord).toBe('com.educms.player');
    // "did the installer finish, and which vendor page could not be found?"
    expect(out.setup.complete).toBe(false);
    expect(out.setup.steps[0].launch).toBe('fallback');
  });

  it('keeps command outcomes even when the document has to be trimmed', () => {
    // Sections are dropped from the BACK of INVENTORY_SECTIONS, and
    // `commandOutcomes` sits at the FRONT on purpose: losing it re-creates
    // the exact blindness the wave exists to end.
    const fat: Record<string, unknown> = {
      commandOutcomes: [{ actionId: 'act-keep', mechanism: 'sysfs-backlight', applied: true }],
    };
    for (const section of ['admin', 'brightness', 'backlightNodes', 'settingsKeys', 'features', 'displays', 'serial', 'control', 'power', 'vendorPackages', 'app', 'setup']) {
      fat[section] = Object.fromEntries(
        Array.from({ length: 64 }, (_, i) => [`k${i}`, 'y'.repeat(200)]),
      );
    }
    const out = boundInventoryReport(fat) as any;
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(32 * 1024);
    expect(out.commandOutcomes[0].actionId).toBe('act-keep');
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

// ═════════════════════════════════════════════════════════════════════════
// THE BLANK / POWER SPLIT — field incident night, 2026-08-25
//
// Operator contract, verbatim: "wake and blank should just do that and turn
// on and off should do that, keep them separate and make them work perfectly
// on all our models."
//
// ⚠️ THIS BLOCK REPLACES the four "foreign-owner admin-lock guard (G43)"
// specs written earlier the same night. Do NOT restore them. That guard
// refused BLANK on exactly one verdict shape (device-admin +
// blocked-other-owner) — and the Mobile A-Frame latched with an IDENTICAL
// verdict to an L55VEC that recovered, so the shape was never the
// discriminator. The A-Frame then woke itself back up minutes later with
// nothing sent to it, proving the standby is a VENDOR TIMER: unreliable in
// both directions, un-predictable from anything we probe.
//
// What replaces it: BLANK stops touching hardware on every model, and the
// hardware lives behind POWER_OFF / POWER_ON on a proven-only allowlist.
// ═════════════════════════════════════════════════════════════════════════
describe('BLANK / WAKE — soft, universal, unbrickable by construction', () => {
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
      // Healthy panel baseline — see the note on the delivery-suite helper.
      lastPushConnectedAt: new Date(),
      ...over,
    } as any);
  /** The signed payload published for the Nth publish (default: the first). */
  const published = (n = 0) => signer.signMessage.mock.calls[n][1];

  it.each([
    ['device-admin (the G43 / A-frame class)', 'device-admin'],
    ['vendor-recipe (the TC22 class)', 'vendor-recipe'],
    ['screen-timeout', 'screen-timeout'],
    ['software-dim (the M43 class)', 'software-dim'],
    ['device-owner (legacy)', 'device-owner'],
    ['none', 'none'],
  ])('BLANK dispatches SOFT on verdict %s', async (_label, screenBlank) => {
    const res = await apply({ capabilities: stored({ ...G43_VERDICT, screenBlank }) });
    expect(res.mechanism).toBe('web-overlay');
    expect(res.action).toBe('BLANK');
    expect(redis.publish).toHaveBeenCalledWith(`device:${SCREEN_ID}`, expect.any(Object));
    // THE FRAME SHAPE. `soft:true` is the single field that keeps this out of
    // the APK bridge; without it the player forwards it and device-admin
    // fires — the whole incident.
    expect(published()).toMatchObject({
      action: 'BLANK',
      mechanism: 'web-overlay',
      soft: true,
    });
    expect(published()).not.toHaveProperty('hard');
  });

  it('BLANK dispatches SOFT on a screen that has never reported, and on junk', async () => {
    for (const capabilities of [null, undefined, 'nonsense', { verdict: 'yes' }]) {
      redis.publish.mockClear();
      signer.signMessage.mockClear();
      const res = await apply({ capabilities });
      expect(res.mechanism).toBe('web-overlay');
      expect(published()).toMatchObject({ soft: true });
    }
  });

  it('WAKE dispatches SOFT on every verdict, always', async () => {
    for (const screenBlank of ['device-admin', 'vendor-recipe', 'software-dim', 'none']) {
      signer.signMessage.mockClear();
      const res = await apply({
        action: 'WAKE',
        capabilities: stored({ ...G43_VERDICT, screenBlank }),
      });
      expect(res.mechanism).toBe('web-overlay');
      expect(published()).toMatchObject({ action: 'WAKE', soft: true });
    }
  });

  it('audits the soft blank with the real action AND the web-overlay mechanism', async () => {
    await apply();
    const row = JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details);
    expect(row).toMatchObject({
      requested: 'BLANK',
      outcome: 'dispatched',
      mechanism: 'web-overlay',
    });
  });

  it('STILL refuses BLANK during an emergency hold — the interlock is untouched', async () => {
    await expect(
      apply({ emergencyHold: { active: true, source: 'tenant' } }),
    ).rejects.toMatchObject({ code: 'DISPLAY_EMERGENCY_HOLD' });
    expect(redis.publish).not.toHaveBeenCalled();
    expect(
      JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details),
    ).toMatchObject({ outcome: 'refused', code: 'DISPLAY_EMERGENCY_HOLD' });
  });

  it('but WAKE during an emergency hold still dispatches — recovery is never gated', async () => {
    await expect(
      apply({ action: 'WAKE', emergencyHold: { active: true, source: 'tenant' } }),
    ).resolves.toMatchObject({ success: true });
    expect(redis.publish).toHaveBeenCalled();
  });

  it('the superseded foreign-owner guard is GONE — the G43 shape blanks softly now', async () => {
    // The exact verdict that was refused with
    // DISPLAY_BLANK_ADMIN_LOCK_FOREIGN_OWNER hours earlier. It dispatches,
    // because what it dispatches can no longer reach the panel.
    const res = await apply({
      capabilities: stored({
        ...G43_VERDICT,
        screenBlank: 'device-admin',
        deviceOwnerPath: 'blocked-other-owner',
      }),
    });
    expect(res.mechanism).toBe('web-overlay');
    expect(published()).toMatchObject({ soft: true });
  });
});

describe('POWER_OFF / POWER_ON — hardware, proven-only, legacy-frame translated', () => {
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
      action: 'POWER_OFF',
      capabilities: stored({ ...G43_VERDICT, screenBlank: 'vendor-recipe' }),
      // Healthy panel baseline — see the note on the delivery-suite helper.
      lastPushConnectedAt: new Date(),
      ...over,
    } as any);
  const published = (n = 0) => signer.signMessage.mock.calls[n][1];

  it('vendor-recipe POWER_OFF dispatches as a LEGACY "BLANK" frame with hard:true', async () => {
    const res = await apply();
    // The API answer names the REAL action…
    expect(res).toMatchObject({ action: 'POWER_OFF', mechanism: 'vendor-recipe' });
    // …while the WIRE carries the only verb a shipped APK understands.
    // Sending 'POWER_OFF' verbatim would be silently unrecognised on every
    // screen in the fleet; `hard:true` is the extra key old APKs ignore
    // (org.json opt*) and the new web layer keys off.
    expect(published()).toMatchObject({
      screenId: SCREEN_ID,
      action: 'BLANK',
      mechanism: 'vendor-recipe',
      hard: true,
    });
    expect(published()).not.toHaveProperty('soft');
  });

  it('POWER_ON dispatches as a LEGACY "WAKE" frame with hard:true', async () => {
    const res = await apply({ action: 'POWER_ON' });
    expect(res).toMatchObject({ action: 'POWER_ON' });
    expect(published()).toMatchObject({ action: 'WAKE', hard: true });
    expect(published()).not.toHaveProperty('soft');
  });

  it('audits POWER_OFF under the REAL requested action, not the wire verb', async () => {
    await apply();
    const row = JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details);
    expect(row).toMatchObject({
      requested: 'POWER_OFF',
      outcome: 'dispatched',
      mechanism: 'vendor-recipe',
    });
  });

  it.each([
    ['device-admin — the A-frame / G43 / L55VEC class', 'device-admin'],
    ['device-owner — the same admin-lock family', 'device-owner'],
  ])('REFUSES POWER_OFF on %s with BLANK_MECHANISM_UNPROVEN', async (_l, screenBlank) => {
    await expect(
      apply({ capabilities: stored({ ...G43_VERDICT, screenBlank }) }),
    ).rejects.toMatchObject({ code: 'DISPLAY_BLANK_MECHANISM_UNPROVEN' });
    expect(redis.publish).not.toHaveBeenCalled();
    expect(signer.signMessage).not.toHaveBeenCalled();
    expect(
      JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details),
    ).toMatchObject({
      requested: 'POWER_OFF',
      outcome: 'refused',
      code: 'DISPLAY_BLANK_MECHANISM_UNPROVEN',
    });
  });

  it('the unproven refusal names the BOTH-DIRECTIONS evidence, not just the latch', async () => {
    // The A-frame woke ITSELF minutes after latching. If the copy only says
    // "it will not come back", the next operator reads a self-recovered panel
    // as proof the guard is wrong and asks for it to be removed.
    await expect(
      apply({ capabilities: stored({ ...G43_VERDICT, screenBlank: 'device-admin' }) }),
    ).rejects.toThrow(/both directions/i);
    await expect(
      apply({ capabilities: stored({ ...G43_VERDICT, screenBlank: 'device-admin' }) }),
    ).rejects.toThrow(/woke itself back up/i);
  });

  it.each([['software-dim'], ['screen-timeout'], ['none']])(
    'POWER_OFF on %s is UNSUPPORTED — there is no panel power path at all',
    async (screenBlank) => {
      await expect(
        apply({ capabilities: stored({ ...G43_VERDICT, screenBlank }) }),
      ).rejects.toMatchObject({ code: 'DISPLAY_ACTION_UNSUPPORTED' });
      expect(redis.publish).not.toHaveBeenCalled();
    },
  );

  it('POWER_OFF on a screen that has never reported is refused as UNKNOWN', async () => {
    await expect(apply({ capabilities: null })).rejects.toMatchObject({
      code: 'DISPLAY_CAPABILITIES_UNKNOWN',
    });
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('POWER_ON is NEVER refused on the unproven code — it is the recovery direction', async () => {
    // A panel already dark (an earlier hard blank, a vendor timer, someone's
    // remote) must always have a dashboard path back, on every verdict and
    // on none at all. Exactly the asymmetry WAKE has always had.
    for (const capabilities of [
      stored({ ...G43_VERDICT, screenBlank: 'device-admin' }),
      stored({ ...G43_VERDICT, screenBlank: 'device-owner' }),
      stored({ ...G43_VERDICT, screenBlank: 'software-dim' }),
      stored({ ...G43_VERDICT, screenBlank: 'none' }),
      null,
    ]) {
      signer.signMessage.mockClear();
      await expect(apply({ action: 'POWER_ON', capabilities })).resolves.toMatchObject({
        success: true,
        action: 'POWER_ON',
      });
      expect(published()).toMatchObject({ action: 'WAKE', hard: true });
    }
  });

  it('POWER_OFF is a DARKENING action, so the emergency interlock covers it', async () => {
    // isDarkeningAction is what makes the CONTROLLER resolve emergency state
    // at all. A darkening verb missing from it does not skip a check — it
    // never reads whether a lockdown is on the glass.
    expect(isDarkeningAction('POWER_OFF', {})).toBe(true);
    expect(isDarkeningAction('POWER_ON', {})).toBe(false);
    await expect(
      apply({ emergencyHold: { active: true, source: 'screen' } }),
    ).rejects.toMatchObject({ code: 'DISPLAY_EMERGENCY_HOLD' });
    expect(redis.publish).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// THE BRIGHTNESS SPLIT — same field night, same failure shape
//
// The operator's brightness slider worked on two panels and was dead on two.
// Each panel's OWN hardware probe (ScreenDeviceInventory.report) says why:
//
//   M43      /sys/class/backlight/aml-bl     writable:true  → sysfs-backlight
//   L55VEC   /sys/class/backlight/aml-bl     writable:true  → sysfs-backlight
//   G43      /sys/class/backlight/aml-bl     writable:false → settings
//   A-Frame  /sys/class/backlight/backlight  writable:false → settings
//
// All four report canWriteSettings:true, and the `settings` write genuinely
// SUCCEEDS — G43's stored screen_brightness reads 102, not 255. The vendor
// firmware simply ignores it for the real backlight. A mechanism that reports
// success and does nothing to the glass: the blank incident's signature.
//
// So brightness routes the way blank does — PROVEN mechanisms keep driving
// hardware untouched, everything else goes SOFT and the player dims its own
// picture. What must NOT move: the clamp, the MIN_SAFE floor, allowBlack's
// dead-man requirement, and the emergency interlock. Those are asserted here
// ON THE SOFT PATH specifically, because a routing change that quietly
// bypassed one of them would be far worse than a dead slider.
// ═════════════════════════════════════════════════════════════════════════
describe('SET_BRIGHTNESS — proven mechanisms drive hardware, the rest dim softly', () => {
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
      action: 'SET_BRIGHTNESS',
      percent: 40,
      capabilities: stored(G43_VERDICT),
      // A LIVE push socket by default. This block tests brightness ROUTING
      // (which mechanism drove the glass), not delivery grading — and since
      // 2026-08-25 an absent `lastPushConnectedAt` correctly grades as
      // `undelivered` (a screen with no live channel cannot receive an
      // instant command). Without this the routing assertions would be
      // measuring the delivery dimension by accident. Delivery grading has
      // its own dedicated matrix above.
      lastPushConnectedAt: new Date(),
      ...over,
    } as any);

  const published = (n = 0) => signer.signMessage.mock.calls[n][1];
  const auditRow = (n = 0) =>
    JSON.parse(prisma.client.auditLog.create.mock.calls[n][0].data.details);

  const withBrightness = (brightness: string) => stored({ ...G43_VERDICT, brightness });

  // ── THE ROUTING MATRIX ────────────────────────────────────────────────

  it.each([
    ['vendor-recipe — a named-node write, validated percent-derived', 'vendor-recipe'],
    ['sysfs-backlight — M43 / L55VEC, writable aml-bl', 'sysfs-backlight'],
    ['sysfs — the same thing in the probe heuristic spelling', 'sysfs'],
    ['software-dim — the APK\'s own window dimmer owns the stored level (LED Poster 1, 2026-09-02)', 'software-dim'],
  ])('dispatches HARD on %s — nothing changes for the panels that work', async (_l, brightness) => {
    const res = await apply({ capabilities: withBrightness(brightness) });
    expect(res.mechanism).toBe(brightness);
    expect(published()).toMatchObject({
      action: 'SET_BRIGHTNESS',
      percent: 40,
      mechanism: brightness,
    });
    // The absence of `soft` is what keeps this on the APK's backlight path.
    expect(published()).not.toHaveProperty('soft');
    expect(published()).not.toHaveProperty('hard');
  });

  it.each([
    ['settings — G43 / A-Frame, write succeeds and the glass does not move', 'settings'],
  ])('dispatches SOFT on %s', async (_l, brightness) => {
    const res = await apply({ capabilities: withBrightness(brightness) });
    expect(res.mechanism).toBe('software-dim');
    expect(published()).toMatchObject({
      action: 'SET_BRIGHTNESS',
      percent: 40,
      mechanism: 'software-dim',
      soft: true,
    });
    expect(published()).not.toHaveProperty('hard');
  });

  it('covers every mechanism in the contract — a new one is a gap, not a default', () => {
    // If a provider id is added to DISPLAY_BRIGHTNESS_MECHANISMS without a
    // decision about whether it actually moves a backlight, this fails
    // rather than silently assuming it does.
    const routed = Object.fromEntries(
      DISPLAY_BRIGHTNESS_MECHANISMS.map((m) => [m, isBrightnessMechanismProven(m)]),
    );
    expect(routed).toEqual({
      'vendor-recipe': true,
      'sysfs-backlight': true,
      sysfs: true,
      settings: false,
      // The APK's own window dimmer: reversible on every ROM and the owner of
      // the persisted level a reboot restores — the soft overlay could never
      // reach it (LED Poster 1 stuck at 5%, 2026-09-02).
      'software-dim': true,
      // NovaStar Taurus LED, 2026-09-02. `-pending` means "this poster's
      // brightness is NovaStar's own layer and the player has no client for
      // it", so nothing is driven and the soft overlay is the only thing
      // that paints. `novastar-sdk` is the eventual real client and stays
      // unproven until a supervised on-glass test on a real TB unit.
      'novastar-sdk-pending': false,
      'novastar-sdk': false,
    });
  });

  it.each([
    ['novastar-sdk-pending — a Taurus poster whose LED layer we cannot reach', 'novastar-sdk-pending'],
    ['novastar-sdk — the real client, not yet proven on glass', 'novastar-sdk'],
  ])('dispatches SOFT on %s', async (_l, brightness) => {
    const res = await apply({ capabilities: withBrightness(brightness) });
    expect(res.mechanism).toBe('software-dim');
    expect(published()).toMatchObject({
      action: 'SET_BRIGHTNESS',
      percent: 40,
      mechanism: 'software-dim',
      soft: true,
    });
    // The panel's own claim is still recorded — that is the fact the
    // incident night needed and could not answer.
    expect(auditRow()).toMatchObject({ reportedMechanism: brightness, softDim: true });
  });

  it('dispatches SOFT on a screen that has never reported', async () => {
    // The unknown-verdict branch resolves 'software-dim', which is unproven
    // by construction — we have observed nothing about this hardware, so the
    // path that provably paints something is the honest one.
    const res = await apply({
      capabilities: null,
      percent: DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT,
    });
    expect(res.mechanism).toBe('software-dim');
    expect(published()).toMatchObject({ soft: true });
  });

  // ── THE AUDIT TRAIL STAYS HONEST ──────────────────────────────────────

  it('audits the mechanism that ACTUALLY drove the glass, plus what the panel claimed', async () => {
    await apply();
    expect(auditRow()).toMatchObject({
      requested: 'SET_BRIGHTNESS',
      outcome: 'dispatched',
      // What we did…
      mechanism: 'software-dim',
      softDim: true,
      // …and what this panel reported it had. Both, because the incident
      // night needed exactly these two facts and could answer neither.
      reportedMechanism: 'settings',
      appliedPercent: 40,
    });
  });

  it('leaves a HARD row exactly as it was — no new keys on the working panels', async () => {
    await apply({ capabilities: withBrightness('sysfs-backlight') });
    const row = auditRow();
    expect(row).toMatchObject({ mechanism: 'sysfs-backlight' });
    expect(row).not.toHaveProperty('softDim');
    expect(row).not.toHaveProperty('reportedMechanism');
  });

  // ── THE SAFETY PROPERTIES THE ROUTING MUST NOT MOVE ───────────────────

  it('still clamps to the MIN_SAFE floor on the soft path', async () => {
    const res = await apply({ percent: 0 });
    expect(res.percent).toBe(MIN_SAFE_BRIGHTNESS_PERCENT);
    expect(res.clamped).toBe(true);
    expect(published()).toMatchObject({
      percent: MIN_SAFE_BRIGHTNESS_PERCENT,
      soft: true,
    });
  });

  it('still refuses allowBlack without a dead-man revert on the soft path', async () => {
    await expect(apply({ percent: 0, allowBlack: true })).rejects.toMatchObject({
      code: 'DISPLAY_ALLOW_BLACK_REQUIRES_REVERT',
    });
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('still refuses a darkening brightness under the emergency interlock', async () => {
    // The interlock runs BEFORE the routing decision and is untouched by it.
    // A soft dim is gentler than a backlight drop, but an alert with a black
    // film over it is still an alert someone might not read.
    await expect(
      apply({ percent: 10, emergencyHold: { active: true, source: 'screen' } }),
    ).rejects.toMatchObject({ code: 'DISPLAY_EMERGENCY_HOLD' });
    expect(redis.publish).not.toHaveBeenCalled();
    expect(auditRow()).toMatchObject({ outcome: 'refused', requested: 'SET_BRIGHTNESS' });
  });

  it('still refuses a DARKENING request on an unreported screen', async () => {
    // C4 is unchanged: we do not darken hardware we have never observed,
    // soft path or not.
    await expect(
      apply({ capabilities: null, percent: DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT - 1 }),
    ).rejects.toMatchObject({ code: 'DISPLAY_CAPABILITIES_UNKNOWN' });
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('keeps SET_BRIGHTNESS out of the BLANK/POWER translation', async () => {
    // POWER_OFF/POWER_ON are rewritten onto the legacy verbs for the
    // five-verb APKs. Brightness is already one of those five, so it must
    // ride as itself — a translated brightness would be unparseable.
    await apply();
    expect(published()).toMatchObject({ action: 'SET_BRIGHTNESS' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// OPEN_SETUP — the one verb on this endpoint that touches no hardware
// (2026-08-25, v1.1.6).
//
// Operator, first install on v1.1.5: *"it popped up with the config page but
// after you do the first 4 requirements it just launched so i didnt get to
// even do the optional ones at all and have no way to know how to pull those
// up again"*. The only re-entry was an adb action — useless at a wall-mounted
// panel. This verb is the dashboard route back, and it reuses this endpoint
// precisely so it inherits the RBAC, the throttle, the AuditLog row, the
// signed per-screen fan-out and the delivery honesty that already exist here.
//
// What these tests pin is that reusing the endpoint did NOT make it a display
// action: no verdict gate, no percent, no revert, no soft/hard flag, no
// translation — and, load-bearing, it must never be treated as darkening.
// ─────────────────────────────────────────────────────────────────────
describe('OPEN_SETUP — rides the display transport, drives no display', () => {
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
      action: 'OPEN_SETUP',
      capabilities: null,
      lastPushConnectedAt: new Date(),
      ...over,
    } as any);
  const published = (n = 0) => signer.signMessage.mock.calls[n][1];

  it('is accepted on a screen that has NEVER reported — the only screens that need it', () => {
    // THE POINT. A brand-new panel is exactly the population with unfinished
    // grants AND no capability verdict. Gating this on a verdict would make
    // it useless on the one screen it exists for.
    expect(displayActionSupport('OPEN_SETUP', null)).toEqual({
      supported: true,
      mechanism: 'setup-checklist',
    });
  });

  it('is never gated on any verdict, on any hardware', () => {
    for (const screenBlank of ['device-admin', 'vendor-recipe', 'software-dim', 'none']) {
      expect(
        displayActionSupport('OPEN_SETUP', { ...G43_VERDICT, screenBlank } as any).supported,
      ).toBe(true);
    }
  });

  it('publishes an untranslated frame with no percent, no revert, no soft/hard', async () => {
    const res = await apply();
    expect(res.action).toBe('OPEN_SETUP');
    expect(res.mechanism).toBe('setup-checklist');
    expect(res.percent).toBeNull();
    expect(res.revertAfterMs).toBeNull();
    expect(redis.publish).toHaveBeenCalledWith(`device:${SCREEN_ID}`, expect.any(Object));
    const frame = published();
    // Untranslated: unlike POWER_OFF/POWER_ON this does NOT ride a legacy
    // verb, because it never reaches the APK's five-verb display surface.
    expect(frame.action).toBe('OPEN_SETUP');
    expect(frame).not.toHaveProperty('soft');
    expect(frame).not.toHaveProperty('hard');
  });

  it('is NEVER a darkening action, so it cannot be refused by the emergency hold', () => {
    // ⚠️ The device owns this interlock instead: SetupCeremony refuses to put
    // the checklist over a live emergency, and dispatchDisplayControl drops
    // the frame client-side when an alert is displayed. The SERVER must not
    // treat "an operator is finishing setup" as a reason to read emergency
    // state, or a lockdown-time setup tap would 409 for no reason.
    expect(isDarkeningAction('OPEN_SETUP' as any, {})).toBe(false);
  });

  it('writes an audit row naming the real verb', async () => {
    await apply();
    expect(prisma.client.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          details: expect.stringContaining('OPEN_SETUP'),
        }),
      }),
    );
  });

  it('reports delivered:false honestly on a poll-only panel', async () => {
    // Same rule every other action lives by: `delivered` means a live push
    // socket existed, never that the panel acted. The dashboard renders this
    // as "queued", not as success.
    const res = await apply({ lastPushConnectedAt: null });
    expect(res.delivered).toBe(false);
    expect(res.deliveryReason).toBe('no_push_socket');
  });
});

