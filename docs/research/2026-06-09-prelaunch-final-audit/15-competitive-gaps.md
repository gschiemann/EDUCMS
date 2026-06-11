# §5 AI-Tool Comparative Scan + Full Missing-Features Competitive Audit

**Audit:** 2026-06-09/10 pre-launch FINAL pass · **Auditor:** competitive-gaps agent (fresh frontier-model pass)
**Assigned sections:** Standard Audit Surface §5 (AI-tool comparative scan) + full missing-features competitive scan
**Method:** every "do WE ship it" claim verified in the repo (file:line), never assumed; competitor 2026 feature sets from live web research (Yodeck, OptiSigns, ScreenCloud, Rise Vision, Navori, BrightSign, ScoreVision, Daktronics Show Control, InformaCast, Raptor, Navigate360).
**Dedup:** checked against `docs/research/2026-06-09-full-audit/REPORT.md` and `2026-06-08-launch-readiness-audit/00-MASTER-SYNTHESIS.md`. Items already tracked there are marked **KNOWN-OPEN** (verified still open) or listed under "solid" (verified fixed/real). Did NOT read `sonnet-baseline/` (blinded control).

---

## Coverage declaration (first page, per CLAUDE.md rule)

| Section | Coverage | DESIGN | UX | FUNCTIONALITY |
|---|---|---|---|---|
| §5 AI-tool comparative scan | **covered** | B | B− | **C+** (unchanged from 06-08 — image-gen/translation/AI-designer still absent; Concierge still dark) |
| Full missing-features scan (signage / sports / K-12 safety / QSR) | **covered** | — | — | K-12 parity **B**, Sports parity **A−**, QSR parity **B**, Corporate parity **C** |

Nothing scoped down. Every checklist bullet in the assignment (AI content gen, smart scheduling, CV tagging, proof-of-play, sponsor impression analytics, dayparting, approval workflows, social walls, weather/news/RSS packs, menu sync, integrations marketplace, hardware breadth, offline claims, SOC2 posture) is covered in the parity table below. All §5 bullets from CLAUDE.md (Canva-Magic-Write equivalent, smart playlist suggestions, scheduling AI, CV tagging, AI celebrations, logo-theme extraction, people counting) are graded.

---

## 1. What VenueOS verifiably ships (the parity baseline — all repo-verified)

| Capability | Evidence | Reality check |
|---|---|---|
| AI text generation, multi-provider BYOK (Anthropic/OpenAI/Google) + platform free-tier fallback, 6 content kinds incl. **daypart copy suggestion** | `apps/api/src/ai/ai.service.ts:1-26` (announcement/quote/menu_item/promo/daypart/ticker), `ai-providers.ts`, `ai-hourly-cap.ts` | REAL. Cost caps + audit rows shipped (AI-P0-4). Parity with Canva-Magic-Write class. |
| AI full-template synthesis (touch templates) + AI alt-text (vision) | `ai.controller.ts`, `ai-alt-text.service.ts` | REAL. Few competitors generate whole templates from a sentence. |
| Dayparting / scheduling rules | `schema.prisma:1005-1039` (daysOfWeek/timeStart/timeEnd/priority on PlaylistItem + Schedule), menu `dayparts` `schema.prisma:1592` | REAL, rules-based (no AI assist — see gap G7). |
| Proof-of-play | `apps/api/src/analytics/proof-of-play.sampler.ts` (10-min sampling), dashboard `apps/web/src/app/[schoolId]/analytics/page.tsx` | REAL but interval-sampled, **day/time windows not applied (v1 LIMITATION comment, sampler.ts:33-37)** and **no CSV/PDF export on /analytics** — not billing-grade. See G6. |
| Sponsor impression analytics (sports) | `apps/api/src/sports/sponsors.service.ts`, `sponsor-impression.spec.ts`, frequency caps (T2-9), CSV in `sports.controller.ts` | REAL per-impression logs — ScoreVision-class. `ad_revenue_daily` rollup missing (KNOWN-OPEN M8/P1-7). |
| Approval workflow | `apps/api/src/submissions/submissions.controller.ts:250,257` (`POST :id/approve`, `:id/reject`) | REAL for playlists only; RBAC review loop "effectively dead" beyond that (KNOWN-OPEN M10). |
| Weather (live), streaming | `use-live-weather.ts` (real fetch); `apps/api/src/streaming/` — YouTube/Vimeo/Twitch/HLS real | REAL. RTSP honest N-A (V2). |
| Menu sync / POS | `apps/api/src/pos/providers/{square,clover,shopify,lightspeed}.ts` behind one `PosConnector` interface (`registry.ts`); per-location price book + auto-86 (`menu.service.ts:7-16`) | REAL — 4 OAuth connectors. **Toast absent** (G5). |
| Offline | `sw-player.js` emergency+playlist cache tiers; `apps/api/src/usb-export/` sneakernet | REAL — competitive claim parity ("plays offline"). |
| Emergency moat | signed fan-out (`redis.service.ts` verifyWsHmac), **render-proof telemetry** (`apps/api/src/screens/render-proof.ts` — player POSTs every ~30s during an emergency), audit immutability triggers | REAL and ahead of every signage competitor's "alerts" checkbox. Missing: operator-facing proof-of-alert report (G4) + drill mode (G4b). |
| Brand auto-extraction (logo/palette from URL → apply-to-templates) | branding module + wizard (tasks #56/#63) | REAL — covers the §5 "AI-suggested template themes from logo color extraction" bullet via deterministic scraping. |
| Design imports | `apps/api/src/imports/imports.controller.ts` — PDF/PPTX/image → real editable templates (Import 2.0) | REAL file-based; Canva/Slides OAuth honest N-A (Sprint 11). |
| Compliance posture | `COMPLIANCE.md` — FERPA / COPPA / PCI-SAQ-A / SOPIPA, honest "open items" section | REAL doc, honest. **No SOC 2 anywhere outside an archived April plan** (G2). |
| Fleet ops | fleet map, offline alerting at 150-screen scale (tasks #232/#238), canary OTA, cohort outage detection | REAL — genuinely strong vs competitors' "device monitoring". |

---

## 2. PARITY TABLE — feature → who ships it (2026) → do WE → gap severity

Severity is per-vertical deal-risk: **K-12 first / Sports second / QSR third.** ✅ = shipped+verified, ◐ = partial, ✗ = absent, 🎭 = costume (looks shipped, isn't).

| Feature | Who ships it (2026) | VenueOS | K-12 | Sports | QSR |
|---|---|---|---|---|---|
| AI text/content generation | Yodeck AI-assisted templates; OptiSigns AI Designer; ScreenCloud | ✅ (3 providers, BYOK, 6 kinds) | — | — | — |
| AI image generation / AI designer canvas | **OptiSigns AI Designer** (in-canvas) | ✗ (text only) | P2 | P2 | P2 |
| NL app/dashboard builder | **OptiSigns OptiDev.ai** (Jan-2026 launch, NL → working signage app) | ✗ (Concierge "build-it-for-me" is vision; backend dark — KNOWN-OPEN P1-5) | P2 | P2 | P2 |
| Smart/AI playlists (tag-driven auto-content, layout suggestions) | **Yodeck AI-managed playlists + Smart Engine** | ✗ (rules-based dayparting only) | P2 | P3 | P2 |
| AI translation / multilingual boards | emerging (ScreenCloud caption tooling) | ✗ (KNOWN-OPEN, 06-08 §5 C+) | P2 | P3 | P3 |
| CV audience analytics / people counting / proof-of-impressions | **Navori Aquaji** (CV embedded in player: demographics, dwell, footfall); BrightSign partner ecosystem | ✗ | P3 (privacy-fraught in K-12 — arguably a non-goal) | P2 (sponsor proof) | P3 |
| CV asset auto-tagging on upload | OptiSigns/enterprise DAM class | ✗ (alt-text on demand only) | P3 | P3 | P3 |
| Proof-of-play reports (per-asset logs, CSV export, billing-grade) | Yodeck (enterprise tier), Navori, BrightSign, OptiSigns | ◐ (10-min sampling; day/time windows ignored; no export) | P2 | **P1** (sponsor billing claims) | P2 |
| Sponsor rotation + impression analytics | **ScoreVision** (cloud sponsor mgmt, multi-venue); Daktronics times-sponsor | ✅ (caps + per-impression log + CSV) — rollup cron missing (KNOWN-OPEN) | — | P2 (finish rollup) | — |
| Dayparting | all signage vendors | ✅ | — | — | — |
| Approval workflows | ScreenCloud (custom permissions), Rise Vision, Yodeck enterprise | ◐ (playlists only; KNOWN-OPEN M10) | P2 | P3 | P3 |
| Social walls (IG/FB/X feeds) | OptiSigns, ScreenCloud, Yodeck app stores (100+ apps incl. social) | **🎭 SOCIAL_FEED widget is an icon-only costume** (`WidgetRenderer.tsx:3128-3136`) | P2 | P2 | P2 |
| RSS / news feeds | every competitor (table stakes) | **🎭 RSS_FEED widget renders 5 hardcoded FAKE headlines** (`WidgetRenderer.tsx:3096-3126`); no RSS parser anywhere (`data-source.service.ts:26` = json\|csv only) | **P1** | P2 | P2 |
| Weather pack | all | ✅ live | — | — | — |
| BI dashboard embeds (Power BI/Tableau/Grafana, authed) | **ScreenCloud Dashboards** (flagship), OptiSigns | ✗ (generic WEBPAGE iframe only, `WidgetRenderer.tsx:482`) | P3 | P3 | P3 (P2 for corporate vertical) |
| Menu sync from POS (price + 86) | OptiSigns OptiSync-class data sync | ✅ Square/Clover/Shopify/Lightspeed + price book + auto-86 | — | — | **Toast absent = P1** |
| Integrations marketplace / app store | **OptiSigns 100+ apps**; ScreenCloud app library | ◐ ~30 tiles, honesty-tiered; Concierge UI dark (KNOWN-OPEN P1-5) | P2 | P2 | P2 |
| Hardware breadth (players) | Yodeck: Pi/Android/Windows; ScreenCloud: FireTV/Chromecast/Samsung/LG/Win/Linux/Pi; **Rise Vision: native LG webOS** (2026); BrightSign: own SoC line | ◐ Android APK + browser web player only (`apps/player/` = gradle/Android; no tizen/webos/brightsign/firetv hits in repo) | **P1** | P2 | P1 |
| Offline playback | all claim it | ✅ (SW tiers + USB sneakernet — stronger than most) | — | — | — |
| SOC 2 / ISO 27001 | **Rise Vision SOC 2 Type 2** (markets it at K-12); **ScreenCloud SOC 2 Type 2** | ✗ (only in `docs/archive/2026-04.../INFRASTRUCTURE_PLAN.md`; absent from COMPLIANCE.md) | **P1** (district/ESSER procurement checklists) | P2 | P2 |
| CAP inbound + safety-platform interop (Raptor, Alertus, InformaCast, CrisisGo) | **Rise Vision integrates with ALL of them** + synchronized audio CAP alerts | ✗ (V2 roadmap, honest N-A — KNOWN-OPEN §13) | **P1 deal-risk** (see G1) | P3 | — |
| Proof-of-alert compliance report (which screens showed the alert, CSV) | **Rise Vision Q1-2026 feature** | ◐ render-proof telemetry EXISTS (`render-proof.ts`) but no operator report/export | **P1→P2** (data already captured; report is thin work) | P3 | — |
| Drill management / drill mode + compliance log | **Navigate360** (drills/readiness leader), Raptor | ✗ (zero "drill" hits in `apps/api/src/emergency/`) | P2 | — | — |
| Wearable panic badges / hardware panic integration | **Navigate360** (Jan-2026 badge+panic launch), Raptor, Centegix | ✗ (mobile hold-to-trigger page only) | P2 (partner play, not build) | — | — |
| Reunification / accountability workflows | Navigate360, Raptor | ✗ (V2 scope, honest) | P3 (different product category) | — | — |
| Game presentation / per-sport consoles | ScoreVision, Daktronics Show Control | ✅ deep (per-sport widget sets, CTS bridge, celebrations, scorebug, undo rail) | — | — (ahead; 2D/3D timeline + named-vendor feeds are the remaining tail — KNOWN-OPEN §7) | — |
| AI-generated celebration animations | none ship this yet (Sprint-13 stretch in CLAUDE.md) | ✗ (manual decks ✅, AUTO trigger in progress #45) | — | P3 | — |

---

## 3. NEW findings (not in prior audit reports)

### G1 (P1, K-12) — Safety-interop checkbox: Rise Vision consumes CAP from Raptor/Alertus/InformaCast/CrisisGo; we consume nothing
Our emergency stack is *better* than Rise Vision's (native trigger, signed fan-out, render-proof, offline cache). But districts that already own Raptor/InformaCast/CrisisGo buy signage that **attaches** to those systems; Rise Vision turned that into a checkbox + synchronized audio CAP alerts. VenueOS today is a rip-and-replace sale in any district with an incumbent alerting vendor — that's most of them. §13 is honestly N-A (KNOWN-OPEN), but the deal-risk deserves elevation: a minimal **CAP-inbound consumer** (poll/receive CAP XML → map to our native trigger types, audit-logged) is days of work on top of the existing trigger path and converts the moat from "replace your safety stack" to "your safety stack, on every screen."

### G2 (P1, K-12 + enterprise) — No SOC 2 program; both K-12-focused competitors market SOC 2 Type 2
`COMPLIANCE.md` is honest and strong on FERPA/COPPA/PCI-SAQ-A/SOPIPA — but SOC 2 appears nowhere outside `docs/archive/2026-04-original-design/INFRASTRUCTURE_PLAN.md`. Rise Vision is "SOC 2 Type 2 attested" and uses it in K-12 marketing; ScreenCloud bundles SOC 2 + SSO + audit logging as its enterprise tier. District technology RFPs and parent-facing privacy reviews increasingly ask. This is a program, not code (the underlying controls — audit immutability, RBAC, encryption — largely exist); a Type I in ~3 months / Type II in ~9-12 is realistic. Start before the first district RFP asks, not after.

### G3 (P1, all verticals) — RSS_FEED widget is a FAKE-NEWS costume; SOCIAL_FEED is an icon costume; no feed backend exists
`apps/web/src/components/widgets/WidgetRenderer.tsx:3096-3126`: RSSWidget renders five **hardcoded fabricated headlines** ("School District Announces New STEM Program", "Board Meeting Highlights: Budget Approved", "2h ago") regardless of any configured URL — on a real school screen this displays invented news as if real, and it never updates. `WidgetRenderer.tsx:3128-3136`: SocialWidget renders an icon + the word "Connected" if `embedUrl` is set — nothing else. There is no RSS/Atom parser anywhere in the API (`data-source.service.ts:26` — `CustomDataFormat = 'json' | 'csv'` only). RSS/news and social walls are table-stakes apps at every competitor (OptiSigns 100+ app library, ScreenCloud, Yodeck, Rise Vision). This is the exact "costume" class the operator banned (P0-6, AUDIT-P0-2 precedents) — the 06-08 sweep ("all coming-soon honestly labeled") missed these two because they *render content* instead of saying coming-soon. Fix: server-side RSS fetch+parse in the existing data-source module (SSRF guards already there), real RSSWidget, and either a real oEmbed/official-API social wall or remove SOCIAL_FEED from the palette until built.

### G4 (P2, K-12) — Proof-of-alert report: we capture the data, Rise Vision ships the report
Rise Vision's Q1-2026 flagship safety feature is a CSV export proving which displays received/showed the last alert ("proof of alert" for safety audits). VenueOS **already captures superior telemetry** — `apps/api/src/screens/render-proof.ts` (player POSTs render-proof + content signature every ~30s during an emergency, with per-screen health derivation). Missing is only the operator-facing artifact: a post-incident/post-drill report page + CSV ("N of M screens showed LOCKDOWN within Xs; these 2 didn't"). Thin work, big procurement optics; pairs with G4b.

### G4b (P2, K-12) — No drill mode
Zero "drill" references in `apps/api/src/emergency/`. Navigate360's category leadership is built on drill management/readiness compliance; most states mandate logged drills. A `isDrill` flag on trigger (clearly watermarked on screens, separately audit-logged, feeding the G4 report) is cheap and turns every monthly drill into proof our system works — the best possible sales demo.

### G5 (P1, QSR) — Toast connector absent while 4 other POS connectors are real
`apps/api/src/pos/providers/` = square, clover, shopify, lightspeed behind a clean `PosConnector` interface (`registry.ts`). Toast — the #1 US restaurant POS — is absent entirely (correctly not faked). For the QSR/restaurant vertical, "works with Toast" is the first question. Toast requires a partner-program application (lead time weeks) — apply now even if the connector ships later; the interface makes the build mechanical once approved.

### G6 (P2, Sports P1) — Proof-of-play is not billing-grade: day/time windows ignored + no export
`proof-of-play.sampler.ts:33-37` (v1 LIMITATION): a schedule's day-of-week/time-of-day window is **not applied** — a playlist daypart-scheduled 6-9am is counted as live 24/7, overcounting display hours. `/analytics` page has no CSV/PDF export (grep: zero csv/export/download hits in `analytics/page.tsx`). The moment a sports tenant uses display-hour numbers in a sponsor renewal deck, overcounted hours are a refund/credibility incident. Fix: apply the same day/time predicate the manifest uses, add CSV export. (Sports per-impression sponsor logs are separate and already accurate — the strong story.)

### G7 (P2) — No AI/smart scheduling assist
Yodeck ships AI-managed playlists (tag-driven content filtering, e.g. high-contrast content auto-selected for outdoor screens) and a "Smart Engine" for layout suggestions by business type. We have solid rules (dayparting, priority) and AI *copy* by daypart, but no "schedule this for me" / tag-driven auto-playlist. Cheap v1: screen tags + playlist tags + an auto-match rule; the AI layer can come later via the existing ai.service.

### G8 (P1, K-12 + QSR) — Player hardware breadth: 2 platforms vs competitors' 5-7
Repo confirms players = Android APK (`apps/player/` gradle) + browser web player. No Tizen/webOS/BrightSign/FireTV/ChromeOS packaging (zero repo hits). ScreenCloud runs on FireTV/Chromecast/Samsung/LG/Windows/Linux/Pi; Rise Vision just shipped **native LG webOS** ("no media player needed" — kills $80-150/screen of hardware + install in K-12 bids); Yodeck bundles free Pi players. Districts with existing Samsung/LG commercial panels must add an Android box per screen with us. Mitigation path: the web player already runs in any browser — package it for webOS/Tizen kiosk mode (both are web-app runtimes; weeks, not months) and lean on the existing hardware-recommender (`integrations/hardware-recommender.service.ts`) honestly in the meantime.

### G9 (P3) — CV audience analytics / people counting absent
Navori embeds Aquaji CV in its player (anonymous demographics/dwell/footfall → content adapts + sponsor proof-of-impressions); BrightSign partners likewise; CLAUDE.md §5 explicitly lists people-counting. In K-12, cameras-watching-children is a procurement liability, not a feature — recommend an explicit "we don't do audience surveillance in schools" stance (privacy as a feature) while planning an opt-in sports/retail dwell-analytics integration (partner, not build) when sponsor-revenue dashboards mature.

### G10 (P2) — Marketplace surface: ~30 tiles vs 100+ apps, and the differentiator (Concierge) is dark
OptiSigns' 100+ app library and OptiDev NL app-builder set the 2026 bar for "connects to everything" perception. Our honest tiering (DIRECT/PARTNER/BRIDGE/CLOSED) is the right discipline, and the Integration Concierge (discover-by-URL) is a genuinely differentiated answer — but it has zero frontend callers (KNOWN-OPEN P1-5, re-verified: `discovery.service.ts` exists, no UI). Ship the Concierge step + a public-data app pack (RSS from G3, ICS calendar, Google Slides embed, sheets/CSV via existing data-source) to close most of the *perceived* app-count gap cheaply.

---

## 4. KNOWN-OPEN items re-verified (tracked elsewhere — not re-reported as new)

- **AI image gen + AI translation absent** (06-08 §5 grade C+) — still absent; no image-model call sites in `apps/api/src/ai/`.
- **Concierge UI dark** (P1-5 / LOW "zero frontend callers") — still true.
- **`ad_revenue_daily` rollup + retention crons missing** (M8/P1-7) — still true.
- **Approval/RBAC review loop playlists-only** (M10) — endpoints verified (`submissions.controller.ts:250,257`); breadth still missing.
- **§13 public-alert integrations all V2** (honest N-A) — re-framed as G1 deal-risk, not a costume.
- **Canva/Slides/PowerPoint/Figma OAuth imports N-A (Sprint 11)** — file-based Import 2.0 is real; honest.
- **Breadth honesty (~30 tiles vs ~3-4 wired)** (06-09 REPORT item 5) — POS keystone (#224) improved reality to 4 real POS connectors; framing stands.

---

## 5. TOP 10 GAPS RANKED BY DEAL-RISK

| # | Gap | Verticals hit | Verdict | Why |
|---|---|---|---|---|
| 1 | CAP-inbound + Raptor/Alertus/InformaCast/CrisisGo interop (G1) | K-12 | **build-now** (minimal CAP consumer; partner apps in parallel) | Converts every incumbent-safety-vendor district from rip-and-replace to attach. Rise Vision made it a checkbox. |
| 2 | SOC 2 Type II program (G2) | K-12, enterprise, sports | **build-now** (start program; 9-12mo runway) | Both K-12 competitors market it; RFP checkbox you can't retro-fit fast. |
| 3 | Real RSS/news + de-costume SOCIAL_FEED (G3) | all | **build-now** (days of work; reputational costume) | Fake headlines on a real school screen is an embarrassment incident waiting; table-stakes app at every competitor. |
| 4 | Proof-of-alert report + drill mode (G4/G4b) | K-12 | **build-now** (telemetry exists; report+flag is thin) | Matches Rise Vision's newest safety flagship and weaponizes our render-proof advantage; drills are state-mandated. |
| 5 | Player packaging for webOS/Tizen (G8) | K-12, QSR | **fast-follow** (web player port; weeks) | Kills the "plus an Android box per screen" line-item in bids vs Rise Vision native webOS. |
| 6 | Toast POS connector (G5) | QSR | **fast-follow** (apply to partner program NOW — lead time) | #1 US restaurant POS; interface already generalized. |
| 7 | Billing-grade proof-of-play (day/time predicate + CSV) (G6) | Sports, QSR | **fast-follow** (small fix, big claim-integrity) | Sponsor-renewal numbers must not overcount; precedes any "sell ads on your boards" pitch. |
| 8 | Concierge UI + public-data app pack (G10) | all | **fast-follow** (backend exists; UI is the gap) | Our differentiated answer to OptiSigns' 100-app perception — currently invisible. |
| 9 | AI Designer / image-gen + smart-playlist assist (G7 + KNOWN-OPEN) | all | **fast-follow** (BYOK image API behind existing ai.service; tags-v1 for playlists) | OptiSigns/Yodeck market AI hard; we have the plumbing (3 providers) — visible gap is images + "do it for me". |
| 10 | CV audience analytics / people counting (G9) | sports, retail | **ignore for launch** (privacy stance in K-12; partner later) | Wrong feature for the K-12 beachhead; revisit with sponsor-revenue dashboards. |

**Also ignore for launch:** BI dashboard embeds (corporate-vertical play), reunification/accountability (different product category — partner via G1 instead), wearable badges (partner hardware), AI celebrations (no competitor ships it either).

---

## 6. Where VenueOS is AHEAD (use in sales, defend in roadmap)

1. **Native life-safety on the same screens** — signed fan-out + render-proof + offline emergency cache beats every signage vendor's bolted-on "alerts" feature; no signage competitor owns the trigger path.
2. **Sports game presentation depth** — per-sport widget sets, CTS console bridge, celebration decks, sponsor impression logs put us between ScoreVision and Daktronics at signage pricing; "earns its keep 5 days a week" is real.
3. **AI text gen with BYOK across 3 providers + cost governance + audit rows** — more provider breadth than any signage competitor (most are single-vendor AI).
4. **Menu platform** — per-location price book + auto-86 + 4 real POS OAuth connectors is genuinely competitive with OptiSync-class offerings.
5. **Honest integration tiering + gap-register discipline** — rare in this market; extendable to a public trust page that procurement teams love.
6. **Offline + USB sneakernet** — stronger than the "offline playback" checkbox competitors ship.

---
*Evidence discipline: every "we ship/don't ship" claim above was verified by file path or grep in this session; competitor claims cite 2026 web sources (Yodeck features/pricing pages, OptiSigns OptiDev launch coverage (sixteen-nine.net 2026-01-14), Rise Vision Q1-2026 roundup + K-12 page, ScreenCloud dashboards/security pages, Navori Aquaji, ScoreVision/Daktronics comparisons, Navigate360 Jan-2026 panic-button launch PR).*
