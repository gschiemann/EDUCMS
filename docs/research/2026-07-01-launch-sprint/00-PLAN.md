# VenueOS Launch Sprint — 5 Days to World-Class (the Fable plan)

Date: 2026-07-01. Mandate (Greg): "take our app from a hobby to a world-class
CMS — AI integration, cutting-edge development, backend, security, and most of
all USABILITY for all customer types… areas I missed like the player… launch
ready within 5 days… Sonnet 5 does the building, you stay in control… do it
slow, do it right."

## Operating rules (every day, non-negotiable)
- **Sonnet-5 fleets build in isolated worktrees; Fable (lead) reviews every
  diff, upgrades it, owns every merge + push.** No agent touches master.
- **CI to green before anything is called done.** Every fixed bug CLASS gets
  a CI gate so it can never come back (taurus-safety / mobile-perf pattern).
- **Endpoint set-review on every merge** (the 2026-07-01 security-audit rule).
- **Everything persisted** to docs/research/ + tasks the moment it exists.
- **No new settings.** Effortless = auto-detect + defaults + one-click.
- Verify before claim: tests + CI + on-glass where it matters.

## The 5 days

### DAY 1 (today) — FOUNDATION: nothing lies, nothing blanks, nothing regresses
Goal: kill the two failure classes that make the app feel like a hobby —
"default surfaces lag behind features" and "silent breakage Greg finds first."
- **Sports parity gate (#269)** built + wired into CI; **track lanes (#270a)**
  land with it (near-free reuse of SWIM_LANE_GRID).
- **Majors-finder audit** (read-only agent): the blank-screen class end-to-end
  (schedule/playlist/template/asset deletes, no-schedule windows, asset 404s,
  license expiry, CC-2 verification), costume sweep (every button honest),
  multi-replica in-memory-state sweep, swallowed-error sweep on load-bearing
  paths. Output = the ranked P0/P1 list that feeds Days 2–4.
- **Config-blocker checklist to Greg tonight** (only-Greg items) so keys/creds
  arrive before Day 4.

### DAY 2 — USABILITY FOR EVERY CUSTOMER TYPE (the #1)
- Fix the 5 **costume verticals** (CORPORATE / WORSHIP / HEALTHCARE /
  HOSPITALITY / GYM — graded "un-editable EXTERNAL_HTML costumes" 2026-06-27)
  → truly editable, real presets, real sample data.
- **Persona happy-paths proven**: K-12 admin, athletic director, restaurant
  owner, retail manager — each completes their core job in ≤30s, proven with
  Playwright runs (§20 gate), not claims.
- Mobile bugs **#215–217** + **meet lane-pad (#271)** + Concierge onboarding
  step (**#265**). Fresh-tenant onboarding walkthrough per key vertical.

### DAY 3 — AI FLAGSHIP + INTEGRATIONS DEPTH
- **#268** (telemetry already live `67150a68`): interpretation hedging
  (brief-extraction pass), brief-echo confirm chips, auto-grounding with
  tenant's real data (POS/hours/address), learn-from-refines into house style.
- **App Library native tier quick wins**: real RSS backend (#262) + Calendar
  ICS parse, embeddability preflight, Tier-2 visual polish (#264);
  **Google OAuth (#259)** the moment creds arrive.

### DAY 4 — PLAYER + BACKEND + SECURITY HARDENING
- **Player deep pass** (the area Greg flagged): pairing UX, offline/recovery
  drill, OTA update path, ON-DEVICE blank-screen fallbacks, watchdog, Taurus
  re-verified on glass (webcam rig).
- **Backend**: Redis-backed rate limiters (#272), error-envelope discipline
  (#57), 150-screen load re-test, DB pool/index sanity.
- **Security**: endpoint set-review of everything Days 1–3 merged; confirm
  secret rotation + prod config landed.

### DAY 5 — DRESS REHEARSAL + GO/NO-GO
- Full **21-section Standard Audit Surface** re-audit (D/UX/F lenses, per the
  CLAUDE.md invocation rule — coverage table page 1).
- **Live fresh-tenant funnel on prod** per key vertical; on-glass LED checks;
  perf pass; punch-list burn-down.
- **Go/no-go with Greg** (needs 1–2 hours of his eyes).

## What only Greg can do (asks going out Day 1)
1. ~30 min config: rotate JWT/SESSION/DEVICE secrets; Stripe live keys +
   $15/mo + $150/yr prices + webhook secret; EMAIL_FROM verified domain in
   Resend; PILOT_SEAT_LIMIT; platform ANTHROPIC_API_KEY (Tier-1 Concierge).
2. Google Cloud OAuth client (if sign-in-with-Google makes launch); Apple
   Developer account if Apple SSO is wanted post-launch.
3. Day 5: go/no-go time + webcam rig for on-glass verification.
4. Scope confirm: launch-ready = SOFTWARE. On-site hardware (CTS physical
   bridge #263) is explicitly post-launch install work.

## Day-1 dispatch log
- Agent SPORTS-GATE (Sonnet, worktree): #269 parity gate + #270a track lanes. ✅ merged 5fe4a857
- Agent MAJORS-FINDER (Sonnet, read-only): blank-screen / costume / replica /
  swallowed-error sweeps → ranked list. ✅ 01-MAJORS-FOUND.md → P0s fixed 6ff8a467
- Lead: plan, review, merge, config checklist, Day-2 prep. ✅ Day 1 all-green @ d2983bdc

## COMPRESSED SCHEDULE (rev 2, Day-1 evening — Greg: "more agents, move
## everything up 1-2 days, buy more final-test time; and audit API/DB
## efficiency — no waste anywhere")
Days 2+3+4-parallelizable work now runs as ONE build wave (9 agents, airtight
disjoint domains, lead merges sequentially). Revised:
- **Day 2 (now):** WAVE A (usability): costume verticals · lane pad · mobile
  bugs · Concierge onboarding. WAVE B (pulled forward): AI first-try #268
  items 2-5 · feeds backend (RSS/ICS real fetch, Redis-cached) · player deep
  pass · Redis feed limiter #272 · **EFFICIENCY AUDIT (new mandate)** —
  DB (N+1/indexes/pool/write volume), API (poll cadences × fleet math,
  payload sizes, caching), storage egress, AI token spend — read-only ranked
  WASTE list.
- **Day 3:** merge waves + persona happy-path proofs vs prod (lead) +
  efficiency FIX wave + error envelopes #57 + PARITY-DEBT depth (XC/golf/
  gym/cheer boards) + anything red from waves.
- **Day 4:** FULL dress rehearsal (moved up): 21-section audit, fresh-tenant
  funnel per vertical on prod, on-glass LED, load re-test.
- **Day 5:** pure buffer — Greg's hands-on testing, bug burn-down, polish,
  go/no-go. Two full days of test-fix instead of half of one.
