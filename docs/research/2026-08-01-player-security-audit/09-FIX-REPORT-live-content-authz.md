# Fix Report — CONTRIBUTOR live-content gate + zone URL guard

> Agent report, verbatim. **Lead review status: NOT yet reviewed or verified.**

**BRANCH:** `worktree-wf_814aca52-f7b-6` (2 commits: `ac2a98d2` = the salvaged WIP cherry-picked forward, `3db7472f` = my work). Not pushed, not merged.

---

## What changed (file + symbol)

**New — `apps/api/src/submissions/live-content-gate.ts`** (the shared gate, one home for the whole policy)
- `actorNeedsApprovalToEditLiveContent(user)` — **fail-CLOSED**: gated unless the role is one of the three approver roles. Not `role === CONTRIBUTOR`, so a future non-admin role added to a route's `@RequireRoles` inherits the restriction instead of the hole. Also covers the machine identity (`kind:'api-key'`, `jwt-auth.guard.ts:46`, whose role comes from the key grant).
- `findLiveTemplateBinding` / `findLivePlaylistBinding` — the "is this live" lookups.
- `requiresApprovalException(kind, binding)` — 403 `REQUIRES_APPROVAL` carrying `reason`, `scheduleId`, `target`.
- `auditBlockedLiveEdit(...)` — best-effort `CONTENT_EDIT_BLOCKED_REQUIRES_APPROVAL` AuditLog row (Standard Audit Surface §16: a *denied* privileged action is exactly the row a district questionnaire asks about). Wrapped so a logging failure can never turn the 403 into a 500 — there's a test for that.

**`templates.controller.ts`** — `assertContributorMayEditLiveTemplate` rewritten onto the shared gate; called from `update` (`bgColor`/`bgImage`/`bgGradient` render on the wall exactly like a zone, and it's the *first* half of the builder's two-phase save), `replaceZones`, and `restoreVersion` (leaving restore open would make the other two bypassable in one call — "restore the version I saved 30 seconds ago"). `assertZoneUrlsSafe` wired at `create`, `replaceZones`, `restoreVersion`.

**`playlists.controller.ts`** — `assertContributorMayEditLivePlaylist(req, id, isProtected)` on `reorderItems` (`PUT /:id/items`). `isProtected` is passed from the row the method already loaded — no extra query.

**`zone-url-guard.ts`** — salvaged file kept and hardened (below).

---

## Live-bound: the approach, and why

**I did not reuse the submission queue. Here is exactly what I checked and why it does not work** — the reasoning is written into the gate file so the next agent doesn't re-litigate it:

1. `Submission` (`schema.prisma:1482-1504`) has exactly three content dimensions — `assetIds`, `playlistIds`, `scheduleIds` — and **no payload column**. It references content that already exists in a not-yet-published state and publishes by flipping `Asset.status` / `Schedule.isActive` (`submissions.controller.ts:284-324`). A zone save is a destructive delete-all-and-recreate; there is nowhere to park the proposed array.
2. The copy-on-write variant (clone template + playlist, stage an inactive Schedule, bundle *that*, let approval flip it live with the existing `displaceCompetingActiveSchedules`) **does** fit the queue's shape — but it silently switches the id the builder is editing. The client keeps PUTting to, and re-reading, the original row, so every reload reads "my changes vanished." Making it correct needs the client to follow a server-side identity switch, i.e. `apps/web` — outside my domain.
3. Even solving 2: `GET /submissions/:id` embeds assets/playlists/schedules and the reviewer screen renders those. **A proposed template layout would be approved blind.** A queue that can't show the reviewer what they're approving is worse than an honest block.

So: **403 `REQUIRES_APPROVAL`**, but not a bare one — it names the blocking screen and the unblocking move (Duplicate, a route CONTRIBUTOR already has). The correct follow-up is `Submission.templateIds` + a pending-payload pointer (`TemplateVersion` already stores exactly the right `zones`/`meta` JSON shape) + a reviewer diff view.

**"Live-bound" is more precise than the salvaged version.** Traced against the manifest resolver (`screens.controller.ts:3186-3195`: `isActive` + `startTime<=now` + `endTime>=now OR null`):
- I **dropped** the `startTime<=now` half — a schedule going live at 3pm publishes this content with no further review, so a future-dated binding still blocks (tested).
- I **kept** the end-of-window half — the salvaged `isActive: true` alone would have made every board ever bound to an expired campaign **permanently un-editable by its own author**. Documented residual: if an admin later *extends* an expired window they re-publish un-reviewed edits — an admin publish decision, and the edit is audit-logged. Defence-in-depth gap behind a hard precondition.

### The second hole I found (this is the important one)

Emergency content is bound **by id on the tenant row** (`Tenant.panicLockdownPlaylistId` / `panicWeatherPlaylistId` / … / `emergencyPlaylistId`, `schema.prisma:35-59`) and on `Screen.emergency*PlaylistId` (`:859-861`). **None of those create a `Schedule` row**, so a schedule-only gate is blind to them. And `reorderItems` — unlike `setActive` (`playlists.controller.ts:345`) and `remove` (`:405`) — has **no `isProtected` check**. A CONTRIBUTOR with the playlist's UUID could rewrite what every screen displays during a real lockdown.

- **Attack:** authenticated Editor → `PUT /api/v1/playlists/<lockdown-playlist-id>/items` with their own assets → next panic press shows attacker-chosen content instead of the lockdown instructions.
- **Severity: HIGH**, consequence CRITICAL. The precondition I could *not* refute away: `GET /playlists` filters `isProtected:false` (`:106`) so the id isn't listed to an Editor, and `panic-content.controller.ts` is admin-only (`:154/:186/:253`), as is `/audit`. But `GET /playlists/:id` (`:161-166`) is CONTRIBUTOR-allowed and does **not** filter `isProtected` — so any id leak (admin-shared link, device-token manifest, DB access) converts straight to a subverted alert. I did not verify a specific in-product leak path; I'm rating it on the consequence plus the trivially-reachable write.
- **Fix:** `Playlist.isProtected` is treated as always-live (never window-scoped — emergency content is live the instant panic is pressed), for both the playlist path and any template a protected playlist renders. Keyed off the existing flag rather than enumerating ~20 nullable tenant/screen columns, which would rot the moment a new panic type is added. **Admins are not newly restricted** — there's a test asserting an admin can still manage protected content, so the panic-content surface is untouched.

---

## Critical review of the salvaged guard

**Kept (it was good work):** control-character rejection (refuse rather than normalize, so what's validated is byte-identical to what's persisted); root-relative allow — verified as the shipped shape across `system-presets.ts` and `restaurant-presets.ts` (`/templates/hs/varsity.html`, `?orientation=portrait`) and the sports direct-mode allowlist (`WidgetRenderer.tsx:4030-4037`); https-only with a dev-loopback `http:` hatch that parses before judging the host; bare-domain resolution matching `WebpageWidget`'s own auto-prefix (`:4039-4041`); `defaultConfig`-as-JSON-string tolerance. Its `validatePublicUrl` choice is right and matches shipped precedent (`ai.service.ts:4707` `parseCtaHref`, `streaming.service.ts:369`) — including the 80/443 port rule, which is therefore not a new restriction.

**Four holes I fixed:**
1. **`playbackUrlVariants[].url` was unguarded.** `StreamingWidget.tsx:72-79` → `pickBestVideo()` → `<video src>`. Added array-field support (`URL_BEARING_ZONE_ARRAY_FIELDS`).
2. **Backslash bypass.** `/\evil.com` and `\\evil.com` passed the root-relative early-return; WHATWG treats `\` as `/` for https pages, so `/\127.0.0.1:8443/x` reached the **kiosk's own loopback**. Shape detection now normalizes the leading separators the way a browser does.
3. **Bracketed IPv6 defeats `validatePublicUrl` outright** — `new URL('https://[::1]/x').hostname` is `"[::1]"` *with* brackets and `net.isIP('[::1]')` is `0`, so the IP-literal test never fires. My spec caught this as a real failure. Closed locally by stripping brackets. **Upstream finding for whoever owns `branding/safe-fetch.ts`:** `safeFetch`/`assertPublicUrl` survive by accident (the non-IP branch then DNS-looks-up `[::1]` and errors closed), but the *synchronous* `validatePublicUrl`-only callers — `ai.service.parseCtaHref:4707`, `streaming.validateStreamUrl:369`, this guard — have no backstop. I did not touch `safe-fetch.ts`: out of my domain.
4. **`localhost` by name** isn't an IP literal so `isPrivateIp` can't see it, but on a kiosk it's the screen's own loopback. `localhost` / `*.localhost` (RFC 6761) now refused; other LAN names (`*.local`, `intranet.*`) deliberately still allowed — on-prem embeds are a shipped use.

Plus a UX correctness fix: a bare `example.com:8443/x` satisfied the scheme regex and reported `Disallowed URL scheme "example.com:"`. It's still refused (port rule) but now with an honest port message.

It remains a **scheme/SSRF gate, not a host allowlist** — tests pin both halves.

---

## Tests added

`apps/api/src/templates/inj003-live-content-gate.spec.ts` (27) and `zone-url-guard.spec.ts` (41). The gate spec's `schedule.findFirst` mock **re-implements Prisma's filter semantics** over an in-memory table, so it asserts the WHERE the controller actually builds. Covers: blocked on live-bound (zones/metadata/restore, and the destructive transaction proven never to fire); still-editable when unbound / draft-bound / window-expired; blocked when future-dated; tenant-scoped; different-template; every admin role bypasses (and never runs the lookup); unknown role fails closed; playlist path all four ways; emergency binding with zero schedules; audit row written; audit failure still yields a clean 403; `@RequireRoles` metadata proving both routes really are CONTRIBUTOR-reachable. URL spec: 8 hostile schemes, 6 control-char smuggles, backslash forms, private/IPv6/localhost hosts, prod `http:`, 5 accepted third-party URLs, root-relative + query, STREAMING's three fields, and both write paths end-to-end.

I also added an explicit `role: AppRole.SCHOOL_ADMIN` to the `req.user` in `c2-staleness-guard.spec.ts` and `c3-version-history.spec.ts` (with a comment). Those modeled a role-less actor, which is not a real caller now that the gate fails closed — flagging it plainly since I edited pre-existing tests.

## Verification (actual output)

```
$ rm -f apps/api/tsconfig.build.tsbuildinfo
$ pnpm --filter api exec tsc --noEmit --project tsconfig.build.json
TSC_EXIT=0                       # no output, clean

$ pnpm --filter api test
Test Suites: 132 passed, 132 total
Tests:       1802 passed, 1802 total
```
Baseline before my changes on this branch was **130 suites / 1730 tests**, all green → +2 suites, +72 tests, **zero failures introduced**. (Worktree had no `node_modules`; I ran `pnpm install` + built the `@cms/*` workspace packages first, otherwise tsc reports phantom `Cannot find module '@cms/signage-design'` errors.)

## Legitimate operator workflows this makes harder — the real cost

1. **A teacher/Editor can no longer fix a typo on a board that's currently on the wall.** They must Duplicate → edit the copy → get an admin to publish. In a small single-operator tenant where the Editor is trusted, this is friction with no perceived benefit. It is unconditional (matching the *unconditional* draft-staging rule in `schedules.controller.ts:108-110`); I deliberately did **not** gate it behind `Tenant.requireContentApproval`, because that flag only controls auto-*filing* a Submission, not whether an Editor may publish. If Greg wants the softer behavior, that's a one-line policy change in `actorNeedsApprovalToEditLiveContent` — but it re-opens the hole.
2. **There is no in-product "submit this template for review" today** (Submission has no template dimension), so the Editor's remedy for a *template* ends at "ask an admin." For *playlists* the remedy is fully supported (duplicate → schedule → auto-staged draft → review queue).
3. **Duplicate-and-edit orphans the version history** and any schedule bindings; the copy is a new row.
4. **Zone URLs on non-standard ports are now rejected at save** (e.g. `https://cdn.example.com:8443/live.m3u8`). This matches the shipped stream-URL validator, but a customer who had such a URL persisted *before* this gate will hit an error on their next save of that template.
5. `POST /templates/create-from-candidate`, `create-designer` and the other AI persist paths are **not** URL-guarded — `create-designer` writes inline `config.html` (no url) and the rest are admin-only. I left them alone rather than risk breaking AI generation in a path I can't exercise here; flagging it as a deliberate scope decision, not an oversight.