# Competitor RBAC + content-approval research (full report)

Six products: Yodeck, OptiSigns, ScreenCloud, Rise Vision (signage) + Canva for Teams/Enterprise, WordPress (approval-workflow references). Every claim cited inline.

## Headline findings
1. A real submit-for-review gate is NOT universal but best-in-class signage ships it. Rise Vision (K-12) + OptiSigns have genuine creator→approver gates; ScreenCloud has it via a Publisher role; **Yodeck has NO true submit-for-review queue** (role-gated publish only) — a competitive opening for VenueOS.
2. Every serious platform has a "manages one location, can't touch billing/org" mid-tier (Yodeck Workspace Admin, OptiSigns Team Admin, ScreenCloud Manager, Rise Vision sub-company admin). VenueOS lacking a clean Location/School Admin is a gap vs all four.
3. Cleanest K-12 approval models = Rise Vision's & OptiSigns': approval is carried by role pairs (editor that can't publish + publisher/approver), NOT a per-screen toggle. Canva adds per-template mandatory approval — maps to VenueOS's "emergency content must never need approval, a hallway flyer should."

## 1. Role tiers (per product)

### Yodeck (roles restructured Apr 2023)
Global Admin (full, only role that manages users/workspaces/custom roles, billing) · Workspace Admin (full within their workspace incl users; no billing/org) · Content & Device Manager (full content + push + screen create/delete) · Content Manager (view/change/delete + push; no screen config) · **Restricted Content Manager (build but NO publish)** · Content Viewer (read-only) · Template Manager (branded templates only) · Billing Access (billing only) · Custom Roles (Enterprise). One-role-per-user (Basic/Premium); one-role-per-workspace (Enterprise). **No review queue** — restricted content just waits for a publisher.
Sources: yodeck.com/docs/user-manual/what-user-roles-do-you-provide, /users, /user-permissions-for-screens, Workspaces (Enterprise), use-cases/workspace-hierarchies.

### OptiSigns (ships a built-in proposal/approval pair)
Account Owner (full + billing; only role that deletes account) · Super Admin (global) · Admin (full, team-scoped, no billing) · User (create/edit/delete in accessible folders; publish; no billing) · **Content Proposal / Proposer (create + PROPOSE playlist changes; NO publish — submits for approval)** · **Content Approval / Approver (reviews + approves proposals)** · Read Only (view accessible folders). Proposer sees an A|B "Original vs Proposed" diff, submits, notifies approvers (email Review button).
Sources: support.optisigns.com Advanced-Security-Managing-User-Roles, How-to-use-Approval-Workflow-feature, Working-with-Teams-and-Security-Levels.

### ScreenCloud (Creator+Publisher split = the gate)
Owner (full + billing) · Admin (full, can be Space-scoped) · Manager (create/update content + screens for assigned Spaces; NO billing/org) · **Creator (upload + build; NO publish)** · **Publisher (review + approve content before publishing)** · Viewer (read-only, assigned Spaces) · Custom Roles (Pro/Enterprise). No standalone pending-queue UI — enforced by the capability split.
Sources: help.screencloud.com People-Groups-and-Spaces, Managing-Custom-Roles, Custom-Role-Functions.

### Rise Vision (K-12 model — closest to VenueOS; roles do NOT inherit)
Teacher (lightest) · Screen Share Moderator · **Content Editor (create/edit; if NOT also Publisher → must "Send for Review")** · **Content Publisher (publish + review/approve editors' submissions)** · Display Administrator (manages displays/players) · System Administrator (full account). Sub-companies nest under a primary; parent can push down; cross-level review needs "Allow Sub-Company Reviews" (Enterprise).
Sources: help.risevision.com Users-overview, Content-Publishing-Approval.

### Canva Teams/Enterprise (two-layer approval reference)
Team Admin (members/content/permissions + publishing settings + design approvals + Brand Templates/Controls; can require approval + template locks) · Member (create/collaborate; may be required to get approval before download/publish). Two layers: (a) any member "Get approval," (b) admin-set MANDATORY approval tied to specific Brand Templates or specific members/groups.
Sources: canva.com/help roles-and-permissions, manage-approval-settings-for-teams, design-approval-for-enterprise, get-approval.

### WordPress (canonical Contributor→Editor pattern)
Contributor (own posts only; can ONLY "Submit for Review", no publish, no media upload) · Author (publish own) · Editor (all posts, publish incl others', reviews pending queue). Flow: Contributor "Submit for Review" → Pending Review → Editor notified, edits, publishes.
Sources: wordpress.org/documentation roles-and-capabilities; wordpress.com/support user-roles; publishpress.com contributor.

## 2. Location/Site mid-tier scoping
- Yodeck → Workspaces (Enterprise): Workspace Admin = full content+screens+users in workspace, no billing/org. Lower tiers: one global role, no scoping.
- OptiSigns → Teams + folder permissions: one Team per location recommended; Team Admin runs their team, no billing; folder-level perms; users can be in multiple teams.
- ScreenCloud → Spaces + Groups: Manager scoped to assigned Spaces, no billing/org; Groups granted org-wide OR per-Space; a group can hold different roles in different Spaces.
- Rise Vision → Sub-companies: sub-company admin controls own displays/users; parent pushes down.
- **Pattern for VenueOS:** competitors separate container (workspace/team/space/sub-company = a site) from role (admin of that container). VenueOS's Tenant `district→school` already IS the container; missing = a role that is admin of ONE school-tenant with no district/billing/sibling visibility.

## 3. Approval gate — who has it + how
| Product | Real gate? | Unit | Capability vs setting |
|---|---|---|---|
| Rise Vision | Yes | per Presentation | per-role (Editor lacks publish); cross-sub-company needs Enterprise setting |
| OptiSigns | Yes | per playlist (proposal) + A|B diff | per-role (Proposal vs Approval) |
| ScreenCloud | Partial/implicit | content before publish | per-role (Creator vs Publisher) |
| Yodeck | No true gate | — | role-gated publish only (GAP) |
| Canva | Yes (most sophisticated) | per design + per-template mandatory | BOTH per-role/member AND per-template |
| WordPress | Yes (canonical) | per post | per-role (Contributor vs Editor) |

Takeaways: dominant model = per-role default (lowest tier lacks publish → forced submit; no per-screen config). Canva-style per-target mandatory approval is the layer for VenueOS's emergency exception (emergency bypasses approval; general signage requires it). Table-stakes UX: notes both ways + email/in-app round-trip; OptiSigns A|B diff is a differentiator worth copying.

## 4. Viewer tier
Consistent: scoped read-only browse of content+screens+schedules+dashboards, zero mutation, NO clone. (ScreenCloud Viewer, Yodeck Content Viewer, OptiSigns Read Only.)

## Recommended model for VenueOS
See `00-AUDIT-AND-RECOMMENDATION.md` §C — relabel existing 5 roles (Viewer/Editor/Location Admin/District Admin/Super Admin), make the Editor (Contributor) tier publish-OFF→submit-for-review by default across all content types, make SCHOOL_ADMIN the strictly-scoped Location Admin + approver, gate = per-role default (phase 1) + per-screen-group `approvalRequired` with emergency hard-bypass (phase 2). Keep roles hierarchical/inheriting. Add a distinct "Teacher" tier only if a lighter-than-Editor role is wanted (fold into Editor for now).
