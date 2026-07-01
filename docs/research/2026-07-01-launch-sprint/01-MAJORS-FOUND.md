# Day 1 — Majors-Finder Audit (read-only)

Date: 2026-07-01. Scope: blank-screen class, costume sweep, multi-replica
in-memory state, swallowed failures on load-bearing paths. Method: direct
file reads (lead) + 4 parallel Explore sub-agents, cross-verified against
actual code (schema, migrations, controllers) — not agent claims taken at
face value. Every finding below was independently re-read by the lead
before inclusion; two sub-agent claims were corrected or downgraded (noted
inline).

---

## TOP-10 RANKED MAJORS

### P0-1 — Deleting a playlist bypasses the go-dark fallback → screen CAN go blank
**File:** `apps/api/src/playlists/playlists.controller.ts:385-419` (`remove()`)
**Failure scenario:** A screen is playing Playlist A (active schedule). The
operator publishes Playlist B to the same screen (A's schedule auto-deactivates,
per the existing supersession logic), then later deletes Playlist A entirely
(a very normal "cleaning up old content" action). `remove()` does:
```ts
await tx.schedule.deleteMany({ where: { playlistId: id } });   // line 416
await tx.playlist.delete({ where: { id } });                    // line 418
```
This directly SQL-deletes every schedule row that references the playlist —
including any that a later `reactivateFallbackIfDark()` call could have
promoted — WITHOUT ever calling that fallback. Contrast with
`schedules.controller.ts`'s `remove()`/`toggle()`/`update()`, which all call
the private `reactivateFallbackIfDark()` (lines 362-431) specifically to
prevent CC-2 (2026-06-27 beta finding, "schedule-delete blanks screen").
**The playlist-delete path is a second door into the exact same bug CC-2
was supposed to close**, just reached by deleting the playlist instead of
the schedule. Worse case: if Playlist A's schedule was the ONLY schedule
targeting that screen (B was targeting a different screen/group), deleting
A removes A's schedule; if A's schedule happened to still be `isActive`
(e.g., operator never published anything else to that exact screen and just
deletes the playlist they're done with), the screen goes dark with zero
recovery — no other schedule exists to fall back to, same as the
"genuinely no other schedule" case the spec explicitly says does nothing.
**Verified directly** — `schema.prisma` line 1085 (`Schedule.playlist` has
no `onDelete` clause, i.e., DB-level `Restrict`), so the controller had to
hand-roll the delete-schedules-first logic instead of relying on cascade —
but it rolled it WITHOUT the safety net the schedules controller has.
**Fix sketch:** extract `reactivateFallbackIfDark` into a shared
`ScheduleGoDarkService` (or make it `public` and inject `SchedulesController`
into `PlaylistsController`), and call it once per distinct
`(screenId|screenGroupId)` target found among `attachedSchedules` BEFORE
`tx.schedule.deleteMany`. Needs a new spec mirroring
`schedule-go-dark-fallback.spec.ts` but driven from playlist-delete.
**Effort:** M (shared-service extraction + call-site wiring + transaction
correctness + new spec).

### P0-2 — Deleting a Template while referenced by an active Playlist has no precheck (degrades silently, not blank, but still a customer-visible regression)
**File:** `apps/api/src/templates/templates.controller.ts:2254-2275`
**Failure scenario:** Confirmed via schema: `Playlist.templateId` is
optional (`String?`) with no explicit `onDelete`, and Postgres/Prisma's
default for an optional relation is `SetNull` (confirmed no
`playlists_template_id_fkey` appears with `ON DELETE RESTRICT` in the init
migration, unlike the required `tenant_id` FK which IS explicit `RESTRICT`
— template_id's absence from the explicit FK list is consistent with the
Prisma-managed default). So deleting a Template in use does NOT throw and
does NOT go through an FK error — but it silently sets every referencing
Playlist's `templateId` to `null`. The manifest endpoint
(`screens.controller.ts:3103`, `...(s.playlist.template ? {...} : {})`)
then omits the `template` key entirely. **The screen does not go blank**
(items/assets still play if the playlist is asset-based), but if the
playlist's zones/layout depend entirely on the template (a template-driven
signage board with no independent PlaylistItems), the player has nothing to
render — effectively the same failure as a blank screen, just reached via
a different code path, with ZERO audit trail pointing at which template
was deleted or which playlists broke (the `TEMPLATE_DELETED` audit row
does not list affected playlists, unlike the `PLAYLIST_DELETED` audit row
which explicitly lists `attachedSchedules` — see line ~403-407 in
playlists.controller.ts for the pattern to copy).
**Fix sketch:** Before delete, `findMany` playlists with `templateId: id`,
include the list in the `TEMPLATE_DELETED` audit details (cheap, matches
existing pattern), and if any of those playlists have an ACTIVE schedule,
either block the delete with a friendly 409 (`TEMPLATE_IN_USE`) or warn in
the response body so the UI can confirm-dialog it. Given this is a template
(not the last line of defense against a truly blank screen), a soft warn +
audit is enough — the harder requirement is not "prevent the delete" but
"don't let this be invisible."
**Effort:** S (audit detail + optional 409 confirmation).

### P1-1 — Multi-tenant/billing: no code path degrades a CANCELLED tenant's live screens (confirm this is the intended business decision, not an oversight)
**File:** `apps/api/src/screens/screens.controller.ts` manifest endpoint
(no License check anywhere in the file); `apps/api/src/billing/stripe.service.ts:176`
only checks `license.status === 'CANCELLED'` inside billing-portal/checkout
flows, never in the content-serving path.
**Failure scenario:** This is the INVERSE of a blank-screen bug — a
tenant's card is declined and Stripe fires `customer.subscription.deleted`,
`License.status` flips to `CANCELLED`, but every already-paired screen
keeps serving content indefinitely because the manifest endpoint has zero
License awareness. This may be exactly what CLAUDE.md's "grace period"
philosophy intends (never punish existing signage for a billing hiccup),
but as found it's not a *deliberate* grace period with an expiry — it's
an indefinite absence of enforcement. Recommend an explicit decision +
if-then: e.g., after N days CANCELLED, degrade to a "please update billing"
banner overlay rather than pulling content outright (matches the spirit of
CC-2's "never truly blank" ethic while still creating dunning pressure).
**Not ranked P0** because it never produces a blank screen — it's a
revenue-leak / business-continuity gap, not a customer-facing outage.
**Fix sketch:** add a cron (mirrors `license-reconcile.cron.ts`) that, for
tenants CANCELLED > 30 days, injects a small non-blocking banner override
into the manifest (or leaves as-is if this is an intentional lifetime-grace
decision — needs a product call, not just an engineering fix).
**Effort:** S-M depending on decision.

### P1-2 — Schedule submission audit + reviewer-notification failures are silently swallowed
**File:** `apps/api/src/schedules/schedules.controller.ts:295-324`
```ts
await this.prisma.client.auditLog.create({...}).catch(() => {});   // line 310
...
this.notify.notify({...}).catch(() => {});                          // line 323
```
**Failure scenario:** Content-approval-gate submission succeeds (the
`Submission` row IS created), but if the audit-log write or the
reviewer-notification fails, there is zero record and reviewers are never
told a submission is waiting — it silently sits until someone stumbles on
the reviews queue. Contrast with the playlist-delete audit path in the same
codebase, which was explicitly hardened in 2026-05-23 to NOT swallow audit
failures ("a partial state with no forensic trail is worse than rejecting").
This one path never got the same treatment.
**Fix sketch:** at minimum add `Sentry.captureException` (matches the
pattern already used in `emergency.controller.ts` for Redis-publish
failures) inside both catches so the gap is observable; consider making the
audit-log write non-optional (rollback via transaction) since it's cheap
and the pattern already exists elsewhere in this exact file's neighbor
(playlists.controller.ts).
**Effort:** S.

### P2-1 — EmergencyOverlay's outer poll catch has no telemetry hook
**File:** `apps/web/src/components/player/EmergencyOverlay.tsx:287-289`
**Note:** Initially flagged P0 by a sub-agent; downgraded on direct review.
The MEANINGFUL failure mode (non-2xx HTTP status, e.g. 401/403 meaning the
kiosk can't read its own emergency state) already has an explicit
`console.warn` at lines 262-270 with a clear message. The outer `catch {}`
at 287 only catches network-level exceptions (DNS failure, fetch abort,
JSON parse error) — genuinely "we're offline, keep last known state" is the
correct behavior, not a bug. The gap is purely observability: this catch
has no Sentry hook, so a fleet-wide connectivity problem wouldn't surface
in monitoring, only in on-device console logs nobody's watching.
**Fix sketch:** add a throttled Sentry breadcrumb/capture (dedupe so an
offline kiosk doesn't spam Sentry every poll interval).
**Effort:** S.

### P2-2 — Emergency trigger response doesn't disclose Redis-publish fallback
**File:** `apps/api/src/emergency/emergency.controller.ts` (trigger ~579-591,
all-clear ~756-768, SOS ~919-931, broadcast ~997-1009, media-alert ~1085-1097)
**Note:** Verified as an intentional, well-logged tradeoff (Sentry capture +
console.warn on every Redis-publish failure), not a silent lie about
delivery — the HTTP-polling manifest fallback genuinely does deliver the
alert within ~10s. The only real gap: the HTTP response still says plain
`{ success: true }` with no indication realtime delivery failed and the
screens will pick it up via polling instead. An operator watching the
dashboard during a real drill has no way to know "sent, but slow" vs "sent,
instant."
**Fix sketch:** thread a `deliveryPath: 'redis' | 'http_poll_fallback'`
field into the response so the UI can show "Alert dispatched (may take up
to 10s to reach all screens)" instead of implying instant delivery.
**Effort:** S.

### P2-3 — Two RSS/Calendar/Social widgets were costumes but appear ALREADY FIXED today (2026-07-01) — verify this landed correctly, don't re-fix
**File:** `apps/web/src/components/apps/app-registry.ts:759-833` (news-rss,
calendar, facebook-page/instagram/social-wall/google-reviews)
**Status: appears RESOLVED, not open.** Git-blame-adjacent comments dated
2026-07-01 show these were re-tiered to `comingSoon: true` with an honest
"Coming soon" blurb TODAY, specifically citing the exact silent-costume
failure mode ("operator would paste their real feed, see plausible fake
headlines in preview, ship it, and their screen shows fiction forever").
**Action for Day 1 lead: confirm this commit is actually on master and CI
is green** — the sub-agent that found this treated it as an open costume,
but the code it quoted is already the FIXED, honest version. If this
landed in an uncommitted/unpushed state from earlier today's work, that's
the actual risk (verify with `git log -p -- apps/web/src/components/apps/app-registry.ts`
and confirm push+CI, don't just trust the working tree).
**Effort:** confirm-only, no code change needed if already shipped clean.

### P2-4 — Ad-network monetization dashboard shows literal `$0` earnings with no distinguishing UI between "no ads served yet" and "system broken"
**File:** `apps/web/src/app/[schoolId]/settings/monetize/page.tsx:133-145`;
`apps/api/src/ads/ads.service.ts:177-227`
**Note:** This is HONESTLY LABELED — there's an explicit amber v1.1 banner
("Inventory delivery rolls out v1.1... Talk to sales for early access") —
so it does not qualify as a silent costume under this audit's own
inclusion bar. Flagging only as a UX nit: a beta customer who skims past
the banner and just watches the earnings tile see identical `$0` whether
the integration is broken or simply hasn't served an impression yet. Not a
launch blocker; note for Day 2 UX pass if time allows.
**Effort:** N/A this sprint (documented tradeoff, not a majors finding).

### P2-5 — POS "PARTNER" tier (Toast/Clover/Lightspeed/Shopify/MINDBODY) correctly blocks the credential form with an honest "in development" panel
**File:** `apps/web/src/app/[schoolId]/settings/pos/page.tsx:395-418`
**Verified NOT a costume** — read directly, the UI renders an amber
"connector is in development" block with a mailto CTA in place of the
credential form for any `provider.integrationTier === 'PARTNER'`; DIRECT
providers (Square OAuth, Custom Webhook) keep real forms. This is the
opposite of a costume — it's the honest pattern. No action needed;
included here only so the lead doesn't re-audit it.

### P2-6 — Streaming "Connect Soundtrack" OAuth button
**File:** `apps/web/src/app/[schoolId]/settings/streaming/page.tsx:103-109`
**Verified NOT a costume today** — per the sub-agent's own note, this now
routes to an honest "coming soon" treatment rather than a broken enabled
button. Confirm-only; no action needed.

---

## PER-SWEEP NOTES

### Sweep 1 — Blank-screen class (a)-(h)

| # | Scenario | Verdict | Evidence |
|---|---|---|---|
| a | Schedule deleted/deactivated while live | **DEFENDED** | `schedules.controller.ts:362-431` `reactivateFallbackIfDark`, called from `remove()`/`toggle()`/`update()`; proven by `schedule-go-dark-fallback.spec.ts` (6 scenarios incl. cross-screen safety, group targets, idempotency). Read the full spec — it's exhaustive for THIS controller's mutation paths. |
| b | Playlist deleted while referenced by active schedule | **OPEN — P0-1 above** | `playlists.controller.ts:416` hard-deletes schedules without the fallback. |
| c | Template deleted while referenced by playlists | **PARTIALLY DEFENDED** (no crash, but silent layout loss) — **P0-2 above** | `schema.prisma` optional relation defaults to `SetNull`; manifest gracefully omits `template` key; no audit trail of affected playlists. |
| d | Asset deleted / Supabase 404 while in live playlist | **DEFENDED** | `PlaylistItem.asset` relation cascades on asset delete (schema line ~1053), so a delete removes the PlaylistItem row too — no dangling reference reaches the manifest. (Did not independently verify Supabase-object-404-without-DB-delete case — i.e., DB row exists but storage object is gone; recommend a follow-up check of the asset upload/serve path's 404 handling on Day 4, lower priority since this requires an out-of-band storage deletion, not a normal operator action.) |
| e | No schedule matches current time window | **DEFENDED** | `screens.controller.ts:3050-3071` — explicit 200 response with `emptyReason: 'NO_SCHEDULE'` and a friendly operator message, NOT a 404 (this was itself a prior fix, "2026-05-26 P0-2" per the inline comment). Did not confirm exactly what pixel-level UI the player renders for this state (recommend a quick Day-2 on-glass check, not urgent — the API contract is sound). |
| f | Empty playlist (zero items) scheduled | **DEFENDED** | Same manifest code path naturally produces `items: []`; nothing in playlist-create blocks zero items, and the player is expected to render nothing/wait rather than error. |
| g | License expiry / seat-limit on already-live screens | **OPEN (by apparent design, needs explicit product decision) — P1-1 above** | No License check anywhere in `screens.controller.ts`; seat-limit SERIALIZABLE tx (`screens.controller.ts:1167-1206`) is pairing-time only, doesn't touch already-paired screens. |
| h | Manifest 5xx / unreachable — player stale-cache behavior | **DEFENDED** | Offline-cache + service-worker stale-while-revalidate pattern keeps last-good manifest playing; did not find evidence of the player clearing state on a fetch error. |

**Already defended — do not re-audit:** (a), (d), (e), (f), (h). CC-2's
ORIGINAL scope (schedule delete/deactivate) is genuinely closed — the gap
is a sibling door (playlist delete), not a regression of CC-2 itself.

### Sweep 2 — Costume sweep

Net of corrections: **zero confirmed silent costumes as of right now.**
Every candidate the sub-agent raised (RSS, Calendar, Social widgets, Ad
Network monetization, POS PARTNER tier, Streaming OAuth) is honestly
labeled with a `comingSoon`/beta banner/blocked-form treatment, several
dated literally today. This is a good sign — the app has clearly been
through prior costume-elimination passes (2026-05-04, 2026-05-28,
2026-06-27, 2026-07-01 per inline comments). **Action item, not a
finding:** confirm the 2026-07-01-dated RSS/Calendar/Social fixes in
`app-registry.ts` are committed + pushed + green (see P2-3).

**Recommend a second-pass costume sweep on Day 3** once the AI/integrations
depth work lands — this pass's grep coverage was strong on
apps/web/src/components + apps/api/src top-level but did not exhaustively
walk every settings sub-page (e.g., didn't check Canva import flow UI,
Google Slides/PPTX import buttons, or the Integration Concierge's
"Connect" buttons for each of the ~76 integrations referenced in the
2026-06-26 final beta audit memory). Flagging as a coverage gap, not a
finding.

### Sweep 3 — Multi-replica in-memory state

**No new load-bearing findings.** Two items in CLAUDE.md/memory previously
flagged as open were re-verified and are now FIXED:
- **Login rate limiting** ("dead login rate-limit (P1)") — now
  `@Throttle({ default: { ttl: 60_000, limit: 10 } })` on
  `apps/api/src/auth/auth.controller.ts:36`, Redis-backed via the global
  ThrottlerModule.
- **AI hourly cap** ("30 generations/hr/tenant via in-memory rate limit")
  — migrated to Redis sorted-set sliding window,
  `apps/api/src/ai/ai-hourly-cap.ts` (ZADD/ZCARD/ZREMRANGEBYSCORE,
  fail-open on Redis loss, cap now 120/hr, tunable via env). Image
  generation cap is separately Redis-backed in `ai-image-cap.ts`.

**Already known + accepted, confirmed still tracked (not new):** `feedHits`
(sports CTS feed rate limit, task #272), `sponsors.controller.ts`
`impressionHits`, `sports.service.ts` `boardCache` (1s perf memoization,
not correctness-bearing), `mfa-rate-limiter.ts` in-memory MFA lockout
(explicitly documented single-replica tradeoff), `branding-rate-limiter.ts`
+ `data-source-rate-limiter.ts` (both explicitly comment "v1 only, Redis
upgrade later" — acceptable at current N=1 replica count).

**Stripe webhook idempotency** verified DB-backed (`processed_stripe_events`
table / License row event-ordering compare), not in-memory — good.

**Watch item, not a finding:** every one of the "accepted at N=1" caches
above becomes a real P1 the moment Railway scales the API past 1 replica.
Worth a single tracking issue ("audit all v1-only rate limiters before
enabling horizontal scaling") rather than 5 separate ones.

### Sweep 4 — Swallowed failures on load-bearing paths

**No P0s that lie about success on the emergency path.** Every emergency
Redis-publish failure (trigger/all-clear/SOS/broadcast/media-alert) is
logged to Sentry + console.warn AND has a working HTTP-polling fallback
that genuinely delivers within ~10s — this is a documented, deliberate
degrade-gracefully design, not a swallowed failure. GPIO status-lamp
auto-drive and Stripe seat-count sync are both correctly-scoped
fire-and-forget side channels (lamp is a visual nicety, not the delivery
path; Stripe sync has a daily reconciliation cron as a backstop).

**Real gap:** schedule-submission audit + notification swallow (P1-2
above) — the one place in this sweep where a similar-looking pattern
elsewhere in the SAME FILE (playlist delete's audit write) was explicitly
hardened to not swallow, but this one wasn't.

**Already reviewed, confirmed ACCEPTABLE — do not re-flag:**
- `screen-emergency.controller.ts:254-358` — per-screen emergency override
  transaction + audit; failure here correctly throws a 500 to the caller
  (fail-loud), only the Redis publish inside is fire-and-forget-with-logging.
- `realtime.gateway.ts:134-141` — JWT revocation check is fail-CLOSED
  (rethrows), not fail-open.
- `sse.service.ts:150-170` — dead-client cleanup swallowing is correct
  (the socket is already gone; nothing to communicate).
- `screens.controller.ts` Stripe seat-sync fire-and-forget calls
  (~1245, ~1350) — daily reconcile cron is the backstop, documented tradeoff.

---

## EXPLICIT "VERIFIED-FINE" LIST (do not re-audit these)

- CC-2 schedule delete/deactivate/toggle/PUT fallback — fully covered by
  `schedule-go-dark-fallback.spec.ts`, matches the live controller code.
- Empty-schedule-window manifest response (200 + `NO_SCHEDULE` + message,
  not a 404) — `screens.controller.ts:3050-3071`.
- Asset delete cascading PlaylistItem removal — schema-level cascade,
  can't produce a dangling asset reference via the normal delete flow.
- Emergency Redis-publish-failure handling across all 5 emergency
  endpoints — logged, Sentry-tracked, HTTP-poll fallback proven to work.
- JWT revocation check fail-closed behavior in the realtime gateway.
- Login rate limiting — Redis-backed `@Throttle`, not the "dead" state
  CLAUDE.md/memory described from a prior audit.
- AI hourly + image generation caps — both Redis-backed sliding windows,
  not in-memory Maps.
- Stripe webhook idempotency — DB-backed, ordering-protected via
  `stripeLastEventCreatedAt` comparison.
- POS PARTNER-tier UI (Toast/Clover/Lightspeed/Shopify/MINDBODY) — honest
  "in development" block, not a costume.
- Streaming "Connect Soundtrack" — honest coming-soon treatment.
- RSS/Calendar/Social-feed widgets in `app-registry.ts` — honestly
  labeled `comingSoon: true` as of a 2026-07-01 change (verify it's
  pushed + CI green, per P2-3, but the code itself is clean).

---

## SUMMARY FOR THE LEAD

Two real P0/P1 majors, both in the blank-screen class, both narrower and
more fixable than they first look:

1. **Playlist delete bypasses the go-dark fallback** — the CC-2 fix only
   covers the schedule-controller's own mutation methods; playlist-delete
   reaches the same database rows through a different controller and skips
   the safety net entirely. This is the single highest-priority fix from
   this audit — same blast radius as the original CC-2 bug, same fix
   pattern already exists and just needs to be shared/reused.
2. **Template delete has no in-use check or audit detail** — lower
   severity (doesn't blank the screen, just silently degrades a
   template-driven board to a template-less one with zero forensic trail).

Everything else this audit went looking for — costumes, multi-replica
races, swallowed emergency-path failures — came back clean or already
fixed. The app has clearly been through several honesty and
Redis-migration passes already (dated 2026-05-04 through 2026-07-01 in
code comments); this audit's job was mostly to confirm those held up
under direct re-reading rather than trusting memory/CLAUDE.md's
snapshot-in-time claims, and to find the one sibling bug (playlist-delete)
that the original CC-2 fix didn't cover because it was scoped to the
wrong controller.
