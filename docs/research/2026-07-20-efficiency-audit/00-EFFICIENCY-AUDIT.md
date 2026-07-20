# Full Efficiency + Cost Audit — 2026-07-20

**Verdict: infrastructure is NOT being overpaid in any structural way today — total infra runs on the order of $50–70/month and the unit economics at fleet scale are excellent (>95% gross margin at $25/screen). But three engineering findings will bite at scale if unfixed, and one of them (proof-of-play data with zero read value) grows forever. Three dashboard checks only Greg can do close the loop.**

## Scope (page-1 statement, per Standard Audit Surface rule)

Efficiency/cost lens across infrastructure (Supabase, Railway, Vercel, GitHub) + application resource drivers. Mapped to the Standard Audit Surface: §2 (storage/egress) covered; §3 (AI cost levers) covered; §11 (unit economics) covered; §15/§20 (frontend weight = UX quality) covered; §17 (ops efficiency) covered; remaining sections N-A for this lens (no functional re-audit — the 2026-07-16/18 audits cover those). **Verification limits stated honestly: I cannot see actual invoices or plan tiers from here** — everything below is measured from live systems (Railway metrics API, direct SQL on the production database, GitHub API, local build output); plan-tier items are flagged as Greg-dashboard checks with expected values. Pricing rates quoted are approximate/as-of-training — the drivers and fixes are exact, the dollar conversions are ±.

## Measured reality (evidence)

| System | Measurement | Value |
|---|---|---|
| Railway api | CPU (24h avg / max) | **0.037 / 0.069 vCPU** (3.7% of one core) |
| Railway api | Memory (24h avg / max) | **0.21 / 0.42 GB** |
| Railway api | Network TX (24h) | ~2 GB/day (≈60 GB/mo, ≈$3/mo at $0.05/GB) |
| Railway Redis | CPU / Mem | 0.25% / **6.3 MB** (near-idle) |
| Supabase DB | Total size | **42 MB** |
| Supabase DB | Cache hit ratio | **100.00%** |
| Supabase DB | Connections | 19 (8 idle) of pool 25 — healthy |
| Supabase Storage | assets bucket | **138 MB / 227 files** (+0.9 MB bug screenshots) |
| GitHub | Visibility / Actions | **PUBLIC → Actions minutes $0**; cache 1.8/10 GB free |
| Web build | Static payload | 30 MB total; **4 chunks × 3.4 MB** (widget world — see F3) |

**Cost model at today's scale** (verify exact numbers on dashboards): Railway compute ~$3–6/mo actual usage + plan seat ($5 Hobby / $20 Pro); Supabase Pro $25/mo (the right floor for production — no pausing, backups) with **no compute add-on warranted** at 42 MB / 100% cache hit; Vercel plan seat (usage trivial today); GitHub $0. **Total ≈ $50–70/mo → break-even at ~3 paying screens.** At 1,000 screens the only linear cost terms are asset egress (already mitigated: long-TTL Cache-Control + player service-worker cache tiers + manifest ETag/304), playback telemetry (F1), and APK updates (already free — served via GitHub Releases on the public repo). Everything else is flat. Gross margin at fleet scale >95% **if F1 is fixed**.

## Findings (priority order)

### F1 — HIGH (structural): proof-of-play `playback_samples` grows forever and is never read
The table is **16 MB = 38% of the entire database**, 32k rows — with **2 index scans and 4 seq scans ever**. Its 4 indexes are 10 MB (62% of its own footprint); `playlist_id` index and pkey have **0 scans**. Sampler writes every ONLINE screen every 10 min (`PROOF_OF_PLAY_SAMPLE_INTERVAL_MS`, 144 rows/screen/day — measured ~550/day on the current ~4-screen live fleet). **No retention, purge, or rollup exists anywhere** (`grep purge|retention|deleteMany apps/api/src/analytics/` → empty). Projection: **1,000 online screens ≈ 26 GB/year; 10,000 ≈ 260 GB/year** of write IOPS, vacuum pressure, and paid storage for data with zero read value.
**Fix (small, high-leverage):** nightly job → roll up rows older than N days into a `playback_daily` aggregate (tenant, screen, playlist, day, sample_count — ~500× compression, KEEPS the proof-of-play reporting story for sponsors), purge raw > 90 days, drop the playlist-only index now. Multi-replica-safe via the existing maintenance-job pattern.

### F2 — HIGH (direct cost lever): Anthropic prompt caching is NOT implemented
`grep cache_control|ephemeral apps/api/src/ai/` → **zero hits**, while §3 of the Standard Audit Surface explicitly lists "Prompt caching where supported (Anthropic ephemeral)." The AI Designer's 3-candidate fan-out sends the same multi-thousand-token designer/system prompt **3× at full input price per generation**; chat-to-edit and set-generation repeat it again within minutes — the exact access pattern prompt caching exists for (cached prefix ≈ 10% of base input price, 5-min TTL). Applies to platform Tier-1 spend (your money) AND BYOK tenants (their bill = your product's perceived cost).
**Fix:** add `cache_control: { type: 'ephemeral' }` on the static system/designer prompt block for Anthropic calls (one structural change in the request builder + spec). Expected 50–85% input-token savings on multi-candidate and iterate flows.

### F3 — MEDIUM (world-class perf + player boot time): 4 × 3.4 MB widget mega-chunks
The widget/template component world (barrel-registered lucide icons re-exported en masse + every widget's inline-SVG theme trees) lands as **four separate ~3.4 MB chunks** (13.6 of the 30 MB static payload) — any route mounting `WidgetRenderer` (player, template builder, gallery, screens preview) parses the ENTIRE catalog. Dollar cost is minor (CDN-cached); the real cost is **first-paint on school WiFi and JS parse time on weak Android/Taurus player CPUs** — directly against "a CMS they could only dream of."
**Fix (phased):** (1) replace barrel icon re-exports with per-icon imports (cheap, big); (2) make the widget registry lazy — `next/dynamic` per `widgetType` so a screen parses only the widgets its template actually uses. Guard with a bundle-size CI budget so it ratchets down only (same discipline as every other gate).

### F4 — MEDIUM (Greg dashboard checks, ~5 min total)
1. **Supabase**: confirm plan = Pro with **NO compute add-on** and no PITR beyond needs — at 42 MB / 100% cache hit, base Pro compute is ample. If an add-on is on, remove it.
2. **Railway**: confirm plan tier (usage shown above is single-digit dollars; the seat fee is the main line). Check the egress line on the invoice against the ~60 GB/mo TX measured.
3. **Vercel**: check Image Optimization usage (source-image transform counts) — `next/image` with remotePatterns is active; asset-thumbnail-heavy dashboards can climb into paid transform tiers at scale. If it climbs: serve precomputed thumbnails from Supabase instead.
4. (Standing, from the launch audit) `PLATFORM_ALERT_EMAILS` — the **egress anomaly monitor** that guards the biggest variable cost mails every SUPER_ADMIN until this is set.

### Verified GOOD — the efficiency engineering already in place (credit where due)
Manifest **ETag/304** implemented player-side and server-side (the 60s poll costs ~nothing); emergency 12s reconcile poll runs **only while an alert overlay is live** (correct life-safety trade); OTA APKs ride **GitHub Releases = free egress** (public repo) with API-side release resolution; egress anomaly monitor + 1 GB floor; mobile-perf CI guard (no background polling, no global refetch storms); the 2026-06-15 kill of 59%-of-DB telemetry writes; AI hourly/image/monthly caps + BYOK-first economics (creative spend lands on tenant keys by design, platform key is capped trial-only); Redis fan-out replacing poll-storms; `connection_limit=25&pool_timeout=20`; audit-log append-only with trivial growth (8.5k rows); zero worktree/repo bloat (hygiene clean); DB dead-tuple health excellent (autovacuum keeping up).

## Punch list
| # | Action | Owner | Size |
|---|---|---|---|
| 1 | playback_samples rollup + 90d purge + drop unused index | me | S–M |
| 2 | Anthropic prompt caching (ephemeral) on designer/sparkle/concierge | me | S |
| 3 | Icon de-barreling, then lazy widget registry + bundle-budget CI gate | me | M |
| 4 | Supabase/Railway/Vercel dashboard checks + PLATFORM_ALERT_EMAILS | Greg | 5 min |
