/**
 * refresh-request-origin — who asked for the durable REFRESH_WEB a manifest
 * carries (never-interrupt program, 2026-10-10).
 *
 * Greg's #1 player requirement: playing content is never interrupted unless
 * someone changes it. A durable refresh (`Screen.pendingRefreshAt` →
 * manifest `refreshRequestedAt`) is stamped by two very different hands:
 *
 *   - an OPERATOR — Refresh / Resync / publish-to-fleet. Always honoured;
 *     the person is standing there expecting the screen to reload.
 *   - the SYSTEM — the wedge detector (which can only see server-side
 *     telemetry) or a rendition swap. The player holds strictly better
 *     evidence about its own health than the server does: if it is painting
 *     frames and fetching manifests, a system reload would only tear down
 *     content a customer is looking at. The player therefore declines a
 *     SYSTEM refresh it can prove is unnecessary — but it can only tell the
 *     two apart if the manifest says which it was.
 *
 * `Screen.pendingRefreshSource` is written in the same statement as
 * `pendingRefreshAt` ('operator' | 'system') and cleared with it. This helper
 * is the ONE place that maps the column to the manifest field, so the three
 * manifest branches and the player agree on the vocabulary.
 *
 * Unknown / null (a row stamped before the column existed, or a writer this
 * file does not know about) reads as OPERATOR: that is the pre-column
 * behaviour — the reload happens — so a missing stamp can never make a
 * person's refresh silently disappear. Fail towards doing what was asked.
 */

export type RefreshRequestOrigin = 'operator' | 'system';

export const REFRESH_SOURCE_OPERATOR: RefreshRequestOrigin = 'operator';
export const REFRESH_SOURCE_SYSTEM: RefreshRequestOrigin = 'system';

/**
 * The manifest's `refreshRequestedBy` for a screen row. `null` when there is
 * no pending refresh at all — the field rides beside `refreshRequestedAt` and
 * is null exactly when that one is, so the hashed manifest body stays stable
 * between command edges.
 */
export function refreshRequestedBy(
  pendingRefreshAt: Date | string | number | null | undefined,
  pendingRefreshSource: string | null | undefined,
): RefreshRequestOrigin | null {
  if (pendingRefreshAt === null || pendingRefreshAt === undefined) return null;
  return pendingRefreshSource === REFRESH_SOURCE_SYSTEM ? REFRESH_SOURCE_SYSTEM : REFRESH_SOURCE_OPERATOR;
}
