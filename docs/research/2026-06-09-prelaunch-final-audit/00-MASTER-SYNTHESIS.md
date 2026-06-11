# VenueOS — Final Pre-Launch Audit (Fable 5) — Master Synthesis

**Date:** 2026-06-09 → 06-10 · **Commit audited:** `cf5772ae` (live on prod) · **Auditor:** Fable 5, 17 domains, one-at-a-time, blind to the Sonnet control run.
**Purpose:** a fresh frontier-model pass over all 21 Standard Audit Surface sections + dedicated player/mobile/desktop UX + competitive scan, to catch what the Opus-era audits (2026-06-08 launch-readiness, 2026-06-09 full-audit) missed.

---

## VERDICT

**No new code P0s. The product is launch-capable today.** The only P0 is the **known config set that is Greg's to do** (not code): rotate the weak prod `JWT_SECRET`/`SESSION_SECRET`, flip Stripe `sk_test_` → live, rotate the (now-redacted) pilot password, rotate the `.codex` secrets. Until those four are done, launch is gated on config, not engineering.

**The Fable pass earned its cost.** It confirmed the system is genuinely solid where it matters (emergency chain A-/A/A-, billing A-, player A) AND surfaced real, previously-missed defects — most importantly **a shipped P0 fix that is dead code in production** (AI out-of-credit, below), which I personally re-verified in the source. It also *cleared* two prior-audit HIGH items as stale/overstated (H1 panic-staleness is actually fixed; H4 Clever open-redirect is env-sourced, not exploitable) — so it cut false work as well as adding real work.

---

## THE HEADLINE NEW FINDING (lead-verified, not just agent-reported)

**AI out-of-credit 402 is swallowed into a generic 503 at generate-time — the AI-P0-1 fix (task #73, marked "completed") is dead code.**
`apps/api/src/ai/ai.service.ts:540` throws a structured `402 {code:'AI_PROVIDER_OUT_OF_CREDIT'}`, but it's inside the `try`; the `catch` at line 575 only re-throws `ServiceUnavailableException`, so the 402 falls through to line 578 → `503 "AI service unreachable."` Operators who run out of BYOK credit see "service unreachable" (looks like an outage) instead of "add credit." **Fix:** line 576 `if (err instanceof HttpException) throw err;` (ServiceUnavailableException extends it, so both paths survive). 1 line. I read the control flow end-to-end — confirmed real.

---

## 21-SECTION COVERAGE (Design / UX / Functionality)

| # | Section | Cov | D | UX | F | Headline |
|---|---|---|---|---|---|---|
| 1 | Real-time + signed pub/sub | ✓ | A- | A | A- | Strongest subsystem; SSE tier skips client gates (P2) |
| 2 | Storage + content pipeline | ✓ | A | A | A- | Egress wall real on the wire; HEAD header drift (P1) |
| 3 | AI providers | ✓ | A- | B+ | B | quota 402→503 dead code (P1); catalog stale |
| 4 | AI feature surfaces | ✓ | A- | B | B | sparkle/touch/alt-text real; alt-text broken for only live BYOK tenant (P1) |
| 5 | AI comparative scan | ✓ | B | B- | C+ | no image-gen / AI-designer / smart-scheduling |
| 6 | Streaming | ✓ | A- | B | B+ | HLS real; honest DASH/RTSP refusals; no webcam widget |
| 7 | Sports data | ✓ | A- | B+ | B+ | CTS + ECBox real; Daktronics "stable" w/o hardware proof (P1) |
| 8 | POS / commerce | ✓ | B+ | B+ | B+ | Square/Clover/Lightspeed/Shopify REAL; Toast absent |
| 9 | Communications | ✓ | A- | A- | B+ | email live-verified end-to-end; invite UI lies "not configured" (P1) |
| 10 | Auth + identity | ✓ | A- | B+ | A- | strong spine; Redis-less revocation black hole (P2) |
| 11 | Billing | ✓ | A- | A- | A- | idempotency+seat-enforcement+PCI all real; no dunning |
| 12 | Design imports | ✓ | A- | A- | B | PPTX real+editable; zip-bomb DoS (P1) |
| 13 | Public alert | N-A | — | — | — | zero code, zero UI, EULA disclaims — honest |
| 14 | Multi-vertical | ✓ | B+ | C+ | B | 14 dead gallery tabs (P1); 8/33 sample URLs blocked (P1) |
| 15 | Cross-browser/Taurus | ✓ | A- | B | B+ | inset gate real; WebKit canary froze as boards tripled (P1) |
| 16 | Forensic/audit | ✓ | A- | A- | B+ | immutability VERIFIED IN PROD (1 trigger, dedup migration applied 06-09) |
| 17 | Operational/DX | ✓ | A | A | A- | health green; connection_limit boot-refusal real; 7 unguarded crons (P2) |
| 18 | Accessibility | ✓ | A- | A- | B+ | /panic aria-live verified; axe scans public renders only |
| 19 | Editability | ✓ | A- | A- | B+ | clickedit 28/28; 8 menu-board prices unbound (P1); ticker untagged (P1) |
| 20 | Design/UX/Func lenses | ✓ | — | — | — | applied across all sections |
| 21 | Verify-before-claim | ✓ | — | — | — | headline AI finding lead-verified |

Player (dedicated): pairing/poll/render/emergency/offline/OTA all **A**; multi-panel LED + watchdog-paint **B** (P1: liveness ≠ painting).
Mobile UX: dashboard **A-/A**, Screens tab **fixed** (#215/#217 NOT reproducible), but **/panic bounces valid non-admin sessions to login (P1)**.
Desktop UX: coherent design system, branded 404s, role-aware denials; **marketing page shows fabricated customer logos (P1)**, first-time login dead until EULA checkbox found (P1).

---

## P0 — LAUNCH BLOCKERS (all config, Greg-owned, no code)

1. Rotate weak prod `JWT_SECRET` / `SESSION_SECRET` (guessable low-entropy value) — account-takeover risk.
2. Stripe `sk_test_` still live on Railway → "Upgrade" can't take a real card. Run CLAUDE.md go-live steps 5–6.
3. Rotate the pilot password (doc was redacted in `cf5772ae`; the live credential still works until changed).
4. Rotate the `.codex` secrets (gitignored 06-08, never rotated).

---

## NEW P1s — fix this week (ranked by risk)

| # | Area | Finding | Fix size |
|---|---|---|---|
| 1 | AI | **402 out-of-credit → 503 dead code** (lead-verified) | 1 line (ai.service.ts:576) |
| 2 | Mobile life-safety | **/panic bounces valid non-admin → login**; login drops `?redirect=/panic` | small (panic route guard + redirect passthrough) |
| 3 | AI | Gemini 2.5 thinking-truncation fix missed `callGoogle` in alt-text → broken for the only live BYOK tenant | small (port the fix to the alt-text callsite) |
| 4 | Editability | 8 menu boards: every visible price unbound — not click-editable, POS/applyMenu can't update | medium (tag price nodes) |
| 5 | Editability | duplicated ticker track untagged → override shows stale text on live player | small |
| 6 | Trust/legal | marketing page claims **fabricated customers** ("RUNNING ON SCREENS AT") | trivial (remove/replace) |
| 7 | Content honesty | **RSS_FEED widget renders 5 hardcoded fake headlines** — no RSS parser exists | medium (build real parser or mark COMING_SOON) |
| 8 | UX | first-time login silently dead until EULA checkbox discovered; EULA error is dead code | small |
| 9 | Verticals | 14 dead gallery category tabs across 6 verticals (~120 boards reachable only via "All") | small (prune/wire tabs) |
| 10 | Storage | Cache-Control header-form drift; HEAD serves no-cache (operational landmine) | small |
| 11 | Imports | PPTX zip-bomb: no uncompressed-size cap | small (size guard) |
| 12 | Player | OTA/update toast uses Chromium-83-forbidden flex `gap` on live kiosk surface | trivial (longhand margin) |
| 13 | Player | watchdog liveness ≠ paint (frozen-but-alive WebView not recovered) | medium |
| 14 | Branding | 8/33 sample URLs hard-blocked with the scraper's exact UA (task #51) | small (UA/headers) |
| 15 | Sports | Daktronics profile labeled "stable" with zero hardware evidence — needs provisional badge | trivial (badge) |
| 16 | Cross-browser | WebKit paint canary still 18 holiday boards while catalog tripled to ~140 | medium (auto-discovery) |

Plus the always-known launch P1s reconfirmed: empty cold-start seed (new tenant = all-zero dashboard), no SOC 2 program, no CAP/Raptor/InformaCast interop (K-12's #1 attach-vs-replace deal-risk).

---

## DID THE NEW MODEL CATCH THINGS THE OLD AUDITS DIDN'T?  (the experiment)

**Yes — materially.** Net-new findings no prior audit (06-08, 06-09 Opus) reported, that Fable surfaced:
- AI 402→503 dead code (a *regression in a shipped P0 fix* — the hardest class to catch). **Lead-verified.**
- Gemini alt-text broken for the only live BYOK tenant (a real customer is affected right now).
- /panic unreachable for delegated non-admin staff on mobile (life-safety UX hole).
- SSE fallback tier skips the freshness/dedup/signature gates the WS tier enforces.
- RSS widget ships fabricated headlines; marketing page ships fabricated customers (two distinct "costume/credibility" issues).
- 8 menu-board prices unbound; duplicated ticker untagged (editability gaps below the convention's radar).

**And it cut false work:** cleared H1 (panic-staleness — actually fixed, verified at users.controller.ts:90 + jwt-auth.guard.ts:114) and H4 (Clever "open-redirect" — env-sourced, not exploitable; the naive fix would break the cross-origin frontend redirect).

**Fable vs Sonnet (same 12 assignments, both blind):** the Sonnet control run mostly re-surfaced prior-audit items and config P0s; it did **not** independently flag the AI 402→503 dead code, the Gemini alt-text BYOK breakage, or the /panic mobile bounce. The frontier model's depth-of-trace is what found the regressions hiding behind "this was already fixed." Sonnet baseline retained at `sonnet-baseline/` for the record.

---

## VERIFIED SOLID (don't re-spend effort)

- Emergency chain real end-to-end: signMessage → verifyWsHmac at every replica pmessage → WS passthrough → player gate → manifest sole-arbiter; constant-time compare, ±120s freshness; live `ws_signer:ok`.
- AuditLog immutability **verified in prod**: exactly one `audit_logs_immutable` trigger; the 06-09 dedup migration applied 2026-06-09T20:16Z (H10/P1-1 fix is live).
- Billing: webhook idempotency + out-of-order + audit-row-per-mutation + SERIALIZABLE seat enforcement + PCI-clean (Stripe-hosted) — all real.
- POS connectors Square/Clover/Lightspeed/Shopify hit real provider hosts with OAuth + paginated catalog; PARTNER/CLOSED tiers rejected at the API boundary (honest).
- Player: edit-shim never arms on the player (grep-verified), emergency overlay precedence, 1GB never-evict offline floor, OTA versionCode monotonicity guard (1.0.66 loop fixed).
- Email live end-to-end on prod (custom EMAIL_FROM domain, 14/14 SENT incl pilot) — the Resend trap is defused.
- Cross-browser: zero React removeChild crashes (06-08 class stays fixed); taurus inset gate scans the boards now (0 entries, deploy-verified).

Full per-domain detail in the 17 sibling reports (`01-…` through `17-…`); Vercel deploy health in `00-vercel-deploy-health.md`.
