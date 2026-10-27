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
  keepStagedBoards,
  persistStagedBoards,
  readPersistedStagedBoards,
  readStagedBoardsResponse,
  selectStagedBoard,
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
  it("an explicit trigger playlist replaces the tenant pair, but never this screen's own (perScreen) content", () => {
    expect(selectStagedBoard(staged, { type: 'MEDICAL' }, 'pl-land')?.id).toBe('pl-land');
    expect(selectStagedBoard(staged, { type: 'LOCKDOWN' }, 'pl-land')?.id).toBe('pl-own');
    // An explicit playlist that is not staged is not guessed at.
    expect(selectStagedBoard(staged, { type: 'MEDICAL' }, 'pl-unknown')).toBeNull();
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
