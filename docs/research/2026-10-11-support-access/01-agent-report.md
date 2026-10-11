# Customer-approved, time-boxed support access — agent report (2026-10-11)

Branch: `worktree-agent-a4420cdf4dfc95f7c` (rebased on `origin/master` @ `6498d9f8`, four commits, nothing pushed, production untouched).

| commit | step |
|---|---|
| `6b02bcfe` | feat(db): `support_access_grants`, `Tenant.isInternal`, `AuditLog.supportGrantId` — additive, idempotent migration |
| `89f198ac` | feat(api): grant-gated SUPER_ADMIN reach — interceptor, switch gate, every cross-tenant resolver closed, controllers, emails, notifications |
| `657d4b41` | feat(web): customer banner + Settings page, console card, switcher hints, api-client redirect, en/es/zh |
| `e5620a9f` | chore(db): migration renamed `20261011130000_support_access` so it sorts after master's `20261011120000_license_trial` |

## 1. What changed

**The rule.** VenueOS has no standing access to a customer's data. A `SUPER_ADMIN` reaches a customer organisation (switches into it, reads or changes its screens, playlists, assets, schedules, people, alerts, settings, logs) only while an **ACTIVE `SupportAccessGrant`** covers the tenant being touched. Exempt by design: an **internal** organisation (`Tenant.isInternal` on the root) and the super admin's **own home tenant** (`User.tenantId`) — so the owner can never lock himself out whatever the flag says.

**Two ways in, one grant** (`apps/api/src/support-access/`):
- **(A) VenueOS asks** — `POST /api/v1/super/customers/:id/support-access/request` `{ reason, durationMinutes (15 min … 30 d; UI offers 1 h / 24 h / 7 d), scopeTenantIds? }`. Creates a `REQUESTED` row, audits `SUPPORT_ACCESS_REQUESTED`, writes an in-app `Notification` **and** an email (`EmailService.sendSupportAccessRequested`, respects the existing dispatcher / `isConfigured` behaviour) to every deciding admin. The customer's admins approve — **optionally shorter** — or deny from Settings (`POST /api/v1/support-access/:grantId/approve|deny`). VenueOS's super admins get an in-app notice of the decision.
- **(B) Customer invites us** — `POST /api/v1/support-access/invite` `{ durationMinutes, note?, scopeTenantIds? }` from Settings → *VenueOS support access*. `ACTIVE` at once, audited `SUPPORT_ACCESS_INVITED`.
- Either side ends it any time (`…/revoke`, audited `SUPPORT_ACCESS_REVOKED`; withdrawing an open request is `SUPPORT_ACCESS_WITHDRAWN`). A lapsed grant is refused the instant `expiresAt` passes and the first read that sees it stamps `EXPIRED` + `SUPPORT_ACCESS_EXPIRED` (lazy, exact, no cron).
- **Break-glass** — `POST …/support-access/break-glass` `{ reason (mandatory) }`: a separate explicit action, kind `BREAK_GLASS`, **≤ 60 min hard cap**, audited `SUPPORT_ACCESS_BREAK_GLASS`, every deciding admin is emailed (`sendSupportAccessBreakGlass`) + notified the moment it opens, shown on their banner in red, endable by them at once. Throttled 3/min.
- **Scope**: a grant lives on the organisation **root**; empty `scopeTenantIds` = whole org; otherwise only the listed locations — a sibling location and the root are NOT reachable.
- **Deciding roles**: `DISTRICT_ADMIN` anywhere in the org, or a `SCHOOL_ADMIN` on the root itself (single-location owner). A `SUPER_ADMIN` can never approve its own request (explicit check, not RbacGuard's pass-through). Every signed-in person of the org can READ the state (the banner is for everyone).

**Enforcement (`support-access.interceptor.ts`, global `APP_INTERCEPTOR`, `@Global` module imported by `AppModule`):**
1. For every request by a SUPER_ADMIN *person* (never a device, never an API key, never any other role) whose path is not exempt, the session's active workspace (`req.user.tenantId`) must be reachable → else **403 `SUPPORT_ACCESS_REQUIRED`**, handler never runs.
2. Exempt (no grant needed): `/auth/*`, `/health*`, `/security/csrf`, `/users/me`, `/tenants/accessible`, `/tenants/switch`, `/super/*` (customer console + platform ops), `/support-access/*`, `/license/*`, `/billing/*` (Stripe checkout/portal/invoices — account metadata), `/player-ota/*`, `/bugs/*`, `/geocode/*`, `/ai/catalog/*`. **Not** exempt: `/tenants/me`, `/branding/me`, `/notifications` (they read the active tenant's own rows).
3. Under a grant the handler runs inside the existing ambient audit-actor frame with `supportGrantId`, so the Prisma hook (`audit-actor.ts`) stamps **every `AuditLog` row any code writes during that request** with the grant → the customer's audit log attributes it to the access they approved. A mutating request additionally writes a `SUPPORT_ACCESS_ACTION` row `{ method, path }`. Reads are attributed but not recorded (a 304 poll would flood the log).
4. **Cross-tenant half** — routes where a super admin names *another* tenant's row by id go through `assertSupportReach(req.user, owningTenantId)` (`support-access.context.ts`, reads the frame the interceptor opens; a no-op for non-super principals and outside a frame).
5. `POST /tenants/switch`: a SUPER_ADMIN enters a customer org only with reach; the `TENANT_SWITCH` audit row carries `supportGrantId` + basis. `GET /tenants/accessible` annotates every row with `supportAccess: 'internal' | 'home' | 'grant' | null` (two queries, not two per tenant).
6. Fails **closed**: if the grant lookup itself errors, the answer is "no reach" (and is not cached). Per-process cache 10 s (tenant/home facts 60 s); every grant mutation clears this replica's cache — a revoke is honoured fleet-wide within 10 s.

**Customer-visible surfaces (web):**
- `SupportAccessBanner` in `DashboardLayout` chrome: *"VenueOS support has access to this organization until …"* with **End now** (admins) / **Details**; *"VenueOS (…) is asking for support access"* with **Review**; break-glass reads as emergency in red. Renders nothing otherwise, never for a SUPER_ADMIN, no timers (read on mount + refetch on focus — mobile-perf guard clean).
- Settings → **VenueOS support access** (`/[schoolId]/settings/support-access`, registry section `supportAccess`, group *access*): pending request (approve for a shorter time / deny with note), the active grant (who/why/until/scope, End now), *Give VenueOS support access* (duration, note, whole org or specific locations), history.
- Customer console → `SupportAccessCard` on each customer: current reach, ask (reason/duration/scope), end our access / withdraw, **break-glass** behind its own reason prompt, history. `/super/customers?accessEnded=1` notice; `api-client` sends a super admin whose workspace 403s to the console instead of a dashboard full of errors. Workspace switcher shows a lock on organisations that need approval.
- All strings in en/es/zh (`supportAccess.*`, `customerConsole.support.*`, `settings.cc.supportAccess.*`, `settings.shell.sections.supportAccess`, `switcher.needsAccess`); parity gate green.

**No new JWT claim.** Enforcement is DB-state per request, so a revoke/expiry takes effect without re-minting; the MFA/passkey session-mint sites (`mfa.controller.ts` / `passkey.controller.ts`) needed no change — nothing was added to the login claim set.

## 2. Every bypass found and closed

Found by sweeping every non-decorator `SUPER_ADMIN` reference in `apps/api/src` (71 files) and reading each branch.

| # | site | before | now |
|---|---|---|---|
| 1 | `POST /tenants/switch` (`tenants.controller.ts`) | any SUPER_ADMIN → any tenant | reach required; grant id on the audit row |
| 2 | every tenant-scoped route via `req.user.tenantId` (screens, playlists, assets, schedules, users, audit, notifications, branding, settings, sports, POS, AI, …) | a switched-in super admin read/wrote everything | global interceptor: 403 without reach |
| 3 | `EmergencyController.resolveScopeTenant` (trigger / all-clear / per-scope overrides, tenant·group·device) | `isSuper` skipped the ownership check | `assertSupportReach(owningTenantId)` — **a super admin can never trigger or clear a customer alert without a grant** |
| 4 | `EmergencyController.clearMessage` (`/emergency/messages/:id/all-clear`) | super cleared any tenant's message | reach on `existing.tenantId` |
| 5 | `EmergencyController.status` with `?tenantId=` | super read any tenant's active messages | reach on the queried tenant |
| 6 | `ScreenEmergencyController.resolveScreen` (per-screen trigger / clear / read) | null tenant filter for super | reach on `screen.tenantId`; all 3 callers pass `req.user` |
| 7 | `ScreensController.revokeCredential` | `isSuper ? { id } : …` | reach on the screen's tenant |
| 8 | `ScreensController.getManifest` (user JWT path) | super read any screen's manifest incl. live `emergency` | 403 `SUPPORT_ACCESS_REQUIRED` without reach (device path untouched) |
| 9 | `GpioController` set-output | super on any screen | reach |
| 10 | `DisplayController.loadOperatorScreen` (power / display commands) | super on any screen | reach |
| 11 | `TemplatesController` GET `:id` | `scopeTenantId = null` → every tenant's templates | scoped to the active workspace (+ system presets) |
| 12 | `AssetsController` GET by id (public-file resolver) | `scopeTenantId = null` → any tenant's asset | scoped to the active workspace |
| 13 | `UsersController.setCanTriggerPanic` / `setMfaRequired` | super on any user | reach on target's tenant |
| 14 | `loadManageableTarget` (role change, email change, setup links, lifecycle, MFA reset) | super on any user | reach on target's tenant |
| 15 | `SsoController.assertTenantAccess` | super on any tenant's SSO config | reach |
| 16 | `OnboardingService` createInvite / createUserDirect | super invites into any tenant | reach on `input.tenantId` |
| 17 | `TenantsController` delete / archive-unarchive | super on any tenant | reach on target |
| 18 | `TenantsController` USB-ingest trail write | super on any screen | reach on `screen.tenantId` |

Left open **on purpose** (listed under decisions): `/bugs/*` (Bug Reporter — our own support intake, carries customer session captures), `super/storage/wipe-all-assets` + `backfill-cache-control` (platform storage ops that touch every tenant), `super/tenants/:id/license|comp` (license = console metadata), `IntegrationsHealthController ?admin=1` (platform probes, no tenant content), billing checkout/portal on the active tenant (account metadata).

## 3. Internal organisations (verified against production, read-only)

Marked `is_internal = true` by the migration (root slugs; a location inherits its root at run time):

| slug | name | why |
|---|---|---|
| `__system__` | System (security events) | never a customer |
| `visioncore-systems` | VisionCore Systems | the owner's media-player box |
| `dodgers` | Brookfield Residential Northern California | **Greg's home org** — the only SUPER_ADMIN (greg.schiemann@e-arc.com) lives here; exempt by the home rule anyway, flagged so it is explicit |
| `springfield-district` (+ `springfield-elementary`) | seeded demo district | demo |
| `goodview` | Goodview | Android-9 bench unit |
| `arc-service-department` | ARC Service Department | the owner's company |

NOT marked (treated as customers, need a grant): `riot-corporate` + 40 RIOT locations, `walnut-creek-school-district` + 7 schools, `chardon-high-school` (Crunch Corporate + 2), `agc-education`, `grace-community-church` (City Church SF), `durgabari`, and ~110 archived beta/test orgs (archived tenants are not switchable anyway). The flag can also be flipped later with one SQL update; there is no console toggle yet (see decisions).

## 4. Decisions for Greg

1. **Brookfield (`dodgers`) marked internal.** It is your home org; if it is a real paying customer we should move your SUPER_ADMIN account to VisionCore and un-flag it.
2. **Crunch / AGC / City Church / Durgabari** — customers or demos? They need a grant today.
3. **Break-glass exists** (≤ 1 h, mandatory reason, immediate email + banner, audited, 3/min). Keep, or remove the route if you want zero unilateral paths.
4. **Reads under a grant are attributed (every audit row carries the grant) but not individually logged**; mutations get a `SUPPORT_ACCESS_ACTION` row each. Log reads too?
5. **Bug Reporter (`/super/bugs`, `/bugs/*`) stays open** without a grant — bug captures include the reporter's page/console/network snapshot. Gate it?
6. **`super/storage/wipe-all-assets` / `backfill-cache-control`** stay open as platform ops (they span all tenants, no single grant can cover them). Keep, or require a typed confirmation?
7. **Durations**: UI offers 1 h / 24 h / 7 d; API accepts 15 min – 30 d. Max OK?
8. **`isInternal` has no console control** — set by migration/SQL only. Add a "VenueOS internal" toggle on the customer page?
9. Expiry is lazy (stamped on the next read/list, exact to the second). A nightly sweep to stamp `EXPIRED` on orgs nobody reads is cosmetic — add one?
10. Emails: `VenueOS <onboarding@resend.dev>` only delivers to the Resend account owner — until `EMAIL_FROM` is a verified domain, customer admins get the in-app notice but not the mail (existing `EmailService` posture, unchanged).

## 5. Lockout + unaffected-sessions proof

- Home tenant always reachable (`basis: 'home'`), internal orgs always reachable, `/super/*` + `/tenants/switch` + `/users/me` + `/auth/*` exempt — pinned by `support-access.service.spec.ts`, `support-access.interceptor.spec.ts`, `support-access.bypasses.spec.ts` ("the super admin's own home org always works"). The api-client redirect excludes `/super`, so the console never loops.
- Customers, screens (device principals), API keys and anonymous routes are never touched by the gate (`interceptor.spec` "NEVER touches…"; `assertSupportReach` no-op for non-super). Emergency routes for customers are unchanged; the suspension interceptor's exemptions are untouched.
- A stale super-admin session stamped with a customer tenant gets 403s on tenant data and is sent to the console; switching home/internal works.

## 6. Tests

Whole API suite (after rebase): **486 suites passed, 9485 tests passed, 18 skipped** (`apps/api`, `jest --maxWorkers=4`). New/extended:
- `support-access.policy.spec.ts` — 37 cases: active/lapsed, sibling-scope refusal, shorten-only durations, parsers, exempt-path table.
- `support-access.service.spec.ts` — 26 cases over an in-memory DB: reach (none/internal/home/grant/scoped/sibling), **time-mocked expiry** (reach at +29 min, refused at +30, `EXPIRED` + audit row), revoke, fail-closed, caching; request flow (A) incl. notify/email to deciding admins only, approve **shorter**, clamp, deny, cross-org 404; invite flow (B); revoke both sides; break-glass cap/email/conflict; `isOrgAdmin`; `listForOrg`; `recordAction`; `reachableBasisBulk`.
- `support-access.interceptor.spec.ts` — 10 cases: 403 on ten tenant-data routes, exempt routes, non-super untouched, audit frame carries the grant, mutations recorded, no leak between requests, `assertSupportReach`/`hasSupportReach` in/out of a frame.
- `support-access.bypasses.spec.ts` — 18 cases through the **real** controllers: emergency trigger scope (tenant/group/device) refused + under grant, clearMessage, per-screen resolveScreen, tenant switch (403, audit row with grant, home ok, district admin ungated, frame fallback), `/tenants/accessible` annotation, users/manageable-target, per-file closure counts (a revert cannot be silent), module wiring (@Global + APP_INTERCEPTOR + AppModule import), console routes SUPER_ADMIN-only, customer deciding routes refuse SUPER_ADMIN/viewer.
- `audit-actor.spec.ts` +3: `supportGrantId` stamping (never overwrites, createMany, other models untouched).
- Web: `support-access.test.tsx` — 11 cases (banner silent/never for super, End now via confirm → revoke, viewer no button, pending/break-glass copy, no `refetchInterval`; settings approve-shorter select never offers longer, deny with note, invite with scope, active card scope + end; console request with reason/duration/scope, break-glass prompt-first, active/pending/internal states). Touched-area web suites: 29 suites / 285 tests green.
- Gates: api `tsc` (tsconfig.build) clean; web `tsc --noEmit` unfiltered clean; `check-i18n-parity.cjs` OK (4298 keys); `check-mobile-perf.cjs` OK; jsx-a11y errors **42 = `.a11y-baseline`**. `pnpm --filter api run lint` was NOT run (binding rule).
- Migration `20261011130000_support_access` proven on a scratch Postgres: full `prisma migrate deploy` from zero (after `license_trial`), then the file applied a second time via psql — both exit 0.

## 7. Files

API: `apps/api/src/support-access/{support-access.policy,service,context,interceptor,controller,module,super-support-access.controller}.ts` (+5 specs, fake DB), `audit/audit-actor.ts`, `email/email.service.ts`, `app.module.ts`, and the 11 closure sites listed above. DB: `packages/database/prisma/schema.prisma`, `migrations/20261011130000_support_access/migration.sql`. Web: `lib/support-access.ts`, `hooks/use-support-access.ts`, `components/support-access/{SupportAccessBanner,SupportAccessSettings}.tsx`, `components/super/customers/SupportAccessCard.tsx`, `app/[schoolId]/settings/support-access/page.tsx`, `components/settings/shell/registry.ts`, `components/settings/cc/OverviewPage.tsx`, `components/layout/{DashboardLayout,SchoolSwitcher}.tsx`, `app/super/customers/page.tsx`, `lib/api-client.ts`, `hooks/use-api.ts`, `i18n/messages/{en,es,zh}.json`.

Not done / for the lead: no CLAUDE.md edit (lead's call); no on-glass or live verification (nothing deployed); `isInternal` console toggle; a `SupportAccess` section in `docs/SECRET-ROTATION.md`-style ops docs.
