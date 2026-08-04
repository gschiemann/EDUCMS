# Integration Census — SYNTHESIS
**2026-08-03 · HEAD `b9122ea0` · 5 read-only agents · every integration the app ships, claims, or scaffolds**

This is the per-provider census the 21-section domain audit (`docs/research/2026-08-03-deep-audit/`) did not do. That audit graded *domains*; this one enumerates *providers* and classifies each as REAL / PARTIAL / COSTUME / COMING_SOON with `file:line` evidence, cross-checked against live prod configuration.

---

## 1. Headline

**~98 integrations enumerated. 2 costumes. 38 honestly-labeled coming-soon. The honesty posture is genuinely above industry norm — and it is machine-enforced.**

| Status | Count | Meaning |
|---|---|---|
| **REAL** | **48** | Working code path end-to-end (3 are code-complete but env-dark in prod: Clever, platform legs of Anthropic/OpenAI) |
| **PARTIAL** | **10** | Code exists, one leg stubbed or unreachable |
| **COSTUME** | **2** | UI implies working; backend absent |
| **COMING_SOON** | **38** | Honestly unbuilt — `connectHref: null`, explicit reason string, truth-gated |

The truth-gate machinery is real: `packages/api-types/src/capability-registry.ts` (23 capabilities) + `scripts/check-capability-registry.cjs` + a blocking CI workflow. `discovery.service.ts`'s `buildCandidate` **structurally cannot** emit an AVAILABLE candidate without a routable `connectHref`. Both costumes below live in the one place the gate does not reach: the raw widget-type palette and a doc-comment.

Exact catalog counts (each verified two ways): App Library `APP_REGISTRY` **19** (4 coming-soon) · Concierge `RULES` **26** (not ~34 as previously assumed) · `POS_PROVIDERS` **9** · `STREAMING_PROVIDERS` **12** · `AD_NETWORKS` **8** · integrations-health rows ~45.

---

## 2. COSTUMES — fix before launch

**C-1 · `SOCIAL_FEED` widget: full config UI, zero backend.** Offered in the palette as "Social Media — Posts from social accounts" (`template-builder/constants.ts:166`), with real editable fields — "Profile / feed URL", "Max posts to show" (`PropertiesPanel.tsx:4151-4153`). The renderer never fetches anything and prints the word **"Connected"** whenever `embedUrl` is truthy (`WidgetRenderer.tsx:4308-4316`, line 4313). Absence proven two ways. Note the App Library authors got this right — all four social tiles are `comingSoon` — so the costume is the raw widget type only. **Fix: badge the widget COMING_SOON (or delete the type) and stop printing "Connected".** Cheapest real fix in the whole census.

**C-2 · `iptv-m3u` ships as a `DIRECT` tile with no parser.** `packages/api-types/src/streaming.ts:388-400` declares `integrationTier:'DIRECT'` with tierReason "We parse + render channels"; two independent searches for any M3U parser (`EXTINF|EXTM3U|parseM3U`) return **zero** hits, and there is no upload path. **Fix: retier to COMING_SOON, or build the parser.**

**Near-costume (ranked with them):** the ad-network creative pipeline documents handlers at `apps/api/src/ads/networks/<id>.ts` (`ads.service.ts:7-9`) — **the directory does not exist**. Kept out of full-costume status only because connections save as `PENDING` and health reports COMING_SOON.

---

## 3. Cross-domain findings, ranked

### P1 — worth fixing before or immediately after launch

1. **Sentry's browser half may be dark.** The deep audit said Sentry wasn't wired at all — **that was wrong in the app's favour**: the API SDK is initialized (`apps/api/src/sentry.ts:37-62`, pre-everything import at `main.ts:8-9`) and `SENTRY_DSN` **is** set in prod, so API errors report. But `sentry.client.config.ts:3` reads a *different* key, `NEXT_PUBLIC_SENTRY_DSN`. If Vercel doesn't set it, the operator console **and the `/player` renderer's error boundary** (`player/page.tsx:2039-2041`) report nothing. ⚠️ Also unverified: `@sentry/nextjs` v10 may no longer auto-load the legacy `sentry.client.config.ts` at all (v9+ prefers `instrumentation-client.ts`, which doesn't exist here) — if so, browser Sentry is dead *even with* the public DSN set. **Action: check Vercel for `NEXT_PUBLIC_SENTRY_DSN`, then prove capture with one deliberate test error.**
2. **`PLATFORM_ALERT_EMAILS` is absent in prod → storage-outage and egress-cost alerts fan out to every `SUPER_ADMIN` row** (`efficiency-alerting.service.ts:122-138`, `storage-watchdog.service.ts:133-148`) — precisely the behavior the 2026-07-16 fix was written to stop. **Config fix, not code.**
3. **Billing UI claims "live" while prod runs a test key.** `enabled()` is key-presence only (`stripe.service.ts:112-114`); `/billing/status` returns "checkout, portal and invoices are live" (`billing.controller.ts:139-141`). Prod is `sk_test`. A prospect can believe money moved. **Fix: derive mode from the key prefix + persistent amber banner.**
4. **Stripe idempotency ledger commits before the handler runs** (`stripe.service.ts:362-374`) — a throwing handler leaves the row, so Stripe's retry short-circuits as duplicate and a `payment_failed`/`payment_succeeded` transition is permanently lost. The code's own comment names the consequence (`:800-805`).
5. **Same claim-before-work in POS, with a worse variant** (`pos.service.ts:851-871`): the Square caller claims then dispatches fire-and-forget and returns 200 — a failed sync is lost with *no* retry mechanism at all.
6. **Dropped HLS = permanent black screen.** Zero `recoverMediaError`/`startLoad` calls repo-wide (2 methods). A Wi-Fi blip at 7pm kills the board for the night; the manifest poll won't remount it because the manifest didn't change. `FitnessLiveTVWidget` is strictly worse — it unmounts the video element, so even a self-healing stream can't recover.
7. **No email retry, no delivery visibility.** A transient Resend 5xx permanently loses a password reset or invite (`email.service.ts:141-147`); `emailLog.` has 9 write sites and **zero reads**, so nothing can pick a row back up. `EmailLog` has no `tenantId` and no UI — so the `SENT_UNVERIFIED` status tonight's honesty-gate fix correctly writes is **invisible to every operator**.
8. **bugs→GitHub PR integration cannot work in the prod container** — `spawn('gh', …)` (`bugs.controller.ts:1177`) but no `github-cli` in the runner image (`Dockerfile:79-89`, 2 methods). Degrades honestly (copy-diff UX), so it's an ops/latency defect, not a lying UI.
9. **`FeatureFlagsService.isEnabled()` never consults GrowthBook** — both branches return the env fallback (`feature-flags.service.ts:64-74`); only the async variant reaches OpenFeature, with 2 call sites. The health grid nonetheless claims "per-tenant flag overrides are live."

### P2 — soon

Server-side URL guard doesn't cover fitness widget types (`zone-url-guard.ts:70-74`) — tonight's `safeEmbedSrc` fix is client-side only, and `FitnessTrainingVideoWidget` has neither layer · Daktronics is badged COMING_SOON while its decoder actually ships (under-claim, but the truth-gate grid is now wrong about a real capability) · Shopify carries a REALTIME badge with no webhook receiver · per-location POS price binding is **Square-only** among OAuth connectors while the POS page copy promises location-driven prices · POS cron isn't multi-replica safe · `EMERGENCY_TRIGGERED` notifications still have zero emitters (worse now that district fan-out shipped) · Settings still advertises **shipped** webhooks as "coming next release" · webhook signing secrets stored plaintext-recoverable · `bug-screenshots` bucket is `public:true` while its own comment says private · Spotify for Business has an authorize redirect and **no callback route** · no native crash reporting on the Kotlin player · dunning is a status pill with no CTA or email.

### Owner decisions (not engineering)

**Pluto/Xumo licensing** — the repo contradicts itself in two files: `streaming.ts:232-236` says consumer TOS "explicitly forbids commercial display… Removed from the catalog"; `fitnessSourceCatalog.ts:112-114,123` ships them as "permitted for commercial display." Needs a legal call. · **License lapse never stops playback** — and `terms/page.tsx:61` publishes a 10-day-grace-then-read-only policy for a read-only mode that **does not exist**. This is now a Terms contradiction, not just an undocumented decision. · **Stripe live keys.** · **Advertised 14-day trial** — enforce it or change the copy.

---

## 4. Config actions (fastest wins — no code)

| Action | Why |
|---|---|
| Set `NEXT_PUBLIC_SENTRY_DSN` in Vercel, then prove capture | Browser + player error reporting is likely dark |
| Set `PLATFORM_ALERT_EMAILS` | Stops platform alerts fanning out to every SUPER_ADMIN |
| Replace `GH_TOKEN` (a `gho_` gh-CLI OAuth token) with a fine-grained PAT | A laptop re-auth could kill fleet OTA |
| Delete `PLAYER_APK_LATEST_VERSION_CODE`, `PLAYER_APK_LATEST_VERSION_NAME`, `PLAYER_APK_SHA256` | Inert since 2026-05-15; pure confusion risk |
| Rotate `districtadmin@wcsd.demo` | Live password in pushed git history |
| Stripe live keys when ready | Prod is on `sk_test` |

---

## 5. Domain grades at HEAD

| Domain | D | UX | F | Δ |
|---|---|---|---|---|
| §6 Streaming | B− | B | **B−** | ↑ from C+ (injection + supply-chain closed tonight) |
| §6 injection/trust boundary | A− | B+ | **A−** | ↑ from C |
| §6 stream-drop recovery | D | D | **D** | unchanged — largest single defect |
| §7 Sports | B | B− | B | unchanged |
| §7 Taurus surface parity | B+ | B+ | **A−** | ↑ (polyfills now on /board, /ribbon, /scorebug) |
| §8 POS / Commerce | B+ | A− | B+ | unchanged (no code moved) |
| §9 Email | B+ | B− | B | D↑ (one gate, CI-pinned); UX↓ (status no operator can read) |
| §9 Outbound webhooks | B | A− | A− | unchanged — signing + SSRF + lease retry all intact |
| §10 Identity | A− | A− | **A** | ↑ ACC-09, ACC-10, panic rank-gate, JWT TTL all closed tonight |
| §11 Billing | B | C+ | A− | unchanged |
| §13 Public alerts | – | A | – | honest N-A, refused by absence of a boundary (stronger than a rejecting handler) |

---

## 6. What the census confirms is genuinely strong

Four real POS OAuth connectors with envelope-encrypted credentials and honest tier-gating at the API boundary · outbound webhooks with HMAC signing, connect-time DNS-pinned SSRF defense on **every** attempt including retries, and a `FOR UPDATE SKIP LOCKED` lease-based retry worker · OIDC SSO with JIT provisioning clamped to the tenant-assignable ceiling and cross-tenant mismatch rejected · the Google Maps key provably never reaching the browser (three independent methods) · Pexels degrading to `null` on every path with a UI that collapses rather than promising photos it can't deliver · Redis's 7s boot hard-cap intact · the storage transport/watchdog/health trio intact after the 07-31 incident · and the capability-registry truth-gate that makes the honesty posture machine-enforced rather than aspirational.

---

## 7. UNVERIFIED (carried — do not assert as fact)

Whether `NEXT_PUBLIC_SENTRY_DSN` / `GITHUB_REPO` / `PLAYER_APK_SHA_PINS` are set in the deploy dashboards · whether `@sentry/nextjs` v10 still auto-loads the legacy client config · whether `EMAIL_FROM`'s custom domain is DNS-**verified** inside Resend (the gate proves "not the shared sender", not "verified") · every tenant-level POS/streaming connection is UNVERIFIED-live (no platform keys in prod; DB rows unreadable) · live Supabase bucket ACLs · Railway replica count (sets severity of the cron finding) · real-hardware validity of the Daktronics/WTTC byte offsets · whether any `SOCIAL_FEED` zone ships in a preset · Kotlin-side player integrations not read this pass · nothing was executed in any of the five passes — all verdicts are code-reading.
