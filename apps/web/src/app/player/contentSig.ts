/**
 * The identity a playlist item's `contentVersion` is hashed from — the thing
 * the player's apply signature (`newSig`, `playlistItemsSig`) uses to decide
 * "same playlist, nothing to do" versus "this changed, re-apply".
 *
 * It used to fold in only the served bytes' identity and the mute flag. A
 * TRANSITION-only edit (fade → slide, on an unchanged playlist) therefore
 * produced an identical signature and was discarded at
 * `newSig === currentPlaylistSigRef.current`: the new manifest arrived, the
 * player looked at it, called it "the same playlist" and kept playing with the
 * old transition until something else forced a reload — which is why the
 * change looked intermittent or tied to a restart. Finding F3 of
 * docs/research/2026-09-29-video-loop/REPORT.md (confirmed there as a
 * functional defect; NOT offered as the cause of the solo-loop hitch).
 *
 * Pure, so it is unit-tested without mounting the 13k-line player page.
 */
export interface ContentSigItem {
  asset_hash?: string | null;
  muted?: boolean | null;
  transition_type?: string | null;
}

/**
 * @param urlKey the item's `stableManifestUrlKey(url)` — used only when the
 *   manifest carries no asset hash.
 */
export function itemContentSigInput(item: ContentSigItem, urlKey: string): string {
  return `${item.asset_hash || urlKey}|${item.muted ?? ''}|${item.transition_type ?? ''}`;
}
