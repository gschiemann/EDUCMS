# Fleet overview hybrid (read-only roll-up + click-to-switch) — research + design (2026-06-02)

Operator's proposal to vet: *"Roll up every child location's screens into ONE
top-level map/list so HQ sees everything — but the second you click a screen to
DO anything, it flips you into that location's context. Read-only overview at
the top; all actions scoped to the owning child. Keeps isolation, still allows
local-team management. I've seen a top-level view of every account before —
maybe they don't use child accounts? Lets get this right + build ours better."*

## Verdict: this is the gold-standard "manager-account / MSP-console" pattern. Build it.

The operator independently reinvented the canonical pattern for managing many
isolated accounts: **aggregate read-only at the top, switch into a child to take
consequential action.** Google Ads MCC, AWS Organizations (switch-role), Stripe
Connect, Datadog, Cloudflare Tenant, Shopify Organizations, and the MSP RMM
tools (NinjaOne/Datto/ConnectWise) all converge on exactly this — and for one
reason: **blast-radius + permission containment.** True cross-account *write* in
place (god-mode top console) is deliberately avoided; it appears only as a
narrow low-risk convenience (bulk reporting/payouts) bolted onto a switch base.

## The key finding (answers "maybe they don't use child accounts?")

The operator's hunch was right:

- **Signage products with a slick org-wide screen view are mostly FLAT-with-partitions, NOT truly isolated sub-accounts.** Yodeck Workspaces are explicitly *"partitions within a single account, not separate accounts"*; ScreenCloud Spaces sit under one Organization; OptiSigns recommends a single account with a Region→State→City folder tree for chains. The single pane is *cheap* there because nothing is truly isolated.
- **The one that uses true sub-accounts like us — Rise Vision Sub-Companies — solves the aggregate view with ASYMMETRIC VISIBILITY:** the parent reads into every child; children are sealed from each other and the parent. That is exactly the read-only-roll-up half of the operator's hybrid.
- **A sub-account model does NOT naturally give a cross-account aggregate view** (that's the point of isolation). You get it by (a) asymmetric parent-read, or (b) the manager-console switch-to-act. **The operator's hybrid combines both — asymmetric read-only roll-up + switch-to-act — which is the best of both worlds and well-precedented.** It also neutralizes the main cost of our sub-account model (cross-tenant *write* plumbing) by never writing at the top.

## Manager-console comparison

| Console | Aggregate view? | Act in place or switch-to-act? | Switch mechanism |
|---|---|---|---|
| Google Ads MCC | Yes (cross-account reporting, ~10-acct cap) | **Switch in** to manage | click client → enter its account |
| AWS Organizations | Consolidated billing/policies | **Switch-role** to act | Switch Role + colored display-name in nav |
| Stripe Connect | Yes (connected-accts list + balances) | Hybrid, leans switch | click account → its detail page |
| Datadog multi-org | Parent = billing/mgmt only; children data-isolated | **Switch org** | org switcher bottom-left |
| Cloudflare Tenant | Yes (Managed Accounts summary) | **Switch in** | into the account |
| Shopify Organizations | Org command center | **Switch store** | top-bar store switcher |
| NinjaOne / MSP RMM | Yes (single pane across all clients) | **Drill/switch into Org→Location→device** | click device → its detail inside the client |

## "Build ours EVEN BETTER" — 8 refinements (each validated by a leader)

1. **Deep-link the switch to the exact screen** (land on that screen's detail page inside the child, action-ready) — *NinjaOne device drill-in.*
2. **Persistent color-coded "You're now in <Location> — Return to fleet" banner** — *AWS colored nav label + Shopify/Datadog always-visible switcher + breadcrumb.*
3. **Preserve full fleet-map state on return** (viewport, zoom, filters, selection, search) — *dashboard global-by-default → drill → return pattern.*
4. **Draw the read/act line explicitly.** Top, read-only, NO switch: filter, search, status, what's-playing, last-ping, roll-up health, acknowledge an alert. Switch-to-act: edit content, pair/unpair, reboot, push playlist, change schedule, **trigger emergency** (in-context with full safeguards) — *Stripe (status visible / risky mgmt requires opening the account) + our emergency-safeguard rules.*
5. **Log the switch as impersonation in the immutable AuditLog** — operator identity + target child + the action taken inside — *universal impersonation best practice (ABP.IO/Genesys/Laravel).*
6. **Asymmetric visibility enforced server-side** — parent reads into every child for the roll-up; children see only themselves, never siblings/parent — *Rise Vision + Datadog isolation.*
7. **Cross-account roll-up stats + saved filters at the top** ("12 of 340 offline," "3 locations have a stale playlist," group by status/region) — triage from the map, switch in only to fix — *NinjaOne single pane + Google MCC + ScreenCloud Screens Manager.*
8. **Constrained SAFE bulk from the top** (reboot offline / push all-clear) with hold-to-confirm + per-child audit fan-out; destructive edits stay behind the switch — *ScreenCloud bulk + Stripe bulk payouts, bounded by AWS blast-radius discipline.*

## Why this fits VenueOS perfectly
- Keeps the child-account structure the operator likes (true isolation + local-team management).
- The top layer is a **read-only aggregator + a router** — reuses the per-child screens we already built; no parallel god-mode write UI to build/secure twice.
- Avoids the cross-tenant *write* complexity that made the sub-account model look heavy in docs 01-05. The only new server work is an asymmetric-read aggregation endpoint + parent-scoped alerting; writes still go through the existing switch + per-child paths.

## Proposed build phasing
- **Phase 1 (core):** read-only fleet map + list roll-up across `visibleTenantIds` (parent ∪ children), each screen tagged with its location + status; **click → /tenants/switch into the child + deep-link to that screen**; persistent "in <Location> · Return to fleet" banner; fleet state preserved on return; switch audited.
- **Phase 2:** fleet offline alerting rolled up to the parent WITH fatigue controls (down-for-N-min threshold, off-hours suppression, back-online notices, daily-digest default, scoped rules) + one escalation channel beyond email (Slack/webhook). *(see doc 05.)*
- **Phase 3:** roll-up health stats + saved filters; constrained safe bulk (reboot offline / push all-clear) with hold-to-confirm + per-child audit.

## Sources
Yodeck Workspace Hierarchies; ScreenCloud Spaces + Screens Manager; Rise Vision Sub-Companies; Skykit tenants; OptiSigns chain folders/Teams (medium-confidence, 403 on direct fetch); Google Ads MCC; AWS Organizations switch-role; Stripe Connect dashboard; Datadog multi-org; Cloudflare Tenant Platform; Shopify Organizations; NinjaOne RMM; impersonation best practice (ABP.IO/MS/Genesys); breadcrumb/dashboard UX patterns. (URLs in session transcript; Google MCC ~10-acct reporting cap may change.)
