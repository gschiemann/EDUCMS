/**
 * The pure drill rules (emergency-drill.ts) — one case per guarantee.
 */
import {
  DRILL_BLOCKED_MESSAGE,
  DRILL_TEXT_PREFIX,
  drillTextBlob,
  liveAlertsBlockingDrill,
  pickScreenDrillContent,
  pickTenantDrillPlaylists,
  resolveScreenAlertContent,
  tenantAlertPlaysDrillContent,
  tenantHasLiveAlert,
} from './emergency-drill';
import {
  SCREEN_DRILL_CONTENT_FIELDS,
  SCREEN_DRILL_CONTENT_SELECT,
  SCREEN_DRILL_MEDIA_URL_FIELDS,
  SCREEN_DRILL_PLAYLIST_FIELDS,
  SCREEN_EMERGENCY_MEDIA_URL_FIELDS,
  SCREEN_EMERGENCY_PLAYLIST_FIELDS,
  TENANT_DRILL_PLAYLIST_FIELDS,
  TENANT_EMERGENCY_PLAYLIST_FIELDS,
} from './emergency-content-use';
import { entryFromRow, placeAlert, clearAlert, parseDisplaced } from './alert-stack';

describe('drillTextBlob — the belt-and-braces mark for old player bundles', () => {
  it('prefixes a drill text exactly once and leaves live text alone', () => {
    expect(drillTextBlob('Gym to the field', true)).toBe('DRILL — Gym to the field');
    expect(drillTextBlob('DRILL — already', true)).toBe('DRILL — already');
    expect(drillTextBlob('Gym to the field', false)).toBe('Gym to the field');
  });
  it('a drill with no text gets no text (the default board says DRILL itself)', () => {
    expect(drillTextBlob(null, true)).toBeNull();
    expect(drillTextBlob('   ', true)).toBeNull();
    expect(drillTextBlob(undefined, false)).toBeNull();
  });
  it('the prefix is the literal the manifest and the player tests look for', () => {
    expect(DRILL_TEXT_PREFIX).toBe('DRILL — ');
  });
});

describe('pickTenantDrillPlaylists — the mirror of the live pick', () => {
  const t = {
    drillLockdownPlaylistId: 'ld', drillLockdownPortraitPlaylistId: 'ld-p',
    drillWeatherPlaylistId: 'w', drillEvacuatePlaylistId: 'e', drillHoldPlaylistId: 'h',
    drillSecurePlaylistId: 's', drillMedicalPlaylistId: 'm', drillMedicalPortraitPlaylistId: 'm-p',
  };
  it.each([
    ['lockdown', 'ld', 'ld-p'],
    ['LOCKDOWN', 'ld', 'ld-p'],
    ['weather', 'w', null],
    ['evacuate', 'e', null],
    ['hold', 'h', null],
    ['secure', 's', null],
    ['medical', 'm', 'm-p'],
  ])('%s', (type, landscape, portrait) => {
    expect(pickTenantDrillPlaylists(t, type)).toEqual({ landscape, portrait });
  });
  it('an unknown or missing type picks nothing', () => {
    expect(pickTenantDrillPlaylists(t, 'custom')).toEqual({ landscape: null, portrait: null });
    expect(pickTenantDrillPlaylists(null, 'lockdown')).toEqual({ landscape: null, portrait: null });
  });
});

describe('liveAlertsBlockingDrill — a drill never goes out over a live alert', () => {
  it('a live tenant-wide alert blocks; a drill or an inactive tenant does not', () => {
    expect(tenantHasLiveAlert({ emergencyStatus: 'CRITICAL', emergencyIsDrill: false })).toBe(true);
    expect(tenantHasLiveAlert({ emergencyStatus: 'CRITICAL' })).toBe(true);
    expect(tenantHasLiveAlert({ emergencyStatus: 'CRITICAL', emergencyIsDrill: true })).toBe(false);
    expect(tenantHasLiveAlert({ emergencyStatus: 'INACTIVE' })).toBe(false);
    expect(tenantHasLiveAlert(null)).toBe(false);
    expect(
      liveAlertsBlockingDrill({
        tenants: [{ id: 'a', emergencyStatus: 'HIGH' }, { id: 'b', emergencyStatus: 'HIGH', emergencyIsDrill: true }],
        overrideRows: [],
      }),
    ).toEqual([{ kind: 'tenant', id: 'a' }]);
  });
  it('a live override row blocks, shown or covered; a drill-only row, an expired row and a pre-drill-era row read as stated', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    const liveShown = { screenId: 's1', type: 'LOCKDOWN', alertId: 'a1', triggeredByUserId: 'u', triggeredAt: new Date(now) };
    const drillOverLive = {
      screenId: 's2', type: 'HOLD', alertId: 'd1', isDrill: true, triggeredByUserId: 'u', triggeredAt: new Date(now),
      displaced: [{ ...liveShown, alertId: 'a2' }],
    };
    const drillOnly = { screenId: 's3', type: 'HOLD', alertId: 'd2', isDrill: true, triggeredByUserId: 'u', triggeredAt: new Date(now) };
    const expiredLive = { ...liveShown, screenId: 's4', alertId: 'a4', expiresAt: new Date(now - 1000) };
    const legacyLive = { screenId: 's5', type: 'LOCKDOWN', triggeredByUserId: 'u', triggeredAt: new Date(now) }; // no isDrill column at all
    expect(
      liveAlertsBlockingDrill({ tenants: [], overrideRows: [liveShown, drillOverLive, drillOnly, expiredLive, legacyLive], now }),
    ).toEqual([
      { kind: 'screen', id: 's1', alertId: 'a1' },
      { kind: 'screen', id: 's2', alertId: 'a2' },
      { kind: 'screen', id: 's5', alertId: null },
    ]);
  });
});

describe('alert-stack carries isDrill', () => {
  it('reads only the literal true as a drill and round-trips it through displaced', () => {
    expect(entryFromRow({ type: 'HOLD', isDrill: true }).isDrill).toBe(true);
    expect(entryFromRow({ type: 'HOLD', isDrill: 'true' }).isDrill).toBe(false);
    expect(entryFromRow({ type: 'HOLD' }).isDrill).toBe(false);
    const base = { alertId: null, scopeType: null, scopeId: null, severity: 'HIGH', scopeNote: null, playlistId: null, mediaUrl: null, textBlob: null, floorPlanId: null, floorZoneId: null, scenarioId: null, triggeredByUserId: 'u', expiresAt: null };
    const drill = { ...base, alertId: 'd', scopeType: 'tenant', scopeId: 't', type: 'HOLD', triggeredAt: '2026-10-10T10:00:00.000Z', isDrill: true };
    const live = { ...base, alertId: 'l', scopeType: 'group', scopeId: 'g', type: 'LOCKDOWN', triggeredAt: '2026-10-10T10:01:00.000Z', isDrill: false };
    const placed = placeAlert(null, drill, () => false);
    expect(placed.columns.isDrill).toBe(true);
    const over = placeAlert({ ...placed.columns }, live, () => false);
    expect(over.columns.isDrill).toBe(false);
    expect(parseDisplaced(over.columns.displaced)[0].isDrill).toBe(true);
    // ending the live one restores the drill, flag intact
    const plan = clearAlert({ ...over.columns }, (e) => e.alertId === 'l');
    expect(plan.kind).toBe('update');
    if (plan.kind === 'update') expect(plan.columns.isDrill).toBe(true);
  });
});

describe('drill playlists are emergency content for the deletion guard and the never-evict tier', () => {
  it('the twelve drill columns are in the tenant field list, and TENANT_DRILL_PLAYLIST_FIELDS is exactly them', () => {
    const drillFields = TENANT_EMERGENCY_PLAYLIST_FIELDS.filter((f) => f.startsWith('drill'));
    expect(drillFields).toHaveLength(12);
    expect([...TENANT_DRILL_PLAYLIST_FIELDS]).toEqual(drillFields);
    for (const k of ['Lockdown', 'Evacuate', 'Weather', 'Hold', 'Secure', 'Medical']) {
      expect(drillFields).toContain(`drill${k}PlaylistId`);
      expect(drillFields).toContain(`drill${k}PortraitPlaylistId`);
    }
  });

  it('the 24 per-screen drill columns are in the screen field lists the guard, the re-mux and the precache read', () => {
    expect(SCREEN_DRILL_PLAYLIST_FIELDS).toHaveLength(12);
    expect(SCREEN_DRILL_MEDIA_URL_FIELDS).toHaveLength(12);
    expect(SCREEN_DRILL_CONTENT_FIELDS).toHaveLength(24);
    expect(Object.keys(SCREEN_DRILL_CONTENT_SELECT)).toHaveLength(24);
    expect(SCREEN_EMERGENCY_PLAYLIST_FIELDS).toHaveLength(24);
    expect(SCREEN_EMERGENCY_MEDIA_URL_FIELDS).toHaveLength(24);
    for (const k of ['Lockdown', 'Evacuate', 'Weather', 'Hold', 'Secure', 'Medical']) {
      for (const f of [`drill${k}PlaylistId`, `drill${k}PortraitPlaylistId`]) {
        expect(SCREEN_DRILL_PLAYLIST_FIELDS).toContain(f);
        expect(SCREEN_EMERGENCY_PLAYLIST_FIELDS).toContain(f);
        expect(SCREEN_EMERGENCY_PLAYLIST_FIELDS).toContain(f.replace('drill', 'emergency'));
      }
      for (const f of [`drill${k}AssetUrl`, `drill${k}PortraitAssetUrl`]) {
        expect(SCREEN_DRILL_MEDIA_URL_FIELDS).toContain(f);
        expect(SCREEN_EMERGENCY_MEDIA_URL_FIELDS).toContain(f);
        expect(SCREEN_EMERGENCY_MEDIA_URL_FIELDS).toContain(f.replace('drill', 'emergency'));
      }
    }
    // the 409 names the organisation, not a screen
    expect(DRILL_BLOCKED_MESSAGE).toMatch(/organization/);
  });
});

describe('pickScreenDrillContent — the screen\'s own drill content, orientation-aware', () => {
  const screen = {
    drillLockdownPlaylistId: 'ld',
    drillLockdownPortraitPlaylistId: 'ld-p',
    drillLockdownAssetUrl: 'https://cdn/ld.png',
    drillEvacuatePortraitAssetUrl: 'https://cdn/ev-p.png',
    drillHoldPlaylistId: 'hold',
  };
  it('picks the orientation\'s slot first and falls back to the other', () => {
    expect(pickScreenDrillContent(screen, 'LOCKDOWN', false)).toEqual({ playlistId: 'ld', mediaUrl: 'https://cdn/ld.png' });
    expect(pickScreenDrillContent(screen, 'LOCKDOWN', true)).toEqual({ playlistId: 'ld-p', mediaUrl: 'https://cdn/ld.png' });
    expect(pickScreenDrillContent(screen, 'evacuate', false)).toEqual({ playlistId: null, mediaUrl: 'https://cdn/ev-p.png' });
    expect(pickScreenDrillContent(screen, 'HOLD', true)).toEqual({ playlistId: 'hold', mediaUrl: null });
  });
  it('an unknown type, a missing screen, and the LIVE columns pick nothing', () => {
    expect(pickScreenDrillContent(screen, 'CUSTOM', false)).toEqual({ playlistId: null, mediaUrl: null });
    expect(pickScreenDrillContent(null, 'LOCKDOWN', false)).toEqual({ playlistId: null, mediaUrl: null });
    expect(pickScreenDrillContent({ emergencyLockdownPlaylistId: 'live' }, 'LOCKDOWN', false)).toEqual({ playlistId: null, mediaUrl: null });
  });
});

describe('resolveScreenAlertContent — one precedence for every trigger path', () => {
  const none = { playlistId: null, mediaUrl: null };
  const live = (over: Partial<typeof none> = {}) => ({ ...none, ...over });

  it('LIVE: explicit > screen live playlist > (screen live media | tenant playlist); media only without a playlist', () => {
    const base = { isDrill: false, tenantSource: 'live' as const, screenDrill: live({ playlistId: 'ignored-drill' }), tenantPlaylistId: 'tenant', payloadMediaUrl: 'https://cdn/payload.png' };
    expect(resolveScreenAlertContent({ ...base, explicitPlaylistId: 'explicit', screenLive: live({ playlistId: 's' }) })).toEqual({ playlistId: 'explicit', mediaUrl: null });
    expect(resolveScreenAlertContent({ ...base, screenLive: live({ playlistId: 's', mediaUrl: 'https://cdn/s.png' }) })).toEqual({ playlistId: 's', mediaUrl: null });
    expect(resolveScreenAlertContent({ ...base, screenLive: live({ mediaUrl: 'https://cdn/s.png' }) })).toEqual({ playlistId: null, mediaUrl: 'https://cdn/s.png' });
    expect(resolveScreenAlertContent({ ...base, screenLive: none })).toEqual({ playlistId: 'tenant', mediaUrl: null });
    expect(resolveScreenAlertContent({ ...base, screenLive: none, tenantPlaylistId: null })).toEqual({ playlistId: null, mediaUrl: 'https://cdn/payload.png' });
    expect(resolveScreenAlertContent({ ...base, screenLive: none, tenantPlaylistId: null, payloadMediaUrl: null })).toEqual({ playlistId: null, mediaUrl: null });
  });

  it('DRILL: explicit > screen drill playlist > screen drill media > tenant DRILL playlist > the live precedence', () => {
    const base = { isDrill: true, tenantSource: 'drill' as const, screenLive: live({ playlistId: 'screen-live', mediaUrl: 'https://cdn/live.png' }), tenantPlaylistId: 'tenant-drill', payloadMediaUrl: null };
    expect(resolveScreenAlertContent({ ...base, explicitPlaylistId: 'explicit', screenDrill: live({ playlistId: 'sd' }) })).toEqual({ playlistId: 'explicit', mediaUrl: null });
    expect(resolveScreenAlertContent({ ...base, screenDrill: live({ playlistId: 'sd', mediaUrl: 'https://cdn/sd.png' }) })).toEqual({ playlistId: 'sd', mediaUrl: null });
    expect(resolveScreenAlertContent({ ...base, screenDrill: live({ mediaUrl: 'https://cdn/sd.png' }) })).toEqual({ playlistId: null, mediaUrl: 'https://cdn/sd.png' });
    expect(resolveScreenAlertContent({ ...base, screenDrill: none })).toEqual({ playlistId: 'tenant-drill', mediaUrl: null });
    // no tenant drill content (the pair is the LIVE pair): the screen's live content comes first, then the tenant
    expect(resolveScreenAlertContent({ ...base, tenantSource: 'live', tenantPlaylistId: 'tenant-live', screenDrill: none })).toEqual({ playlistId: 'screen-live', mediaUrl: null });
    expect(resolveScreenAlertContent({ ...base, tenantSource: 'live', tenantPlaylistId: 'tenant-live', screenDrill: none, screenLive: none })).toEqual({ playlistId: 'tenant-live', mediaUrl: null });
    expect(resolveScreenAlertContent({ ...base, tenantSource: 'live', tenantPlaylistId: 'tenant-live', screenDrill: none, screenLive: live({ mediaUrl: 'https://cdn/live.png' }) })).toEqual({ playlistId: null, mediaUrl: 'https://cdn/live.png' });
  });
});

describe('tenantAlertPlaysDrillContent — is the tenant\'s active alert playlist its drill content?', () => {
  const t = { emergencyIsDrill: true, emergencyType: 'LOCKDOWN', drillLockdownPlaylistId: 'd', drillLockdownPortraitPlaylistId: 'd-p', panicLockdownPlaylistId: 'l' };
  it('true only for a drill whose pointer is one of the type\'s drill columns', () => {
    expect(tenantAlertPlaysDrillContent({ ...t, emergencyPlaylistId: 'd' })).toBe(true);
    expect(tenantAlertPlaysDrillContent({ ...t, emergencyPlaylistId: null, emergencyPortraitPlaylistId: 'd-p' })).toBe(true);
    expect(tenantAlertPlaysDrillContent({ ...t, emergencyPlaylistId: 'l' })).toBe(false); // fell back to live content
    expect(tenantAlertPlaysDrillContent({ ...t, emergencyIsDrill: false, emergencyPlaylistId: 'd' })).toBe(false);
    expect(tenantAlertPlaysDrillContent({ ...t, emergencyType: 'HOLD', emergencyPlaylistId: 'd' })).toBe(false);
    expect(tenantAlertPlaysDrillContent(null)).toBe(false);
  });
});
