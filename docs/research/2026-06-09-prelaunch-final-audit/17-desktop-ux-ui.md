# Desktop UI/UX Polish Audit — LIVE venue-os.app @ 1440×900 (chromium + webkit)

**Date:** 2026-06-10 (overnight) · **Auditor:** dedicated desktop-UX agent (pre-launch final audit, section 17)
**Method:** Scripted Playwright walks against the LIVE deploy (`https://venue-os.app`) at 1440×900 in **chromium** and **webkit**, logged in as the seed demo account `admin@springfield.edu` (CONTRIBUTOR on live — both springfield seed users were demoted from their seed roles; no SCHOOL_ADMIN credential was usable without touching a real customer tenant, see Constraints). Console errors, page errors, and failed network requests captured per page. ~30 screenshots in `/tmp/desktop-audit/`. Scripts: `/tmp/desktop-audit/walk.cjs`, `walk2.cjs`, `walk3.cjs`, `walk4.cjs`, `login-debug.cjs`, raw results `/tmp/desktop-audit/results.json`.
**Hard rules honored:** no emergency triggered, no SUPER_ADMIN login, no live-data mutation (no signup submitted, no entity created/saved; wizards walked to last step then cancelled; one intentional failed-login + real logins are the only server-side writes).

**Lens:** would a superintendent show this to their board?
**Verdict: Yes, mostly.** The authed app at 1440×900 is genuinely polished — consistent design system (indigo/slate, rounded-2xl cards, soft shadows), strong empty states, a Canva-grade template builder, role-aware denial screens, and WebKit visual parity. What undercuts the $$$ impression is a first-login dead-end (EULA gating), fabricated customer logos on the public marketing page, a dashboard that flashes fake "All systems normal" zeros before data loads, and a console full of red 401/403s on every page (including the marketing page) the moment a district IT person opens DevTools.

---

## Constraints / scope notes (read first)

- **Role ceiling:** live springfield seed accounts are both CONTRIBUTOR (`admin@springfield.edu` demoted 2026-05-28 by `apps/api/scripts/demote-seed-admin.ts`; verified via read-only SQL). The only live SCHOOL_ADMIN accounts are Greg's own and real-customer/pilot accounts (off-limits). So admin-only surfaces (Settings detail cards, Reviews queue, Branding wizard, Emergency console, audit log) were audited only to their role-denial states. Their internal polish needs a pass with a throwaway SCHOOL_ADMIN on a non-customer tenant.
- **No-mutation rule** prevented executing signup→first-board end-to-end on live. The flow was walked to the final submit and timed/click-counted up to that point; the post-signup onboarding sequence is assessed from code (`onboarding`), not live.
- Empty-state coverage comes from the springfield tenant's mixed state (0 screen groups, populated assets/playlists) + cold-start is KNOWN-OPEN (see dedup below).

## Dedup against prior audits

- **KNOWN-OPEN (not re-reported as new): cold-start all-zero dashboard for brand-new tenants** — 2026-06-08 P1-4 / 2026-06-09 M7 (`seedForNewTenant` fire-and-forget, K-12 seeds only house-ads). Still relevant; this audit adds the *adjacent* new finding that even a populated tenant's dashboard renders fake zeros for ~1–2s (F-3).
- **KNOWN-OPEN: RBAC review loop effectively dead** (2026-06-09 M10) — confirmed visually: `/reviews` for CONTRIBUTOR is a bare one-liner + back link. Not re-reported.
- Pilot creds in public docs, Stripe test mode, secrets rotation — config P0s already tracked; not re-touched.
- 2026-06-08 webkit-nav crash class (favicon/removeChild): **verified fixed on live** — full webkit nav across 6 destinations produced zero React `removeChild`/`parentNode` page errors and no hard reloads. Listed in *solid*.

---

## PAGE-1 COVERAGE TABLE (assignment areas × Design / UX / Functionality)

| # | Area | Coverage | D | UX | F | One-liner |
|---|------|----------|---|----|---|-----------|
| 1 | Marketing page (logged out) | covered | A- | A- | B+ | $$$ look; fabricated "RUNNING ON SCREENS AT" customers (F-1); 401 console noise (F-5) |
| 2 | Login | covered | A- | C | B | Clean card; EULA checkbox makes Enter-key + click silently dead until discovered (F-2) |
| 3 | Signup | covered | A- | B+ | n/t | 10-field single page, FERPA/COPPA links, address autocomplete; submit not executed (no-mutation rule) |
| 4 | Post-login first impression | covered | A- | B+ | B+ | Greeting + Getting-Started checklist + stat cards; fake-zeros flash before data (F-3); "Good night" copy (F-12) |
| 5 | Sidebar destinations (all) | covered | A- | B+ | A- | 6 items, all load <5s, active states correct; Analytics orphaned from nav (F-10) |
| 6 | Empty states | covered | A- | A- | A- | Screen-groups, Proof-of-Play, Recent Activity all friendly with CTAs; cold start KNOWN-OPEN |
| 7 | Loading skeletons | covered | C | C | B- | No skeletons on dashboard — placeholder zeros + false "All systems normal" pill (F-3) |
| 8 | Error states (404/invalid/denied) | covered | A | A- | A | Branded 404 (global + tenant), role-aware denials with recovery links |
| 9 | Typography/spacing consistency | covered | A- | — | — | One design system throughout; minor brand-string drift "Venue OS" vs "VenueOS" (F-11) |
| 10 | Brand-injection quality | deferred | — | — | — | springfield has default branding; needs SCHOOL_ADMIN tenant w/ brand kit to grade |
| 11 | Modal polish | covered | A- | A- | A- | Pair-Screen, New-Playlist 5-step wizard, Upload-folder picker all centered/escapable/polished |
| 12 | Toast/inline feedback | covered | A- | A- | A- | Copy-URL flips to green "✓ Copied!" inline; AppDialogHost present |
| 13 | 30s happy paths (add screen / upload / playlist / template) | covered | — | B+ | B+ | Pair=2 clicks to code entry; Upload=2 clicks to OS picker; Playlist wizard 5 steps ~6 clicks; template customize→builder loads in ~8s |
| 14 | Onboarding signup→first board | deferred-with-reason | — | B (est) | — | Not executed on live (mutation rule); form = 10 fields, then Getting-Started 3-step checklist drives to first board; est. 4–6 min |
| 15 | Cross-browser (webkit parity) | covered | A- | A- | B+ | Visual parity on 6 pages; no React crashes; Safari-only "access control checks" fetch errors (F-8) |
| 16 | Console/network hygiene (operator-visible quality) | covered | — | — | C | 401s on public pages, 403 storms on every authed page, 404 thumbs on templates (F-4/5/7) |

Standard-Audit-Surface mapping: this report covers §20 (D/UX/F lenses) for the desktop web app, plus §15 (cross-browser, WebKit) and §18 (a11y spot notes) within that scope. All other numbered SAS sections (1–14, 16, 17, 19, 21) are **N-A here — owned by sibling auditors in this same final-audit fleet**.

---

## FINDINGS

### P1-A. Public marketing page claims fictional customers ("RUNNING ON SCREENS AT — Lincoln USD, Riverside Arena, Northgate Market, Iron & Oak Fitness, Summit Hotels")
- **Evidence:** live `https://venue-os.app/` social-proof strip (screenshot `chromium-marketing-root.png`); hardcoded at `apps/web/src/app/page.tsx:115`.
- **Why P1:** these read as named, real customers. Districts do reference checks; one "can I call Lincoln USD?" or one competitor screenshot = credibility/false-advertising problem at exactly the trust level a life-safety vendor can't afford. (Real traction exists — AGC pilot, water polo venue — which makes the fake strip doubly unnecessary.)
- **Fix (30 min):** relabel to honest framing ("BUILT FOR districts, arenas, markets, gyms, hotels") or swap in real pilot names with permission, or remove the strip.

### P1-B. First-time login is a silent dead-end until the EULA checkbox is discovered (Enter does nothing, button unclickable, error message unreachable)
- **Evidence:** `apps/web/src/app/login/page.tsx` — submit button `disabled={loading || !eulaAccepted}` (~:410) with only a hover `title`; the `handleLogin` guard that would explain ("You must accept the End User License Agreement…", :182-185) is **dead code**: with the default submit button disabled, implicit form submission never fires, and the button can't be clicked either. Reproduced live in both browsers: filled valid creds, pressed Enter → nothing (no error, no shake, no focus move); my scripted walk failed twice on exactly this (`results.json` login-submit timeouts; `login-debug.cjs` output shows `<button disabled title="You must accept the EULA to sign in">`).
- **Why P1:** this is the FIRST 30 seconds of every new operator on every new browser/device (EULA acceptance is per-browser localStorage, so it recurs on every new machine, incognito, cleared storage, password-manager autofill+Enter flows). The form looks complete — Email, Password, Sign in — and silently refuses. This is the "non-IT operator, 30s task" gate failing on task #1.
- **Fix (1 hr):** keep the button ENABLED; on submit without EULA, show the existing error + scroll/flash the checkbox (the code for the message already exists and becomes reachable). Optionally `aria-disabled` styling instead of `disabled`. Add Playwright regression: Enter with unchecked EULA must surface visible guidance.

### P2-C. Dashboard paints fabricated "all-clear" data before queries resolve — no loading skeletons
- **Evidence:** `chromium-dashboard-early.png` (700ms after commit): green "**All systems normal**" pill, "FLEET HEALTH 0.0% — No screens paired yet", "DOWN 0 — all reporting in", LIBRARY 0, SITES 0, raw slug `springfield-elementary` in the tenant pill. ~1–2s later (`chromium-page-dashboard.png`): amber "**3 items need attention**", DOWN 3, LIBRARY 7, SITES 1, "Springfield Elementary".
- **Why it matters:** on an ops/emergency product the status pill is the one element operators trust at a glance — it should never assert "All systems normal" as a loading placeholder and then flip to "3 items need attention". "No screens paired yet"/"all reporting in" are confident false statements. Same class on the stat cards.
- **Fix:** skeleton/shimmer (or `—`) until `isSuccess`; never default the health pill to a green all-clear; show tenant display-name only after hydration.

### P2-D. Every authed page fires admin-only API calls as a non-admin → guaranteed red console + wasted requests (the exact class the Sidebar already fixed)
- **Evidence (live, CONTRIBUTOR):** dashboard: `GET /audit/recent` 403 ×2+ per view; screens: `GET /tenants/me/canary-rollout` 403 ×2 + `GET /player/latest-version` 403 ×2; playlists & settings: `GET /users` 403 ×2–3 (`results.json`, both browsers). `components/layout/Sidebar.tsx:~270` comments prove the team already knows this pattern ("otherwise every non-admin would fire a recurring 403 … just to render a sidebar") — the page-level hooks never got the same `enabled: isAdmin` gate.
- **Why it matters:** a district IT evaluator WILL open DevTools; a wall of red 401/403 on every click reads as broken/insecure. Also masks real errors and burns API quota. (The 403 envelope copy itself — "Ask an administrator if you need access." — is good.)
- **Fix:** sweep `use-api.ts` hooks used on dashboard/screens/playlists/settings; gate `audit/recent`, `canary-rollout`, `player/latest-version`, `/users` on role like the sidebar hooks. ~half-day + add a Playwright assertion "0 console errors as CONTRIBUTOR on the big-5 pages".

### P2-E. Public pages (marketing, /login, /signup) call `/branding/me` unauthenticated → 401 console errors ×2–4 on the first page any prospect sees
- **Evidence:** `results.json` marketing-root/login/signup in both browsers: `401 GET …/api/v1/branding/me` ×2 + `[api] Request failed … Unauthorized` log spam. Source: `BrandStyleInjector`/branding hook mounting outside the authed shell.
- **Fix:** skip the fetch when no auth token exists (one guard), or 200-with-defaults for anonymous.

### P2-F. Notification bell: 15 unread, all stale duplicates from 25–26 days ago, no aging/dedup/auto-resolve
- **Evidence:** `x-notifications.png` — every row is "Screen offline: OTA Sandbox (emulator) — No heartbeat since 2026-05-15/16…", 6+ near-duplicates for the same screen, badge stuck at red "15".
- **Why it matters:** offline alerts that never resolve or collapse train operators to ignore the bell — the worst possible habit on a product whose pitch is "you'll know when a screen is down." (Phase-2b fleet alerting shipped the trigger; lifecycle is missing.)
- **Fix:** collapse per-screen (latest wins), auto-resolve on heartbeat resume/screen delete, age-out (>7d → archived), cap badge display ("9+").

### P2-G. Template gallery requests 5 nonexistent thumbnails on every visit (404 ×5–6) after the HS board redesign
- **Evidence:** `404 GET https://venue-os.app/templates/_thumbs/hs/{morning-news,achievement,bell-schedule,zine,gallery}.png` on `/templates` in both browsers (`results.json`); repo `apps/web/public/templates/_thumbs/hs/` contains 16 files, none of these 5 (verified by ls). Cards still LOOK fine (live-render fallback; `document.images` shows 0 broken), so this is network/console hygiene + lost LCP, not visual breakage — but it's on the flagship sales page and recurs every visit. Root cause: batch-1/2 HS redesign (commits `c4b0f04e`/`cf5772ae` era) renamed boards without regenerating `_thumbs` (the DB preset rows still point at old names).
- **Fix:** regenerate thumbs for the new HS set (existing thumb-gen script) or null the `previewImage` on those preset rows so the fallback is intentional.

### P2-H. Safari/WebKit cannot read some API *error* responses — "Fetch API cannot load … due to access control checks" page errors
- **Evidence:** webkit runs only: unhandled page errors on `users/me`, `/tenants`, `/users` (`results.json` webkit dashboard-early-paint + page-settings) while the same requests in chromium return clean 401/403 envelopes. Pattern matches CORS headers missing/stripped on some error responses via the Railway origin, so WebKit blocks the body and the client gets a TypeError instead of the server's message.
- **Why it matters:** the carefully written server error copy ("Ask an administrator…") can degrade to generic "something went wrong" for Safari users, and unhandled promise rejections are one refactor away from an error-boundary screen. Cross-browser rule #1 says WebKit is the canary.
- **Fix:** confirm the NestJS exception path (and any proxy) sets `Access-Control-Allow-Origin` on 4xx/5xx; add a webkit assertion that a 403 envelope is readable.

### P2-I. Same role has two names in the same viewport: sidebar footer says "Editor", account page badge says "CONTRIBUTOR"
- **Evidence:** `chromium-page-account.png` (badge "CONTRIBUTOR") vs sidebar footer "Admin / Editor" visible on every page. Docs/DB say CONTRIBUTOR; newer UI says Editor.
- **Why it matters:** role vocabulary is how admins delegate ("I made you an Editor") — drift breaks support conversations and the RBAC mental model. Pick one display name and map it everywhere (the 06-09 RBAC plan already leans "Editor").

### P2-J. Analytics / "Proof of Play" page is orphaned — polished page, no nav entry for any role
- **Evidence:** `/springfield-elementary/analytics` renders a finished page (`chromium-page-analytics.png`: 7/30/90-day toggle, friendly empty state). `components/layout/Sidebar.tsx` navItems = Dashboard/Screens/Assets/Templates/Playlists/(Sports)/(Menu)/Settings (+Reviews admin) — **no Analytics**; no other link found (grep across Sidebar/TopToolbar/dashboard page = 0). Discoverable only by typing the URL.
- **Why it matters:** proof-of-play is a headline capability for sponsors/admins; a feature operators can't find doesn't exist (and its empty state even explains data collection — wasted polish). Fix: add nav entry (possibly admin-gated) or link from the dashboard stats row.

### P3-K. Brand-string drift: browser tab says "Venue OS" on login, account footer "Venue OS dashboard"; brand is "VenueOS" everywhere else
- Evidence: `page.title()` = "Venue OS" on /login vs "VenueOS — the operating system…" on marketing; `chromium-page-account.png` footer. One-token fix in layout metadata.

### P3-L. "Good night, Admin" greeting at 11 PM
- Evidence: `chromium-page-dashboard.png`. "Good night" is a farewell; convention is "Good evening" (most products cap at evening). Tiny, but it's the first line of the app.

### P3-M. Demo/seed tenant shows test cruft in the UI Greg demos
- Evidence: playlists `__editor_review_test__`, `Test`, "Rainbow Ribbon copy — By **Unknown creator**" (`chromium-page-playlists.png`); templates table has `zz_test_delete_me` + duplicate "🏛️ Gallery — Museum Wall Labels" ×2 (read-only SQL). "Unknown creator" is also a copy bug worth a nicer fallback ("VenueOS team" / hide the byline). Cleanup is a 5-minute pass *by the owner* (this audit mutated nothing).

### P3-N. `/announcements` scaffolding page live on prod ("Feature in development" banner)
- Evidence: `chromium-page-announcements.png` — full form + disabled Publish + honest amber banner, reachable by URL, not in nav. Honesty is good practice; for launch either gate it behind a flag or keep — low risk.

### P3-O. `apps/web/src/components/app-sidebar.tsx` is dead code with a divergent nav (Analytics/Reviews/no Templates) and stale role logic
- Evidence: zero render sites (`grep -rn '<AppSidebar' apps/web/src` → none); real nav is `components/layout/Sidebar.tsx`. This is the exact CLAUDE.md rule-#9 trap (edits landing in never-rendered files). Delete it.

### P3-P. Playlist cards: clicking the card body/title does nothing
- Evidence: scripted click on "Rainbow Ribbon copy" title → no navigation/no editor (`x-playlist-editor.png`); page has zero `<a href*="/playlists/">` (walk3 output); there's no detail route (`app/[schoolId]/playlists/page.tsx` only). Editing exists via other affordances (wizard/inline), but the biggest click target on the card is inert — operators will click the card first. Make the card open the editor drawer.

### P3-Q. Builder entry uses `window.location.href` full page reload
- Evidence: `app/[schoolId]/templates/page.tsx:406,593`. Works (builder loaded in ~8s total incl. fonts), but it's the only major transition that hard-reloads the SPA. Use `router.push` unless the reload is deliberate (stale-bundle hygiene) — if deliberate, comment it.

### P3-R. Screens page offers Pair Screen / New Group / Create First Group to CONTRIBUTOR (role-appropriateness unverified)
- Evidence: `chromium-page-screens.png` as CONTRIBUTOR; pair modal opens (`chromium-modal-add-screen.png`: "Pair a Screen — Enter the 6-digit code… Scan instead with phone" — nice). NOT verified whether the backend accepts a CONTRIBUTOR pair/group-create (no mutation attempted). If backend denies → button is a costume for this role; if it allows → confirm that's intended policy. Either way, align UI visibility with the decision.

---

## What's genuinely solid (verified, so nobody re-spends effort)

1. **Design-system consistency** across every audited page — same card language, type scale, spacing, icon set; nothing looks bolted-on. Typography/spacing grade A-.
2. **Marketing page** is a real SaaS front door: clear positioning ("The operating system for every screen you run"), vertical sections, pricing/help links, "Up and running in 10 minutes" promise. (Fix F-A's fake logos and it's an A.)
3. **Login→dashboard in ~1.3–1.4s** (both browsers); all sidebar destinations reach networkidle in 2.4–5.3s on live.
4. **Bad-password UX**: visible "Invalid credentials" inline (once EULA checked), no info leak.
5. **Signup form quality**: password+confirm, FERPA/COPPA footer links, address autocomplete with fleet-map explainer, anti-spam phone copy, dark value-prop panel. 9–10 fields on one page is long but scannable.
6. **Dashboard IA**: Getting-Started 3-step checklist (dismissable) mirroring the real activation path (Connect screen → Upload → Build playlist), stat cards with real drill targets, per-site health table, Today's Schedule + Recent Activity.
7. **Screens page onboarding strip**: "Open the Player URL → Get Pairing Code → Pair it Here" + Copy-URL with inline "✓ Copied!" state — best-in-class add-a-screen affordance; QR "Scan instead with phone" in the pair modal.
8. **Empty states with CTAs everywhere**: No Screen Groups Yet→Create First Group; Proof-of-Play explains its data pipeline; Recent Activity "will appear here".
9. **Role-aware denials, not errors**: Settings shows "Admin Access Required — contact your administrator" card while still exposing the self-service Security & 2FA row; Reviews explains and links back; audit says exactly who to ask.
10. **404 page** (global AND inside-tenant): branded, explains, one-click "Back to VenueOS".
11. **Modal stack**: New-Playlist 5-step wizard (named steps, disabled-Next until valid, type cards), Upload folder-picker, Pair-Screen — all centered at 1440×900, Escape-dismissable, backdrop-blurred.
12. **Template builder** (opened via direct URL as CONTRIBUTOR): Canva-grade three-pane editor, brand-library buttons, premium "Westridge High — Atrium Gallery" board render, zero page errors.
13. **WebKit parity**: pixel-equivalent dashboard/screens/templates/playlists/settings; **zero React removeChild/parentNode crashes** across webkit client-side nav — the 2026-06-08 crash class stays fixed on live.
14. **Security posture visible in UX**: emergency console simply doesn't exist for a non-panic role (404, no tease), version hash in account footer (`cf5772a`) for supportability.

## Missing features noticed through the desktop lens (not bugs)

- No global search / command palette (⌘K) — competitors (ScreenCloud, Yodeck) ship it; with 6 nav items it's tolerable, but fleet customers (150-screen Acme) will want jump-to-screen.
- No product tour / contextual help beyond the "?" icon; Getting-Started checklist partly covers this.
- No breadcrumbs on deep pages (builder relies on back arrow).
- Analytics has no nav home (F-J) — counted both as finding and gap.
- No "what's new/changelog" surface despite rapid shipping cadence.

## 30-second happy-path timings (CONTRIBUTOR, live, measured)

| Task | Clicks to commit point | Verdict |
|------|------------------------|---------|
| Add screen | Screens → "Pair Screen" → code field focused = 2 clicks (+6-digit type) | PASSES 30s easily; the 3-step strip + QR option is excellent |
| Upload asset | Assets → "Upload" → folder confirm → OS picker = 2–3 clicks | PASSES (folder-picker step is one extra but sensible) |
| Make playlist | Playlists → "New Playlist" → 5-step wizard | PASSES for the wizard's named path (~6 clicks + typing); full schedule setup pushes ~60–90s — acceptable |
| Customize template | Templates → card click → builder (full reload, ~8s to interactive) | borderline: load time + full reload eat half the budget; editing itself is immediate |
| Login (first time, fresh browser) | **FAILS** until EULA discovered (F-B) — the 30s task that gates all others | fix F-B |

---

*Screenshots referenced are under `/tmp/desktop-audit/` (chromium-*.png, webkit-*.png, x-*.png, y-*.png). Raw per-page console/network logs: `/tmp/desktop-audit/results.json`.*
