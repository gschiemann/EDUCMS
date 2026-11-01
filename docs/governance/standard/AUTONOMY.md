# Autonomy — the ladder, the registers, the ceilings

Companion to Articles 15, 33 and 34 of `STANDARD.md`. Every application keeps its own `docs/governance/AUTONOMY-REGISTER.md` in the shape below.

## The ladder

| Level | Name | Meaning |
|---|---|---|
| L0 | Observe | Recommend only. |
| L1 | Prepare | Prepare the complete action (diff, plan, rollback) for approval. |
| L2 | Execute after approval | One explicit human authorisation per action or per written batch. |
| L3 | Execute and notify | Runs automatically; the owner is told. |
| L4 | Autonomous with audit | Runs independently with full logging and a rehearsed rollback. |
| L5 | Closed loop | Detection → remediation → verification without a human, for proven domains. |

Each **category of action** has its own level. There is no global switch. **When unsure, treat the action as consequential.**

## Two registers, never mixed

**Register A — agent authority.** What an AI may do on its own. Columns: category · level · ceiling · evidence (count of clean executions, window) · rollback · kill switch (if any) · last review · last demotion (cause). Today no agent category sits above L2 in any application.

**Register B — product automations.** What the shipped product does on its own (alert emails, transcodes, catalog syncs, auto-heal jobs). Columns: behaviour · mode (shadow / warn / enforce / on / off) · **kill switch** (subtractive: unset = today's behaviour, never a lockout) · **failure direction** when the safeguard cannot run (open or closed, written and tested) · test that exercises the "cannot run" path · who is alerted. Product automations are not "agent autonomy" and are never argued as precedent for it.

## Ceilings

- **Life safety (named by file path in each register):**
  - **CHANGE** — an agent editing life-safety code, configuration or test fixtures: ≤ L1, plus a review by a different vendor than the author, the owner's merge, and an on-glass drill before the change is called done.
  - **OPERATE** — an agent triggering or clearing a live alert in production: L0. Drills on a lab screen or test tenant are allowed and encouraged.
  - **RUNTIME** — the shipped delivery path: off the ladder; governed by its written failure direction (in doubt, show the alert; cached state raises, never releases).
- **Consequential list — ≤ L2 until the owner raises a row in writing:** the emergency path · device credentials, authentication, secrets · schema and migrations (a deploy carrying a migration is L2; the reviewed merge is its approval) · CI/CD pipeline definitions · agent-initiated fleet-wide actions (updates, reloads, configuration broadcasts) · anything that emails or messages a customer · billing and pricing · public content and repository visibility · any autonomy-level change · amendments to the standard.
- Only the owner raises a level. Any agent may lower one.

## Promotion (slow)

A row moves up one level only with all of: a kill switch and a rehearsed rollback; **≥ 10 clean executions over ≥ 14 days with zero reverts or hotfixes attributable to it**; a decision record (`DECISION.md` format); the owner's written approval in the register.

## Demotion (mandatory, same day)

Applied by the lead the day the trigger is seen — at the weekly review at the latest — and recorded in the row with its cause. Until tooling computes these, they are **mandatory manual**, not "automatic":

1. **Error budget burning.** Every class of fleet or customer-facing action has an error budget derived from its objective; while it burns, fleet-wide actions for that class drop to L1 until it recovers.
2. **A revert or hotfix within 72 hours** of a merge in a ≥ L3 category drops that category one level.
3. **A security event** touching a category drops it to L1.
4. **A customer-impacting error** or **a wrong call** by an autonomous action drops its category one level.

## Freezes, standing approvals, waivers

- **Freeze.** A written `FREEZE.md` in the application's governance folder: reason, start, expiry, named exceptions, who declared it. While active, every consequential category is ≤ L1 except the named exceptions; Frontier Intake pauses except the Tier A security re-audit. A launch is a freeze.
- **Standing approvals.** The owner's "go ahead, stop asking" is written down with scope and expiry (a batch: ≤ 72 h; a launch-ready approval: until a named date) in the register. **Nothing in the standard adds a prompt for an action the owner has waived in writing** — the standard records waivers; it does not override them.
- **Reviewer waiver.** The owner may waive the different-vendor review for 24 hours per change, recorded in the PR. During a freeze the cross-vendor rule applies only to emergency, authentication/secrets, migrations, billing and the native player.
- **Standing mitigations (pre-authorised at L3, subtractive only).** Revert the last deployment; flip a named kill switch; pause updates and field pushes. The lead may run these at any hour; each run is logged and the owner is notified at once.

## Doors and the owner's decision budget

A **two-way door** (reversible in minutes by a kill switch or a rollback, touching nothing on the consequential list) needs no owner decision and is batched into the weekly review as information. A **one-way door** (migrations, deletions, public content, pricing, credential changes, anything on the consequential list) needs the owner. Proposals to the owner are batched to the weekly review unless they are blocking; the review carries at most ten bullets.

## Register row format

```
| category | level | ceiling | evidence | rollback | kill switch | failure direction | last review | last demotion |
```
