# Next-sprint launchpad — resume here (2026-07-03, usage-wall park)

**State at park:** master `ec79295f` · tree CLEAN · 1 worktree (main only) · all pushed.
Prod live on `d57cbe74`, `db=ok redis=ok`, buckets intact, 60 emails SENT. Infra green under auto-monitor.

## Shipped this session (done, verified, live)
- Wave-1 bug hunt → 4 non-emergency fixes merged + CI-green + live:
  - #5 Square webhook raw-body HMAC (`a54aa90b`) · #6 Stripe current_period from items (`2fe1e96f`)
  - #4 Builder re-init wipe `[template.id,init]` (`c3cbc0ce`) · #3 CTS/operator stats race → `withStatsTx` Serializable+retry, full API suite 1456/1456 (`849ff1ee`)
- Storage bucket onModuleInit fix already live (`e744d6d6`, #223).
- 2 hunts persisted: `00-CONFIRMED-BUGS.md` (wave-1), `01-HUNT2-BILLING-EMERGENCY.md` (wave-2).

## THE FENCE (unchanged — respect it)
Opus = **executor of Fable-approved plans + safe bug-fixes/hardening ONLY.** No new design/architecture/UX. Emergency-subsystem edits need **Greg's explicit sign-off**. Money-path (Stripe) edits need Greg/Fable. Additive-only Prisma on the live pilot (write migration files, never `prisma migrate`).

## QUEUE — ranked, with lane

### A. GATED on Greg's word (do NOT start without it)
1. **Emergency #1 (hunt-1)** — Android kiosks miss per-screen alerts. `realtime.gateway.ts:174` → `ctx.deviceId = decoded.deviceId || decoded.sub`. One-line, all safeguards preserved. **Highest value.**
2. **Emergency #2 (hunt-1) + #4 (hunt-2)** — pushed overlay (SOS/TEXT_BROADCAST/MEDIA_ALERT) has no HTTP/manifest backstop → dropped ALL_CLEAR strands takeover. `player/page.tsx:4235` + `EmergencyOverlay.tsx:238`. Same class — fix together.
3. **Billing cluster (hunt-2, Stripe is TEST-mode live)** — recommend routing to **Fable** (design):
   - #1 P0 shared out-of-order watermark swallows `invoice.payment_failed` (`stripe.service.ts:680`) — needs design (per-concern watermark / add `invoice.payment_succeeded` handler; maybe migration).
   - #2 P0 `checkoutForTenant:233` no idempotency → duplicate subscription double-bill.
   - #3 P1 webhook guard TOCTOU (`stripe.service.ts:496`) — freshness read outside tx. **This one is the safe subset** (same Serializable-tx pattern as #3 stats race) — can ship solo on Greg's OK.

### B. Autonomous safe-hardening (in-fence — can start immediately next window)
- **Wave-3 adversarial hunt** on the lenses that returned clean (cross-tenant isolation, RBAC, unguarded-await-500, SSRF, scale) with deeper/different angles + NEW lenses (idempotency tables, cron consistency, service-worker cache tiers, WS dedup). Read-only → produces confirmed list → fix safe subset. Same workflow: `workflows/scripts/prelaunch-bug-hunt-2-*.js` (edit lenses, re-invoke).
- If a Wave-3 finding is localized + non-money + non-emergency → fix under the full gate.

### C. Config items for Greg (not code — flag, don't touch)
- **Rotate prod secrets before go-live:** `JWT_SECRET`/`SESSION_SECRET` are human-readable beta placeholders (low entropy). Rotating invalidates sessions → Greg's call/timing.
- Stripe is on **test keys** (`sk_test_`) — swap to `sk_live_` at go-live (that's when the billing bugs become real money).
- `EMAIL_FROM=noreply@venue-os.app` — confirm the domain is Resend-verified (else non-owner recipients dropped).
- Supabase global upload cap (>50MB uploads) — raise if needed.

## Merge-relay gate (paste-ready)
```
# per fix, on a worktree branch:
test "$(git branch --show-current)" = master   # ALWAYS before push
git cherry-pick <sha>
rm -f apps/api/tsconfig.build.tsbuildinfo && pnpm --filter api exec tsc --noEmit --project tsconfig.build.json   # api
pnpm --filter web exec tsc --noEmit | grep -vE 'test\.|@testing-library'                                          # web
pnpm --filter api exec jest <touched-dirs>          # or full suite for flagship paths
node apps/web/tools/check-mobile-perf.cjs            # if web/chrome touched
grep -rnE 'inset:[[:space:]]*0|inset(-x|-y)?-[0-9]' apps/web/src/components/widgets apps/web/src/app/player apps/web/src/components/player  # rule #10
git push origin master --no-verify
git worktree remove --force .claude/worktrees/agent-<id>; git branch -D worktree-agent-<id>
# CI watch to green (background), then re-verify prod health + storage.buckets
```
Fresh worktrees need `pnpm install` + build `@cms/*` packages before tsc/jest resolve (main tree already built).

## Infra sweep (standing duty — run each window + after every deploy)
- API `https://api-production-39a1.up.railway.app/api/v1`: `/health` (db/redis ok), `/health/ready` (200), `/health/emergency-path` (ws_signer ok).
- Supabase: `SELECT count(*) FROM tenants/screens/users` (baseline 111/196/63); `storage.buckets` (assets, branding-logos, floor-plans present).
- Railway: latest deploy SUCCESS on master SHA; `http_error_rate` no 5xx spike.
- Vercel Production Ready; Dependabot previews paused (limit 0). Alert Greg ONLY on red.
