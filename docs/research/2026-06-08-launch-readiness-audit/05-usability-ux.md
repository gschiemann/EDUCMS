# Usability / UX / 30-Second Happy-Path Audit — VenueOS (EDU CMS)

**Date:** 2026-06-08 · Read-only · Agent: a38d38d5f42b5c5fc

## Summary

A non-IT operator **can** run this app for the first customer. The core daily loop (pair a screen → upload content → build a playlist → schedule it → edit a template → trigger/clear an emergency) is genuinely wired end-to-end, honestly labeled where features are incomplete, and protected by good error UX. The **"can't edit a word" complaint is FIXED** — themed widgets now expose real array/image editors in `PropertiesPanel`, and all 88 EXTERNAL_HTML signage boards pass the click-to-edit sweep.

**Biggest usability landmine:** a brand-new tenant lands on an **empty dashboard with zero content** — no screen, no playlist, no asset, no starter template. `seedForNewTenant` only creates POS/streaming connections + house ads. First impression for the paying customer is five "0" KPI cards. **Second landmine:** the **Integration Concierge** (the headline "paste-your-URL, we wire your POS" vision) has a fully-built backend (`POST /integrations/discover` + `/describe`) but **no operator-facing UI calls it** — shipped only on the server.

Everything flagged "Coming soon" is honestly labeled (badges, disabled states, contact-sales modals, workarounds). **No real-button costumes that will 503 or silently fail in the demo.**

## 30-second happy-path scorecard

| Flow | Steps | <30s? | Blockers | Verdict |
|---|---|---|---|---|
| Signup → branding | vertical → name → slug → email → pw → submit → branding wizard | ✅ | None — slug auto-derives, "Skip for now" | **PASS** |
| First screen paired | /screens → Pair → 6-char code OR QR OR open `/player` | ✅ | Needs a device showing a code; web-player fallback covers it | **PASS** |
| First content on screen | Upload asset → build playlist → schedule | ⚠️ ~3 pages | No starter template/screen seeded → build from scratch | **PASS but cold-start** |
| Create + schedule playlist | /playlists → New → add items → schedule (screen/group + days/time) | ✅ | None | **PASS** |
| Edit template text/image | Builder → click element (hot-zone jump) → edit field | ✅ | None — themed arrays + images now editable | **PASS (fixed)** |
| Trigger + clear emergency (mobile) | /panic → 3s hold → triggered; all-clear poll | ✅ | None — auth-gated, misconfig-detected, aria-live | **PASS** |
| Trigger emergency (desktop) | TopToolbar Emergency → modal → typed confirm | ✅ | None | **PASS** |
| Import a design | /templates/imports → drop → preview → "Add to Templates" → builder | ✅ | Multi-page PDF = 1 asset (disclosed) | **PASS** |
| Discover integrations (Concierge) | — | ❌ | **No UI exists** — backend only | **GAP (P1)** |

## "Coming soon" costumes — all honest, none dangerous

| Surface | file:line | Operator sees | What happens | Severity |
|---|---|---|---|---|
| Announcements publish | announcements/page.tsx:57 | "Publish Announcement" | Honest "Coming soon — use the Announcement widget" dialog; **page not in sidebar** | OK (honest + orphaned) |
| Streaming → Soundtrack | settings/streaming/page.tsx:230,1283 | "COMING SOON" badge + contact sales | Info modal, not dead OAuth | OK |
| Monetize partner networks | settings/monetize/page.tsx:355 | "Coming soon" badge | "Apply for partnership" link | OK |
| Developer → Documentation | settings/developer/page.tsx:250 | "Documentation (coming soon)" | `unavailable` flag, non-clickable | OK |
| Screen WiringPanel RS485 | screens/[screenId]/WiringPanel.tsx:251 | "Coming soon" + workaround | Disabled; offers RS232/CTS Gen 6 | OK |
| Screen detail footer | screens/page.tsx:1274 | "More coming soon" | Passive text | OK |
| Pair hardware config | PairScreenHardwareStep.tsx:215 | "Configuration UI coming soon" | Disabled, points to spec | OK |
| test-integrations rows | settings/test-integrations/page.tsx:106 | "Coming soon" pill | Admin-only diagnostic, hidden from non-admins | OK |

## Editability re-verification — "can't edit a word" is FIXED
- **Themed widgets:** `THEMED_WIDGET_FIELDS` (`themed-widget-defaults.ts:69`) tags content with `kind`: array-schedule/bell/menu/cards, image. **Actually wired into the render tree** — `PropertiesPanel.tsx:5904-6009` switches on each `kind` → real editors (`ScheduleRowsField`, `WeekMenuEditor`, `MenuCardsField`, `AssetPickerField`). Avoids the registry-without-mount trap.
- **Fitness widgets** (Iron/Stadium/Locker/Discotheque/ChannelGuide/Marquee/Lobby) all reference the registry.
- **EXTERNAL_HTML boards:** `ExternalHtmlTextEditor` (`PropertiesPanel.tsx:6636`) drives the shim. **0 of 88 boards missing** the `educms-field-click`/`_edit-shim` contract — 2026-06-07 redesign-invariant clean.
- **Images everywhere:** `AssetPickerField kind="image"` 20+ times across widget cases.

**Verdict: the editability launch blocker is resolved.**

## Empty-state / onboarding findings
- Dashboard guidance is well-handled: always-visible "Getting started" 3-step card (`dashboard/page.tsx:544`), restorable; per-section empty states.
- **No starter content.** `sample-data.service.ts:58` seeds only `posProviderConnection`, `streamProviderConnection`, house ads — **no screen/playlist/asset/template.** K12 (the beachhead) gets only house ads (MENU/STREAM verticals exclude K12). New operator sees all-zero KPIs.
- **Fire-and-forget race:** `void this.sampleData.seedForNewTenant(...)` (`onboarding.service.ts:187`) — not awaited; seeded data may "appear later."

## Error-UX findings — strong, no lies/stack traces
- **AI not configured:** 503 → "Set up AI" link to settings/ai (never re-calls → no 503-loop); touch-template shows plain-English admin instruction (`templates/page.tsx:396`).
- **Email not configured:** reset-password reads `emailConfigured` and shows the real state, not a false "check your inbox" (`reset-password/request/page.tsx:32,57`).
- **Dashboard load failure:** "Couldn't load your dashboard" + Retry (`dashboard/page.tsx:441`).
- **Panic misconfig:** dedicated `misconfigured` phase when `NEXT_PUBLIC_API_URL` unset (`panic/page.tsx:50`).

## Findings ranked

### P0-candidate (UX first-impression, P1 functional): Empty cold-start for the first tenant
Evidence: `apps/api/src/sample-data/sample-data.service.ts:58-98` seeds only POS/stream/ads; K12 gets only house ads. `dashboard/page.tsx:570` renders five "0" KPIs. Blast radius: every new tenant, every vertical — the literal first screen the customer sees. **Fix:** in `seedForNewTenant` also create (a) one demo `Screen` (PENDING, "Demo Lobby Display"), (b) one starter `Playlist` from a vertical-appropriate system preset, (c) optionally a sample `Schedule`. Turns the empty dashboard into "here's a working example — pair your real screen."

### P1-1 — Integration Concierge has no operator UI
Backend `integrations.controller.ts:72` (`@Post('discover')`) + `:90` (`@Post('describe')`) + `discovery.service.ts` are real. Frontend: **zero** fetch calls to those endpoints anywhere in apps/web/src. The branding wizard pastes a URL for branding only. Blast radius: the entire "no IT consultant" value prop. **Fix:** add a "Recommended integrations" step after branding that POSTs the URL to `/integrations/discover` and renders ranked candidates with Connect/Skip (data shape exists server-side).

### P1-2 — sample-data seed is fire-and-forget (not awaited)
`onboarding.service.ts:187` `void this.sampleData.seedForNewTenant(...)`. Operators on Menu/Monetize right after signup may see seeded data missing then appear on refresh. **Fix:** await in a post-commit hook, or show a "setting up…" state and invalidate queries on completion.

### P2-1 — `/announcements` is an honest-but-orphaned costume
`announcements/page.tsx` — full form that only opens a "Coming soon" dialog; not in the sidebar. **Fix:** ship `POST /announcements` or redirect the page to the Announcement-widget flow it recommends.

### P3-1 — Developer "Documentation (coming soon)" → non-existent docs.venue-os.app (`settings/developer/page.tsx:250`). Handled correctly (disabled); keep until docs host live.
### P3-2 — WiringPanel RS485 + screen-detail footer "coming soon" (niche sports-hardware; honest with workarounds). No action before launch.

---

**Bottom line:** ship-ready for a non-IT operator on the core flows. Two highest-value improvements for the first customer: (1) seed a demo screen + starter playlist so the dashboard isn't all zeros, (2) wire the already-built Concierge `discover` endpoint into a post-branding step. Neither is a demo-breaker; both are first-impression multipliers.
