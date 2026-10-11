/**
 * EMERGENCY DRILLS — end to end against the real controller + manifest
 * (2026-10-10). Same stateful world as emergency.targeting.spec.ts.
 *
 * What this proves, in the owner's words ("drills where different content
 * plays vs a live emergency", "live and drill section in settings", "an easy
 * switch to flip between drill and live", then "custom location content
 * available for drills too" and "live alerts always win"):
 *
 *   1. a drill is delivered like the real thing — signed push, manifest
 *      `isEmergency: true` (the only field the native panel-off watch reads,
 *      so a drill WAKES a sleeping panel), the revision moves, the raise
 *      descriptor rides — and every one of those carries `isDrill: true`;
 *   2. a drill plays the type's DRILL content, and falls back to the LIVE
 *      content when none is set (or the drill bucket is empty) — still a drill;
 *   3. LIVE ALERTS ALWAYS WIN: a live alert anywhere in the organisation ENDS
 *      every running drill in it (tenant-wide, group / one-screen, inherited)
 *      — audited `DRILL_ENDED_BY_LIVE_ALERT` per tenant, with a signed push —
 *      after its own dispatch; another organisation's drill is untouched; a
 *      failure in that pass never touches the live alert;
 *   4. a drill is REFUSED (409, plain words) while a live alert is active
 *      ANYWHERE in the organisation — overlap is irrelevant — and a refused
 *      drill reaches no screen; another organisation's live alert does not
 *      block it;
 *   5. a drill all-clear ends ONLY a drill — with the explicit drill intent it
 *      ends nothing when a live alert already ended the drill;
 *   6. the LIVE path is byte-for-byte what it was: no `isDrill` key on the
 *      signed payload, `TRIGGER_EMERGENCY` / `CLEAR_EMERGENCY` audit actions;
 *   7. per-screen DRILL content: the screen's own drill content → the tenant's
 *      drill content → the live precedence, in every trigger path and in the
 *      manifest for a screen with no override row.
 */

import { ConflictException } from '@nestjs/common';
import { ClearEmergencyInputSchema, TriggerEmergencyInputSchema } from '@cms/api-types';
import { invalidateTenantState, resetManifestCacheForTests } from '../screens/manifest-hot-cache';
import { localTenantEmergencyEpoch, resetEmergencyRevForTests } from '../screens/emergency-rev';
import {
  DISTRICT, SCHOOL, SIBLING, OTHER, GYM, FRONT_GROUP, SIB_GROUP,
  SCHOOL_IDS, makeWorld, schoolAdmin, districtAdmin,
  clear, emergencyMap, only,
} from './emergency.targeting.world';
import {
  DRILL_BLOCKED_CODE,
  DRILL_CLEAR_ACTION,
  DRILL_ENDED_BY_LIVE_ACTION,
  DRILL_TRIGGER_ACTION,
} from './emergency-drill';

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

describe('3. "LIVE ALERTS ALWAYS WIN" — a live alert ends every drill in the organisation', () => {
  it('a live tenant alert replaces a running tenant drill', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyType: 'HOLD', emergencyIsDrill: true });

    const res: any = await w.emergency.triggerEmergency(live('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(res).toMatchObject({ success: true, isDrill: false });
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyType: 'LOCKDOWN', emergencyIsDrill: false });
    expect(await drillMap(w, SCHOOL_IDS)).toEqual(Object.fromEntries(SCHOOL_IDS.map((id) => [id, false])));
    expect(w.auditLogs.filter((a) => a.action === 'TRIGGER_EMERGENCY')).toHaveLength(1);
    // the tenant row was replaced by the live write itself — nothing was left to end
    expect(res.drillsEnded).toBeUndefined();
    expect(w.auditLogs.some((a) => a.action === DRILL_ENDED_BY_LIVE_ACTION)).toBe(false);
  });

  it('a live group alert ENDS a tenant drill everywhere: its screens show the live alert, the rest go back to normal', async () => {
    const w = makeWorld();
    const d: any = await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    const before = w.published.length;
    const res: any = await w.emergency.triggerEmergency(live('group', GYM, 'lockdown'), schoolAdmin);
    expect(res.success).toBe(true);
    expect(await emergencyMap(w)).toEqual(only(['gym-1', 'gym-2']));
    expect(await drillMap(w, ['gym-1', 'gym-2'])).toEqual({ 'gym-1': false, 'gym-2': false });
    expect((await w.manifest('gym-1')).emergencyType).toBe('LOCKDOWN');
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyStatus: 'INACTIVE', emergencyIsDrill: false });
    expect(res.drillsEnded).toEqual({ tenantIds: [SCHOOL], screenIds: [] });
    const ended = w.auditLogs.find((a) => a.action === DRILL_ENDED_BY_LIVE_ACTION);
    expect(ended).toMatchObject({ tenantId: SCHOOL, targetType: 'tenant', targetId: SCHOOL, userId: 'u-school' });
    expect(JSON.parse(ended!.details)).toMatchObject({
      liveOverrideId: res.overrideId,
      liveScopeType: 'group',
      liveScopeId: GYM,
      endedTenantDrill: true,
      endedDrillOverrideIds: [d.overrideId],
    });
    // the live push went out FIRST, then the drill's end rode a signed ALL_CLEAR to the tenant channel
    expect(w.published.slice(before)).toEqual([`group:${GYM}`, `tenant:${SCHOOL}`]);
  });

  it('a live tenant alert ends a group drill on its own screens (the drill row is gone, the screen shows the live type)', async () => {
    const w = makeWorld();
    const d: any = await w.emergency.triggerEmergency(drill('group', GYM, 'hold'), schoolAdmin);
    expect(w.overrides.get('gym-1')).toMatchObject({ isDrill: true });
    const before = w.published.length;
    const res: any = await w.emergency.triggerEmergency(live('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(w.overrides.has('gym-1')).toBe(false);
    expect(w.overrides.has('gym-2')).toBe(false);
    expect((await w.manifest('gym-1')).emergencyType).toBe('LOCKDOWN');
    expect(await drillMap(w, SCHOOL_IDS)).toEqual(Object.fromEntries(SCHOOL_IDS.map((id) => [id, false])));
    expect(res.drillsEnded).toEqual({ tenantIds: [SCHOOL], screenIds: expect.arrayContaining(['gym-1', 'gym-2']) });
    expect(JSON.parse(w.auditLogs.find((a) => a.action === DRILL_ENDED_BY_LIVE_ACTION)!.details)).toMatchObject({
      endedTenantDrill: false,
      endedDrillOverrideIds: [d.overrideId],
      clearedScreenIds: expect.arrayContaining(['gym-1', 'gym-2']),
    });
    // the screens whose rows ended were told on their own channels, after the live push
    expect(w.published[before]).toBe(`tenant:${SCHOOL}`);
    expect(w.published.slice(before + 1).sort()).toEqual(['device:gym-1', 'device:gym-2']);
  });

  it('a live alert on the same group replaces the group drill (never stacks under it)', async () => {
    const w = makeWorld();
    const d: any = await w.emergency.triggerEmergency(drill('group', GYM, 'hold'), schoolAdmin);
    await w.emergency.triggerEmergency(live('group', GYM, 'lockdown'), schoolAdmin);
    const row = w.overrides.get('gym-1')!;
    expect(row).toMatchObject({ type: 'LOCKDOWN', isDrill: false });
    expect((row.displaced ?? []).some((e: any) => e.alertId === d.overrideId)).toBe(false);
  });

  it('a live one-screen alert ends a group drill it lands on (the drill is removed from under it) and the drill on the other screens', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(drill('group', GYM, 'hold'), schoolAdmin);
    await w.emergency.triggerEmergency(live('device', 'gym-1', 'medical'), schoolAdmin);
    const row = w.overrides.get('gym-1')!;
    expect(row).toMatchObject({ type: 'MEDICAL', isDrill: false });
    expect((row.displaced ?? []).some((e: any) => e.isDrill)).toBe(false);
    expect(await emergencyMap(w)).toEqual(only(['gym-1']));
  });

  it('a live alert in ONE location ends a drill in ANOTHER location of the same organisation', async () => {
    const w = makeWorld();
    const d: any = await w.emergency.triggerEmergency(drill('tenant', SIBLING, 'hold'), districtAdmin);
    expect(await emergencyMap(w)).toEqual(only(['sib-1']));

    const before = w.published.length;
    const res: any = await w.emergency.triggerEmergency(live('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(res.success).toBe(true);
    // the school is live, the sibling's drill is over, nothing else changed
    expect(await emergencyMap(w)).toEqual(only(SCHOOL_IDS));
    expect(w.tenants.get(SIBLING)).toMatchObject({ emergencyStatus: 'INACTIVE', emergencyIsDrill: false });
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyType: 'LOCKDOWN', emergencyIsDrill: false });
    expect(res.drillsEnded).toEqual({ tenantIds: [SIBLING], screenIds: [] });
    const ended = w.auditLogs.find((a) => a.action === DRILL_ENDED_BY_LIVE_ACTION);
    expect(ended).toMatchObject({ tenantId: SIBLING, targetId: SIBLING });
    expect(JSON.parse(ended!.details)).toMatchObject({ liveOverrideId: res.overrideId, endedDrillOverrideIds: [d.overrideId] });
    // the sibling's screens were told
    expect(w.published.slice(before)).toEqual([`tenant:${SCHOOL}`, `tenant:${SIBLING}`]);
    // and its revision dropped the raise descriptor
    expect(localTenantEmergencyEpoch(SIBLING)?.active).toBe(false);
    expect(localTenantEmergencyEpoch(SIBLING)?.alert ?? null).toBeNull();
  });

  it('a live group alert in one location ends a GROUP drill in another location', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(drill('group', SIB_GROUP, 'hold'), districtAdmin);
    expect(await emergencyMap(w)).toEqual(only(['sib-1']));
    const before = w.published.length;
    const res: any = await w.emergency.triggerEmergency(live('group', GYM, 'lockdown'), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['gym-1', 'gym-2']));
    expect(w.overrides.has('sib-1')).toBe(false);
    expect(res.drillsEnded).toEqual({ tenantIds: [SIBLING], screenIds: ['sib-1'] });
    expect(w.published.slice(before)).toEqual([`group:${GYM}`, 'device:sib-1']);
  });

  it('a school going LIVE under a DISTRICT drill ends the drill in the district and every other school', async () => {
    const w = makeWorld();
    const d: any = await w.emergency.triggerEmergency(drill('tenant', DISTRICT, 'hold'), districtAdmin);
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyIsDrill: true });
    expect(w.tenants.get(SIBLING)).toMatchObject({ emergencyIsDrill: true });

    const res: any = await w.emergency.triggerEmergency(live('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyType: 'LOCKDOWN', emergencyIsDrill: false });
    expect(w.tenants.get(DISTRICT)).toMatchObject({ emergencyStatus: 'INACTIVE', emergencyIsDrill: false });
    expect(w.tenants.get(SIBLING)).toMatchObject({ emergencyStatus: 'INACTIVE', emergencyIsDrill: false });
    expect(await emergencyMap(w)).toEqual(only(SCHOOL_IDS));
    expect(res.drillsEnded.tenantIds.sort()).toEqual([DISTRICT, SIBLING]);
    const endedTenants = w.auditLogs.filter((a) => a.action === DRILL_ENDED_BY_LIVE_ACTION).map((a) => a.tenantId).sort();
    expect(endedTenants).toEqual([DISTRICT, SIBLING]);
    for (const a of w.auditLogs.filter((x) => x.action === DRILL_ENDED_BY_LIVE_ACTION)) {
      expect(JSON.parse(a.details).endedDrillOverrideIds).toEqual([d.overrideId]);
    }
  });

  it('different organisations are independent: a live alert never ends another customer\'s drill', async () => {
    const w = makeWorld();
    const otherAdmin = { user: { id: 'u-other', role: 'SCHOOL_ADMIN', tenantId: OTHER } };
    await w.emergency.triggerEmergency(drill('tenant', OTHER, 'hold'), otherAdmin);
    const before = w.published.length;
    const res: any = await w.emergency.triggerEmergency(live('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(w.tenants.get(OTHER)).toMatchObject({ emergencyStatus: 'CRITICAL', emergencyIsDrill: true });
    expect(await drillMap(w, ['other-1'])).toEqual({ 'other-1': true });
    expect(res.drillsEnded).toBeUndefined();
    expect(w.auditLogs.some((a) => a.action === DRILL_ENDED_BY_LIVE_ACTION)).toBe(false);
    expect(w.published.slice(before)).toEqual([`tenant:${SCHOOL}`]);
  });

  it('the live alert is delivered and recorded even when ending the drills fails', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(drill('tenant', SIBLING, 'hold'), districtAdmin);
    const before = w.published.length;
    w.client.screenEmergencyOverride.findMany.mockImplementationOnce(async () => {
      throw new Error('pooler stall');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res: any = await w.emergency.triggerEmergency(live('tenant', SCHOOL, 'lockdown'), schoolAdmin);
      expect(res).toMatchObject({ success: true, isDrill: false });
      expect(res.drillsEnded).toBeUndefined();
      expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyType: 'LOCKDOWN' });
      expect(w.published.slice(before)).toEqual([`tenant:${SCHOOL}`]);
      expect(w.auditLogs.some((a) => a.action === 'TRIGGER_EMERGENCY')).toBe(true);
      expect(warn.mock.calls.some((c) => String(c[0]).includes('ending drills after a live alert failed'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('4. a drill is refused while a live alert is active ANYWHERE in the organisation', () => {
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

  it('group live → tenant drill, group drill and a one-screen drill on an UNRELATED screen all refused', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('group', GYM), schoolAdmin);
    await expectRefused(w, drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    await expectRefused(w, drill('group', FRONT_GROUP, 'hold'), schoolAdmin);
    await expectRefused(w, drill('device', 'lobby', 'hold'), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['gym-1', 'gym-2']));
  });

  it('tenant live → group drill refused', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('tenant', SCHOOL), schoolAdmin);
    await expectRefused(w, drill('group', GYM, 'hold'), schoolAdmin);
  });

  it('a live alert in a SIBLING location refuses a drill in this one (same organisation, no overlap)', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('tenant', SIBLING), districtAdmin);
    await expectRefused(w, drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    await expectRefused(w, drill('group', GYM, 'hold'), schoolAdmin);
    await expectRefused(w, drill('device', 'lobby', 'hold'), schoolAdmin);
  });

  it('a live ONE-SCREEN alert in a sibling location refuses a drill in this one', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('device', 'sib-1', 'medical'), districtAdmin);
    await expectRefused(w, drill('tenant', SCHOOL, 'hold'), schoolAdmin);
  });

  it('district live → a school drill refused (the school inherits the district alert)', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('tenant', DISTRICT), districtAdmin);
    await expectRefused(w, drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    await expectRefused(w, drill('group', GYM, 'hold'), schoolAdmin);
  });

  it('a school live alert → a DISTRICT drill refused', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live('tenant', SCHOOL), schoolAdmin);
    await expectRefused(w, drill('tenant', DISTRICT, 'hold'), districtAdmin);
  });

  it('a live alert in ANOTHER organisation does not block a drill here', async () => {
    const w = makeWorld();
    const otherAdmin = { user: { id: 'u-other', role: 'SCHOOL_ADMIN', tenantId: OTHER } };
    await w.emergency.triggerEmergency(live('tenant', OTHER), otherAdmin);
    const res: any = await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    expect(res).toMatchObject({ success: true, isDrill: true });
    expect(await drillMap(w, ['gym-1', 'other-1'])).toEqual({ 'gym-1': true, 'other-1': false });
  });

  it('a drill does not block another drill (escalating the drill is fine)', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    const res: any = await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(res.success).toBe(true);
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyType: 'LOCKDOWN', emergencyIsDrill: true });
  });
});

describe('5. a drill all-clear ends only a drill — never a live alert', () => {
  it('a drill all-clear sent AFTER a live alert already ended the drill ends nothing (isDrill intent)', async () => {
    const w = makeWorld();
    const d: any = await w.emergency.triggerEmergency(drill('tenant', DISTRICT, 'hold'), districtAdmin);
    await w.emergency.triggerEmergency(live('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(w.tenants.get(DISTRICT)).toMatchObject({ emergencyStatus: 'INACTIVE' });

    // the operator's "End Drill" from a stale overlay: with the drill intent it must not touch the live school
    const cleared: any = await w.emergency.clearEmergency(d.overrideId, { ...clear('tenant', DISTRICT), isDrill: true }, districtAdmin);
    expect(cleared).toMatchObject({ success: true, isDrill: true });
    expect(w.tenants.get(SCHOOL)).toMatchObject({ emergencyStatus: 'CRITICAL', emergencyType: 'LOCKDOWN', emergencyIsDrill: false });
    expect(await emergencyMap(w)).toEqual(only(SCHOOL_IDS));
    expect(w.auditLogs.filter((a) => a.action === 'CLEAR_EMERGENCY')).toHaveLength(0);
  });

  it('a group drill all-clear with the drill intent leaves a live alert on the same screens alone', async () => {
    const w = makeWorld();
    const d: any = await w.emergency.triggerEmergency(drill('group', GYM, 'hold'), schoolAdmin);
    await w.emergency.triggerEmergency(live('group', GYM, 'lockdown'), schoolAdmin); // replaces the drill
    await w.emergency.clearEmergency(d.overrideId, { ...clear('group', GYM), isDrill: true }, schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['gym-1', 'gym-2']));
    expect(w.overrides.get('gym-1')).toMatchObject({ type: 'LOCKDOWN', isDrill: false });
    expect(w.auditLogs.filter((a) => a.action === DRILL_CLEAR_ACTION)).toHaveLength(1);
  });

  it('a plain group drill all-clear ends exactly the drill it names', async () => {
    const w = makeWorld();
    const d: any = await w.emergency.triggerEmergency(drill('group', GYM, 'hold'), schoolAdmin);
    const d2: any = await w.emergency.triggerEmergency(drill('device', 'lobby', 'hold'), schoolAdmin);
    await w.emergency.clearEmergency(d.overrideId, clear('group', GYM), schoolAdmin);
    expect(await emergencyMap(w)).toEqual(only(['lobby']));
    expect(w.overrides.get('lobby')).toMatchObject({ alertId: d2.overrideId, isDrill: true });
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

  it('the all-clear body rejects a non-boolean isDrill and accepts the plain body unchanged', () => {
    expect(ClearEmergencyInputSchema.safeParse({ scopeType: 'tenant', scopeId: 't' }).success).toBe(true);
    expect(ClearEmergencyInputSchema.safeParse({ scopeType: 'tenant', scopeId: 't', isDrill: true }).success).toBe(true);
    expect(ClearEmergencyInputSchema.safeParse({ scopeType: 'tenant', scopeId: 't', isDrill: 'yes' }).success).toBe(false);
  });
});

describe('7. per-screen DRILL content (location-based mode)', () => {
  function locationWorld() {
    const w = makeWorld();
    w.addPlaylist('live-ld', SCHOOL, 2);
    w.addPlaylist('drill-ld', SCHOOL, 1);
    w.addPlaylist('gym-live', SCHOOL, 1);
    w.addPlaylist('gym-drill', SCHOOL, 1);
    w.addPlaylist('lobby-live', SCHOOL, 1);
    Object.assign(w.tenants.get(SCHOOL)!, {
      locationBasedEmergencyEnabled: true,
      panicLockdownPlaylistId: 'live-ld',
      drillLockdownPlaylistId: 'drill-ld',
    });
    // gym-1: its own live AND drill content; lobby: live content only; office: nothing of its own
    Object.assign(w.screens.get('gym-1')!, { emergencyLockdownPlaylistId: 'gym-live', drillLockdownPlaylistId: 'gym-drill' });
    Object.assign(w.screens.get('lobby')!, { emergencyLockdownPlaylistId: 'lobby-live' });
    return w;
  }

  it('tenant drill: screen drill content → tenant drill content → (never) the screen\'s live content', async () => {
    const w = locationWorld();
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(w.overrides.get('gym-1')).toMatchObject({ playlistId: 'gym-drill', isDrill: true });
    expect(w.overrides.get('lobby')).toMatchObject({ playlistId: 'drill-ld', isDrill: true });
    expect(w.overrides.get('office')).toMatchObject({ playlistId: 'drill-ld', isDrill: true });
    expect((await w.manifest('gym-1')).playlists[0].id).toBe('gym-drill');
    expect((await w.manifest('lobby')).playlists[0].id).toBe('drill-ld');
    // the live path on the same world is untouched: per-screen live content, then the tenant live pair
    await w.emergency.triggerEmergency(live('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(w.overrides.get('gym-1')).toMatchObject({ playlistId: 'gym-live', isDrill: false });
    expect(w.overrides.get('lobby')).toMatchObject({ playlistId: 'lobby-live', isDrill: false });
    expect(w.overrides.get('office')).toMatchObject({ playlistId: 'live-ld', isDrill: false });
  });

  it('with no tenant drill content: screen drill content → the live precedence (screen live, then tenant live)', async () => {
    const w = locationWorld();
    Object.assign(w.tenants.get(SCHOOL)!, { drillLockdownPlaylistId: null });
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(w.overrides.get('gym-1')).toMatchObject({ playlistId: 'gym-drill', isDrill: true });
    expect(w.overrides.get('lobby')).toMatchObject({ playlistId: 'lobby-live', isDrill: true });
    expect(w.overrides.get('office')).toMatchObject({ playlistId: 'live-ld', isDrill: true });
    expect((await w.manifest('lobby')).isDrill).toBe(true);
  });

  it('a screen\'s drill MEDIA beats the tenant drill playlist; its drill playlist beats its drill media', async () => {
    const w = locationWorld();
    Object.assign(w.screens.get('office')!, { drillLockdownAssetUrl: 'https://cdn.test/office-drill.png' });
    Object.assign(w.screens.get('gym-1')!, { drillLockdownAssetUrl: 'https://cdn.test/gym-drill.png' });
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(w.overrides.get('office')).toMatchObject({ playlistId: null, mediaUrl: 'https://cdn.test/office-drill.png' });
    expect(w.overrides.get('gym-1')).toMatchObject({ playlistId: 'gym-drill', mediaUrl: null });
    const m = await w.manifest('office');
    expect(m.playlists[0].items[0].url).toBe('https://cdn.test/office-drill.png');
  });

  it('portrait screens read the portrait drill slot, falling back to landscape', async () => {
    const w = locationWorld();
    w.addPlaylist('gym2-drill-p', SCHOOL, 1);
    Object.assign(w.screens.get('gym-2')!, { drillLockdownPortraitPlaylistId: 'gym2-drill-p' });
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(w.overrides.get('gym-2')).toMatchObject({ playlistId: 'gym2-drill-p' });
    Object.assign(w.screens.get('gym-2')!, { drillLockdownPortraitPlaylistId: null, drillLockdownPlaylistId: 'gym-drill' });
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'lockdown'), schoolAdmin);
    expect(w.overrides.get('gym-2')).toMatchObject({ playlistId: 'gym-drill' });
  });

  it('a group / one-screen drill uses the screen\'s drill content first', async () => {
    const w = locationWorld();
    await w.emergency.triggerEmergency(drill('group', GYM, 'lockdown'), schoolAdmin);
    expect(w.overrides.get('gym-1')).toMatchObject({ playlistId: 'gym-drill', isDrill: true });
    expect(w.overrides.get('gym-2')).toMatchObject({ playlistId: 'drill-ld', isDrill: true });
    await w.emergency.clearEmergency((w.overrides.get('gym-1') as any).alertId, clear('group', GYM), schoolAdmin);
    await w.emergency.triggerEmergency(drill('device', 'lobby', 'lockdown'), schoolAdmin);
    expect(w.overrides.get('lobby')).toMatchObject({ playlistId: 'drill-ld', isDrill: true });
  });

  it('the manifest resolves the same precedence for a screen with NO override row (an inherited district drill)', async () => {
    const w = locationWorld();
    // the district's own drill content; the school inherits the district's alert
    w.addPlaylist('district-drill', DISTRICT, 1);
    w.addPlaylist('district-live', DISTRICT, 1);
    Object.assign(w.tenants.get(DISTRICT)!, { panicLockdownPlaylistId: 'district-live', drillLockdownPlaylistId: 'district-drill' });
    await w.emergency.triggerEmergency(drill('tenant', DISTRICT, 'lockdown'), districtAdmin);
    // simulate the fan-out never reaching the school's rows (a school created mid-drill): wipe them
    w.tenants.set(SCHOOL, { ...w.tenants.get(SCHOOL)!, emergencyStatus: 'INACTIVE', emergencyType: null, emergencyPlaylistId: null, emergencyPortraitPlaylistId: null, emergencyIsDrill: false });
    for (const id of SCHOOL_IDS) w.overrides.delete(id);
    invalidateTenantState(SCHOOL);
    invalidateTenantState(DISTRICT);
    expect((await w.manifest('gym-1'))).toMatchObject({ isEmergency: true, isDrill: true, emergencyInheritedFromTenantId: DISTRICT });
    expect((await w.manifest('gym-1')).playlists[0].id).toBe('gym-drill'); // the screen's drill content
    expect((await w.manifest('lobby')).playlists[0].id).toBe('district-drill'); // the inherited DRILL playlist beats the screen's LIVE content
    expect((await w.manifest('office')).playlists[0].id).toBe('district-drill');
  });

  it('the manifest, no row, no tenant drill content: the screen\'s live content comes before the inherited live playlist', async () => {
    const w = locationWorld();
    w.addPlaylist('district-live', DISTRICT, 1);
    Object.assign(w.tenants.get(DISTRICT)!, { panicLockdownPlaylistId: 'district-live' });
    await w.emergency.triggerEmergency(drill('tenant', DISTRICT, 'lockdown'), districtAdmin);
    w.tenants.set(SCHOOL, { ...w.tenants.get(SCHOOL)!, emergencyStatus: 'INACTIVE', emergencyType: null, emergencyPlaylistId: null, emergencyPortraitPlaylistId: null, emergencyIsDrill: false });
    for (const id of SCHOOL_IDS) w.overrides.delete(id);
    invalidateTenantState(SCHOOL);
    invalidateTenantState(DISTRICT);
    expect((await w.manifest('gym-1')).playlists[0].id).toBe('gym-drill');
    expect((await w.manifest('lobby')).playlists[0].id).toBe('lobby-live');
    expect((await w.manifest('office')).playlists[0].id).toBe('district-live');
    expect((await w.manifest('office')).isDrill).toBe(true);
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

  it('GET /emergency/active reports isDrill per alert — and a live alert empties the drill out of it', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(drill('tenant', SCHOOL, 'hold'), schoolAdmin);
    let { alerts } = await w.emergency.activeAlerts(schoolAdmin);
    expect(alerts.find((a: any) => a.scopeType === 'tenant')).toMatchObject({ type: 'HOLD', isDrill: true });

    await w.emergency.triggerEmergency(live('device', 'lobby', 'medical'), schoolAdmin);
    ({ alerts } = await w.emergency.activeAlerts(schoolAdmin));
    expect(alerts.find((a: any) => a.scopeType === 'tenant')).toBeUndefined();
    expect(alerts.find((a: any) => a.scopeType === 'device')).toMatchObject({ type: 'MEDICAL', isDrill: false });
  });
});
