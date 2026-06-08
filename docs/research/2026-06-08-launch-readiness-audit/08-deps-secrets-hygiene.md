# Supply-Chain / Secrets / Repo-Hygiene Audit — VenueOS (EDU CMS)

**Date:** 2026-06-08 · Read-only · Repo PUBLIC at github.com/gschiemann/EDUCMS · Agent: ab3cc35bf2f0872d9

## Summary

**ONE LAUNCH BLOCKER — P0: live production secrets sitting unprotected in the working tree.** `.codex/config.toml` (untracked, but **NOT gitignored**) contains a live GitHub PAT, a live Supabase Postgres password, a Railway API token, and a Supabase `service_role` JWT. They are **not yet in git history** (verified) — but the file is one `git add .` from being published to a public repo, with no `.gitignore` rule stopping it. **Rotate all four credentials and gitignore `.codex/` before launch.**

**Good news on the rest:**
- **passport-saml CVE-2025-54419 is REMEDIATED** — package fully uninstalled (absent from lockfile + every package.json), SAML code falls through to a stub, SAML hard-gated (0 enabled tenants), prior self-enable-by-DISTRICT_ADMIN path now SUPER_ADMIN-only with audit logging. Prior P0 closed.
- **No high/critical CVEs.** `pnpm hygiene:deps` + `pnpm audit` agree: 27 advisories, all moderate/low, all in dev/build/transitive tooling. tar/undici prior highs gone (undici → 6.24.1/7.25.0; tar absent).
- **No leaked secrets in tracked files or git history.** All `.env.example` values are placeholders.
- **`.git` healthy** (40 MB, 0 garbage), **lockfile in sync** (`--frozen-lockfile` passes), **no leftover worktrees**, tag/branch clutter minor.

## Dependency CVEs
`pnpm audit`: **0 critical, 0 high, 25 moderate, 2 low.** hygiene:deps gate: "no critical/high advisories."

| Package | Installed | Advisory | Severity | Reachable in prod? | Fix |
|---|---|---|---|---|---|
| **passport-saml** | **NOT INSTALLED** | CVE-2025-54419 | (was critical) | **No — removed** | ✅ done; keep uninstalled until @node-saml/passport-saml@5 (task #199) |
| esbuild | 0.17.19 | GHSA-67mh-4wv8-2f99 | moderate | No (wrangler build-time) | wrangler bump → esbuild ≥0.25 |
| dompurify | 3.3.3 | GHSA ×5 | moderate | Partial (api+web sanitizer; only via ADD_TAGS/FORBID_TAGS config, not user input) | bump ≥3.4.0 |
| hono | 4.12.12 | GHSA ×5 | moderate | No (devDep MCP SDK CLI) | dev-only |
| postcss | 8.5.9/8.4.31 | GHSA-qx2v-qp2m-jg93 | moderate | Build-time | bump ≥8.5.10 |
| ip-address | 10.1.0 | GHSA-v2v4-37r5-5v8g | moderate | No (@wdio test tooling) | dev-only |
| brace-expansion | 5.0.x | DoS | moderate | No (@sentry transitive) | bump ≥5.0.6 |

**No CVE is a launch blocker.** dompurify is the only prod-path one worth a near-term bump (P2). tar/undici prior highs resolved.

## Secrets / PII scan

| Pattern | File:line | Real or placeholder | Verdict |
|---|---|---|---|
| `github_pat_11A6XJ63...` | `.codex/config.toml:17` (untracked) | **REAL GitHub PAT** | 🔴 P0 rotate |
| `postgresql://postgres.bhdaxz...:g4qM7Pb5EeUc8aA6@...supabase.com` | `.codex/config.toml:24` | **REAL Supabase DB password** | 🔴 P0 rotate |
| `RAILWAY_API_TOKEN = 062a7919-...` | `.codex/config.toml:35` | **REAL Railway token** | 🔴 P0 rotate |
| `SUPABASE_SERVICE_ROLE_KEY = eyJ...` (exp 2091) | `.codex/config.toml:46` | **REAL service_role JWT** (full RLS bypass) | 🔴 P0 rotate |
| `AGENTS.md` (69 KB) | — | Clean — doc placeholders only | ✅ safe (gitignore it) |
| sk-ant/sk_live/sk_test/whsec_/re_/AIza/gho_/ghp_/eyJ/PRIVATE KEY (tracked) | — | none found | ✅ clean |
| `postgres://...@` (tracked) | docker-compose.yml, deploy-reliability.yml | `cms_user:cms_password` / `fake:fake` | ✅ safe placeholders |
| `.env.example` values | root + api + web | `USER:PASSWORD`, `CHANGE_ME_`, localhost | ✅ placeholders |
| `apps/player/app/debug.keystore` | tracked 2.6 KB | standard Android debug keystore (universal public key, not release) | ✅ benign |
| `chuck@/larry@agceducation.com` + `12345678` | `docs/CUSTOMER_PILOT_GUIDE.md:13-14` + `.html` (tracked) | **Real pilot emails + weak password in PUBLIC repo** | 🟠 P1 |
| `greg.schiemann@e-arc.com` + SUPER_ADMIN UUID | apps/api/scripts/*.ts | dev work email + prod SUPER_ADMIN id | 🟡 P2 |
| northwind.co/riverside.edu/etc | seed/demo | fake demo data | ✅ safe |

**Note:** the seed script `seed-agc-pilot.ts` was hardened (2026-05-03) to require passwords via env, so `12345678` is no longer seeded by code — but the pilot guide docs still print it as the live login for real accounts on `https://venue-os.app`.

## Repo hygiene (`pnpm hygiene` digest)

| Axis | State | Fix |
|---|---|---|
| Worktrees | ✅ only main tree | — |
| `.git` health | ✅ 40 MB, 2607 loose, **0 garbage** | — (no gc needed) |
| Working tree | ⚠️ 3 untracked: `.codex/`, `AGENTS.md`, this audit dir | gitignore `.codex/` + `AGENTS.md` |
| Local branches | ✅ 4 (master + 3 stale agent/rollout/fix) | `git branch -D fix/deep-widget-...` (remote gone) + the two if merged |
| Remote stale | ✅ none | — |
| Backup tags | ✅ only 2 — the 90-tag problem is **resolved** | — |
| Total tags | 103 (mostly player-v* releases — expected) | — |

`master` is 1 commit ahead of origin (`698a7943` perf-cliff test) — unpushed local commit.

## .gitignore + lockfile + PII
- **Ignored:** `.env*`, `node_modules/`, `.next/`, `dist/`, `build/`, `*.pem`, `*.sqlite`, `*.tsbuildinfo`, `apps/api/uploads/`, `.turbo/`, `scratch/`, `test-results/`, `.mcp.json`, `.claude/*`.
- 🔴 **NOT ignored — the P0 gap:** `.codex/` and `AGENTS.md` — `git check-ignore` returns nothing → both committable. `.codex/config.toml` holds live secrets. **Add `/.codex/` and `/AGENTS.md` now.**
- 🟠 **Tarball backups not ignored** — no `*.tar.gz`/`edu-cms-backup-*` rule; the documented backup procedure writes one to repo root. Add `*.tar.gz`.
- 🟡 `*.key`/`*.pfx`/`*.p12`/`*.crt` not ignored (only `*.pem`/`*.sqlite`). Low risk, cheap to add.
- **Lockfile:** ✅ `--frozen-lockfile --lockfile-only` exits 0 — no drift.
- **PII:** only real PII is the AGC pilot emails+password (P1) and the dev's own e-arc.com email in scripts (P2). All other emails are fake demo data.

## Findings ranked

### 🔴 P0-1 — Live production secrets in `.codex/config.toml`, unprotected by `.gitignore` (public repo)
Evidence: `.codex/config.toml` lines 17/24/35/46 — GitHub PAT, Supabase DB password `g4qM7Pb5EeUc8aA6`, Railway token `062a7919-...`, Supabase service_role JWT (exp 2091). `git log --all -S` confirms none are in git history; `.codex`/`AGENTS.md` in no commit. Blast radius: service_role JWT bypasses all Supabase RLS (every tenant's data incl. student/parent PII); DB password = direct Postgres; Railway token = prod deploys/env; PAT = repo push. One `git add . && git push` publishes all four. **Fix:** (1) rotate all four immediately; (2) add `/.codex/` + `/AGENTS.md` to `.gitignore`; (3) move secrets outside the repo or to env. Do this before launch regardless of commit state.

### 🟠 P1-1 — Real pilot-customer login credentials in a public-repo doc
`docs/CUSTOMER_PILOT_GUIDE.md:13-14` + `.html:41-42` — `chuck@/larry@agceducation.com` / `12345678` for live accounts at venue-os.app. Blast radius: anyone can read the guide and log into the pilot CMS (SCHOOL_ADMIN has emergency-trigger). **Fix:** rotate the AGC pilot passwords on prod; redact password (and ideally emails) from both files; reconsider whether the guide belongs in a public repo.

### 🟡 P2-1 — dompurify 3.3.3 on a prod sanitizer path (5 moderate XSS-bypass advisories). Bypasses need attacker-controlled ADD_TAGS/FORBID_TAGS, not user input — low reachability. Bump ≥3.4.0.
### 🟡 P2-2 — Dev email + SUPER_ADMIN UUID hardcoded in tracked scripts (apps/api/scripts/*.ts). Public-repo self-doxxing + prod SUPER_ADMIN id. Move to env when convenient.
### 🟡 P2-3 — `.gitignore` missing tarball/cert patterns (`*.tar.gz`, `*.key`, `*.pfx`, `*.p12`, `*.crt`). Backup procedure writes `edu-cms-backup-*.tar.gz` to root. Add them.

### 🟢 P3-1 — Stale local branch with gone remote (`fix/deep-widget-...`). `git branch -D`.
### 🟢 P3-2 — 25 moderate / 2 low dev-tooling CVEs (esbuild/hono/postcss/ip-address/brace-expansion) — all transitive build/test, none shipped. Bump opportunistically.

**Bottom line:** one true blocker — rotate the four `.codex/config.toml` credentials + gitignore it (P0-1) — plus rotate the pilot-guide password (P1-1). Everything else is in good shape; prior critical/high findings all closed.
