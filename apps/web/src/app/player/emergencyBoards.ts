/**
 * STAGED emergency boards — the player half (2026-10-26, the live alerts at a
 * launch site: "it should play instant").
 *
 * WHAT. `GET /screens/:id/emergency-assets` has always pre-delivered the
 * emergency FILES into the never-evict cache tier. It now also carries the
 * BOARDS — every emergency playlist a trigger could select for this screen,
 * keyed by playlist id, in exactly the shape the manifest's emergency branch
 * emits (`emergency-boards.ts`, one builder) — and `boardFor`: which of them a
 * tenant-scope trigger of each type resolves for THIS screen (live / drill),
 * with the screen's own content in location mode marked `perScreen`.
 *
 * On a gate-accepted signed OVERRIDE the page already knows the type and
 * whether it is a drill; with a staged board it can put the location's board
 * on the glass in the same tick, through the SAME playlist state the manifest
 * sets, so the committed manifest a few seconds later is "identical content"
 * (no re-mount, no visual change). No staged board → the typed surface, as
 * before.
 *
 * RULES (player rule 11 — each has a test):
 *   • a staged board may RAISE content for an alert the page already holds;
 *     it never decides that an alert exists, and nothing here releases one;
 *   • an EMPTY or malformed response never wipes the staged boards
 *     (`keepStagedBoards`), exactly like the never-evict tier;
 *   • boards are written only from an authenticated response (the caller's
 *     fetch carries the device token) and persisted per screen so a reload
 *     under a native hold can use them.
 *
 * Pure — no React, no DOM, no network.
 */

export const EMERGENCY_BOARD_TYPES = ['LOCKDOWN', 'EVACUATE', 'WEATHER', 'HOLD', 'SECURE', 'MEDICAL'] as const;
export type EmergencyBoardType = (typeof EMERGENCY_BOARD_TYPES)[number];

/** One manifest-shaped emergency playlist item (the API's `emergencyBoardPayload`). */
export interface StagedBoardItem {
  item_id: string;
  asset_id: string | null;
  asset_hash: string | null;
  url: string;
  duration_ms: number;
  sequence: number;
  mime_type: string | null;
  transition_type: string | null;
}

export interface StagedBoard {
  id: string;
  name: string;
  items: StagedBoardItem[];
}

export interface BoardSelection {
  playlistId: string | null;
  perScreen: boolean;
}

export interface StagedBoards {
  boards: Record<string, StagedBoard>;
  boardFor: Partial<Record<EmergencyBoardType, { live: BoardSelection; drill: BoardSelection }>>;
  setHash: string;
}

export const STAGED_BOARDS_KEY_PREFIX = 'edu_emergency_boards_v1:';

export function stagedBoardsStorageKey(screenId: string): string {
  return `${STAGED_BOARDS_KEY_PREFIX}${screenId}`;
}

function readItem(value: unknown): StagedBoardItem | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (typeof r.item_id !== 'string' || r.item_id.length === 0) return null;
  if (typeof r.url !== 'string' || r.url.length === 0) return null;
  if (typeof r.duration_ms !== 'number' || !Number.isFinite(r.duration_ms)) return null;
  if (typeof r.sequence !== 'number' || !Number.isFinite(r.sequence)) return null;
  return {
    item_id: r.item_id,
    asset_id: typeof r.asset_id === 'string' ? r.asset_id : null,
    asset_hash: typeof r.asset_hash === 'string' ? r.asset_hash : null,
    url: r.url,
    duration_ms: r.duration_ms,
    sequence: r.sequence,
    mime_type: typeof r.mime_type === 'string' ? r.mime_type : null,
    transition_type: typeof r.transition_type === 'string' ? r.transition_type : null,
  };
}

function readBoard(value: unknown): StagedBoard | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0 || !Array.isArray(r.items)) return null;
  const items = r.items.map(readItem);
  if (items.length === 0 || items.some((i) => i === null)) return null;
  return { id: r.id, name: typeof r.name === 'string' ? r.name : r.id, items: items as StagedBoardItem[] };
}

function readSelection(value: unknown): BoardSelection | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  return {
    playlistId: typeof r.playlistId === 'string' && r.playlistId.length > 0 ? r.playlistId : null,
    perScreen: r.perScreen === true,
  };
}

/**
 * The staged boards in an `emergency-assets` response, or `null` when it
 * carries none (an older API, a tenant with no boards, a partial body).
 * Structural only — trust is the authenticated fetch that produced `data`.
 */
export function readStagedBoardsResponse(data: unknown): StagedBoards | null {
  if (!data || typeof data !== 'object') return null;
  const r = data as Record<string, unknown>;
  if (!r.boards || typeof r.boards !== 'object' || Array.isArray(r.boards)) return null;
  const boards: Record<string, StagedBoard> = {};
  for (const [id, raw] of Object.entries(r.boards as Record<string, unknown>)) {
    const board = readBoard(raw);
    if (board && board.id === id) boards[id] = board;
  }
  if (Object.keys(boards).length === 0) return null;
  const boardFor: StagedBoards['boardFor'] = {};
  if (r.boardFor && typeof r.boardFor === 'object') {
    for (const type of EMERGENCY_BOARD_TYPES) {
      const entry = (r.boardFor as Record<string, unknown>)[type];
      if (!entry || typeof entry !== 'object') continue;
      const live = readSelection((entry as Record<string, unknown>).live);
      const drill = readSelection((entry as Record<string, unknown>).drill);
      if (live && drill) boardFor[type] = { live, drill };
    }
  }
  return { boards, boardFor, setHash: typeof r.setHash === 'string' ? r.setHash : '' };
}

/** A response with no usable boards keeps what was staged — never a wipe. */
export function keepStagedBoards(prev: StagedBoards | null, next: StagedBoards | null): StagedBoards | null {
  return next ?? prev;
}

/**
 * The board a gate-accepted alert should put on the glass, or `null` (the
 * typed surface). `pushPlaylistId` is the trigger's EXPLICIT playlist when
 * the operator chose one; it replaces the tenant pair for every screen except
 * one whose own content was picked (`perScreen`) — the trigger's rule.
 */
export function selectStagedBoard(
  staged: StagedBoards | null | undefined,
  alert: { type: string; isDrill?: boolean } | null | undefined,
  pushPlaylistId: string | null = null,
): StagedBoard | null {
  if (!staged || !alert || typeof alert.type !== 'string') return null;
  const type = alert.type.trim().toUpperCase() as EmergencyBoardType;
  const entry = staged.boardFor[type];
  const selection = entry ? (alert.isDrill === true ? entry.drill : entry.live) : null;
  const id = selection?.perScreen ? selection.playlistId : (pushPlaylistId || selection?.playlistId || null);
  if (!id) return null;
  return staged.boards[id] ?? null;
}

interface StoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function persistStagedBoards(store: StoreLike | null | undefined, screenId: string, staged: StagedBoards): void {
  try {
    store?.setItem(stagedBoardsStorageKey(screenId), JSON.stringify(staged));
  } catch { /* storage full / disabled: memory still has them */ }
}

export function readPersistedStagedBoards(store: StoreLike | null | undefined, screenId: string): StagedBoards | null {
  try {
    const raw = store?.getItem(stagedBoardsStorageKey(screenId));
    return raw ? readStagedBoardsResponse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
