# VenueOS deep audit — MASTER REPORT
**2026-08-03 · full app · Standard Audit Surface §1–21 · baseline `a74c7894`, closed at `ffddbdc4`**

11 read-only audit agents across all 21 sections, plus a lead verification lane (live prod, live DB, CI forensics, independent re-verification of every P0/P1). No section was scoped down. Per-domain reports are the numbered files in this folder; this is the synthesis.

---

## 1. Coverage table — all 21 sections × 3 lenses

D = Design ("would a superintendent show this to their board?") · UX ("can a non-IT operator do it in 30s?") · F = Functionality ("does it actually work end-to-end?"). "–" = lens not applicable.

| § | Domain | Status | D | UX | F | Report |
|---|---|---|---|---|---|---|
| 1 | Real-time + signed pub/sub | covered | A | A− | **A−** | [01](01-emergency-realtime.md) |
| 2 | Storage + content pipeline | covered | A− | A | B+ | [03](03-storage-content.md) |
| 3 | AI providers (×3) | covered | – | A | A− | [04](04-ai-providers-surfaces.md) |
| 4 | AI feature surfaces | covered | A− | A | A− | [04](04-ai-providers-surfaces.md) |
| 5 | AI comparative scan | covered | – | – | B | [04](04-ai-providers-surfaces.md) |
| 6 | Streaming integrations | covered | B | B | **C+** | [05](05-streaming-sports.md) |
| 7 | Sports score / data | covered | B+ | B− | B | [05](05-streaming-sports.md) |
| 8 | POS / commerce | covered | B+ | A− | B+ | [06](06-pos-billing.md) |
| 9 | Communications | covered | B− | B | B− | [07](07-comms-public-alerts.md) |
| 10 | Auth + identity | covered | – | B+ | A− | [02](02-auth-forensics.md) |
| 11 | Billing + commerce | covered | B | C+ | B− | [06](06-pos-billing.md) |
| 12 | Design imports | covered | A− | A− | B+ | [08](08-imports-verticals.md) |
| 13 | Public alert integrations | **N-A (honest)** | – | A | – | [07](07-comms-public-alerts.md) |
| 14 | Multi-vertical surface | covered | A− | A | B+ | [08](08-imports-verticals.md) |
| 15 | Cross-browser + Chromium-83 | covered | A | A− | **C+** | [09](09-crossbrowser-a11y.md) |
| 16 | Forensic / audit coverage | **partial** | – | A− | B− | [02](02-auth-forensics.md) |
| 17 | Operational + DX | covered | B | C+ | **D** | [10](10-ops-dx.md) |
| 18 | Accessibility | covered | A− | B− | **C** | [09](09-crossbrowser-a11y.md) |
| 19 | Template + widget editability | covered | A | A− | **A−** | [11](11-editability.md) |
| 20 | D/UX/F lenses | applied throughout | – | – | – | this table |
| 21 | Verification before claim | covered | – | – | B− | [12](12-lead-verification.md) |

**Every section covered. Zero deferred, zero silently scoped down.** §13 is a legitimate N-A: CAP/IPAWS/Raptor/RapidSOS/PA-speaker are all unbuilt, honestly labelled `COMING_SOON`, disclaimed in the EULA, and protected by a CI truth-gate that fails on a false marketing claim.

Sections at ≤ C in any lens — the gap list: **§17 (F: D)**, **§18 (F: C)**, **§15 (F: C+)**, **§6 (F: C+)**, **§11 (UX: C+)**, **§16 (F: B−, partial)**.

---

## 2. The verdict in one paragraph

**The core is strong; the perimeter was never swept.** The emergency bus, tenant isolation, PCI posture, AI stack, POS connectors, and the editability surface all came back at or near A, and every fix from the 2026-08-01 security wave is verifiably present at HEAD. What this audit found is a single dominant pattern, repeated across six independent domains: **a fix landed in one file and its twin was never updated.** Beyond that, one genuine product gap (no district-wide emergency), one still-open access-control hole from the previous audit, and an operational layer (§17) that is materially weaker than the code it guards — master has been red for 9 commits while a launch-readiness doc recorded "12/12 green."

---

## 3. P0 — fix before launch

### P0-1 · CI has been red on master for 9 consecutive commits; "12/12 green" was false
Last fully-green `CI & Security` was `cca5aa78` (08-01 14:29Z). The 08-03 launch-readiness evening addendum claimed all 12 workflows green on `a74c7894`; the sweep was taken **before the slowest job finished**. Two jobs are red on the current tip `ffddbdc4`:

**(a) Production Dependency Audit — 3 newly-published HIGH advisories, zero dependency changes.** The gate queries npm's live advisory endpoint, so it flips red with no commit. Two of the three matter here specifically:
- `undici` <7.29.0 (GHSA-4cwx-7wf7-3272) — this is the **storage transport's primary fetch**; a companion MODERATE (GHSA-8xcm-r25x-g524) is response desync *via the retry interceptor*, on a path that retries.
- `ip-address` ≤10.3.0 (GHSA-mwp4-54f8-5fhr) — **SSRF / trust-boundary bypass**, in a product whose outbound-webhook SSRF defense depends on correct IP parsing. Check whether `ssrfSafeLookup` sits downstream.
- `fast-uri` <3.1.5 (GHSA-7p8r-x3mc-p8w7) — host confusion.
Also below threshold but on the operator-HTML path: `sanitize-html` ≤2.17.4 (`javascript:` URIs survive via `action`/`formaction`/`data`/`poster`/`background`) and `dompurify` ≤3.4.11.
→ Pin fix floors in root `pnpm.overrides`, then make the gate deterministic (pin a reviewed advisory snapshot; run the live query as a scheduled issue-opener) so "green at commit X" is durable.

**(b) The emergency-path gate is red from a REVERTED test fix — not a product regression.** Per-browser evidence is decisive: chromium fails test #1 twice at ~25 s then **passes on retry #2 in 4.7 s**; webkit fails all three at ~20 s. That 4.7 s is the signature of a cold-compile race — the dev server hasn't compiled `/player` when test #1 fires (`net::ERR_ABORTED`). Commit `25717588` diagnosed exactly this and added a warm-up; `5844466a` reverted it. The race returned and now lands on WebKit.
→ **Do not read this as the emergency system being broken** — prod `/health/emergency-path` is 200 with `ws_signer:ok`, and chromium passes the same assertion once warm. Restore a route warm-up (or a per-project retry budget). A red life-safety gate trains everyone to ignore it, which is worse than no gate.

Two further real E2E failures, both editability invariants CLAUDE.md names by name: `external-html-clickedit.spec.ts:87` on `signage/hospitality/01-lobby-welcome-flagship.html` (3 attempts) and `holiday-hotzone.spec.ts:214`.

### P0-2 · 40 widget variants cannot be styled at all — launch blocker by CLAUDE.md's own rule
Triple-verified by the lead. The v2 Announcements / Calendars / Staff / Countdowns / Logos / Weather / Bell-Schedules / Clocks variants map onto canonical types that already have hand-built editor cases, so they `break` before the v2 style panel; the universal "Text style" block is explicitly guarded by `!isV2Widget`; and all eight widget files contain **zero** `data-field` hooks, so the click-canvas fallback cannot arm either. Three escape hatches closed simultaneously. The operator can change the words and nothing else — no font, no size, no color, no background. CLAUDE.md: anything below B in §19 is a launch blocker.
→ Extract `PropertiesPanel.tsx:6192-6276` into a `v2StyleFields()` helper and call it from the 8 colliding cases. Do **not** just drop the `!isV2Widget` guard — it writes a different key space (`cfg.fontFamily` vs `cfg.style`) and would half-work.

---

## 4. P1 — the dominant pattern: fixed once, never swept

Six independent domains produced the same failure shape. This is the single highest-leverage theme in the audit.

| The fix that landed | The twin that never got it | Consequence |
|---|---|---|
| `SENT_UNVERIFIED` email honesty gate in `EmailService` | `storage-watchdog.service.ts`, `efficiency-alerting.service.ts` (2 duplicate senders) | **Storage-outage and egress-cost alerts log "SENT" for mail Resend silently drops.** The alerts that tell you the platform is broken are the ones that fail. |
| `AI_KEY_UNREADABLE` hard-stop on every spend path (S5) | `ai-alt-text.service.ts` keeps a pre-S5 copy of key resolution | Broken tenant BYOK key silently bills **your** platform AI budget on every image upload |
| INJ-006 iframe URL allowlist on `StreamingWidget` | `FitnessLiveTVWidget` / `FitnessTrainingVideoWidget` absent from `zone-url-guard.ts` | Raw operator URL framed with `allow-same-origin` — a same-origin `streamUrl` gets the player's DOM and device token |
| bundled `hls.js ^1.6.16` used by `StreamingWidget` | `FitnessLiveTVWidget` fetches hls.js **from jsdelivr at runtime via `new Function`** | Unpinned third-party code executing on the same surface that renders lockdown alerts; breaks on a locked-down venue LAN; violates the player CSP twice |
| Chromium-83 polyfills mounted in `player/page.tsx` | `/board`, `/ribbon`, `/scorebug` — which the Taurus gate **explicitly scans** as in-scope | On a Taurus LED wall a standalone scoreboard loses every flex gap and container-query unit |
| WebKit coverage for holiday bridge + widget render | `multiscreen-sync`, `external-html-clickedit`, `holiday-hotzone` + 8 more, dropped by `91702ef7` **during this audit** | Two are named in CLAUDE.md as binding chromium+webkit invariants. This is the exact blind spot that hid the 2026-05-09 WebKit bug for two months |

### Other P1s

**No district-wide emergency.** Zero hierarchy references exist in the emergency module; the manifest reads only `screen.tenantId`. Measured against live prod: **41 paired screens sit under child tenants** — Walnut Creek (7 schools / 38 screens), Springfield (1 / 3), Chardon (2 / 0). A district-level lockdown reaches the district office and nothing else. Demoing "lock down all schools" on the flagship demo district would visibly fail on all 38 screens.

**ACC-09 cross-tenant account hijack — still open**, flagged 08-01, fix never applied. `createUserDirect` looks up by global email, rejects only ACTIVE, and rewrites a victim tenant's `INVITED` placeholder to the attacker's `tenantId`; `acceptInvite` never asserts tenant match, so the real invitee logs into the attacker's tenant. Self-signup mints DISTRICT_ADMIN with no email verification, supplying the attacker account free.

**Stripe idempotency ledger commits before the work.** A handler that throws leaves the ledger row written, so Stripe's retry short-circuits as duplicate — a `payment_failed` downgrade or `payment_succeeded` recovery is permanently lost. The code's own comment names this consequence. Same pattern in the POS webhook claim.

**Billing cannot distinguish test mode from live**, and prod runs `sk_test`. `enabled()` is `!!STRIPE_SECRET_KEY`; nothing anywhere inspects the key prefix. The UI tells operators checkout is "live."

**A dropped HLS stream is a permanent black screen.** Neither HLS widget calls `startLoad()` or `recoverMediaError()`. A Wi-Fi blip at 7pm on game night kills the board for the night — the manifest poll won't remount it because the manifest didn't change.

**No email retry and no delivery visibility anywhere.** A transient Resend 5xx permanently loses a password reset or invite; `EmailLog` is server-side only and has no `tenantId`, so no operator can ever see a delivery failure. Webhooks, by contrast, get a lease-based retry worker for the same class of failure.

**Sentry may not be on in production.** `SENTRY_DSN` appears only as an empty placeholder in `.env.example`, in zero workflows, and CI logs print "error tracking disabled." Compounded by no request-id correlation anywhere and no Sentry in the player at all — the kiosk fleet is unmonitored. *(Unverified: the Railway/Vercel dashboards may set it.)*

**Every ratchet baseline can drift up silently.** All six (`.a11y-baseline` 221, tenant-isolation 180, taurus, hooks, bundle budget, poster) are "down-only" by comment convention; nothing compares a baseline against its merge-base value. A commit that adds a violation and raises its baseline goes green.

**No secret scan in any git hook**, contrary to the §17 checklist — gitleaks exists only in CI, so a leaked key reaches GitHub and must be rotated rather than being blocked locally.

**The rollback runbook's primary command targets a deleted tag**, the newest backup tag is 37 days stale (none taken before the riskiest change set in the repo's history), and the daily encrypted `pg_dump` that *is* the real backup has **no documented restore procedure** and no evidence of a drill.

**axe never authenticates** (6 of 10 routes render the login shell; the builder isn't in the route list) and the **Lighthouse a11y gate is `continue-on-error`** — so nothing enforces accessibility on a signed-in page.

**21 of 50 holiday boards are unreachable** — the `-v2` and `-flagship` files match no path the widget can generate. Paid design work no operator can select.

---

## 5. Notable P2s

License status never gates playback — a cancelled tenant plays forever (may be a deliberate life-safety call, but nothing documents it). `EMERGENCY_TRIGGERED` notifications have **zero emitters** despite the bell shipping a red shield icon for them, so an admin who didn't fire the lockdown gets no in-app record. Content mutations are largely unaudited (templates: 25 mutation handlers, 2 audit actions) — "who changed what's on that screen" is unanswerable. Customer admins still cannot demote, disable, or delete a departing employee (SUPER_ADMIN only) even though the revocation machinery is built and correct. Device re-register and crash-report both write Screen columns missing from `SCREEN_TELEMETRY_ONLY_FIELDS`, so each clears the **entire fleet's** manifest cache — a morning power-on wave or one crash-looping kiosk re-creates the 25 GB/mo egress bill. The emergency offline cache never calls `navigator.storage.persist()`, so the never-evict guarantee is app-side only. `bug-screenshots` is created `public: true` while its comment says private. Bug-reporter redaction is key-name-exact-match with no PII keys at all, and full-page screenshots are emailed unredacted to every SUPER_ADMIN and shipped to an AI API — a student-data path in a K-12 tenant. `numReplicas: 1` is load-bearing in ~14 places (including per-replica anti-flap on **fire-alarm contacts**) with nothing enforcing it. The billing page renders raw enum tier names including `EDU_DISTRICT` on non-EDU tenants. Emergency surfaces are hardcoded English while `<html lang>` flips to es/zh — a WCAG 3.1.1 failure on the life-safety surface. `app-dialog.tsx` has no focus trap and no focus restore. Pluto/Xumo ship as "permitted for commercial display" while the streaming catalog says their TOS forbids exactly that — a legal call, not a code call.

---

## 6. Corrections to agent findings (lead re-verification)

Three findings were revised after I checked them myself — recorded so they don't propagate:

1. **"14-day trial not enforced" is KNOWN and deliberate, not new.** `license.service.ts:5-15,34-41` documents at length that the pilot ceiling is an internal testing accommodation, that it is "NOT the plan we advertise," and that the real cap awaits the PLAN-001A backfill, with a boot warning. Deferred by the 2026-07-13 W0-07 audit. The customer-facing copy still overstates the product — worth fixing — but nobody was self-deceived.
2. **"PDF import may be a silent costume on Node 20" — DISPROVEN.** I ran the exact dynamic import on Node v20.20.2 from the `apps/api` workspace: `IMPORT OK — getDocument is function`, resolving `pdfjs-dist@6.0.227`. The `engines` field is advisory and the package is pure JS. What survives is the agent's real point: the failure mode is silent, so *if* it ever failed the operator would get a cheerful success message for a non-editable iframe.
3. **Every design-import finding is latent.** `SELECT … FROM audit_logs WHERE action ILIKE '%IMPORT%'` returns **zero rows** — the feature has never been used in production.

Also corrected: the emergency-path CI failure is a reverted-warm-up flake, **not** a product regression (see P0-1b). Stating it as "the emergency system is broken" would have been a false alarm.

---

## 7. What is genuinely strong

Worth stating plainly, because the finding list above is long and this is the larger truth:

- **The emergency core.** All of R-01…R-08 present and correct at HEAD; audit immutability enforced at the **database** level (UPDATE/DELETE/TRUNCATE triggers); trigger and all-clear atomic with their audit rows; the 07-31 stuck-lockdown wave fully held (no-store on every manifest branch, emergency before cache, 304-counts-streak, emergency never retained, remote-input lockout).
- **Auth.** ACC-01 closed in four independent layers with a build-time drift guard. Argon2id at OWASP+ parameters. Durable revocation that **fails closed** on Redis error. Unspoofable client-IP throttling.
- **The AI stack.** Prompt caching **is** present (formally retracting the old false finding), 14/14 provider calls carry AbortSignal timeouts, Redis+Postgres dual-layer accounting, CI-gated model freshness, and zero costumes across nine shipped surfaces.
- **PCI-SAQ-A is clean and verified** — no card field anywhere, no Stripe Elements dependency, no PAN in any log line. Webhook ordering is better than most production systems.
- **Editability is no longer the 2026-05-26 disaster.** 0 of 165 boards missing click-to-edit, the 31 hand-crafted menu boards intact, the dead `WidgetPalette.tsx` gone from the tree, and a real RTL proof suite now blocking in CI. The 40-variant hole is a genuine blocker, but it is a seam — not the systemic failure it was.
- **Integration honesty is above industry norm.** Unbuilt providers are refused at the API boundary *and* badged `COMING_SOON` *and* disclaimed in the EULA *and* protected by a CI truth-gate. Across §6/§7/§8/§9/§13 the auditors found effectively no misleading costume.
- **Live prod is healthy** on the deployed sha: all four health endpoints 200, storage on primary transport at 760 ms, web 200, zero tenants stuck in an emergency state.

---

## 8. Recommended order of work

1. **Unblock CI** — pin the three advisory floors; restore the emergency-path warm-up; triage the two click-to-edit spec failures. Nothing else can be trusted while master is red.
2. **P0-2 editability** — the `v2StyleFields()` extraction. One helper, eight call sites, plus the regression test nobody has written.
3. **Sweep the six twins** in §4's table. Each is small and mechanical; together they close five P1s and a supply-chain exposure.
4. **ACC-09** — refuse a cross-tenant existing user in `createInvite`/`createUserDirect`; assert tenant match in `acceptInvite`.
5. **District-wide emergency** — a product decision first (fan-out at trigger vs parent-inheritance in the manifest), then the build.
6. **Operational floor** — baseline drift guard, `timeout-minutes` on the six uncapped jobs, gitleaks in pre-commit, a restore drill, and confirm `SENTRY_DSN` is actually set.

---

## 9. Owner decisions (not engineering tasks)

- **Pluto/Xumo commercial-display licensing** — the repo contradicts itself; needs a legal call.
- **Does license lapse stop playback?** Currently never. Deliberate for life-safety, or a revenue leak?
- **Stripe live keys** + whether the advertised 14-day/3-screen trial becomes real or the copy changes to match.
- **IPAWS outbound origination** — FEMA COG authorization is a months-long legal/procurement track; decide as a business commitment before scoping code. The cheapest real step up the safety ladder is a `format` switch on the webhook you already ship (turns Slack/Teams/PagerDuty from N-A into working escalation on transport that is already signed, SSRF-pinned and durably retried).
- **Should a REVOKED screen still show a lockdown?** Today it shows nothing at all.

---

## 10. Method + honesty notes

- 11 agents, read-only, each required to cite `file:line`, to trace guards to real call sites, and to prove any absence claim **two independent ways** or label it UNVERIFIED. One agent hit the zsh unquoted-glob trap mid-run and re-ran with quoted globs; so did I. That trap (`grep` errors reading as "no match") is the reason for the two-method rule.
- The lead lane independently re-verified every P0/P1 before it entered this report, and corrected four (§6 above).
- Master moved `a74c7894` → `ffddbdc4` during the audit (a concurrent session landed a serviceWorker fix + the CI chromium pin, and an RS-01 security fix). Findings are pinned to specific SHAs.
- Open UNVERIFIED items are listed per-report and are not asserted here as fact — chiefly: whether `SENTRY_DSN` and `PLATFORM_ALERT_EMAILS` are set in the deploy dashboards, live Railway replica count, whether the Daktronics/WTTC decoders are hardware-valid, and whether `/board`-family URLs are ever assigned to a physical Taurus screen.
