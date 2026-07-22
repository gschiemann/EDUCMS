# i18n (Spanish + Chinese) — WRAP-UP HANDOFF

**Written 2026-07-22 by the Fable session facing a usage wall. Any model
(Opus included) can finish from this doc alone. A Chinese beta customer is
waiting — zh coverage of the operator journey is the priority.**

## What is DONE and shipped on master (all CI-green unless noted)

| Commit | What |
|---|---|
| `41d4c944` | Brand-contrast contract (VisionCore cream fix) + CI gate |
| `c898f29e` | sharp ≥0.35.3 + fast-uri ≥3.1.4 advisory pins (12/12 green, prod-deployed) |
| `e0fcb128` | i18n foundation: next-intl client-side, catalogs en/es/zh, chrome (Sidebar/TopToolbar/MobileTabBar) + full login page translated, switcher in avatar menu + /login. Verified in browser all 3 languages |
| `825d6a6f` | Scraper hardening (bg-color demotion, font sanitize, persisted shades) — reviewed + merged from Greg's spawned task |
| `88b6c0ca` | Device-language auto-detect (explicit pick always wins + persists; auto-detect never writes cookie). 17-case matrix verified |
| `e53b815b` | **CURRENT HEAD.** a11y fix: login switcher slate-400→slate-600 (axe redded all 9 unauth routes on e0fcb128 — 11/12 was that one red). **FIRST TASK for the wrap-up session: confirm 12/12 green on e53b815b** (ci-watch.sh, edit sha= line) |

Architecture doc: memory `project_i18n_es_zh_2026_07_22.md` + `apps/web/src/i18n/config.ts` header comment. **NEVER add a server-side next-intl request config — it kills static prerender and reds check-help-prerender.cjs.**

## IN FLIGHT: 4 background agents translating page content

Dispatched with `isolation: "worktree"`, all forked from `825d6a6f`. Worktrees under `.claude/worktrees/agent-*`:

| Worktree suffix | Scope | Namespaces |
|---|---|---|
| `aa2c114770ffb1a99` | app/[schoolId]/dashboard+screens + components/dashboard+screens | `dashboard`, `screens` |
| `a764fd99b927f2ef8` | app/[schoolId]/assets+playlists + components/assets+playlists | `assetsPage`, `playlists` |
| `a2ad095fe0b052c5c` | app/[schoolId]/settings+account + components/settings (NO emergency) | `settings`, `account` |
| `a1b274f7e2ef4ca16` | app/[schoolId]/templates (no builder) + components/templates + signup + onboarding | `templatesPage`, `signup`, `onboarding` |

Each was told: strings→t() only (zero logic changes), keys in ALL 3 catalogs in lockstep, author real es/zh translations, never touch i18n/config.ts / I18nProvider / providers / layout / globals.css / emergency / ui / layout components / lockfile, verify tsc+build+lockstep in worktree, commit to branch.

**Check status:** `for w in .claude/worktrees/agent-*; do git -C "$w" log master..HEAD --oneline | head -2; git -C "$w" status --short | head -3; done`

**If an agent died on the usage wall** (memory `feedback_usage_wall_pacing.md`): its committed work is on its branch; uncommitted work is dirty in the worktree (commit it yourself from inside the worktree). Full transcripts: `/private/tmp/claude-501/-Users-gschiemann-Desktop-EDU-CMS/bb3735e7-af27-4fa5-8f9a-269159786661/tasks/<id>.output` (grep `"file_path"` to list its writes). If a scope produced nothing, redo it by hand — the pattern is mechanical (see any merged agent's diff).

## MERGE CYCLE (lead owns it — per CLAUDE.md Agent Dispatch Protocol)

1. Per agent: `git diff master..worktree-agent-<id>` — review: string-extraction only, no logic drift, translations sane (spot-check zh: no machine-y literalism; UI-length OK).
2. Cherry-pick sequentially: `git cherry-pick <sha>`. **Catalog conflicts (messages/{en,es,zh}.json) are EXPECTED** — every agent adds its own top-level namespace block; resolution = keep BOTH blocks (mechanical). After each resolve: `node -e "require('./apps/web/src/i18n/messages/en.json')"` etc. to confirm valid JSON.
3. Catalog lockstep check (same script the agents ran):
   `node -e "const en=require('./apps/web/src/i18n/messages/en.json'),es=require('./apps/web/src/i18n/messages/es.json'),zh=require('./apps/web/src/i18n/messages/zh.json');const k=o=>JSON.stringify(Object.keys(o).sort())+Object.entries(o).filter(([,v])=>typeof v==='object').map(([kk,v])=>kk+JSON.stringify(Object.keys(v).sort())).join('');if(k(en)!==k(es)||k(en)!==k(zh)){console.error('MISMATCH');process.exit(1)}console.log('lockstep')"`
4. Full verify: `pnpm --filter web exec tsc --noEmit` · `pnpm --filter web run build` · `node apps/web/tools/check-help-prerender.cjs` · `node apps/web/tools/check-bundle-budget.cjs` · `node apps/web/tools/check-brand-contrast.cjs` · `pnpm mobile-perf-guard`.
5. Browser proof (Greg's Verification-Before-Claim rule): `.claude/launch.json` has `web-prod` (`next start` on port 3000 — RESTART server after any rebuild, mixed-manifest trap). Fake session for authed chrome: set localStorage `edu_cms_token` + `edu_cms_user` (JSON with role SCHOOL_ADMIN), cookie `venueos_locale=zh`, open `/demo-school/dashboard` and `/demo-school/screens` — screenshot Chinese page CONTENT (not just chrome). Browser-pane clicks use screenshot-pixel coords (NOT rendered px) — use read_page refs.
6. `git push origin master`, then CI-watch to completion (script: `/private/tmp/claude-501/-Users-gschiemann-Desktop-EDU-CMS/bb3735e7-af27-4fa5-8f9a-269159786661/scratchpad/ci-watch.sh` — edit `sha=` line first; or the CLAUDE.md gh-watch one-liner). 12 workflows must be green; `https://venue-os.app/api/v1/health` `version` shows the deployed API sha (web deploys via Vercel; API-skipped deploys show SKIPPED in Railway — normal for web-only commits).
7. **Remove each merged worktree SAME TURN:** `git worktree remove --force .claude/worktrees/agent-<id> && git branch -D worktree-agent-<id>`. End state: `git worktree list` = main tree only.
8. Tell Greg: what shipped, proof screenshots, honest remainder list.

## MOBILE APP LANGUAGES (Greg 2026-07-22: "dont forget the mobile app")

**Greg confirmed (2026-07-22): "the mobile app" = the mobile WEB app (the dashboard PWA) — NOT the Android APKs.** It is the SAME Next.js app as desktop, so it inherits ALL of the i18n work automatically: chrome + auto-detect are live on phones today, page content arrives with the agent wave. **Wrap-up session: verify the finished wave AT MOBILE VIEWPORT (375×812) in zh** — tab bar, More sheet, dashboard, screens, settings — not just desktop. Mobile-specific leftovers: the **/panic page** (mobile emergency trigger — falls under the careful emergency pass below) and **`apps/web/public/manifest.webmanifest`** (PWA name + shortcut labels are static English; low-priority, note to Greg rather than build speculatively).

Secondary (kiosk hardware, NOT the operator mobile app — lower priority):
1. **Android PLAYER APK (`apps/player/app`):** native Kotlin. Only `src/main/res/values/strings.xml` (English) exists — VERIFIED no `values-es`/`values-zh-rCN` dirs. Work: sweep Kotlin sources for hardcoded UI literals → extract to strings.xml, then add `values-es/strings.xml` + `values-zh-rCN/strings.xml` with real translations. Android auto-picks by device locale (satisfies Greg's auto-detect requirement natively; no in-app switcher needed for v1 — the kiosk mostly renders web content anyway, so the strings that matter are pairing/setup/offline-error surfaces a venue's IT staff sees). RELEASE TRAP: any player release must bump gradle versionCode/versionName BEFORE tagging `player-v*` (memory `feedback_player_release_tagging.md`; use release-apk.sh) — do NOT tag a release just for string files without the bump.
2. **Android MANAGER APK (`apps/player/manager`):** same treatment, same trap (`manager-v*` tags).

The web player surfaces a kiosk shows (offline self-heal page in `apps/web/public/sw-player.js`, pairing/splash screens under `apps/web/src/app/player/` + `KioskSplash.tsx`) are WEB code — if translating those, mind the Taurus/Chromium-83 rules (CLAUDE.md #10) and that sw-player.js edits must keep `check-sw-shell.cjs` green (26 assertions, incl. the HTTP-200 self-heal contract).

## AFTER THIS WAVE (not yet done — do not claim otherwise)

- **Emergency surfaces** (components/emergency/**, settings/emergency): deliberately excluded from agents. Translate STRINGS ONLY in a careful solo pass (CLAUDE.md: emergency changes need review; never touch @AllowPanicBypass/audit logic). Hold-to-trigger instructions + typed-confirm words need special care — the typed confirmation word should probably stay English-insensitive; flag to Greg for decision.
- `useTenantCopy` role labels + vertical copy ("Admin", "Add a School/Store/Gym") — its own pass.
- Help center: 24 articles × es/zh — content translation project.
- API-originated strings (login errors, toasts carrying error.message) — needs API i18n or client-side error-code mapping.
- Template builder, sports console, menu/POS pages, super-admin, marketing pages (marketing needs static localized variants for SEO — do NOT convert to client rendering).
- More languages later: add catalog + LOCALES/LOCALE_LABELS entry in config.ts.

## Standing rules that bind this work

- Every new user-facing string ships in en+es+zh same commit (memory `feedback_all_features_all_languages.md`).
- Absence claims need two independent verification methods (memory `feedback_audit_grep_and_seed_timing.md`).
- Watch CI to green before saying "shipped". Verify render trees before editing UI. `command grep`, not bare grep.
