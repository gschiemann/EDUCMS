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
  screenAssetBoard,
  screenAssetUrlFor,
  systemEmergencyBoard,
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
    expect(land.MEDICAL.live).toMatchObject({
      playlistId: 'pl-medical-land',
      perScreen: false,
    });
    expect(port.MEDICAL.live).toMatchObject({
      playlistId: 'pl-medical-port',
      perScreen: false,
    });
    // Both-ways fallback: a portrait screen uses the landscape slot when no portrait one is set.
    expect(port.LOCKDOWN.live).toMatchObject({
      playlistId: 'pl-lockdown-land',
      perScreen: false,
    });
    // A type with nothing configured resolves to no board (the manifest's system board).
    expect(land.WEATHER.live).toMatchObject({
      playlistId: null,
      perScreen: false,
      boardKey: 'system:WEATHER:live',
    });
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
    expect(on.MEDICAL.live).toMatchObject({
      playlistId: 'pl-own-land',
      perScreen: true,
    });
    expect(on.MEDICAL.drill).toMatchObject({
      playlistId: 'pl-own-land',
      perScreen: true,
    });
    expect(off.MEDICAL.live).toMatchObject({
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

describe('boardKey — what the manifest WILL play (2026-10-31, "first frame is the final board")', () => {
  // The launch site's live LANDSCAPE playlists have no items; every portrait
  // and every drill playlist has one. The id still resolves (it is not null),
  // but the manifest plays an empty playlist as "no playlist".
  const hasItems = (id: string) =>
    id !== 'pl-medical-land' && id !== 'pl-lockdown-land';

  it('a landscape screen whose live board is EMPTY stages the SYSTEM board, not the empty playlist and not the portrait board', () => {
    const land = resolveEmergencyBoardSelection({
      screen: noScreenContent,
      tenant,
      isPortrait: false,
      locationModeOn: true,
      drillPairHasItems: () => true,
      boardHasItems: hasItems,
    });
    expect(land.MEDICAL.live).toEqual({
      playlistId: 'pl-medical-land',
      perScreen: false,
      boardKey: 'system:MEDICAL:live',
    });
    // The drill board has content: the drill stages it. Live and drill never cross.
    expect(land.MEDICAL.drill).toEqual({
      playlistId: 'pl-drill-medical-land',
      perScreen: false,
      boardKey: 'pl-drill-medical-land',
    });
  });

  it('a portrait screen stages its own live board; the back face of a double-sided unit is a portrait screen', () => {
    const back = {
      resolution: '960×540',
      orientation: 'PORTRAIT',
      faceOfScreenId: 'front',
      hardwareModel: 'generic-android',
    };
    const isPortrait = emergencyLayoutIsPortrait(back);
    expect(isPortrait).toBe(true);
    const sel = resolveEmergencyBoardSelection({
      screen: back,
      tenant,
      isPortrait,
      locationModeOn: true,
      drillPairHasItems: () => true,
      boardHasItems: hasItems,
    });
    expect(sel.MEDICAL.live.boardKey).toBe('pl-medical-port');
    expect(sel.MEDICAL.drill.boardKey).toBe('pl-drill-medical-port');
  });

  it('a screen with only a single FILE for the type (location mode) stages the screen-asset board; off, the system board', () => {
    const screen = {
      emergencyEvacuateAssetUrl: 'https://files.example/evacuate.png',
    };
    const on = resolveEmergencyBoardSelection({
      screen,
      tenant,
      isPortrait: false,
      locationModeOn: true,
      drillPairHasItems: () => false,
      boardHasItems: () => false,
    });
    expect(on.EVACUATE.live).toEqual({
      playlistId: null,
      perScreen: false,
      boardKey: 'asset:EVACUATE:live',
    });
    // A drill with no drill media of its own plays the screen's live file (the manifest's effectiveAsset order).
    expect(on.EVACUATE.drill.boardKey).toBe('asset:EVACUATE:drill');
    expect(screenAssetUrlFor(screen, 'EVACUATE', true, false)).toBe(
      'https://files.example/evacuate.png',
    );
    const off = resolveEmergencyBoardSelection({
      screen,
      tenant,
      isPortrait: false,
      locationModeOn: false,
      drillPairHasItems: () => false,
      boardHasItems: () => false,
    });
    expect(off.EVACUATE.live.boardKey).toBe('system:EVACUATE:live');
  });

  it('with no boardHasItems the selection reads as before (every resolved playlist counts)', () => {
    const sel = resolveEmergencyBoardSelection({
      screen: noScreenContent,
      tenant,
      isPortrait: false,
      locationModeOn: false,
      drillPairHasItems: () => true,
    });
    expect(sel.MEDICAL.live.boardKey).toBe('pl-medical-land');
  });
});

describe('the staged system board IS the manifest board', () => {
  it('builds the DEFAULT_EMERGENCY template exactly as the manifest branch did, with a content revision', () => {
    const live = systemEmergencyBoard({
      type: 'MEDICAL',
      severity: 'CRITICAL',
      isDrill: false,
      isPortrait: false,
    });
    expect(live.id).toBe('DEFAULT_EMERGENCY');
    expect(live.name).toBe('SYSTEM DEFAULT - MEDICAL');
    expect(live.items).toEqual([]);
    expect(live.template.name).toBe('EMERGENCY OVERRIDE');
    expect(live.template.bgColor).toBe('#dc2626');
    expect(live.template.screenWidth).toBe(1920);
    expect(live.template.screenHeight).toBe(1080);
    const zone = live.template.zones[0] as any;
    expect(zone.widgetType).toBe('TEXT');
    expect(zone.defaultConfig).toEqual({
      sizeMode: 'absolute',
      content:
        'MEDICAL EMERGENCY\n\nKeep this area clear.\nFollow staff directions.',
      fontSize: 100,
      fontWeight: 800,
      color: 'white',
      alignment: 'center',
      lineHeight: 1.15,
    });
    expect(live.contentRev).toMatch(/^[0-9a-f]{8}$/);
  });
  it('a drill is indigo and says DRILL; portrait is 1080×1920 at 140; an LED canvas wins; each is a different revision', () => {
    const drill = systemEmergencyBoard({
      type: 'HOLD',
      severity: 'CRITICAL',
      isDrill: true,
      isPortrait: true,
    });
    expect(drill.template.bgColor).toBe('#3730a3');
    expect(drill.template.screenWidth).toBe(1080);
    expect((drill.template.zones[0] as any).defaultConfig.fontSize).toBe(140);
    expect(
      (drill.template.zones[0] as any).defaultConfig.content.startsWith(
        'DRILL — THIS IS A DRILL\n\nHOLD DRILL',
      ),
    ).toBe(true);
    const led = systemEmergencyBoard({
      type: 'HOLD',
      severity: 'CRITICAL',
      isDrill: true,
      isPortrait: true,
      canvasW: 320,
      canvasH: 1080,
    });
    expect([led.template.screenWidth, led.template.screenHeight]).toEqual([
      320, 1080,
    ]);
    const liveHold = systemEmergencyBoard({
      type: 'HOLD',
      severity: 'CRITICAL',
      isDrill: false,
      isPortrait: true,
    });
    const liveLockdown = systemEmergencyBoard({
      type: 'LOCKDOWN',
      severity: 'CRITICAL',
      isDrill: false,
      isPortrait: true,
    });
    expect(
      new Set([
        drill.contentRev,
        led.contentRev,
        liveHold.contentRev,
        liveLockdown.contentRev,
      ]).size,
    ).toBe(4);
    // The same inputs are the same revision — the staged board and the manifest board share one apply signature.
    expect(
      systemEmergencyBoard({
        type: 'HOLD',
        severity: 'CRITICAL',
        isDrill: false,
        isPortrait: true,
      }).contentRev,
    ).toBe(liveHold.contentRev);
  });
  it("the operator's text and a lesser severity change the board, as they do in the manifest", () => {
    const typed = systemEmergencyBoard({
      type: 'LOCKDOWN',
      severity: 'MEDIUM',
      isDrill: false,
      isPortrait: false,
      textBlob: 'Stay in place',
    });
    expect(typed.template.bgColor).toBe('#d97706');
    expect((typed.template.zones[0] as any).defaultConfig.content).toBe(
      'Stay in place',
    );
  });
  it('the single-file board keeps its manifest shape (id per type, item per screen, 60 s, mime from the extension)', () => {
    const b = screenAssetBoard({
      screenId: 'scr-1',
      typeKey: 'EVACUATE',
      url: 'https://files.example/x/exit.JPG?t=1',
    });
    expect(b).toEqual({
      id: 'screen-asset-evacuate',
      name: 'EVACUATE (custom asset)',
      items: [
        {
          item_id: 'screen-asset-scr-1-evacuate',
          asset_id: null,
          asset_hash: null,
          url: 'https://files.example/x/exit.JPG?t=1',
          duration_ms: 60_000,
          sequence: 0,
          mime_type: 'image/jpeg',
          transition_type: null,
        },
      ],
    });
    expect(
      screenAssetBoard({
        screenId: 's',
        typeKey: 'HOLD',
        url: 'https://f/x.mov',
      }).items[0].mime_type,
    ).toBe('video/quicktime');
  });
});
