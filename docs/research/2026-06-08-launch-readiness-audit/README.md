# 2026-06-08 Launch-Readiness Audit

Autonomous overnight pre-launch gate audit (first paying customer this week). 8 read-only Opus agents, all 21 Standard Audit Surface sections × Design/UX/Functionality lenses, every safeguard traced to its real caller. Built on the 2026-05-30 full-app audit (zero P0s); re-verifies that baseline + audits the ~60 commits since (gallery perf fix + 9 new K-12 boards), focused on Greg's five areas: performance, Supabase egress/cost, security, usability, launch-readiness.

## Start here
- **[00-MASTER-SYNTHESIS.md](00-MASTER-SYNTHESIS.md)** — page-1 coverage table (21×3), one ranked punch list, FIXED-OVERNIGHT vs NEEDS-GREG split, recommended morning order.

## Per-domain reports
| # | File | Scope | Headline |
|---|---|---|---|
| 01 | [01-performance.md](01-performance.md) | page-load / "page unresponsive" class | Gallery fix verified solid; 2 playlist surfaces had same unfrozen-iframe bug → **fixed** |
| 02 | [02-storage-egress-db.md](02-storage-egress-db.md) | Supabase egress, DB pool, unbounded tables, indexes | Egress GREEN; every hot query indexed; watch append-only retention + video |
| 03 | [03-security-authz.md](03-security-authz.md) | multi-tenant isolation, authz, SSRF, CSRF, secrets | No exploitable cross-tenant IDOR; SSRF defense best-in-class |
| 04 | [04-emergency-audit-chain.md](04-emergency-audit-chain.md) | emergency signing chain + forensic audit trail | Signing gate + immutability REAL (not theater); 1 migration-ordering P1 |
| 05 | [05-usability-ux.md](05-usability-ux.md) | 30s happy paths, costumes, editability | "Can't edit a word" FIXED; empty cold-start + dark Concierge UI are the gaps |
| 06 | [06-launch-deploy-billing.md](06-launch-deploy-billing.md) | CI/deploy/health/billing/onboarding/env | All CI green; blockers are config: TEST-mode Stripe, weak secrets, seat limit |
| 07 | [07-crossbrowser-taurus.md](07-crossbrowser-taurus.md) | Chromium-83 (Taurus) + WebKit/Safari | Recurring killers closed; 117 boards unscanned by taurus gate |
| 08 | [08-deps-secrets-hygiene.md](08-deps-secrets-hygiene.md) | dep CVEs, leaked secrets, repo hygiene | passport-saml remediated; **P0 live secrets in `.codex/`** (gitignored tonight) |

## Fixed overnight (verified, tsc clean, pushed)
- `.gitignore` now blocks `.codex/` + `AGENTS.md` (+ tarballs/certs) so live secrets can't be `git add`-ed (does NOT rotate them — that's on Greg)
- Playlists page + Create-Playlist wizard pass `freeze` to template thumbnails (next "page unresponsive" eliminated)
- Assets grid `<img>` → `loading="lazy" decoding="async"`

## The 4 launch blockers (all need Greg — config/secret, not code)
1. Rotate the 4 live secrets in `.codex/config.toml`
2. Rotate the weak prod `JWT_SECRET`/`SESSION_SECRET`
3. Stripe is live in TEST mode — go-live test-card pass + swap to live keys
4. Pilot password `12345678` in a public-repo doc — rotate + redact
