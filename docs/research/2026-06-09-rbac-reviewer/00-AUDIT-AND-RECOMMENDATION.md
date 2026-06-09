# RBAC + Reviewer Workflow — code audit, competitor research, and recommended model

**Date:** 2026-06-09. Triggered by operator: "what permissions should a viewer get? right now they see no assets, playlists or templates… the goal was they could do all the editing but instead of publishing to a screen it would publish to the admin for review… do we need another level, like a location admin? … we have an entire tab for pending reviews and no way to submit anything to be reviewed."

## A. CODE AUDIT — why submit-for-review is effectively dead

The backend workflow EXISTS: `Submission` model (csv-id bundles), `POST /submissions` (CONTRIBUTOR+admins), reviewer `GET /submissions` + approve/reject, the `/[schoolId]/reviews` page, and a sidebar "Reviews" tab with a live pending badge (admins only). But it's wired so narrowly it's unusable:

1. **`RESTRICTED_VIEWER` is hard-403'd from all content.** `GET /assets`, `/playlists`, `/templates` use `@RequireRoles(SUPER, DISTRICT, SCHOOL, CONTRIBUTOR)` — no `RESTRICTED_VIEWER`. So a viewer's content pages are empty. = "they see no assets, playlists or templates."
2. **Submit-for-Review is Playlists-only.** The "Submit for Review" button + modal + `useCreateSubmission` live only in `playlists/page.tsx`. Assets have a *different* path (CONTRIBUTOR uploads land `PENDING_APPROVAL` → the Reviews tab's pending-assets list). **Templates have no submit path at all.**
3. **Only `CONTRIBUTOR` ever sees a submit button.** It's gated `isContributor`. Admins publish directly and never see it.
4. **The operator tests as SUPER_ADMIN** → sees the Reviews tab but no submit path, and the queue is empty unless a contributor submits. = "a tab for pending reviews and no way to submit anything."
5. **`CONTRIBUTOR` can't create playlists.** `POST /playlists` = `@RequireRoles(SUPER, DISTRICT, SCHOOL)` only. The "editor" role is half-crippled.
6. **No scoped "Location Admin" mid-tier surfaced.** `SCHOOL_ADMIN` exists in the enum but isn't positioned as the per-school approver, and scoping (no district/billing visibility) isn't clearly enforced/labelled.

Current 5 enum roles: `SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN, CONTRIBUTOR, RESTRICTED_VIEWER`. Live counts: DISTRICT_ADMIN 8, CONTRIBUTOR 3, SCHOOL_ADMIN 2, RESTRICTED_VIEWER 1, SUPER_ADMIN 1.

## B. COMPETITOR RESEARCH (Yodeck, OptiSigns, ScreenCloud, Rise Vision, Canva, WordPress)

Full report: `01-competitor-rbac-research.md`. The decision-relevant conclusions:

1. **Approval is best modeled as a per-ROLE property, not a per-screen toggle.** Rise Vision (Content Editor lacks publish → "Send for Review" → Content Publisher approves), OptiSigns (Content Proposal vs Content Approval), ScreenCloud (Creator vs Publisher), and WordPress (Contributor "Submit for Review" → Editor publishes) all gate by giving the lowest editing tier *no publish*, which *forces* submit. **Yodeck has NO true approval queue — a competitive opening for VenueOS.**
2. **Every competitor has a "Location/Site Admin" mid-tier** that runs one site's content+screens+users but can't touch billing/org/sibling sites: Yodeck **Workspace Admin**, OptiSigns **Team Admin**, ScreenCloud **Manager** (per-Space), Rise Vision **sub-company admin**. → A scoped Location Admin is near-universal; VenueOS lacking a clean one is a gap.
3. **The container already exists in VenueOS** (Tenant `district→school` via `parentId`) — competitors all separate "container (workspace/team/space/sub-company = a site)" from "role (admin of that container)". The missing piece is a role that is **admin of ONE school-tenant only** (no district, no billing, no sibling visibility).
4. **Best gate design = BOTH layers (the Canva model):** (a) per-role default — lowest editing tier can't publish → submits; (b) a per-screen-group / content-class `approvalRequired` override for sensitive boards — **with emergency/life-safety content HARD-CODED to bypass approval** (lockdown can't wait for an approver; stays on the `@AllowPanicBypass`/emergency path, outside the approval system).
5. **Keep roles hierarchical/inheriting** (higher ⊇ lower). Rise Vision's non-inheriting roles (must grant Editor AND Publisher separately) are a documented friction — do not copy.
6. **Viewer** = scoped read-only browse of content+screens+schedules+dashboards (not clone).
7. Copy-worthy UX: **OptiSigns' A|B "Original vs Proposed" diff** for playlist submissions; **submit-with-notes / request-changes-with-notes** round-trip (Rise Vision).

## C. RECOMMENDED MODEL FOR VENUEOS (decision-ready)

Keep the existing 5 enum roles (no migration), **relabel for clarity**, fix the wiring, and make `SCHOOL_ADMIN` the scoped Location-Admin/approver. The role you (operator) described ("edit everything → goes to admin for review") **is the Contributor/Editor role** — not Viewer. Viewer is read-only.

| Tier (UI label) | Enum | Edit content | Publish to screens | Submit for review | Approve/reject | Manage screens | Manage users | Billing/Org settings | Scope |
|---|---|---|---|---|---|---|---|---|---|
| **Super Admin** | SUPER_ADMIN | ✓ | ✓ | n/a | ✓ | ✓ | all tenants | ✓ | global |
| **District Admin** | DISTRICT_ADMIN | ✓ | ✓ | n/a | ✓ | ✓ | district + schools | ✓ | district tree |
| **Location Admin** | SCHOOL_ADMIN | ✓ (their school) | ✓ | n/a | **✓ — approves their school's submissions** | their school | users in their school | **✗** | **one school only** |
| **Editor** (Contributor) | CONTRIBUTOR | ✓ (assets+templates+playlists) | **✗ → Submit for Review** | **✓ (all content types)** | ✗ | ✗ | ✗ | ✗ | assigned school/group |
| **Viewer** | RESTRICTED_VIEWER | **read-only (can SEE)** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | assigned scope |

**Gate placement:** per-role default (Editor lacks publish → forced submit) as phase 1; per-screen-group `approvalRequired` override + **emergency-always-bypass** as phase 2.

### Implementation plan (phase 1 — "get it working")
1. **Viewer can SEE content read-only** — add `RESTRICTED_VIEWER` to the GET guards on assets/playlists/templates; keep every mutation blocked; frontend already disables editing for `isViewer`.
2. **Submit-for-Review across assets + templates + playlists** (not just playlists) — surface the "Submit for Review" action on assets + templates for Editor; bundle into the existing `Submission`.
3. **Editor can create playlists** (as draft, unpublished) — add `CONTRIBUTOR` to `POST /playlists`, status stays draft until an approver publishes.
4. **Make the loop demonstrable** — clear role labels in Settings → Users; ensure an Editor's submit lands in `/reviews` and Approve actually publishes; surface "your submission status" to the Editor.
5. **Keep SCHOOL_ADMIN strictly scoped** — verify it can't see sibling schools / district billing; it's the approver.
6. Every state change AuditLogged (already is); emergency path stays outside approval.

### Phase 2 (after phase 1 verified)
- Per-screen-group `approvalRequired` flag + emergency hard-bypass.
- OptiSigns-style A|B diff on playlist submissions.
- Optional distinct "Teacher" tier (create-from-approved-templates only) if the operator wants a lighter-than-Editor tier — fold into Editor for now.

**Open decision for the operator:** approve this model (relabel existing 5 + SCHOOL_ADMIN-as-Location-Admin), or add a distinct 6th "Teacher" tier now. Nothing RBAC ships until green-lit.
