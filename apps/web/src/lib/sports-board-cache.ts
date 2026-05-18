/**
 * Last-frame cache for the live sports surfaces — board, ribbon,
 * scorebug, and the scoreboard widget.
 *
 * Each surface writes the latest `/sports/board/:id` payload to
 * localStorage on every successful poll, and seeds from it on mount.
 * So a player power-cycle or a Wi-Fi blip mid-game paints the last
 * known state INSTANTLY — never a blank screen or an error box.
 *
 * A cached frame is returned with the clock FROZEN (`clockRunning:
 * false`): `clockUpdatedAt` is stale, so projecting a running clock
 * off it would show a wrong time. The first live poll (~2s later, or
 * whenever the network returns) restores the real running state.
 */

const KEY = (gameId: string) => `venueos_sports_board_${gameId}`;

export function readBoardCache<T extends { clockRunning?: boolean }>(
  gameId: string,
): T | null {
  if (typeof window === 'undefined' || !gameId) return null;
  try {
    const raw = window.localStorage.getItem(KEY(gameId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as T;
    return { ...parsed, clockRunning: false };
  } catch {
    return null;
  }
}

export function writeBoardCache(gameId: string, data: unknown): void {
  if (typeof window === 'undefined' || !gameId) return;
  try {
    window.localStorage.setItem(KEY(gameId), JSON.stringify(data));
  } catch {
    /* quota exceeded / private mode — non-fatal, just skip caching */
  }
}
