/**
 * All-assets-failed tracker — player blank-screen class (b).
 *
 * 2026-07-01 LAUNCH-SPRINT player deep pass. A single broken playlist item
 * was already handled (onError → advance to the next item), but nothing
 * put a floor under the case where EVERY item in the live playlist fails
 * to load — a bulk Supabase outage, a bucket migration that left stale
 * signed URLs, or an operator's whole playlist pointing at deleted assets.
 * Without a floor, `currentIndex` increments forever through the same N
 * broken items and the kiosk shows nothing but its black container
 * background, indefinitely, with zero operator-facing signal. That is
 * exactly the cardinal-sin blank state this fix closes.
 *
 * Pulled out as a small pure class (rather than inlined refs in
 * page.tsx) so the failure-detection logic can be unit-tested without
 * mounting the ~8000-line player page component — same rationale as
 * `isContactUrl` / `dispatchTouchAction` being extracted as named
 * exports for `touch-dispatch.test.tsx`.
 */
export class AllAssetsFailedTracker {
  private failedIds = new Set<string>();

  /** Record one more broken item. Returns true iff EVERY distinct item id
   *  in `allIds` has now failed at least once (a full lap with zero
   *  successful renders) — the caller should show the fallback card. */
  recordFailure(itemId: string | null | undefined, allIds: readonly string[]): boolean {
    if (!itemId || allIds.length === 0) return false;
    this.failedIds.add(itemId);
    return allIds.every((id) => this.failedIds.has(id));
  }

  /** A single successful load is proof the outage (if there was one) is
   *  over — clear every recorded failure immediately rather than waiting
   *  for a full recovery lap across every item. */
  recordSuccess(): void {
    this.failedIds.clear();
  }

  /** Manifest delivered a genuinely different item set (republish, edit,
   *  or recovery). A republish deserves a clean slate rather than
   *  inheriting stale failure ids that no longer exist in the playlist. */
  reset(): void {
    this.failedIds.clear();
  }

  /** Diagnostic / test hook — current count of distinct failed item ids. */
  get failedCount(): number {
    return this.failedIds.size;
  }
}
