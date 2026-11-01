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
  /**
   * The SYSTEM board (2026-10-31): the manifest's `DEFAULT_EMERGENCY` text
   * template, staged so a screen with no board of its own still opens on the
   * final board. `items` is empty for it; `contentRev` is part of the apply
   * signature (`tpl:<name>:<rev>`), exactly as the manifest carries it.
   */
  template?: Record<string, unknown>;
  contentRev?: string;
}

export function isTemplateBoard(board: StagedBoard | null | undefined): boolean {
  return !!board && !!board.template && typeof board.template === 'object';
}

export interface BoardSelection {
  playlistId: string | null;
  perScreen: boolean;
  /**
   * The key in `boards` of what the manifest WILL play for this (type,
   * live|drill): the resolved playlist when it has content, else the screen's
   * single-file board (`asset:…`), else the system board (`system:…`). Absent
   * from an older API's payload, which only named `playlistId`.
   */
  boardKey?: string | null;
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
  const name = typeof r.name === 'string' ? r.name : r.id;
  // A template (system) board: a template with at least one zone, no items.
  if (r.template && typeof r.template === 'object' && !Array.isArray(r.template)) {
    const t = r.template as Record<string, unknown>;
    if (!Array.isArray(t.zones) || t.zones.length === 0 || typeof t.bgColor !== 'string') return null;
    if (r.items.length !== 0) return null;
    return { id: r.id, name, items: [], template: t, contentRev: typeof r.contentRev === 'string' ? r.contentRev : undefined };
  }
  const items = r.items.map(readItem);
  if (items.length === 0 || items.some((i) => i === null)) return null;
  return { id: r.id, name, items: items as StagedBoardItem[] };
}

function readSelection(value: unknown): BoardSelection | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  return {
    playlistId: typeof r.playlistId === 'string' && r.playlistId.length > 0 ? r.playlistId : null,
    perScreen: r.perScreen === true,
    boardKey: typeof r.boardKey === 'string' && r.boardKey.length > 0 ? r.boardKey : null,
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
  for (const [key, raw] of Object.entries(r.boards as Record<string, unknown>)) {
    const board = readBoard(raw);
    // A custom board is keyed by its playlist id; a synthesized one
    // (`asset:…` / `system:…`) keeps the manifest's own id inside.
    if (board && (board.id === key || /^(asset|system):/.test(key))) boards[key] = board;
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
export interface PushBoardFacts {
  /** The push's severity — the system board was staged red (CRITICAL); a different colour is not the same board. */
  severity?: string | null;
  /** Operator-typed words on the trigger: the system board the manifest brings carries them, the staged one does not. */
  textBlob?: string | null;
  /** A media URL on the trigger: the manifest plays it instead of the system board. */
  mediaUrl?: string | null;
}

export function selectStagedBoard(
  staged: StagedBoards | null | undefined,
  alert: { type: string; isDrill?: boolean } | null | undefined,
  pushPlaylistId: string | null = null,
  push: PushBoardFacts | null = null,
): StagedBoard | null {
  if (!staged || !alert || typeof alert.type !== 'string') return null;
  const type = alert.type.trim().toUpperCase() as EmergencyBoardType;
  const entry = staged.boardFor[type];
  const selection = entry ? (alert.isDrill === true ? entry.drill : entry.live) : null;
  if (!selection) return null;
  // ONLY this screen's own staged board for (type, drill|live, orientation)
  // (2026-10-27, on-site test). The push's playlistId is the landscape LIVE
  // board: using it put the live board on a drill and missed every portrait
  // screen. An explicitly chosen non-default board arrives with the manifest.
  void pushPlaylistId;
  // 2026-10-31 — `boardKey` is what the manifest will play (a resolved
  // playlist with no items is "no playlist" to it: the launch site's live
  // landscape playlists are empty, so every landscape screen waited for the
  // committed manifest and then changed boards). An older payload has only
  // `playlistId`.
  const key = selection.boardKey ?? selection.playlistId;
  const board = key ? staged.boards[key] ?? null : null;
  if (!board) return null;
  if (isTemplateBoard(board)) {
    // The staged system board carries the standard words on the CRITICAL
    // colour. A trigger with its own words, its own media or another
    // severity gets a different board from the manifest; the typed surface
    // (same words, same colour rule) bridges that one instead.
    if (push?.textBlob || push?.mediaUrl) return null;
    const colour = String((board.template as Record<string, unknown>).bgColor ?? '');
    const expected = alert.isDrill === true ? '#3730a3' : (push?.severity == null || /^(CRITICAL|HIGH)$/i.test(String(push.severity)) ? '#dc2626' : '#d97706');
    if (colour.toLowerCase() !== expected) return null;
  }
  return board;
}

/**
 * The picture files of the staged boards, for pre-decoding (2026-10-31): a
 * board raised from the push paints on its first frame only if its picture is
 * already decoded — on a slow panel a 4K PNG takes long enough to decode that
 * the protective surface showed first ("some screens are fast, some slow").
 * Images only, de-duplicated, bounded.
 */
export function stagedBoardImageUrls(staged: StagedBoards | null | undefined, max = 24): string[] {
  if (!staged) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const board of Object.values(staged.boards)) {
    for (const item of board.items) {
      const mime = item.mime_type || '';
      const isImage = mime.startsWith('image/') || (!mime && /\.(png|jpe?g|webp|gif|bmp)(\?|#|$)/i.test(item.url));
      if (!isImage || seen.has(item.url)) continue;
      seen.add(item.url);
      out.push(item.url);
      if (out.length >= max) return out;
    }
  }
  return out;
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
