# Pre-launch bug-hunt — DECISIONS FOR GREG (2026-07-03)

Four adversarial hunt waves (each finding refute-verified twice, confirmed-only) surfaced **22 real bugs**. I autonomously fixed the **14** that are safe/localized/non-emergency/non-money under the standing fence — all adversarially-tested, gated (tsc + targeted jest + web toolchain + rule-#10), CI-green, and live in prod. The remaining items need **your** call because they touch the emergency subsystem, the money path, or the live DB schema.

## ✅ SHIPPED THIS SPRINT (14 fixes, all live + CI-green)
| Area | Fix | Sev |
|---|---|---|
| Sports stats | CTS↔operator write race → `withStatsTx` Serializable+retry | P1 |
| Editor | builder wipes edits/undo on refetch → `[template.id]` | P1 |
| POS | Square webhook HMAC over raw bytes | P1 |
| Billing | Stripe `current_period` read from items | P1 |
| **Security** | **unauth cross-tenant AuditLog write** (player-logs) → token-bound | **P1** |
| **Data** | **POS dedup key tenant-scoped** (was dropping cross-tenant menu/86 pushes) | **P1** |
| Player | SW cache key↔CDN URL agreement (offline images) | P1 |
| Player | SW cache version sort numeric (v10>v9) | P2 |
| Upload | size caps enforced on real bytes (both paths) | P2 |
| Content | fleet publish: per-location tx, no dark screen, honest partial result | P1 |
| **Content** | **approval path now displaces live schedule** (no interleaved playback) | **P1** |
| **Security** | **`/screens/register` per-IP throttle** (was unbounded-row DoS) | **P2** |
| **Security** | **CSV formula-injection guard** in sponsor proof-of-play export | **P2** |

## 🚨 NEEDS YOUR SIGN-OFF — EMERGENCY SUBSYSTEM (I will not touch without your OK)
1. **Per-screen emergency alerts miss Android kiosks** — `realtime.gateway.ts:174`. One-line: `ctx.deviceId = decoded.deviceId || decoded.sub`. All safeguards preserved. **Highest value — a live life-safety gap.**
2. **Pushed emergency overlay can get stuck / no HTTP backstop** — `player/page.tsx:4235` + `EmergencyOverlay.tsx:238`. A dropped `ALL_CLEAR` strands an SOS/broadcast takeover on screen. Same class, fix together.

→ **Say "do #1" / "do the emergency fixes" and I'll ship them with the same gate + emergency E2E.**

## 💳 NEEDS YOUR CALL — STRIPE MONEY PATH (recommend routing to Fable)
Stripe is live in prod on **TEST keys** (`sk_test_`), so no real money moves yet — but these are go-live blockers the moment you swap to `sk_live_`:
1. **P0** failed-payment webhook swallowed by a shared out-of-order watermark → unpaid tenant stays ACTIVE forever (no `payment_succeeded` handler either). `stripe.service.ts:680`. *Needs design (per-concern watermark / add handler; maybe a migration).*
2. **P0** `checkoutForTenant` no idempotency → duplicate subscription double-bill. `stripe.service.ts:233`.
3. **P1** webhook out-of-order guard is TOCTOU (freshness read outside tx). `stripe.service.ts:496`. *This one is the safe subset — I can ship it solo on your OK (same Serializable-tx pattern I shipped for sports).*

→ These 3 are interrelated; recommend **Fable designs the billing-webhook hardening as one piece.** Or tell me to ship the safe #3 now.

## 🗄️ NEEDS A MIGRATION DEPLOY (can't touch under additive-only fence)
- **PlayerSeasonStat unique key omits `sport`** — `schema.prisma:2558`. A multi-sport athlete's identical stat codes (AST/PTS/G/A…) merge into one row, corrupting per-sport leaderboards + the record book. Fix = add `sport` to `@@unique` (a constraint change → needs a coordinated Prisma migration on the live DB; I don't run `prisma migrate` per the fence). **Not biting your current customer** (single-sport water polo) yet. Want me to write the migration file for you to review + apply?

## ⚙️ CONFIG (yours — flagged, not touched)
- **Rotate `JWT_SECRET` / `SESSION_SECRET`** before go-live — they're human-readable beta placeholders (low entropy). Rotating invalidates sessions → your timing.
- **Stripe** → swap to `sk_live_` at go-live (that's when the billing bugs become real money).
- Confirm **`EMAIL_FROM`** domain is Resend-verified; raise Supabase global upload cap if you need >50 MB uploads.

## 🟡 Additive-only, background (webhook retry — emergency-adjacent)
- **#3 webhook-retry reclaim** — `webhook-retry.worker.ts:104`. If a pod dies mid-drain, PENDING deliveries strand forever (no reclaim of in-flight rows). Purely-additive reliability fix, but the queue carries `emergency.triggered` outbound — so I'm holding it with the emergency items. Say "do the retry reclaim" and it ships.

---
Full per-finding evidence + verifier reasoning: `00`–`04` in this folder.
