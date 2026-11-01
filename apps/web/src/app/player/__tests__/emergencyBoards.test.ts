/**
 * Instant emergency boards (2026-10-26) — the pure rules behind "the full
 * board on glass the instant the signed push lands":
 *   • ONE identity for the push-raised and the manifest-asserted alert (the
 *     real push carries `type: 'medical'`, the manifest `MEDICAL`);
 *   • the staged boards: read, select (type × live/drill, explicit playlist,
 *     per-screen content), keep (never a wipe), persist;
 *   • raise-only: a board is chosen for an alert the page already holds, and
 *     the board interlock keeps it only while the alert itself is kept.
 */
import { emergencyPaintIdentity } from '../emergencyPaintProof';
import { alertFromOverridePush, alertFromRevEnvelope, overridePushPlaylistId } from '../emergencyRev';
import { emergencyBoardStaysOnGlass } from '../emergencyInterlock';
import {
  isTemplateBoard,
  keepStagedBoards,
  persistStagedBoards,
  readPersistedStagedBoards,
  readStagedBoardsResponse,
  selectStagedBoard,
  stagedBoardImageUrls,
  stagedBoardsStorageKey,
  type StagedBoards,
} from '../emergencyBoards';

/** The signed OVERRIDE payload exactly as the API builds it for the dashboard's MEDICAL button. */
const REAL_PUSH_PAYLOAD = { overrideId: 'ovr_test_1', severity: 'CRITICAL', type: 'medical', playlistId: undefined, mediaUrl: undefined, textBlob: undefined, expiresAt: 1_800_000_000 };
/** The same alert as the manifest's emergency branch states it (location-mode override row). */
const MANIFEST_ALERT = { active: true, type: 'MEDICAL', severity: 'CRITICAL', scopeNote: null, scope: 'screen', expiresAt: 1_800_000_000, isDrill: false };

describe('one identity per alert', () => {
  it('the alert raised from the real push shape and the manifest alert hash to ONE identity', () => {
    const raised = alertFromOverridePush(REAL_PUSH_PAYLOAD);
    expect(raised).not.toBeNull();
    expect(raised!.type).toBe('MEDICAL');
    expect(emergencyPaintIdentity(raised)).toBe(emergencyPaintIdentity(MANIFEST_ALERT));
    // The measured production pair: 126c2f1f (push) vs 431df93f (manifest).
    expect(emergencyPaintIdentity(MANIFEST_ALERT)).toBe('431df93f');
    expect(emergencyPaintIdentity(raised)).toBe('431df93f');
  });
  it('a lower-case type reaching the identity through any other path is the same identity too', () => {
    expect(emergencyPaintIdentity({ ...MANIFEST_ALERT, type: 'medical' })).toBe('431df93f');
    expect(emergencyPaintIdentity({ ...MANIFEST_ALERT, severity: 'critical' })).toBe('431df93f');
  });
  it('the rev descriptor is raised with the same canonical type', () => {
    const fromRev = alertFromRevEnvelope({ type: 'OVERRIDE', signature: 'x', payload: { active: true, type: 'medical', severity: 'CRITICAL', scope: 'tenant' } });
    expect(fromRev?.type).toBe('MEDICAL');
  });
  it('a drill stays a different identity from the live alert of the same type', () => {
    expect(emergencyPaintIdentity(alertFromOverridePush({ ...REAL_PUSH_PAYLOAD, isDrill: true }))).not.toBe('431df93f');
  });
  it('the explicit trigger playlist is read from the push, never invented', () => {
    expect(overridePushPlaylistId(REAL_PUSH_PAYLOAD)).toBeNull();
    expect(overridePushPlaylistId({ ...REAL_PUSH_PAYLOAD, playlistId: 'pl-custom' })).toBe('pl-custom');
    expect(overridePushPlaylistId(null)).toBeNull();
  });
});

const board = (id: string, url: string) => ({
  id, name: `Board ${id}`,
  items: [{ item_id: `${id}-i1`, asset_id: 'a1', asset_hash: 'h1', url, duration_ms: 10_000, sequence: 0, mime_type: 'image/png', transition_type: null }],
});

const RESPONSE = {
  assets: [], setHash: 'set-1',
  boards: { 'pl-land': board('pl-land', 'https://cdn.invalid/land.png'), 'pl-port': board('pl-port', 'https://cdn.invalid/port.png'), 'pl-drill': board('pl-drill', 'https://cdn.invalid/drill.png'), 'pl-own': board('pl-own', 'https://cdn.invalid/own.png') },
  boardFor: {
    MEDICAL: { live: { playlistId: 'pl-port', perScreen: false }, drill: { playlistId: 'pl-drill', perScreen: false } },
    LOCKDOWN: { live: { playlistId: 'pl-own', perScreen: true }, drill: { playlistId: 'pl-own', perScreen: true } },
    WEATHER: { live: { playlistId: null, perScreen: false }, drill: { playlistId: null, perScreen: false } },
  },
};

describe('reading the staged boards', () => {
  it('reads the API response and ignores malformed boards', () => {
    const staged = readStagedBoardsResponse({ ...RESPONSE, boards: { ...RESPONSE.boards, bad: { id: 'bad', items: [] }, mismatch: board('other', 'https://x/y.png') } });
    expect(staged).not.toBeNull();
    expect(Object.keys(staged!.boards).sort()).toEqual(['pl-drill', 'pl-land', 'pl-own', 'pl-port']);
    expect(staged!.boardFor.MEDICAL?.live.playlistId).toBe('pl-port');
    expect(staged!.setHash).toBe('set-1');
  });
  it('an older API (no boards), an empty map or a broken body reads as null', () => {
    expect(readStagedBoardsResponse({ assets: [], setHash: 'x' })).toBeNull();
    expect(readStagedBoardsResponse({ boards: {} })).toBeNull();
    expect(readStagedBoardsResponse(null)).toBeNull();
    expect(readStagedBoardsResponse('nope')).toBeNull();
  });
  it('an empty or failed response never wipes what is staged', () => {
    const prev = readStagedBoardsResponse(RESPONSE)!;
    expect(keepStagedBoards(prev, readStagedBoardsResponse({ assets: [] }))).toBe(prev);
    expect(keepStagedBoards(prev, null)).toBe(prev);
    const next = readStagedBoardsResponse({ ...RESPONSE, setHash: 'set-2' })!;
    expect(keepStagedBoards(prev, next)).toBe(next);
  });
  it('persists per screen and reads back the same boards', () => {
    const store = new Map<string, string>();
    const like = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    const staged = readStagedBoardsResponse(RESPONSE)!;
    persistStagedBoards(like, 'screen-1', staged);
    expect(store.has(stagedBoardsStorageKey('screen-1'))).toBe(true);
    expect(readPersistedStagedBoards(like, 'screen-1')).toEqual(staged);
    expect(readPersistedStagedBoards(like, 'screen-2')).toBeNull();
    const throwing = { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('disabled'); } };
    expect(() => persistStagedBoards(throwing, 'screen-1', staged)).not.toThrow();
    expect(readPersistedStagedBoards(throwing, 'screen-1')).toBeNull();
  });
});

describe('selecting the board for an alert', () => {
  const staged: StagedBoards = readStagedBoardsResponse(RESPONSE)!;
  it('picks the board the trigger resolves for this screen, from the push-raised alert (lower-case type)', () => {
    const raised = alertFromOverridePush(REAL_PUSH_PAYLOAD)!;
    expect(selectStagedBoard(staged, raised, overridePushPlaylistId(REAL_PUSH_PAYLOAD))?.id).toBe('pl-port');
    expect(selectStagedBoard(staged, { type: 'medical' })?.id).toBe('pl-port');
  });
  it('a drill picks the drill board', () => {
    expect(selectStagedBoard(staged, { type: 'MEDICAL', isDrill: true })?.id).toBe('pl-drill');
  });
  it('no staged board for the type → null (the typed surface, unchanged)', () => {
    expect(selectStagedBoard(staged, { type: 'WEATHER' })).toBeNull();
    expect(selectStagedBoard(staged, { type: 'SECURE' })).toBeNull();
    expect(selectStagedBoard(null, { type: 'MEDICAL' })).toBeNull();
    expect(selectStagedBoard(staged, null)).toBeNull();
  });
  it("never takes the push's playlist id: a drill never gets the live board, a portrait screen keeps its own", () => {
    const own = selectStagedBoard(staged, { type: 'MEDICAL' });
    expect(own).not.toBeNull();
    expect(selectStagedBoard(staged, { type: 'MEDICAL' }, 'pl-land')).toBe(own);
    expect(selectStagedBoard(staged, { type: 'MEDICAL' }, 'pl-unknown')).toBe(own);
    expect(selectStagedBoard(staged, { type: 'LOCKDOWN' }, 'pl-land')?.id).toBe('pl-own');
    const drill = selectStagedBoard(staged, { type: 'MEDICAL', isDrill: true }, 'pl-land');
    expect(drill === null || drill.id !== 'pl-land').toBe(true);
  });
  it('never selects for anything but an alert the page already holds (raise-only: no alert → nothing)', () => {
    expect(selectStagedBoard(staged, undefined)).toBeNull();
    expect(selectStagedBoard(staged, { type: '' })).toBeNull();
  });
});

describe('the board interlock', () => {
  it('keeps the board exactly when the alert is kept and the board is on the glass', () => {
    expect(emergencyBoardStaysOnGlass({ alertStaysOnGlass: true, boardOnGlass: true })).toBe(true);
  });
  it('never a release path: once the alert may be released, or no board is up, the manifest decides', () => {
    expect(emergencyBoardStaysOnGlass({ alertStaysOnGlass: false, boardOnGlass: true })).toBe(false);
    expect(emergencyBoardStaysOnGlass({ alertStaysOnGlass: true, boardOnGlass: false })).toBe(false);
    expect(emergencyBoardStaysOnGlass({ alertStaysOnGlass: false, boardOnGlass: false })).toBe(false);
  });
});

/**
 * 2026-10-31 — "first frame is the final board". `boardFor` now names the
 * BOARD the manifest will play (`boardKey`), which may be a synthesized one:
 * the screen's single file (`asset:…`) or the system text board (`system:…`).
 * The launch site's live LANDSCAPE playlists have no items, so `playlistId`
 * alone named a board that was never staged.
 */
const systemBoard = (type: string, drill: boolean, bg = drill ? '#3730a3' : '#dc2626') => ({
  id: 'DEFAULT_EMERGENCY', name: `SYSTEM DEFAULT - ${type}`, contentRev: `rev-${type}-${drill ? 'd' : 'l'}`, items: [],
  template: { name: 'EMERGENCY OVERRIDE', bgColor: bg, screenWidth: 1920, screenHeight: 1080, zones: [{ id: 'emergency-zone', widgetType: 'TEXT', defaultConfig: { content: `${type}` } }] },
});
const RESPONSE_V2 = {
  assets: [], setHash: 'set-2',
  boards: {
    'pl-land-empty-never-staged': undefined,
    'pl-port': board('pl-port', 'https://cdn.invalid/port.png'),
    'pl-drill': board('pl-drill', 'https://cdn.invalid/drill.png'),
    'asset:EVACUATE:live': { id: 'screen-asset-evacuate', name: 'EVACUATE (custom asset)', items: [{ item_id: 'screen-asset-scr-evacuate', asset_id: null, asset_hash: null, url: 'https://cdn.invalid/exit.png', duration_ms: 60_000, sequence: 0, mime_type: 'image/png', transition_type: null }] },
    'system:MEDICAL:live': systemBoard('MEDICAL', false),
    'system:MEDICAL:drill': systemBoard('MEDICAL', true),
    'system:HOLD:live': systemBoard('HOLD', false),
    'bogus:key': systemBoard('X', false), // an unknown staging kind is dropped
  },
  boardFor: {
    // A landscape screen: the live playlist resolved but is EMPTY → the system board; the drill board has content.
    MEDICAL: { live: { playlistId: 'pl-land-empty-never-staged', perScreen: false, boardKey: 'system:MEDICAL:live' }, drill: { playlistId: 'pl-drill', perScreen: false, boardKey: 'pl-drill' } },
    EVACUATE: { live: { playlistId: null, perScreen: false, boardKey: 'asset:EVACUATE:live' }, drill: { playlistId: null, perScreen: false, boardKey: 'asset:EVACUATE:live' } },
    HOLD: { live: { playlistId: null, perScreen: false, boardKey: 'system:HOLD:live' }, drill: { playlistId: null, perScreen: false, boardKey: 'system:HOLD:drill' } },
  },
};

describe('what the manifest will play: boardKey, synthesized boards', () => {
  const staged = readStagedBoardsResponse(RESPONSE_V2)!;
  it('reads synthesized boards under their staging keys and keeps the manifest id inside; an unknown kind is dropped', () => {
    expect(Object.keys(staged.boards).sort()).toEqual(['asset:EVACUATE:live', 'pl-drill', 'pl-port', 'system:HOLD:live', 'system:MEDICAL:drill', 'system:MEDICAL:live']);
    expect(staged.boards['system:MEDICAL:live'].id).toBe('DEFAULT_EMERGENCY');
    expect(isTemplateBoard(staged.boards['system:MEDICAL:live'])).toBe(true);
    expect(isTemplateBoard(staged.boards['pl-port'])).toBe(false);
    expect(staged.boardFor.MEDICAL?.live.boardKey).toBe('system:MEDICAL:live');
  });
  it('a landscape LIVE alert whose own playlist is empty opens on the SYSTEM board, never the empty playlist, never the portrait board', () => {
    const raised = alertFromOverridePush(REAL_PUSH_PAYLOAD)!;
    const picked = selectStagedBoard(staged, raised, null, { severity: 'CRITICAL' });
    expect(picked?.id).toBe('DEFAULT_EMERGENCY');
    expect(picked?.contentRev).toBe('rev-MEDICAL-l');
  });
  it('the same type as a DRILL opens on the drill board — live and drill never cross', () => {
    expect(selectStagedBoard(staged, { type: 'medical', isDrill: true }, null, { severity: 'CRITICAL' })?.id).toBe('pl-drill');
    expect(selectStagedBoard(staged, { type: 'HOLD', isDrill: true }, null, { severity: 'CRITICAL' })).toBeNull(); // no drill system board staged → typed surface
    expect(selectStagedBoard(staged, { type: 'HOLD' }, null, { severity: 'CRITICAL' })?.contentRev).toBe('rev-HOLD-l');
  });
  it("a screen with only a single file for the type opens on that file's board", () => {
    expect(selectStagedBoard(staged, { type: 'evacuate' }, null, { severity: 'CRITICAL' })?.id).toBe('screen-asset-evacuate');
  });
  it('the system board is skipped when the trigger carries words, media or another colour — the manifest brings a different board then', () => {
    expect(selectStagedBoard(staged, { type: 'MEDICAL' }, null, { severity: 'CRITICAL', textBlob: 'Room 12' })).toBeNull();
    expect(selectStagedBoard(staged, { type: 'MEDICAL' }, null, { severity: 'CRITICAL', mediaUrl: 'https://cdn.invalid/x.png' })).toBeNull();
    expect(selectStagedBoard(staged, { type: 'MEDICAL' }, null, { severity: 'MEDIUM' })).toBeNull();
    expect(selectStagedBoard(staged, { type: 'MEDICAL' }, null, { severity: 'HIGH' })?.id).toBe('DEFAULT_EMERGENCY');
    expect(selectStagedBoard(staged, { type: 'MEDICAL' }, null, null)?.id).toBe('DEFAULT_EMERGENCY');
    // A CUSTOM board is what the manifest plays whatever the trigger's words or severity.
    expect(selectStagedBoard(staged, { type: 'medical', isDrill: true }, null, { severity: 'MEDIUM', textBlob: 'words' })?.id).toBe('pl-drill');
  });
  it('an older payload (playlistId only) selects exactly as before', () => {
    const old = readStagedBoardsResponse(RESPONSE)!;
    expect(old.boardFor.MEDICAL?.live.boardKey).toBeNull();
    expect(selectStagedBoard(old, { type: 'medical' })?.id).toBe('pl-port');
  });
  it('the pictures to pre-decode: images of every staged board, once each, bounded', () => {
    expect(stagedBoardImageUrls(staged)).toEqual(['https://cdn.invalid/port.png', 'https://cdn.invalid/drill.png', 'https://cdn.invalid/exit.png']);
    expect(stagedBoardImageUrls(staged, 2)).toHaveLength(2);
    expect(stagedBoardImageUrls(null)).toEqual([]);
  });
});
