# FREEZE — VenueOS (launch)

While this file exists, every consequential category is ≤ L1 except the named exceptions; Frontier Intake pauses except Tier A security re-audits; the cross-vendor review rule applies only to emergency, auth/secrets, migrations, billing and the native player. Delete the file to lift the freeze.

| | |
|---|---|
| Reason | Customer launch on the GUQ panel class (launch week per docs/research/2026-10-24-launch-week/00-PLAN.md). |
| Declared by · date | The owner's launch-week instructions of 2026-10-24 / 2026-10-26, recorded here by the lead on 2026-10-31 (the standard treats a launch as a freeze). Owner to confirm. |
| Expires | When the owner lifts it (expected: the launch customer stable on the glass). |
| Named exceptions | All work on the launch tracker proceeds at the levels already in force — this freeze changes nothing about approved launch work ("wrap up never pauses approved launch work", owner 2026-10-26). Governance documentation (this folder, `AGENTS.md`). **Phase 1 life-safety items, by the owner's instruction "ok go" (2026-10-31), under the owner's condition "no disruption to the application or any account":** zero-runtime items may land now — the nightly scheduled emergency-path CI run, the synthetic on-glass drill *design*, the required-checks ruleset prepared for the owner; the two items that would redeploy the API when merged — routing every destructive database script through the guard, and the OTA blast-radius rule in code — are prepared as PRs and **held unmerged until the owner says so**. Each is its own PR, built by an agent in an isolated worktree, reviewed by the lead, merged only by the owner; nothing may touch the emergency delivery path itself without a different-vendor review and an on-glass drill. |
| Standing mitigations pre-authorised (L3, subtractive only) | revert last deployment · flip named kill switches · pause updates and field pushes — logged, owner notified at once |
