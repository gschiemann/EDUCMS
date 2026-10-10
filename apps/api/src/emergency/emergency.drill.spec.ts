/**
 * EMERGENCY DRILLS — end to end against the real controller + manifest
 * (2026-10-10). Same stateful world as emergency.targeting.spec.ts.
 *
 * What this proves, in the owner's words ("drills where different content
 * plays vs a live emergency", "live and drill section in settings", "an easy
 * switch to flip between drill and live"):
 *
 *   1. a drill is delivered like the real thing — signed push, manifest
 *      `isEmergency: true` (the only field the native panel-off watch reads,
 *      so a drill WAKES a sleeping panel), the revision moves, the raise
 *      descriptor rides — and every one of those carries `isDrill: true`;
 *   2. a drill plays the type's DRILL content, and falls back to the LIVE
 *      content when none is set (or the drill bucket is empty) — still a drill;
 *   3. a LIVE alert always wins: it replaces a running drill at the same
 *      scope and takes the glass from a drill underneath it;
 *   4. a drill is REFUSED (409, plain words) wherever a live alert is active —
 *      tenant-wide, on a screen in its scope, or inherited from the district —
 *      and a refused drill reaches no screen;
 *   5. a drill all-clear ends ONLY the drill (a school that went live under a
 *      district drill stays live) and is audited under its own action;
 *   6. the LIVE path is byte-for-byte what it was: no `isDrill` key on the
 *      signed payload, `TRIGGER_EMERGENCY` / `CLEAR_EMERGENCY` audit actions.
 */

import { ConflictException } from '@nestjs/common';
import { TriggerEmergencyInputSchema } from '@cms/api-types';
import { invalidateTenantState, resetManifestCacheForTests } from '../screens/manifest-hot-cache';
import { localTenantEmergencyEpoch, resetEmergencyRevForTests } from '../screens/emergency-rev';
import {
  DISTRICT, SCHOOL, SIBLING, OTHER, GYM,
  SCHOOL_IDS, makeWorld, schoolAdmin, districtAdmin,
  clear, emergencyMap, only,
} from './emergency.targeting.world';
import { DRILL_BLOCKED_CODE, DRILL_CLEAR_ACTION, DRILL_TRIGGER_ACTION } from './emergency-drill';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

type Scope = 'tenant' | 'group' | 'device';
const drill = (scopeType: Scope, scopeId: string, type = 'lockdown', extra: Record<string, unknown> = {}) =>
  ({ scopeType, scopeId, overridePayload: { type, severity: 'CRITICAL', isDrill: true, ...extra } }) as any;
const live = (scopeType: Scope, scopeId: string, type = 'lockdown', extra: Record<string, unknown> = {}) =>
  ({ scopeType, scopeId, overridePayload: { type, severity: 'CRITICAL', ...extra } }) as any;

async function drillMap(w: ReturnType<typeof makeWorld>, ids: string[]) {
  const out: Record<string, boolean | null> = {};
  for (const id of ids) {
    const m = await w.manifest(id);
    out[id] = m?.isEmergency === true ? m.isDrill === true : null;
  }
  return out;
}

beforeEach(() => {
  resetManifestCacheForTests();
  resetEmergencyRevForTests('origin-drill');
  for (const id of [DISTRICT, SCHOOL, SIBLING, OTHER]) invalidateTenantState(id);
});

describe('the request shape', () => {
  it('accepts isDrill: true and rejects anything that is not a boolean', () => {
    const base = { scopeType: 'tenant', scopeId: 't', overridePayload: { type: 'lockdown' } };
    expect(TriggerEmergencyInputSchema.safeParse(base).success).toBe(true);
    expect(TriggerEmergencyInputSchema.safeParse({ ...base, overridePayload: { type: 'lockdown', isDrill: true } }).success).toBe(true);
    expect(TriggerEmergencyInputSchema.safeParse({ ...base, overridePayload: { type: 'lockdown', isDrill: 'true' } }).success).toBe(false);
    expect(TriggerEmergencyInputSchema.safeParse({ ...base, overridePayload: { type: 'lockdown', isDrill: 1 } }).success).toBe(false);
  });
});

describe('1. a tenant-wide drill is delivered like the real thing, marked as a drill', () => {
  it('push + manifest + revision all say drill; the native watch field is still isEmergency:true', async () => {
    const w = makeWorld();
    const signed: any[] = [];
    (w.emergency as any).signer.signMessage.mockImplementation((type: string, payload: any) => {
      signed.push({ type, payload });
      return { type, payload, signature: 'sig', timestamp: Date.now() };
    });

    const res: any = await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'lockdown', { textBlob: 'Gym to the field' }), schoolAdmin);
    expect(res).toMatchObject({ success: true, isDrill: true });

    // push: the signed OVERRIDE carries isDrill and the prefixed text
    const override = signed.find((m) => m.type === 'OVERRIDE');
    expect(override.payload.isDrill).toBe(true);
    expect(override.payload.textBlob).toBe('DRILL — Gym to the field');
    expect(w.published).toEqual([`tenant:${SCHOOL}`]);

    // revision: the raise descriptor carries isDrill (read BEFORE this
    // screen's manifest build records the alert — it rides only until then)
    expect(localTenantEmergencyEpoch(SCHOOL)?.active).toBe(true);
    expect(localTenantEmergencyEpoch(SCHOOL)?.alert).toMatchObject({ type: 'lockdown', isDrill: true });
    const r = await w.rev('gym-1');
    expect(r.alert).toMatchObject({ isDrill: true });

    // manifest: every school screen is in an emergency (native wake) AND a drill
    expect(await emergencyMap(w)).toEqual(only(SCHOOL_IDS));
    expect(await drillMap(w, SCHOOL_IDS)).toEqual(Object.fromEntries(SCHOOL_IDS.map((id) => [id, true])));
    const m = await w.manifest('gym-1');
    expect(m.emergencyType).toBe('LOCKDOWN');
    // the system-default board says so in words, for an old player bundle
    expect(m.playlists[0].template.zones[0].defaultConfig.content).toMatch(/^DRILL — THIS IS A DRILL/);
    expect(m.playlists[0].template.bgColor).not.toBe('#dc2626');

    // state + audit
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyStatus: 'CRITICAL', emergencyIsDrill: true });
    const t = w.auditLogs.find((a) => a.action === DRILL_TRIGGER_ACTION);
    expect(t).toMatchObject({ targetType: 'tenant', targetId: SCHOOL, userId: 'u-school' });
    expect(JSON.parse(t!.details)).toMatchObject({ isDrill: true, type: 'LOCKDOWN', contentSource: 'live' });
    expect(w.auditLogs.some((a) => a.action === 'TRIGGER_EMERGENCY')).toBe(false);

    // all-clear ends it under its own action
    const cleared: any = await w.emergency.clearEmergency(res.overrideId, clear('tenant', SCHOOL), schoolAdmin);
    expect(cleared).toMatchObject({ success: true, isDrill: true });
    expect(await emergencyMap(w)).toEqual(only([]));
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyStatus: 'INACTIVE', emergencyIsDrill: false });
    const c = w.auditLogs.find((a) => a.action === DRILL_CLEAR_ACTION);
    expect(c).toMatchObject({ targetType: 'tenant', targetId: SCHOOL });
    expect(JSON.parse(c!.details).isDrill).toBe(true);
    expect(w.auditLogs.some((a) => a.action === 'CLEAR_EMERGENCY')).toBe(false);
  });

  it('a group drill marks exactly its screens as a drill, and its all-clear ends only it', async () => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(drill('group', GYM), schoolAdmin);
    expect(res.success).toBe(true);
    expect(await emergencyMap(w)).toEqual(only(['gym-1', 'gym-2']));
    expect(await drillMap(w, ['gym-1', 'gym-2'])).toEqual({ 'gym-1': true, 'gym-2': true });
    expect(w.overrides.get('gym-1')).toMatchObject({ isDrill: true, alertId: res.overrideId });
    expect(w.auditLogs.find((a) => a.action === DRILL_TRIGGER_ACTION)).toMatchObject({ targetType: 'group', targetId: GYM });

    const cleared: any = await w.emergency.clearEmergency(res.overrideId, clear('group', GYM), schoolAdmin);
    expect(cleared).toMatchObject({ success: true, isDrill: true });
    expect(await emergencyMap(w)).toEqual(only([]));
    expect(w.auditLogs.find((a) => a.action === DRILL_CLEAR_ACTION)).toMatchObject({ targetType: 'group', targetId: GYM });
  });
});

describe('2. drill content: the DRILL playlists, else the LIVE ones', () => {
  it('plays the drill playlist when it has items, per orientation', async () => {
    const w = makeWorld();
    w.addPlaylist('live-ld', SCHOOL, 2);
    w.addPlaylist('live-ld-p', SCHOOL, 1);
    w.addPlaylist('drill-ld', SCHOOL, 3);
    w.addPlaylist('drill-ld-p', SCHOOL, 1);
    Object.assign(w.tenants.get(SCHOOL)!, {
      panicLockdownPlaylistId: 'live-ld',
      panicLockdownPortraitPlaylistId: 'live-ld-p',
      drillLockdownPlaylistId: 'drill-ld',
      drillLockdownPortraitPlaylistId: 'drill-ld-p',
    });

    const res: any = await w.emergency.triggerEmergency(drill('tenant', SCHOOL), schoolAdmin);
    expect(res.success).toBe(true);
    expect(w.tenants.get(SCHOOL)).toMatchObject({
      emergencyPlaylistId: 'drill-ld',
      emergencyPortraitPlaylistId: 'drill-ld-p',
      emergencyIsDrill: true,
    });
    expect((await w.manifest('gym-1')).playlists[0].id).toBe('drill-ld'); // landscape
    expect((await w.manifest('gym-2')).playlists[0].id).toBe('drill-ld-p'); // portrait
    expect(JSON.parse(w.auditLogs.find((a) => a.action === DRILL_TRIGGER_ACTION)!.details).contentSource).toBe('drill');
  });

  it('falls back to the LIVE playlist when no drill content is set — and is still a drill', async () => {
    const w = makeWorld();
    w.addPlaylist('live-ld', SCHOOL, 2);
    Object.assign(w.tenants.get(SCHOOL)!, { panicLockdownPlaylistId: 'live-ld' });

    await w.emergency.triggerEmergency(drill('tenant', SCHOOL), schoolAdmin);
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyPlaylistId: 'live-ld', emergencyIsDrill: true });
    const m = await w.manifest('gym-1');
    expect(m.playlists[0].id).toBe('live-ld');
    expect(m.isDrill).toBe(true);
  });

  it('an EMPTY drill bucket (lazily created by the settings tab) falls back to live content too', async () => {
    const w = makeWorld();
    w.addPlaylist('live-ld', SCHOOL, 2);
    w.addPlaylist('drill-ld', SCHOOL, 0);
    Object.assign(w.tenants.get(SCHOOL)!, { panicLockdownPlaylistId: 'live-ld', drillLockdownPlaylistId: 'drill-ld' });

    await w.emergency.triggerEmergency(drill('tenant', SCHOOL), schoolAdmin);
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyPlaylistId: 'live-ld', emergencyIsDrill: true });
    expect((await w.manifest('gym-1')).playlists[0].id).toBe('live-ld');
  });

  it('a group drill uses drill content for its screens', async () => {
    const w = makeWorld();
    w.addPlaylist('live-ld', SCHOOL, 2);
    w.addPlaylist('drill-ld', SCHOOL, 1);
    Object.assign(w.tenants.get(SCHOOL)!, { panicLockdownPlaylistId: 'live-ld', drillLockdownPlaylistId: 'drill-ld' });
    await w.emergency.triggerEmergency(drill('group', GYM), schoolAdmin);
    expect(w.overrides.get('gym-1')).toMatchObject({ playlistId: 'drill-ld', isDrill: true });
    expect((await w.manifest('gym-1')).playlists[0].id).toBe('drill-ld');
  });
});

describe('3. a LIVE alert always overrides a drill', () => {
  it('a live tenant alert replaces a running tenant drill', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyType: 'HOLD', emergencyIsDrill: true });

    const res: any = await w.emergency.triggerEmergency(live('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(res).toMatchObject({ success: true, isDrill: false });
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyType: 'LOCKDOWN', emergencyIsDrill: false });
    expect(await drillMap(w, SCHOOL_IDS)).toEqual(Object.fromEntries(SCHOOL_IDS.map((id) => [id, false])));
    expect(w.auditLogs.filter((a) => a.action === 'TRIGGER_EMERGENCY')).toHaveLength(1);
  });

  it('a live group alert takes the glass from a tenant drill on its screens; the rest stay in the drill', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    const res: any = await w.emergency.triggerEmergency(live('group', GYM, 'lockdown'), schoolAdmin);
    expect(res.success).toBe(true);
    expect(await drillMap(w, SCHOOL_IDS)).toEqual({
      'gym-1': false, 'gym-2': false, lobby: true, office: true, front: true, back: true,
    });
    expect((await w.manifest('gym-1')).emergencyType).toBe('LOCKDOWN');
    expect((await w.manifest('lobby')).emergencyType).toBe('HOLD');
  });

  it('a live alert on the same group replaces the group drill (never stacks under it)', async () => {
    const w = makeWorld();
    const d: any = await w.emergency.triggerEmergency(drill('group', GYM, 'hold'), schoolAdmin);
    await w.emergency.triggerEmergency(live('group', GYM, 'lockdown'), schoolAdmin);
    const row = w.overrides.get('gym-1')!;
    expect(row).toMatchObject({ type: 'LOCKDOWN', isDrill: false });
    expect((row.displaced ?? []).some((e: any) => e.alertId === d.overrideId)).toBe(false);
  });
});

describe('4. a drill is refused while a live alert is active where it would reach', () => {
  const expectRefused = async (w: ReturnType<typeof makeWorld>, body: any, who: any) => {
    const publishedBefore = w.published.length;
    const auditBefore = w.auditLogs.length;
    await expect(w.emergency.triggerEmergency(body, who)).rejects.toThrow(ConflictException);
    try {
      await w.emergency.triggerEmergency(body, who);
    } catch (e: any) {
      expect(e.getResponse()).toMatchObject({ code: DRILL_BLOCKED_CODE });
      expect(String(e.getResponse().message)).toMatch(/live emergency alert is active/i);
    }
    // a refused drill reaches no screen and writes nothing
    expect(w.published.length).toBe(publishedBefore);
    expect(w.auditLogs.length).toBe(auditBefore);
  };

  it('tenant live → tenant drill refused', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('tenant', SCHOOL), schoolAdmin);
    await expectRefused(w, drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyType: 'LOCKDOWN', emergencyIsDrill: false });
  });

  it('group live → tenant drill refused (it would cover the live screens)', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('group', GYM), schoolAdmin);
    await expectRefused(w, drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['gym-1', 'gym-2']));
  });

  it('tenant live → group drill refused', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('tenant', SCHOOL), schoolAdmin);
    await expectRefused(w, drill('group', GYM, 'hold'), schoolAdmin);
  });

  it('group live → a drill on one of its screens refused; on an unrelated screen allowed', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('group', GYM), schoolAdmin);
    await expectRefused(w, drill('device', 'gym-1', 'hold'), schoolAdmin);
    const res: any = await w.emergency.triggerEmergency(drill('device', 'lobby', 'hold'), schoolAdmin);
    expect(res.success).toBe(true);
    expect(await drillMap(w, ['gym-1', 'lobby'])).toEqual({ 'gym-1': false, lobby: true });
  });

  it('district live → a school drill refused (the school inherits the district alert)', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('tenant', DISTRICT), districtAdmin);
    await expectRefused(w, drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    await expectRefused(w, drill('group', GYM, 'hold'), schoolAdmin);
  });

  it('a school live alert → a DISTRICT drill refused (it would fan out over the school)', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('tenant', SCHOOL), schoolAdmin);
    await expectRefused(w, drill('tenant', DISTRICT, 'hold'), districtAdmin);
  });

  it('a drill does not block another drill (escalating the drill is fine)', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    const res: any = await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(res.success).toBe(true);
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyType: 'LOCKDOWN', emergencyIsDrill: true });
  });
});

describe('5. a drill all-clear ends only the drill', () => {
  it('district drill → school goes LIVE → district drill all-clear leaves the school live', async () => {
    const w = makeWorld();
    const d: any = await w.emergency.triggerEmergency(drill('tenant', DISTRICT, 'hold'), districtAdmin);
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyIsDrill: true });
    expect(w.tenants.get(SIBLING)).toMatchObject({ emergencyIsDrill: true });

    await w.emergency.triggerEmergency(live('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyType: 'LOCKDOWN', emergencyIsDrill: false });

    const cleared: any = await w.emergency.clearEmergency(d.overrideId, clear('tenant', DISTRICT), districtAdmin);
    expect(cleared).toMatchObject({ success: true, isDrill: true });
    expect(w.tenants.get(DISTRICT)).toMatchObject({ emergencyStatus: 'INACTIVE' });
    expect(w.tenants.get(SIBLING)).toMatchObject({ emergencyStatus: 'INACTIVE' });
    // the school's LIVE lockdown survived the drill's all-clear
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyStatus: 'CRITICAL', emergencyType: 'LOCKDOWN', emergencyIsDrill: false });
    expect(await emergencyMap(w)).toEqual(only(SCHOOL_IDS));
    expect(await drillMap(w, ['gym-1'])).toEqual({ 'gym-1': false });
  });

  it('a group drill all-clear leaves a live one-screen alert on another screen alone', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('device', 'lobby', 'medical'), schoolAdmin);
    const d: any = await w.emergency.triggerEmergency(drill('group', GYM, 'hold'), schoolAdmin);
    await w.emergency.clearEmergency(d.overrideId, clear('group', GYM), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['lobby']));
    expect(w.auditLogs.filter((a) => a.action === DRILL_CLEAR_ACTION)).toHaveLength(1);
  });

  it('a LIVE all-clear is audited as live, with isDrill false in its details', async () => {
    const w = makeWorld();
    const res: any = await w.emergency.triggerEmergency(live('tenant', SCHOOL), schoolAdmin);
    await w.emergency.clearEmergency(res.overrideId, clear('tenant', SCHOOL), schoolAdmin);
    const c = w.auditLogs.find((a) => a.action === 'CLEAR_EMERGENCY');
    expect(c).toBeDefined();
    expect(JSON.parse(c!.details).isDrill).toBe(false);
    expect(w.auditLogs.some((a) => a.action === DRILL_CLEAR_ACTION)).toBe(false);
  });
});

describe('6. the LIVE path is unchanged', () => {
  it('a live trigger signs no isDrill key, writes emergencyIsDrill false, and audits TRIGGER_EMERGENCY', async () => {
    const w = makeWorld();
    const signed: any[] = [];
    (w.emergency as any).signer.signMessage.mockImplementation((type: string, payload: any) => {
      signed.push({ type, payload });
      return { type, payload, signature: 'sig', timestamp: Date.now() };
    });
    const res: any = await w.emergency.triggerEmergency(live('tenant', SCHOOL, 'lockdown', { textBlob: 'Stay put' }), schoolAdmin);
    expect(res).toMatchObject({ success: true, isDrill: false });
    const override = signed.find((m) => m.type === 'OVERRIDE');
    expect('isDrill' in override.payload).toBe(false);
    expect(override.payload.textBlob).toBe('Stay put');
    expect(localTenantEmergencyEpoch(SCHOOL)?.alert).not.toHaveProperty('isDrill');
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyIsDrill: false });
    const m = await w.manifest('gym-1');
    expect(m.isDrill).toBe(false);
    expect(m.playlists[0].template.zones[0].defaultConfig.content).not.toMatch(/DRILL/);
    const t = w.auditLogs.find((a) => a.action === 'TRIGGER_EMERGENCY');
    expect(JSON.parse(t!.details)).toMatchObject({ isDrill: false, contentSource: 'live' });
  });

  it('GET /emergency/active reports isDrill per alert', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    await w.emergency.triggerEmergency(live('device', 'lobby', 'medical'), schoolAdmin);
    const { alerts } = await w.emergency.activeAlerts(schoolAdmin);
    const tenantWide = alerts.find((a: any) => a.scopeType === 'tenant');
    const lobby = alerts.find((a: any) => a.scopeType === 'device');
    expect(tenantWide).toMatchObject({ type: 'HOLD', isDrill: true });
    expect(lobby).toMatchObject({ type: 'MEDICAL', isDrill: false });
  });
});
