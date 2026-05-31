# Full-App Audit — 2026-05-30 (tools-enabled)

Run after equipping live tooling (Supabase PAT, Sentry, Vercel, Railway MCP, Postgres MCP, GitHub MCP, Claude-in-Chrome). 5 worktree-isolated read-only agents across all 21 Standard Audit Surface sections; every claim file:line-traced; lead-reviewed.

**Start here:** [`00-MASTER-SYNTHESIS.md`](00-MASTER-SYNTHESIS.md) — page-1 21×3 coverage table + prioritized P0/P1 + costume-vs-real ledger.

| Report | Sections | Agent |
|---|---|---|
| [01-realtime-emergency-taurus-ops.md](01-realtime-emergency-taurus-ops.md) | §1 real-time/emergency · §15 cross-browser/Taurus · §17 ops/DX | a0a08229 |
| [02-storage-egress-ai.md](02-storage-egress-ai.md) | §2 storage/egress · §3 AI providers · §4 AI surfaces · §5 AI competitive | a14bdeaa |
| [03-integrations-reality.md](03-integrations-reality.md) | §6 streaming · §7 sports/data · §8 POS · §9 comms · §12 imports · §13 public-alert | a0adb7fb |
| [04-auth-billing-forensic.md](04-auth-billing-forensic.md) | §10 auth · §11 billing · §16 forensic | a3617a50 |
| [05-vertical-editability-a11y.md](05-vertical-editability-a11y.md) | §14 multi-vertical · §18 a11y · §19 editability · §20 lenses · §21 verify | a578d508 |

**Headline:** the egress incident fix (image 3-layer) is in place; biggest residual is the **player not using the CDN proxy** + **video transcoding**. Two real security gaps: **audit-log not immutable at DB** (P0, documented-but-false safeguard) and **OIDC CSRF** (P1). Two trust gaps: **Twilio/Slack costumes** + **CAP/IPAWS not built** (sales-honesty). Strong: emergency core, Taurus, ops, Square POS, AI providers, billing, and widget-editability are all verified-real, not theater.

Live authed-app UX walkthrough: deferred (needs operator login — lead won't enter credentials).
