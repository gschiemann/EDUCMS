# FINAL BETA — FIX PHASE (Greg greenlit "ship it all, finish the audit, ready to launch, don't look stupid with non-working shit incl. the AI")

> **RESUME:** find the first row not ✅. Lead owns every merge (worktree agents → review diff → cherry-pick to master → tsc/tests → push → watch CI green → verify live where possible). AI fixes get a LIVE Chrome-MCP re-verify on Greg's Dodgers tenant (real OpenAI key).

## Fix set (launch-blockers + visibly-broken + "non-working AI")
| # | Sev | Fix | Owner | Files | Status |
|---|-----|-----|-------|-------|--------|
| F-SEC1 | **P0** | POS webhooks → CSRF EXEMPT_PATHS (curl-verified 403) | **LEAD** | `csrf.middleware.ts` | ✅ **SHIPPED `c0c80f28`** (+spec; csrf 12/12 green). Push done; **CI watch NOT yet confirmed green — first resume action: confirm Deploy Reliability green on c0c80f28, then re-curl `/pos/webhook/square` expecting NOT-403.** |
| F-AI1 | P1 | AI multi-scene gen threads per-zone `sceneId` (stops dumping all content on scene 1) | **LEAD** | `ai.service.ts:~2514`, `templates.controller.ts:~1060` | ⏳ **NOT STARTED** — the headline "non-working AI". Verify line #s. |
| F-AI2 | P2 | Decode `&amp;` HTML-entity in AI-generated text | **LEAD** | `ai.service.ts` | ⏳ NOT STARTED |
| F-AI3 | P2 | Weave brand palette into AI template-gen (parity w/ image-gen/sparkle — `buildImageBrandHint` is the model) | **LEAD** | `ai.service.ts` | ⏳ NOT STARTED |
| F-AI4 | P2 | Chat-to-edit gets element's current size as context ("larger" goes up) | **LEAD** | `ai.service.ts` | ⏳ NOT STARTED |
| F-SEC2 | **P1** | Redis-backed throttler (per-IP rate-limit dead across replicas; curl-verified) | 🤖 `a33ea6b48e6ed1f63` | new `realtime/redis-throttler-storage.ts`+spec, `app.module.ts` (forRoot→forRootAsync) | ✅ **AGENT DONE — branch `worktree-agent-a33ea6b48e6ed1f63` @ `af68751f`, tsc-clean, jest 7/7. READY TO MERGE.** Atomic Lua INCR+PEXPIRE on the existing ioredis client (no new dep), matched ThrottlerStorage v6.5.0 sig, fail-open to in-memory if Redis down. Follow-up (out of scope): stale "in-memory" comments in mfa-rate-limiter.ts + branding-rate-limiter.ts. |
| F-PLAY+F-IMG | P1+P2 | Player empty-scene fallback + per-vertical AI image-modal copy | 🤖 `a149b93a5c574eed9` | `player/page.tsx`, `AiImageGenerateButton.tsx` | ✅ **AGENT DONE — branch `worktree-agent-a149b93a5c574eed9` @ `4e86358a`, tsc-clean, 2 files. READY TO MERGE** (live-screenshot of multi-scene kiosk recommended before claiming to operator). |
| F-ED1+ED2+ED3 | P1+P1+P2 | StyleDisclosure + Athletics tag/empty-state + template-gen modal copy | 🤖 `a403b4ca24850984f` | `PropertiesPanel.tsx`, `BuilderShell.tsx`, `BuilderZone.tsx`, `templates/page.tsx`, `verticals.ts` | ✅ **AGENT DONE — branch `worktree-agent-a403b4ca24850984f` @ `75c4a547`, tsc-clean (5 files). READY TO MERGE.** ED1: chose option (b) — wiring StyleDisclosure (option a) would dupe the style system (`__styles` vs real `_styles` bottom bar), so added line-height/align/brand presets to the REAL bottom bar + deleted dead StyleDisclosure. ED2: `isAthleticsPreset()` predicate + universal empty-state. ED3: `VERTICAL_AI_TEMPLATE_PROMPTS` in verticals.ts. |
| F-COPY | P1 | Cross-vertical onboarding copy (name-overwrite + vertical prop + stale domain + K-12 guide) | 🤖 `af451bb8c15b54b0c` | `BrandingWizard.tsx`, onboarding/branding, `BrandingLivePreview.tsx`, getting-started | ✅ **AGENT DONE — branch `worktree-agent-af451bb8c15b54b0c` @ `d1e1efff`, tsc-clean (4 files). READY TO MERGE.** Name-overwrite fix was in `BrandingWizard.tsx` scrape handler (only fill name/tagline when operator left it empty), NOT branding-scraper.service.ts (scraper never sees the operator's typed value — agent traced + corrected). Stale `edusignage.app`→`venue-os.app` (0 refs remain). |
| F-SCHED | P1 | A3 publish data-loss guard | 🤖 `ad9f22813125f8c0d` | `schedules.controller.ts` + spec | ✅ **AGENT DONE — branch `worktree-agent-ad9f22813125f8c0d` @ `984bb3d7`, tsc-clean, jest 7/7 (red-green proof), 2 files. READY TO MERGE.** Guard: draft `deleteMany` scoped `isActive:false` so a CONTRIBUTOR draft never deletes an admin LIVE row; live-publish path unchanged. (Note: Schedule has no owner column, so scope-by-isActive is the correct schema-compatible guard.) |

### Agent branches to merge on resume (all commits PERSIST in git — 4 DONE, 1 running):
- ✅ `worktree-agent-a149b93a5c574eed9` @ `4e86358a` — F-PLAY+F-IMG (DONE, tsc-clean)
- ✅ `worktree-agent-ad9f22813125f8c0d` @ `984bb3d7` — F-SCHED (DONE, jest 7/7 red-green)
- ✅ `worktree-agent-a33ea6b48e6ed1f63` @ `af68751f` — F-SEC2 throttler (DONE, jest 7/7)
- ✅ `worktree-agent-af451bb8c15b54b0c` @ `d1e1efff` — F-COPY (DONE, tsc-clean)
- ✅ `worktree-agent-a403b4ca24850984f` @ `75c4a547` — F-ED1/2/3 editor (DONE, tsc-clean, 5 files)

**ALL 5 AGENTS DONE.** No file overlap between branches (verified at dispatch: each owns a distinct file set; verticals.ts + templates/page.tsx only touched by EDITOR; AiImageGenerateButton's vertical map is in-component, not verticals.ts).

**Merge order on resume:** (1) confirm P0 `c0c80f28` CI green + re-curl `/pos/webhook/square` (expect non-403). (2) Merge the 5 done branches — review `git diff master..<branch>` each, cherry-pick to master, `rm apps/api/tsconfig.build.tsbuildinfo` + clean API+web tsc + run each branch's new tests, push, **then `git worktree remove --force .claude/worktrees/agent-<id>` + `git branch -D worktree-agent-<id>` SAME TURN** (no worktree pileup). Batch the push + ONE CI watch to green. (3) Do the LEAD AI fixes F-AI1..4 in main tree (`ai.service.ts`+`templates.controller.ts`), tsc + 48 AI specs + push + watch. (4) Live-verify the AI on Dodgers (Chrome MCP tab 918841104, real OpenAI key): generate a multi-scene template → open a destination scene → confirm it has content (not blank); confirm no `&amp;`; confirm brand colors. (5) `pnpm worktrees:status` must be 0. (6) Tell Greg the config-only items are his.

## ⏯️ RESUME PROTOCOL (read FIRST on restart — ~20% budget hit mid-sprint 2026-06-26)
1. **Confirm F-SEC1 CI green** on `c0c80f28` (Deploy Reliability) + re-curl `POST /pos/webhook/square` → expect 401/4xx-but-NOT-403-CsrfError (proves the exempt landed).
2. **Collect the 5 worktree agents.** They were `run_in_background` — check completion via `git branch --list 'worktree-agent-*'` and `git worktree list`, or read each `/private/tmp/claude-501/-Users-gschiemann-Desktop-EDU-CMS/4129bcd1-4636-4065-90ea-207bae54cd20/tasks/<agentId>.output` tail for the returned branch name. Agent commits PERSIST on their worktree branches even if I died. Per CLAUDE.md merge cycle: `git diff master..<branch>` → review → cherry-pick → `rm apps/api/tsconfig.build.tsbuildinfo && pnpm --filter api exec tsc ... ` + web tsc + their tests → push → **`git worktree remove --force` + `git branch -D` THIS SAME TURN** (don't leave worktrees — the 83GB pileup rule).
3. **Do the LEAD AI fixes F-AI1..F-AI4** in the MAIN tree (`ai.service.ts` + `templates.controller.ts`). F-AI1 first (the broken AI). Then tsc + the 48 AI specs + push.
4. **After all merged + CI green: LIVE re-verify the AI fixes** via Chrome MCP on Greg's Dodgers tenant (real OpenAI key) — generate a multi-scene template, open a destination scene, confirm it now has content (not blank); confirm no `&amp;`; confirm brand colors applied. Tab was 918841104.
5. Then: `pnpm worktrees:status` must be 0; tell Greg the config-only items (PILOT_SEAT_LIMIT, AI Tier-1 env, rotate secrets, Stripe keys) are his; offer LIVE-glass when cam is on.
6. Watch every push to CI green BEFORE claiming shipped (CLAUDE.md standing rule).

## Config-only (GREG, not shippable by me) — list for him at the end
- `PILOT_SEAT_LIMIT` 1000→3 (billing metering) · AI Tier-1 `ANTHROPIC_API_KEY` decision · rotate secrets · Stripe live keys.

## Remaining audit: LIVE-glass (live-emergency-on-real-LED) — gated on webcam.

## SHIPPED LOG (append commit shas as they land)
- `c0c80f28` — F-SEC1 POS webhook CSRF exempt (P0).
- `1dc38745` — F-SEC2 Redis throttler (P1) — **MERGED to master (cherry-picked from worktree-agent-a33ea6b48e6ed1f63). DO NOT re-merge.**
- `4e727fb2` — F-SCHED publish data-loss guard (P1) — **MERGED to master (cherry-picked from worktree-agent-ad9f22813125f8c0d). DO NOT re-merge.**
- `e363441d` — F-COPY cross-vertical onboarding (P1) — **MERGED to master (cherry-picked from worktree-agent-af451bb8c15b54b0c, web tsc 0 real errors). DO NOT re-merge.**
- ⏳ All 4 pushed `master → e363441d`; **CI watch NOT confirmed green yet — FIRST resume action: `gh run watch` on e363441d (Deploy Reliability), react to red.**

- `e2638f09` — F-PLAY+F-IMG player empty-scene + AI image copy (P1/P2) — **MERGED to master (cherry-picked from worktree-agent-a149b93a5c574eed9, web tsc 0 real errors). DO NOT re-merge.**

### STILL TO MERGE on resume (1 branch — has tsc errors, NOT on master):
- ⚠️ `worktree-agent-a403b4ca24850984f` @ `75c4a547` — F-ED (editor text-styles + Athletics + AI chips). **Cherry-pick onto current master produced 2 real web tsc errors → auto-reverted, NOT shipped.** The agent reported it tsc-clean in its OWN worktree (after building @cms/scoreboard-cts), so the 2 errors are likely interaction with a newer master OR a type the agent's worktree masked. **THE 2 ERRORS ARE NOW KNOWN (captured 2026-06-26):**
  1. `src/app/[schoolId]/templates/page.tsx:35` — `Module '@cms/api-types' has no exported member 'getAiTemplatePrompts'`. The agent added `getAiTemplatePrompts`/`VERTICAL_AI_TEMPLATE_PROMPTS` to `packages/api-types/src/verticals.ts` but the **built dist is stale** (CLAUDE.md build-failure mode #3). FIX: confirm `packages/api-types/src/index.ts` re-exports verticals (`export * from './verticals'`) then **rebuild the package** (`pnpm --filter @cms/api-types run build` or `pnpm db:generate`-equivalent). This likely PASSES in CI already (CI builds api-types before web tsc) — my local web tsc just used the old dist. Verify the re-export exists; if missing, add it.
  2. `src/app/[schoolId]/templates/page.tsx:1115:29` — `Parameter 'suggestion' implicitly has an 'any' type`. Trivial: annotate the map param (it iterates the prompts array → `(suggestion: string) =>`). This is a GENUINE error to fix regardless.
RESUME: `git cherry-pick -x 75c4a547` → rebuild api-types + add the `: string` annotation → `pnpm --filter web exec tsc --noEmit` (filtered) → push. Branch is intact.

### SHIPPED THIS SESSION = 5 commits on master (c0c80f28 POS · 1dc38745 throttler · 4e727fb2 schedules · e363441d onboarding · e2638f09 player). CI not yet confirmed green on e2638f09 — watch on resume.
These 3 are all WEB changes → after cherry-pick run web tsc (`pnpm --filter web exec tsc --noEmit | grep -v "test\.\|@testing-library"`) before push. Then F-AI1..4 (lead, ai.service.ts) + live-verify. Worktree cleanup for the 5 agent trees still pending (`pnpm worktrees:clean`).
