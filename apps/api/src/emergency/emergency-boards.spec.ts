/**
 * Staged emergency boards — the pure rules (2026-10-26).
 *
 * Which board a tenant-scope trigger resolves for ONE screen, per type ×
 * live/drill, must match what the trigger writes and the manifest serves —
 * including the two orientation cases the launch site exposed: the portrait
 * BACK face of a double-sided unit whose panel reports a landscape mode, and
 * an LED poster whose OS canvas is landscape while its LED module is portrait.
 */
import {
  emergencyBoardPayload,
  pickTenantPanicPlaylists,
  resolveEmergencyBoardSelection,
} from './emergency-boards';
import { emergencyLayoutIsPortrait } from '../screens/emergency-layout';

const tenant = {
  id: 'tenant-a',
  panicMedicalPlaylistId: 'pl-medical-land',
  panicMedicalPortraitPlaylistId: 'pl-medical-port',
  panicLockdownPlaylistId: 'pl-lockdown-land',
  panicLockdownPortraitPlaylistId: null,
  drillMedicalPlaylistId: 'pl-drill-medical-land',
  drillMedicalPortraitPlaylistId: 'pl-drill-medical-port',
};

const noScreenContent = {};

describe('emergencyBoardPayload — the manifest shape', () => {
  it('emits exactly the manifest emergency branch item fields', () => {
    const board = emergencyBoardPayload({
      id: 'pl-1',
      name: 'Medical',
      items: [
        {
          id: 'i2',
          assetId: 'a2',
          durationMs: 8000,
          sequenceOrder: 1,
          transitionType: 'FADE',
          asset: {
            fileUrl: 'https://cdn.invalid/b.png',
            fileHash: 'hb',
            mimeType: 'image/png',
          },
        },
        {
          id: 'i1',
          assetId: 'a1',
          durationMs: 10000,
          sequenceOrder: 0,
          transitionType: null,
          asset: {
            fileUrl: 'https://cdn.invalid/a.mp4',
            fileHash: null,
            mimeType: 'video/mp4',
          },
        },
      ],
    });
    expect(board).toEqual({
      id: 'pl-1',
      name: 'Medical',
      items: [
        {
          item_id: 'i2',
          asset_id: 'a2',
          asset_hash: 'hb',
          url: 'https://cdn.invalid/b.png',
          duration_ms: 8000,
          sequence: 1,
          mime_type: 'image/png',
          transition_type: 'FADE',
        },
        {
          item_id: 'i1',
          asset_id: 'a1',
          asset_hash: null,
          url: 'https://cdn.invalid/a.mp4',
          duration_ms: 10000,
          sequence: 0,
          mime_type: 'video/mp4',
          transition_type: null,
        },
      ],
    });
    // Nothing else leaks into the player's apply signature.
    expect(Object.keys(board.items[0]).sort()).toEqual([
      'asset_hash',
      'asset_id',
      'duration_ms',
      'item_id',
      'mime_type',
      'sequence',
      'transition_type',
      'url',
    ]);
  });
});

describe('pickTenantPanicPlaylists', () => {
  it('accepts the dashboard lower-case type and the manifest upper-case key alike', () => {
    expect(pickTenantPanicPlaylists(tenant, 'medical')).toEqual({
      landscape: 'pl-medical-land',
      portrait: 'pl-medical-port',
    });
    expect(pickTenantPanicPlaylists(tenant, 'MEDICAL')).toEqual({
      landscape: 'pl-medical-land',
      portrait: 'pl-medical-port',
    });
  });
});

describe('resolveEmergencyBoardSelection', () => {
  it('a landscape screen with no location mode resolves the tenant LANDSCAPE pair; portrait resolves the portrait one', () => {
    const land = resolveEmergencyBoardSelection({
      screen: noScreenContent,
      tenant,
      isPortrait: false,
      locationModeOn: false,
      drillPairHasItems: () => true,
    });
    const port = resolveEmergencyBoardSelection({
      screen: noScreenContent,
      tenant,
      isPortrait: true,
      locationModeOn: false,
      drillPairHasItems: () => true,
    });
    expect(land.MEDICAL.live).toEqual({
      playlistId: 'pl-medical-land',
      perScreen: false,
    });
    expect(port.MEDICAL.live).toEqual({
      playlistId: 'pl-medical-port',
      perScreen: false,
    });
    // Both-ways fallback: a portrait screen uses the landscape slot when no portrait one is set.
    expect(port.LOCKDOWN.live).toEqual({
      playlistId: 'pl-lockdown-land',
      perScreen: false,
    });
    // A type with nothing configured resolves to no board (the manifest's system board).
    expect(land.WEATHER.live).toEqual({ playlistId: null, perScreen: false });
  });

  it('drill: the tenant drill pair when it has items, else the live pair', () => {
    const withItems = resolveEmergencyBoardSelection({
      screen: noScreenContent,
      tenant,
      isPortrait: true,
      locationModeOn: false,
      drillPairHasItems: () => true,
    });
    const empty = resolveEmergencyBoardSelection({
      screen: noScreenContent,
      tenant,
      isPortrait: true,
      locationModeOn: false,
      drillPairHasItems: () => false,
    });
    expect(withItems.MEDICAL.drill.playlistId).toBe('pl-drill-medical-port');
    expect(empty.MEDICAL.drill.playlistId).toBe('pl-medical-port');
  });

  it("location mode: the screen's own content wins and is marked perScreen; off, the same columns are ignored", () => {
    const screen = {
      emergencyMedicalPlaylistId: 'pl-own-land',
      emergencyMedicalPortraitPlaylistId: null,
    };
    const on = resolveEmergencyBoardSelection({
      screen,
      tenant,
      isPortrait: true,
      locationModeOn: true,
      drillPairHasItems: () => false,
    });
    const off = resolveEmergencyBoardSelection({
      screen,
      tenant,
      isPortrait: true,
      locationModeOn: false,
      drillPairHasItems: () => false,
    });
    expect(on.MEDICAL.live).toEqual({
      playlistId: 'pl-own-land',
      perScreen: true,
    });
    expect(on.MEDICAL.drill).toEqual({
      playlistId: 'pl-own-land',
      perScreen: true,
    });
    expect(off.MEDICAL.live).toEqual({
      playlistId: 'pl-medical-port',
      perScreen: false,
    });
  });

  it('a double-sided unit: the portrait BACK face (panel mode 960×540) resolves the PORTRAIT board like the front', () => {
    const front = {
      resolution: '1080×1920',
      orientation: 'PORTRAIT',
      faceOfScreenId: null,
      hardwareModel: 'generic-android',
    };
    const back = {
      resolution: '960×540',
      orientation: 'PORTRAIT',
      faceOfScreenId: 'front-id',
      hardwareModel: 'generic-android',
    };
    const sel = (screen: any) =>
      resolveEmergencyBoardSelection({
        screen,
        tenant,
        isPortrait: emergencyLayoutIsPortrait(screen),
        locationModeOn: true,
        drillPairHasItems: () => false,
      });
    expect(sel(front).MEDICAL.live.playlistId).toBe('pl-medical-port');
    expect(sel(back).MEDICAL.live.playlistId).toBe('pl-medical-port');
  });

  it('an LED poster (OS 1920×1080, 320×1080 module) resolves the PORTRAIT board; its OS resolution alone would have said landscape', () => {
    const poster = {
      resolution: '1920×1080',
      orientation: 'AUTO',
      faceOfScreenId: null,
      hardwareModel: 'novastar-taurus',
      canvasW: null,
      canvasH: null,
    };
    const isPortrait = emergencyLayoutIsPortrait(poster, { w: 320, h: 1080 });
    expect(isPortrait).toBe(true);
    const sel = resolveEmergencyBoardSelection({
      screen: poster,
      tenant,
      isPortrait,
      locationModeOn: true,
      drillPairHasItems: () => false,
    });
    expect(sel.MEDICAL.live.playlistId).toBe('pl-medical-port');
    // The old rule (resolution only) — the cause on the glass.
    expect(
      emergencyLayoutIsPortrait({
        ...poster,
        hardwareModel: 'generic-android',
      }),
    ).toBe(false);
  });
});
