# Editor save-path hardening — #293 + snapshotVersion atomicity (2026-07-03)

From the overnight regression review (docs/research/2026-07-02-sports-deep-pass/06-OVERNIGHT-REVIEW.md).

**#293 [P1] version-restore staleness guard.** POST :id/versions/:versionId/restore
performed the same destructive delete-all-zones-and-recreate as update/replaceZones
but had NO C2 guard — a stale tab's Restore silently clobbered another device's fresh
save. Fix: inline `expectedUpdatedAt` body param (same BoundedText(64).nullish() shape),
`assertNotStale(template, body?.expectedUpdatedAt)` before any destructive write (same
position as update:2281 / replaceZones:2341). Client threads it from
useBuilderStore.serverUpdatedAt (same source as handleSave); on 409 TEMPLATE_STALE the
EXISTING saveConflict banner is reused (copy switches Restore/Save; handleOverwrite
retries the right op). Stateful spec (advancing updatedAt) proves succeed/409/omit +
no-side-effect. Commit 6fc614f6.

**snapshotVersion atomicity [P2].** create+findMany+deleteMany cap-eviction was 3
sequential awaits despite a doc-comment claiming one transaction; wrapped in an
interactive `$transaction(async tx => …)`; outer try/catch unchanged (a version-write
failure never fails the save). Commit 16c3c8f6.

Checks (agent worktree): api tsc clean, web tsc clean, jest c2-staleness-guard +
c3-version-history 34 tests pass, mobile-perf clean, templates+ai scope 337 tests green.
Fence-clean (4 permitted files). Re-gated by lead before merge.
