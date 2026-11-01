# Decision record — rulebook restructure: the move map (2026-11-01)

Produced by the restructure pull request (`phase1/rulebook-restructure`, built on top of the truth-fix pull request #208). It answers one question for the reviewer: **did anything get lost, and what was changed rather than moved?**

**Situation** — the single-file `CLAUDE.md` was about 28,700 words loaded into every session. It became an always-loaded core (under 3,000 words, written by the lead) plus nested rulebooks that load only where the work happens, plus documents of the same authority. **Evidence** — the tables below, generated from the old file and the new tree by a throwaway script (not committed): every old heading, every changed sentence, and a sentence-level proof that the old text exists in the new tree. **Validation** — `node scripts/check-rulebook.cjs --self-test && node scripts/check-rulebook.cjs` (output at the end of this file). **Rollback** — revert the pull request; the old file is in git history. **No rule changed.**

How the move was made: the nested files and documents were assembled mechanically from line ranges of the old file (verbatim); the only hand-written text is the one-line scope headers, the numbered one-line stubs that keep "rule N" resolving, the six new audit sections, the incident-file headings and index, the AGENTS.md table, the CHANGELOG entry and this file.

## 1. Word counts

| File | Words |
|---|---|
| **old `CLAUDE.md` (the truth-fixed text this branch started from)** | **28,655** |
| `CLAUDE.md` (new core; limit 3,000) | 1,867 |
| `AGENTS.md` (limit 1,800; North Star block untouched) | 1,438 |
| `packages/database/CLAUDE.md` | 1,112 |
| `apps/api/src/emergency/CLAUDE.md` | 974 |
| `apps/web/src/app/player/CLAUDE.md` | 2,819 |
| `apps/player/CLAUDE.md` | 1,838 |
| `apps/web/public/templates/CLAUDE.md` | 2,062 |
| `apps/web/CLAUDE.md` | 2,859 |
| `docs/ENVIRONMENT.md` | 8,870 |
| `docs/DEPLOY.md` | 2,058 |
| `docs/ORIENTATION.md` | 864 |
| `docs/governance/AUDIT-SURFACE.md` | 2,792 |
| `docs/governance/AGENT-DISPATCH.md` | 2,042 |
| `docs/product/CONCIERGE.md` | 917 |
| `docs/design/TEMPLATE-DESIGN-WORKFLOW-LEGACY.md` | 770 |
| `docs/incidents/README.md` | 658 |
| 21 incident files `docs/incidents/YYYY-MM-DD-<slug>.md` | 3,784 |
| **everything that came out of the old file, in new files** (core + nested + documents + incidents, `AGENTS.md` excluded) | **36,286** |

The new total is larger than the old by 7,631 words: the core's own new text, scope headers and stubs, the six new audit sections (22–27), and the incident files with their index (headings, one-sentence restatements, and quotes of rules that stay in place).


## 2. Every heading of the old CLAUDE.md → where it went

| Old line | Old heading | New location(s) |
|---|---|---|
| 3 | `# EDU CMS — Developer Guide` | replaced by the core's own title (`CLAUDE.md`) |
| 5 | `## Project Mission` | `docs/ORIENTATION.md` |
| 13 | `## Technology Stack` | `docs/ORIENTATION.md` |
| 23 | `## Monorepo Layout` | `docs/ORIENTATION.md` |
| 46 | `## How to Run` | `docs/ORIENTATION.md` |
| 48 | `### Install & Setup` | `docs/ORIENTATION.md` |
| 55 | `### Development` | `docs/ORIENTATION.md` |
| 62 | `### Build & Run (Production)` | `docs/ORIENTATION.md` |
| 69 | `### Database Commands (from root)` | `packages/database/CLAUDE.md`; incident `2026-09-16-schema-change-without-migration.md` |
| 111 | `### Testing & Lint` | `docs/ORIENTATION.md` |
| 117 | `### API Scripts` | `docs/ORIENTATION.md` |
| 123 | `## Environment Variables` | `docs/ENVIRONMENT.md`; `apps/player/CLAUDE.md`; `apps/web/src/app/player/CLAUDE.md`; `packages/database/CLAUDE.md`; incident `2026-10-23-retired-signing-key.md` |
| 242 | `## Core Domain Models` | `packages/database/CLAUDE.md` |
| 259 | `### User Roles` | `packages/database/CLAUDE.md` |
| 266 | `## Emergency System (Load-Bearing)` | `apps/api/src/emergency/CLAUDE.md` |
| 270 | `### Controller Endpoints` | `apps/api/src/emergency/CLAUDE.md` |
| 286 | `### Key Safeguards` | `apps/api/src/emergency/CLAUDE.md` |
| 293 | `### WARNING: Emergency System Changes` | `apps/api/src/emergency/CLAUDE.md` |
| 296 | `## Player Reliability — non-negotiable (2026-08-30)` | `apps/web/src/app/player/CLAUDE.md`; `apps/player/CLAUDE.md`; `apps/api/src/emergency/CLAUDE.md`; incident `2026-09-26-4k-cache-fill.md`; incident `2026-09-24-4k-to-1080p-playback.md`; incident `2026-09-25-4k-field-follow-ups.md`; incident `2026-08-28-player-1-1-6-fleet-failure.md` |
| 585 | `## Frame-Locked Multi-Screen Sync (2026-07-28)` | `apps/web/src/app/player/CLAUDE.md`; `packages/database/CLAUDE.md` |
| 634 | `## Template System` | `apps/web/public/templates/CLAUDE.md` |
| 683 | `### EXTERNAL_HTML signage boards + click-to-edit shim (read before editing ANY board — 20…` | `apps/web/public/templates/CLAUDE.md`; incident `2026-06-07-uneditable-templates-shim.md` |
| 782 | `### System Presets` | `apps/web/public/templates/CLAUDE.md` |
| 788 | `### Zones & Coordinates` | `apps/web/public/templates/CLAUDE.md` |
| 794 | `### Widget Types (20+)` | `apps/web/public/templates/CLAUDE.md` |
| 803 | `### Adding a New Preset` | `apps/web/public/templates/CLAUDE.md` |
| 816 | `## Conventions` | `docs/ORIENTATION.md` |
| 826 | `## Cross-browser support — non-negotiable` | `apps/web/CLAUDE.md`; incident `2026-05-09-safari-minified-bridge.md`; incident `2026-06-08-favicon-removechild-crash.md` |
| 912 | `## Mobile performance standard — non-negotiable (2026-06-16)` | `apps/web/CLAUDE.md`; incident `2026-06-16-mobile-tap-lag.md` |
| 956 | `## Deploy reliability (Railway + Vercel)` | `docs/DEPLOY.md` |
| 993 | `## Backup & Rollback` | `docs/DEPLOY.md` |
| 1004 | `## Deploy Reliability — CI gates` | `docs/DEPLOY.md` |
| 1025 | `### Build failure modes we've seen, and how the CI catches them` | `docs/DEPLOY.md` |
| 1061 | `### Local preflight` | `docs/DEPLOY.md` |
| 1069 | `### Post-push: WATCH CI TO GREEN — do not declare "done" before it resolves (2026-05-31)` | `docs/DEPLOY.md`; incident `2026-05-31-jest-gate-green-locally-red-in-ci.md` |
| 1102 | `### Pre-commit hook (husky)` | `docs/DEPLOY.md` |
| 1112 | `### When the demo breaks despite all this` | `docs/DEPLOY.md` |
| 1120 | `### What never to do` | `docs/DEPLOY.md` |
| 1132 | `## Template Design Workflow` | `docs/design/TEMPLATE-DESIGN-WORKFLOW-LEGACY.md` |
| 1138 | `## Roadmap & Sprint Plan` | `docs/ORIENTATION.md` |
| 1149 | `## Standard Audit Surface — every audit MUST cover this list explicitly` | `docs/governance/AUDIT-SURFACE.md` |
| 1155 | `### 1. Real-time + signed pub/sub` | `docs/governance/AUDIT-SURFACE.md` |
| 1165 | `### 2. Storage + content pipeline` | `docs/governance/AUDIT-SURFACE.md` |
| 1173 | `### 3. AI providers — every entry point × every provider` | `docs/governance/AUDIT-SURFACE.md` |
| 1186 | `### 4. AI feature surfaces — every place AI does work` | `docs/governance/AUDIT-SURFACE.md` |
| 1200 | `### 5. AI-tool comparative scan` | `docs/governance/AUDIT-SURFACE.md` |
| 1213 | `### 6. Streaming integrations` | `docs/governance/AUDIT-SURFACE.md` |
| 1222 | `### 7. Sports score / data integrations (Sprint 13)` | `docs/governance/AUDIT-SURFACE.md` |
| 1232 | `### 8. POS / commerce integrations` | `docs/governance/AUDIT-SURFACE.md` |
| 1243 | `### 9. Communications integrations` | `docs/governance/AUDIT-SURFACE.md` |
| 1252 | `### 10. Auth + identity` | `docs/governance/AUDIT-SURFACE.md` |
| 1262 | `### 11. Billing + commerce` | `docs/governance/AUDIT-SURFACE.md` |
| 1272 | `### 12. Design import integrations` | `docs/governance/AUDIT-SURFACE.md` |
| 1280 | `### 13. Public alert integrations (V2)` | `docs/governance/AUDIT-SURFACE.md` |
| 1288 | `### 14. Multi-vertical surface` | `docs/governance/AUDIT-SURFACE.md` |
| 1298 | `### 15. Cross-browser + Chromium-83` | `docs/governance/AUDIT-SURFACE.md` |
| 1306 | `### 16. Forensic / audit coverage` | `docs/governance/AUDIT-SURFACE.md` |
| 1313 | `### 17. Operational + DX` | `docs/governance/AUDIT-SURFACE.md` |
| 1322 | `### 18. Accessibility + a11y` | `docs/governance/AUDIT-SURFACE.md` |
| 1330 | `### 19. Template + Widget Editability Standard` | `docs/governance/AUDIT-SURFACE.md` |
| 1346 | `### 20. Design + UX + Functionality lenses` | `docs/governance/AUDIT-SURFACE.md` |
| 1357 | `### 21. Verification Before Claim — discipline` | `docs/governance/AUDIT-SURFACE.md`; incident `2026-05-26-logo-bug-round-7.md` |
| 1369 | `### How to invoke this checklist` | `docs/governance/AUDIT-SURFACE.md` |
| 1376 | `## Agent Dispatch Protocol — parallel agents in isolated worktrees` | `docs/governance/AGENT-DISPATCH.md`; incident `2026-05-28-lost-agent-reports.md`; incident `2026-05-26-agent-contention.md` |
| 1429 | `### Pre-dispatch checklist (run EVERY time before spawning agents)` | `docs/governance/AGENT-DISPATCH.md` |
| 1461 | `### Mid-flight monitoring (agents running in background)` | `docs/governance/AGENT-DISPATCH.md` |
| 1475 | `### Merge cycle (when an agent reports complete)` | `docs/governance/AGENT-DISPATCH.md` |
| 1516 | `### Workspace hygiene — `pnpm hygiene` (2026-06-02)` | `docs/governance/AGENT-DISPATCH.md`; incident `2026-06-02-worktree-pileup.md` |
| 1532 | `### Things that look like "agents stomping me" but aren't` | `docs/governance/AGENT-DISPATCH.md` |
| 1539 | `### Anti-patterns that cause real contention (and DID cause the 2026-05-26 chaos)` | `docs/governance/AGENT-DISPATCH.md` |
| 1546 | `## AI Integration Concierge — vision` | `docs/product/CONCIERGE.md` |
| 1552 | `### Workstreams` | `docs/product/CONCIERGE.md` |
| 1568 | `### Economic Model (3 tiers)` | `docs/product/CONCIERGE.md` |
| 1582 | `## Design Imports = Template Feature (not a Setting)` | `docs/product/CONCIERGE.md` |
| 1592 | `## For AI Assistants` | `apps/web/CLAUDE.md`; incident `2026-05-19-tailwind-inset-utility.md`; incident `2026-05-13-inset-shorthand-136-widget-files.md`; incident `2026-07-03-inset-cssom-serialization.md`; `CHANGELOG.md`; `docs/ENVIRONMENT.md`; `docs/DEPLOY.md`; `docs/governance/AGENT-DISPATCH.md`; `packages/database/CLAUDE.md`; `apps/api/src/emergency/CLAUDE.md` |


**The ten items of the old "For AI Assistants" list:** 1, 2 and 6 → `docs/governance/AGENT-DISPATCH.md`; 3 → `apps/api/src/emergency/CLAUDE.md`; 4 and 7 → `docs/ENVIRONMENT.md`; 5 → `docs/DEPLOY.md` ("Repository visibility"); 8 → `packages/database/CLAUDE.md`; 9 and 10 → `apps/web/CLAUDE.md` (their numbers are kept, so "rule #10" in code comments still resolves).

**Player Reliability rules:** 1–8, 10, 12, 14, 16 and 17(a)–(e) stay in `apps/web/src/app/player/CLAUDE.md`; 9 (with the hardware gate), 13 and 15 → `apps/player/CLAUDE.md`; 11 and 17(f) → `apps/api/src/emergency/CLAUDE.md`; sync rule 7 (manifest content cache) → `packages/database/CLAUDE.md`. Each moved rule leaves a one-line numbered stub in the web-player file.

## 3. Judgment calls and conflicts — for the lead

1. **A new file nobody listed: `docs/ORIENTATION.md`.** Project Mission, Technology Stack, Monorepo Layout, How to Run (without Database Commands, which went to the database rulebook), Conventions and the Roadmap pointer had no destination in the brief and are not duplicates of the core's §1. They moved there verbatim. The alternative was appending them to `CONTRIBUTING.md`. `AGENTS.md`'s table lists the file.
2. **The core cites a file nobody was asked to create.** Core §12 said `docs/product/AI.md`. I pointed it at `docs/product/CONCIERGE.md` (it holds the three-tier AI economics); one word changed in the core. If you want an `AI.md`, say so.
3. **A contradiction between the core and the rule it summarises — core wording kept.** Core §2 says "Content *reads* go through `prisma.client` so the manifest cache invalidates". The rule it summarises (now in `packages/database/CLAUDE.md`, "The manifest content cache") says content *writes* MUST go through `prisma.client` (the invalidation hook fires on writes; raw-SQL edits show up on players only after the TTL). The core probably meant "writes".
4. **A tension, not a contradiction.** Core §9 says the player and widgets ship to Chromium 83 controllers (no `inset` shorthand, no flex `gap`), unconditionally; `apps/web/CLAUDE.md` (rule 10, kept verbatim) scopes the rule to code actually shipped to a Taurus LED controller and says LCD players and the dashboard have no such constraint. The pre-commit hook and `taurus-safety.yml` enforce it on all player and widget code regardless.
5. **The core promises "the 17 reliability rules in full" in the web-player file.** Rules 9, 11, 13, 15 and 17(f) are in the specialised files you named (APK, emergency), so the web-player file holds them as numbered one-line stubs. The text exists once.
6. **Sync rule 7 (manifest content cache) is in the database rulebook only.** The brief listed it for both the database and the web-player file; one full copy plus a numbered stub in the web-player file.
7. **Six environment rows were split at sentence boundaries** (`DATABASE_URL`, `PLAYER_LOOP_CONTINUOUS`, `PLAYER_LOOP_TWODECK`, `PLAYER_NATIVE_VIDEO`, `PLAYER_NATIVE_VIDEO_EXPERIMENTS`, `PLAYER_VENDOR_BACKLIGHT`): the variable, tokens, default and kill switch stay in `docs/ENVIRONMENT.md`; the behaviour sentences moved verbatim to the nested rulebook; each kept row ends "Behaviour: <file> (<heading>)". `PLAYER_NATIVE_VIDEO_EXPERIMENTS`'s first sentence still says "(last paragraph)" — that paragraph is now in `apps/player/CLAUDE.md`. Rows with long behaviour text and no designated nested home (for example `GATEWAY_SHARED_SECRET`, `SESSION_BFF_SECRET`, the customer-alert and fleet-alarm rows, `VIDEO_FASTSTART_REMUX_DISABLED`) stayed whole.
8. **`apps/web/CLAUDE.md` keeps `@AGENTS.md` as line 1.** The file existed with only that line; it imports `apps/web/AGENTS.md`, the Next.js agent-rules block that `next dev` maintains. The one-line scope header is line 3 instead of line 1.
9. **Editing outside the brief's list, all to keep pointers true:** the seven section-name pointers in `AGENTS.md`'s "rules an agent must not break"; the eight `CLAUDE.md:NNN` line pointers (six table cells) in `docs/governance/MECHANISMS.md` (the new guard fails on them); `docs/governance/AUTONOMY-REGISTER.md` and `FREEZE.md` (a path into the gitignored launch-week plan — backticks removed so it is no longer a path claim); two rows added to `docs/governance/README.md`; the "Keep it current" sentence in `CHANGELOG.md` (it told people to bump a footer that no longer exists). Every one is listed in section 5.
10. **Audit-surface counts changed with the six new sections:** "(1-21)", "21 rows", "all 21 sections" became 27, and "in CLAUDE.md" became "in docs/governance/AUDIT-SURFACE.md" in the two places that tell an auditor where the list is. The brief only named one "1-21".
11. **§21 of the audit surface lost its incident paragraph** (the "logo bug, round 7" story) to `docs/incidents/2026-05-26-logo-bug-round-7.md`, although the brief said "verbatim"; the brief also listed that incident for extraction. The operative text of §21 is untouched.
12. **Backup & Rollback in `docs/DEPLOY.md` is a two-line pointer**; the six bullets of the old section are not carried as text because `docs/BACKUP_AND_ROLLBACK.md` (rewritten in #208) already holds each of them (rollback by revert or redeploy, `db-backup.yml`, tag-then-push-one-tag, the tarball command without `.env`, recover one file, keep three tarballs). They appear in section 6 as the sentences not found.
13. **The legacy Template Design Workflow has two versions** because #208 had already collapsed the section: the pointer version first, then the original from the commit before #208 (`b66dc8f59^`), unchanged.
14. **Incident files** contain only sentences that were in the old file (extracted whole, or quoted from a rule that stays), plus headings and one-sentence restatements under "Root cause" where the old text gave the cause inline. No facts were added. Where a rule's story was a single clause inside a sentence (the `DATABASE_URL` pool-size story), the clause was cut and replaced by "incident: …".
15. **`apps/web/public/templates/CLAUDE.md` sits under Next's `public/`**, so Vercel serves it at `/templates/CLAUDE.md`. Harmless (the repository is public; no secret in it) and no board script reads non-`.html` files there, but you may prefer to move it.
16. **The guard's design choices** (all in the header of `scripts/check-rulebook.cjs`): "the tree" is `git ls-files -co --exclude-standard`, so a gitignored path is dead exactly as in CI; a partial path (`realtime/redis.service.ts`) passes if it is the tail of a tracked path; build output (`dist/`, `.next/`), `.env*` files, and mentions on or next to a line that says the path is deleted, not yet created, gitignored, private or on the lead's machine are tolerated (that is how `.railway/railway.ts`, `WidgetPalette.tsx (deleted…)` and the private-repo paths in `MECHANISMS.md` pass without edits); typed template counts are verified in **every** rule file, not only the templates rulebook (`537` also appears in the domain-model table). A known weakness: removing the backticks around a path defeats check (a).
17. **CI needs TypeScript for the preset count.** The workflow installs the lockfile's version (5.9.3) into a temp directory and sets `NODE_PATH`; the script itself has no dependency.
18. **The core's table promises topics the nested files have no text for.** The core says `apps/api/src/emergency/CLAUDE.md` covers "routes, drills, paint proof, the native alert watch", `packages/database/CLAUDE.md` "the guard, seeds" and `apps/player/CLAUDE.md` "OTA rings". The old rulebook had no text on drills, paint proof, the native alert watch, the destructive-command guard, seeds or update rings beyond what the core's own sections 2, 5 and 7 now say, so none was invented. Those sections are still to be written (and the destructive-command guard, `scripts/guard-destructive-db.cjs`, is a good first one).
19. **Not touched, listed in section 9:** `CONTRIBUTING.md`, `OWNER-RULES.md`, `FIRST-RESPONSE.md` and about 25 other documents still name sections of the old `CLAUDE.md` ("`CLAUDE.md` → Project Mission", "rule #9"); 205 code, workflow and script files carry comments such as "CLAUDE.md rule #10" (the item numbers 9 and 10 were kept, so those two still resolve).

## 4. Dead paths and path fixes

| Where | What | Action |
|---|---|---|
| core §12 | `docs/product/AI.md` — the file does not exist and was not in the brief | repointed to `docs/product/CONCIERGE.md` |
| `docs/governance/AUTONOMY-REGISTER.md`, `FREEZE.md` | `docs/research/2026-10-24-launch-week/00-PLAN.md` — gitignored, on the lead's machine only | backticks removed (text unchanged); the path is **gone for every other model** — decide whether to delete the mention |
| `docs/governance/MECHANISMS.md` | eight `CLAUDE.md:NNN` line pointers in six table cells, already stale before this change | repointed to the new files (no line numbers) |
| old text (moved) | `.railway/railway.ts` and `.railway/` (the text says no `.railway/` exists yet), `dist/index.js`, `.next/prerender-manifest.json`, `apps/api/.env`, `apps/web/.env.local`, `WidgetPalette.tsx` ("deleted 2026-05-13") | not edited; tolerated by the guard's documented rules |
| old text (moved to the legacy doc) | `scratch/design/`, `scratch/` | not scanned: `docs/design/` is not a rule-file directory |

## 5. Edits that are not pure moves

| File | Kind | Before | After |
|---|---|---|---|
| `packages/database/CLAUDE.md` | incident clause replaced | at the Nano default of 15, 24 of 26 deploys (09-16 → 09-22) refused the new container's connections (`EMAXCONNSESSION … pool_size: 15`) and ~140 mani… | incident: `docs/incidents/2026-09-22-deploy-overlap-500s.md`. |
| `apps/web/src/app/player/CLAUDE.md` | incident narrative replaced (rule 16) | (2026-09-24 4K-to-1080p playback incident). A 1080p Android player received a 4K H.264 asset, briefly showed Content Unavailable, then reported sever… | Incident: `docs/incidents/2026-09-24-4k-to-1080p-playback.md`. |
| `apps/web/src/app/player/CLAUDE.md` | incident narrative replaced (rule 16 field follow-up) | an optimized 3840×2160 H.264 file still reported severe drops and buffering while the device cache row said 0 files. The 4K manifest correctly select… | Incident: `docs/incidents/2026-09-25-4k-field-follow-ups.md`. |
| `apps/web/src/app/player/CLAUDE.md` | incident narrative replaced (rule 17) | (2026-09-26, the 4K cache-fill incident). The customer's 4K screen reported 0 cached files for hours and dropped 121 of 264 frames streaming its 141 … | Incident: `docs/incidents/2026-09-26-4k-cache-fill.md`. |
| `docs/ENVIRONMENT.md` | row split (behaviour moved) | PLAYER_LOOP_CONTINUOUS / PLAYER_LOOP_TWODECK behaviour sentences | pointer to apps/web/src/app/player/CLAUDE.md appended to each row |
| `docs/ENVIRONMENT.md` | row split (behaviour moved) | PLAYER_NATIVE_VIDEO / PLAYER_NATIVE_VIDEO_EXPERIMENTS / PLAYER_VENDOR_BACKLIGHT behaviour sentences | pointer to apps/player/CLAUDE.md appended to each row |
| `apps/web/CLAUDE.md` | incident narrative replaced (cross-browser) | **Why this matters here.** On 2026-05-09 we shipped a 2-month-old "works in Chrome, crashes in Safari" bug — every holiday template's inline minified… | **Why this matters here.** Incident: `docs/incidents/2026-05-09-safari-minified-bridge.md`. |
| `apps/web/CLAUDE.md` | incident narrative replaced (cross-browser rule 6) | This was the multi-day "every menu click needs two clicks / it just reloads" bug (2026-06-08, `BrandStyleInjector` deleting the Next-emitted favicon … | Incident: `docs/incidents/2026-06-08-favicon-removechild-crash.md`. |
| `apps/web/CLAUDE.md` | incident narrative replaced (cross-browser rule 7) | On 2026-06-08 that one row (Safari 27, `/assets`, 0 console errors, all data loaded) is what finally cracked a bug I'd chased ~7 times in Chrome. | Incident: `docs/incidents/2026-06-08-favicon-removechild-crash.md`. |
| `apps/web/CLAUDE.md` | incident narrative replaced (mobile performance) | On 2026-06-16 the mobile bottom-nav + "More" sheet had major tap lag — and since the "More" sheet is a pure local-`useState` toggle (no fetch, no nav… | Incident: `docs/incidents/2026-06-16-mobile-tap-lag.md`. |
| `apps/web/CLAUDE.md` | incident narrative replaced (inset 2026-05-13) | 2026-05-13: 136 widget files (68 inline-style + 98 CSS-rule) had `inset: 0` and the operator's Rainbow Animated Portrait template was unrenderable on… | Incident: `docs/incidents/2026-05-13-inset-shorthand-136-widget-files.md`. |
| `apps/web/CLAUDE.md` | incident narrative replaced (inset 2026-05-19) | 2026-05-19: the SAME bug, second variant. The 2026-05-13 sweep only searched for the literal CSS property `inset: 0` — it never caught the Tailwind *… | Incident: `docs/incidents/2026-05-19-tailwind-inset-utility.md`. |
| `apps/web/CLAUDE.md` | incident narrative replaced (inset 2026-07-03) | Confirmed live in `ScorebugTicker`'s "scrolling reel" (`apps/web/src/components/ widgets/themes/scorebug.tsx`), three `Celebrations*Widgets.tsx` symm… | Incident: `docs/incidents/2026-07-03-inset-cssom-serialization.md`. |
| `docs/ENVIRONMENT.md` | incident narrative replaced (owner fleet alarms row) | Born from the 2026-10-23 retired-key outage: a device-secret rotation finished with an API restart, 14 paired screens at 5 organisations went dark a … | Incident: `docs/incidents/2026-10-23-retired-signing-key.md`. |
| `docs/ENVIRONMENT.md` | cross-reference to a moved item | (see #5) | (see "Repository visibility" in `docs/DEPLOY.md`) |
| `docs/DEPLOY.md` | incident link appended | They detect the build failures we hit in production debugging on 2026-04-19. | … Incident: `docs/incidents/2026-04-19-alpine-native-build-failures.md`. |
| `docs/DEPLOY.md` | incident narrative replaced (post-push) | On 2026-05-31 the lead flipped the API Jest gate to blocking off a local-green run and turned Deploy Reliability red on every subsequent push — the *… | Incident: `docs/incidents/2026-05-31-jest-gate-green-locally-red-in-ci.md`. |
| `docs/ORIENTATION.md` | cross-reference | `AGENTS.md` (imported at the top of this file | `AGENTS.md` (imported at the top of `CLAUDE.md` |
| `docs/ORIENTATION.md` | relative link target (file moved into docs/) | (docs/roadmap/ROADMAP.md) | (roadmap/ROADMAP.md) |
| `docs/governance/AUDIT-SURFACE.md` | location of the list | Future audits should grep `## Standard Audit Surface` in CLAUDE.md | Future audits should grep `## Standard Audit Surface` in `docs/governance/AUDIT-SURFACE.md` |
| `docs/governance/AUDIT-SURFACE.md` | section count 21 -> 27 (six sections added) | section (1-21) … × 21 rows | section (1-27) … × 27 rows |
| `docs/governance/AUDIT-SURFACE.md` | incident narrative replaced (§21) | The "logo bug, round 7" from 2026-05-26 was the lesson: I told the user "fixed" six times in a row without verifying. The cost: trust burned, time wa… | Incident: `docs/incidents/2026-05-26-logo-bug-round-7.md`. |
| `docs/governance/AUDIT-SURFACE.md` | location + section count in the invocation prompt | checklist in CLAUDE.md … (1-21) … all 21 sections | checklist in docs/governance/AUDIT-SURFACE.md … (1-27) … all 27 sections |
| `docs/governance/AGENT-DISPATCH.md` | incident sentence replaced (rule 1) | The Integration Concierge service files were wiped twice from contention before this rule landed. | Incident: `docs/incidents/2026-05-26-agent-contention.md`. |
| `docs/governance/AGENT-DISPATCH.md` | incident sentence replaced (rule 1b) | A 5-agent read-only mobile-UX audit fleet dispatched WITHOUT worktrees dirtied the main tree's `next.config.ts` + `tsconfig.json` and left orphaned `… | Incident: `docs/incidents/2026-05-26-agent-contention.md`. |
| `docs/governance/AGENT-DISPATCH.md` | incident narrative replaced (rule 8) | 2026-05-28: Greg dispatched 4 research agents on 2026-05-27, all 4 returned full reports (~11,800 words total), I never persisted them, context compa… | Incident: `docs/incidents/2026-05-28-lost-agent-reports.md`. |
| `docs/governance/AGENT-DISPATCH.md` | incident sentence replaced (anti-patterns) | The IntegrationDiscoveryService was wiped TWICE this way before the rule landed. | Incident: `docs/incidents/2026-05-26-agent-contention.md`. |
| `docs/governance/AGENT-DISPATCH.md` | incident narrative replaced (workspace hygiene) | The 83 GB worktree pileup wasn't the only accumulating-cruft failure; a process audit that day also found a **408 MB never-gc'd `.git`** (210 MB of g… | Incident: `docs/incidents/2026-06-02-worktree-pileup.md`. |
| `CLAUDE.md` | path pointer fixed (the draft names a file nobody was assigned to create) | Detail: `docs/product/AI.md`. | Detail: `docs/product/CONCIERGE.md`. |
| `AGENTS.md` | pointer to the new location | (`CLAUDE.md` → Environment Variables, the `DATABASE_URL` row.) | (`docs/ENVIRONMENT.md`, the `DATABASE_URL` row; the measured reasoning is in `packages/database/CLAUDE.md`.) |
| `AGENTS.md` | pointer to the new location | (`CLAUDE.md` → Emergency System.) | (`apps/api/src/emergency/CLAUDE.md`.) |
| `AGENTS.md` | pointer to the new location | (`CLAUDE.md` → Standard Audit Surface §21; Deploy Reliability → "Post-push".) | (`docs/governance/AUDIT-SURFACE.md` §21; `docs/DEPLOY.md` → "Post-push".) |
| `AGENTS.md` | pointer to the new location | (`CLAUDE.md` → For AI Assistants #10.) | (`apps/web/CLAUDE.md`, the `inset` rule.) |
| `AGENTS.md` | pointer to the new location | (`CLAUDE.md` → Agent Dispatch Protocol.) | (`docs/governance/AGENT-DISPATCH.md`.) |
| `AGENTS.md` | pointer to the new location | (`CLAUDE.md` → Database Commands.) | (`packages/database/CLAUDE.md`.) |
| `AGENTS.md` | pointer to the new location | (`CLAUDE.md` → Player Reliability rule 9.) | (`apps/player/CLAUDE.md`, rule 9.) |
| `CHANGELOG.md` | instruction updated (the footer stamp is gone) | When you change `CLAUDE.md`, add an entry here and bump the date in its two-line footer. | When you change `CLAUDE.md`, a nested `CLAUDE.md` or one of the rulebook documents, add an entry here — `CLAUDE.md` carries no footer stamp since 202… |
| `docs/governance/MECHANISMS.md` | line pointer / unreachable path repointed | `CLAUDE.md:3-9` (Project Mission; Ambition line 9) | `docs/ORIENTATION.md` (Project Mission; its Ambition line) |
| `docs/governance/MECHANISMS.md` | line pointer / unreachable path repointed | `CLAUDE.md:9`; audit checklists §5 competitive scan (`CLAUDE.md:1235`) and §20 D/UX/F + 30-second UX gate (`CLAUDE.md:1381-1390`) | `docs/ORIENTATION.md` (Ambition); audit checklists §5 competitive scan and §20 D/UX/F + 30-second UX gate (`docs/governance/AUDIT-SURFACE.md`) |
| `docs/governance/MECHANISMS.md` | line pointer / unreachable path repointed | `CLAUDE.md:1462` pre-dispatch checklist | `docs/governance/AGENT-DISPATCH.md` pre-dispatch checklist |
| `docs/governance/MECHANISMS.md` | line pointer / unreachable path repointed | (`CLAUDE.md:1392`, `AGENTS.md` rule 5) | (`docs/governance/AUDIT-SURFACE.md` §21, `AGENTS.md` rule 5) |
| `docs/governance/MECHANISMS.md` | line pointer / unreachable path repointed | `CLAUDE.md:1899` "keep this stamp current" (followed: the stamp says 10-25, matching the last CLAUDE.md commit `d1936fea`) | `CHANGELOG.md` "Keep it current" (it replaced the `CLAUDE.md` footer stamp on 2026-11-01; the stamp was followed: it said 10-25, matching the last CL… |
| `docs/governance/MECHANISMS.md` | line pointer / unreachable path repointed | `CLAUDE.md:9` (product end state only) | `docs/ORIENTATION.md` (Ambition; product end state only) |
| `docs/governance/AUTONOMY-REGISTER.md` | line pointer / unreachable path repointed | (`docs/research/2026-10-24-launch-week/00-PLAN.md`) | (docs/research/2026-10-24-launch-week/00-PLAN.md) |
| `docs/governance/FREEZE.md` | line pointer / unreachable path repointed | per `docs/research/2026-10-24-launch-week/00-PLAN.md` | per docs/research/2026-10-24-launch-week/00-PLAN.md |
| `docs/governance/README.md` | line pointer / unreachable path repointed | \| `decisions/` \| | \| `AUDIT-SURFACE.md` \| The Standard Audit Surface: the 27-section domain map every audit of "the app" must cover (moved out of `CLAUDE.md` 2026-11-01… |


## 6. Paragraphs not carried as text

None was dropped as an exact duplicate of another paragraph — the old file had none. These are the old paragraphs that are not found verbatim in the new tree, each with its reason (the list is generated; section 7 explains the method):

| Old line | Not carried | Why | Where the substance lives |
|---|---|---|---|
| 1 | `@AGENTS.md` | not dropped — kept as line 1 of the new core | `CLAUDE.md` |
| 3 | `# EDU CMS — Developer Guide` | the new core has its own title | `CLAUDE.md` |
| 993–1002 | the six bullets of "Backup & Rollback" | replaced by the two-line pointer, as instructed | `docs/BACKUP_AND_ROLLBACK.md` (sections A–D, "Future backups", "The database backup that exists today") |
| 1869–1872 | the footer stamp and its instruction | stamp deleted; the instruction is superseded | `CHANGELOG.md` (the 2026-11-01 entry and its "Keep it current" paragraph) |

## 7. Nothing lost — the proof

- **First sentence of every old paragraph of at least 12 words:** 321 checked, **307 found, 14 not found** (each explained in 7a).
- **Every sentence of at least 4 words:** 1033 checked, **1012 found, 21 not found** (each explained in 7b; every one is a logged edit in section 5 or one of the four rows of section 6).
- **Fenced code blocks, whole:** 20 checked, **20 found, 0 not found.**
- **Old headings whose title text is absent from the new tree:** 1 (L3 `# EDU CMS — Developer Guide` — replaced by the core's title).
- **Unexplained misses:** 0.

**Method.** A throwaway script split the old file into paragraphs (table rows, list items and fenced code blocks counted separately), took the first sentence of every paragraph of at least 12 words and searched for it, whitespace-normalised, in the new tree: `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md`, the six nested rulebooks, and `docs/ENVIRONMENT.md`, `DEPLOY.md`, `ORIENTATION.md`, `BACKUP_AND_ROLLBACK.md`, `docs/governance/*.md`, `docs/incidents/*.md`, `docs/product/*.md` and the legacy workflow. It then repeated the search for **every** sentence of four words or more and for every fenced code block as a whole. A sentence that is cut at an extraction boundary reads as not found; those are the edits in section 5.

### 7a. First sentences not found

| Old line | Reason | Sentence |
|---|---|---|
| 9 | edit: cross-reference (docs/ORIENTATION.md) | **READ FIRST:** `AGENTS.md` (imported at the top of this file — the North Star, the precedence of texts and the hard stops), then `docs/governance/` … |
| 417 | straddles an extraction boundary: the parenthetical incident label moved to the incident file | **Screen-sized publication is a staged delivery, not a database boolean** (2026-09-24 4K-to-1080p playback incident). |
| 514 | straddles an extraction boundary: the parenthetical incident label moved to the incident file | **A big file downloads WHOLE, in short verified resumable steps, and only THEN plays — never streamed from origin, never a lower-resolution stand-in*… |
| 996 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | **Roll back a bad change:** revert the PR (a new PR; the Lead merges it) or redeploy the previous build from Railway / Vercel. |
| 997 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | **The database** is backed up by `.github/workflows/db-backup.yml` (nightly, AES-256-encrypted `pg_dump`, 30-day artifacts; `node scripts/ops-sweep.m… |
| 998 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | **Before risky changes:** `git tag backup/pre-<topic>-$(date +%Y%m%d-%H%M%S)` and push that one tag (`git push origin <tag>` — never `--tags`, which … |
| 999 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | **Tarball backup** (a local working-tree snapshot; on macOS `tar` the options go BEFORE the path, and it must never contain secrets): `tar -czf edu-c… |
| 1000 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | **Recover one file:** `git checkout <ref> -- <path>`, or extract it from a tarball and copy it out. |
| 1002 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | Keep 3 most recent tarballs; older ones can be deleted (git history is safe). |
| 1348 | edit: section count 21 -> 27 and the new location of the list (docs/governance/AUDIT-SURFACE.md) | Every "audit the entire app" pass MUST score every Standard Audit Surface section (1-21) across three lenses: |
| 1353 | edit: section count 21 -> 27 and the new location of the list (docs/governance/AUDIT-SURFACE.md) | The audit report's page 1 coverage table has 3 columns (D / UX / F) × 21 rows. |
| 1371 | edit: section count 21 -> 27 and the new location of the list (docs/governance/AUDIT-SURFACE.md) | Every audit prompt sent to an agent OR run interactively MUST start with: > "Use the Standard Audit Surface checklist in CLAUDE.md as your domain map. |
| 1374 | edit: section count 21 -> 27 and the new location of the list (docs/governance/AUDIT-SURFACE.md) | The audit report's first section MUST be a table showing all 21 sections × 3 lenses and their coverage status. |
| 1871 | footer stamp deleted (history is CHANGELOG.md) | **Last Updated:** 2026-11-01 History in `CHANGELOG.md` — add an entry there, and bump this date, whenever you change this file. |


### 7b. Any sentence not found

| Old line | Reason | Sentence |
|---|---|---|
| 9 | edit: cross-reference (docs/ORIENTATION.md) | **READ FIRST:** `AGENTS.md` (imported at the top of this file — the North Star, the precedence of texts and the hard stops), then `docs/governance/` … |
| 129 | edit: incident clause replaced (packages/database/CLAUDE.md) | **Supavisor's Pool Size (Supabase → Database → Settings → Connection pooling) is 24 since 2026-09-22 and must stay ≥ 2 × replicas × `connection_limit… |
| 417 | straddles an extraction boundary: the parenthetical incident label moved to the incident file | **Screen-sized publication is a staged delivery, not a database boolean** (2026-09-24 4K-to-1080p playback incident). |
| 514 | straddles an extraction boundary: the parenthetical incident label moved to the incident file | **A big file downloads WHOLE, in short verified resumable steps, and only THEN plays — never streamed from origin, never a lower-resolution stand-in*… |
| 996 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | **Roll back a bad change:** revert the PR (a new PR; the Lead merges it) or redeploy the previous build from Railway / Vercel. |
| 996 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | Never `git reset --hard` or force-push `master`: the ruleset forbids non-fast-forward pushes (admin bypass aside) and the standard forbids pushing to… |
| 996 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | A backup tag is for comparison (`git diff <tag>..master`), not a way to move master. |
| 997 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | **The database** is backed up by `.github/workflows/db-backup.yml` (nightly, AES-256-encrypted `pg_dump`, 30-day artifacts; `node scripts/ops-sweep.m… |
| 997 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | No restore drill is recorded or automated — a GAP (`docs/governance/MECHANISMS.md`, row #29): an untested backup is a hope, not a plan. |
| 998 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | **Before risky changes:** `git tag backup/pre-<topic>-$(date +%Y%m%d-%H%M%S)` and push that one tag (`git push origin <tag>` — never `--tags`, which … |
| 999 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | **Tarball backup** (a local working-tree snapshot; on macOS `tar` the options go BEFORE the path, and it must never contain secrets): `tar -czf edu-c… |
| 1000 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | **Recover one file:** `git checkout <ref> -- <path>`, or extract it from a tarball and copy it out. |
| 1002 | Backup & Rollback summary replaced by the two-line pointer (docs/BACKUP_AND_ROLLBACK.md carries the equivalent) | Keep 3 most recent tarballs; older ones can be deleted (git history is safe). |
| 1153 | edit: location of the list (docs/governance/AUDIT-SURFACE.md) | Future audits should grep `## Standard Audit Surface` in CLAUDE.md and check every bullet. |
| 1348 | edit: section count 21 -> 27 and the new location of the list (docs/governance/AUDIT-SURFACE.md) | Every "audit the entire app" pass MUST score every Standard Audit Surface section (1-21) across three lenses: |
| 1353 | edit: section count 21 -> 27 and the new location of the list (docs/governance/AUDIT-SURFACE.md) | The audit report's page 1 coverage table has 3 columns (D / UX / F) × 21 rows. |
| 1371 | edit: section count 21 -> 27 and the new location of the list (docs/governance/AUDIT-SURFACE.md) | Every audit prompt sent to an agent OR run interactively MUST start with: > "Use the Standard Audit Surface checklist in CLAUDE.md as your domain map. |
| 1371 | edit: section count 21 -> 27 and the new location of the list (docs/governance/AUDIT-SURFACE.md) | For every numbered section (1-21), report covered/N-A/deferred across the Design/UX/Functionality lenses. |
| 1374 | edit: section count 21 -> 27 and the new location of the list (docs/governance/AUDIT-SURFACE.md) | The audit report's first section MUST be a table showing all 21 sections × 3 lenses and their coverage status. |
| 1600 | edit: cross-reference to a moved item (docs/ENVIRONMENT.md) | Treat every change as world-readable regardless of repo visibility (see #5). |
| 1871 | footer stamp deleted (history is CHANGELOG.md) | **Last Updated:** 2026-11-01 History in `CHANGELOG.md` — add an entry there, and bump this date, whenever you change this file. |


### 7c. Nothing invented (the reverse check)

The same idea in the other direction: every line of the moved files (nested rulebooks and documents, not the core, the incidents or the map) must be old text, text from the original pre-#208 workflow section, hand-written scope/stub/pointer text, or an edit from section 5.

1,584 lines of the 13 moved files were checked; **11 sentences** are not old text, hand-written scope/stub/pointer text or one of the known inserts. Every one is a logged edit in section 5:

| File:line | Sentence |
|---|---|
| `packages/database/CLAUDE.md:47` | **Supavisor's Pool Size (Supabase → Database → Settings → Connection pooling) is 24 since 2026-09-22 and must stay ≥ 2 × replicas × `connection_limit` + spare*… |
| `apps/web/src/app/player/CLAUDE.md:142` | Field follow-up (2026-09-25, 4K Android screen): The web player's playlist |
| `docs/ENVIRONMENT.md:11` | Reasoning, measurements and the Supavisor pool sizing (`connection_limit` 10, pool size 24): `packages/database/CLAUDE.md`. \| `postgresql://user:pass@host:5432… |
| `docs/ENVIRONMENT.md:85` | Treat every change as world-readable regardless of repo visibility (see "Repository visibility" in `docs/DEPLOY.md`). |
| `docs/ORIENTATION.md:9` | > **READ FIRST:** `AGENTS.md` (imported at the top of `CLAUDE.md` — the North Star, the precedence of texts and the hard stops), then `docs/governance/` (the a… |
| `docs/governance/AUDIT-SURFACE.md:9` | Future audits should grep `## Standard Audit Surface` in `docs/governance/AUDIT-SURFACE.md` and check every bullet. |
| `docs/governance/AUDIT-SURFACE.md:204` | Every "audit the entire app" pass MUST score every Standard Audit Surface section (1-27) across three lenses: |
| `docs/governance/AUDIT-SURFACE.md:209` | The audit report's page 1 coverage table has 3 columns (D / UX / F) × 27 rows. |
| `docs/governance/AUDIT-SURFACE.md:275` | > "Use the Standard Audit Surface checklist in docs/governance/AUDIT-SURFACE.md as your domain map. |
| `docs/governance/AUDIT-SURFACE.md:275` | For every numbered section (1-27), report covered/N-A/deferred across the Design/UX/Functionality lenses. |
| `docs/governance/AUDIT-SURFACE.md:277` | The audit report's first section MUST be a table showing all 27 sections × 3 lenses and their coverage status. |


## 8. The guard's output

```
$ node scripts/check-rulebook.cjs --self-test
SELF-TEST PASS - the checker reports a dead path, a path:line pointer, a prose line pointer and an oversize CLAUDE.md, stale template counts, and passes a clean fixture
(exit 0)

$ node scripts/check-rulebook.cjs
rulebook check - root: <repo>
  rule files scanned: 41
  derived: presets=537 boards=330 shim=V16
  derived per export: BAR_TEMPLATE_PRESETS=6 DIRECTORY_TEMPLATE_PRESETS=32 FITNESS_TEMPLATE_PRESETS=25 GAP_TEMPLATE_PRESETS=8 HOMEBUILDER_TEMPLATE_PRESETS=14 RESTAURANT_TEMPLATE_PRESETS=21 RETAIL_TEMPLATE_PRESETS=8 SPORTS_TEMPLATE_PRESETS=44 SYSTEM_TEMPLATE_PRESETS=425 TOUCH_PROPERTY_TEMPLATE_PRESETS=12 WORSHIP_TEMPLATE_PRESETS=8
  AGENTS.md: 1438 words (limit 1800)
  CLAUDE.md: 1867 words (limit 3000)
  declared (apps/web/public/templates/CLAUDE.md): presets=537 boards=330 shim=V16
  tolerated mentions of paths that the text itself says are gone, not yet created or outside this repo: 5
PASS - no offences
(exit 0)
```

## 9. Pointers elsewhere that still name the old `CLAUDE.md` (not edited)

Section-name pointers ("`CLAUDE.md` → Project Mission", "rule #9", "§21") in documents outside this change. They still find their target by name, because the moved text kept its headings and item numbers, but they name the wrong file.

| Document | References |
|---|---|
| `CONTRIBUTING.md` | 5 — e.g. (CLAUDE.md → Standard Audit Surface §21.) |
| `apps/api/README.md` | 4 — e.g. toolchain argon2 needs — see CLAUDE.md "Deploy Reliability" for the build |
| `docs/spec/INCIDENT_RESPONSE.md` | 4 — e.g. recovery lives in CLAUDE.md "Deploy reliability". This runbook is the |
| `docs/frontend/DESIGN_SYSTEM_RULES.md` | 3 — e.g. > `backdrop-filter`, no `:has()` / container queries / `oklch()`. See CLAUDE.md |
| `docs/spec/TEST_STRATEGY.md` | 3 — e.g. \| `taurus-safety.yml` \| Scans player/widget paths for Chromium-83 landmines (`inset:0`/`inset-*`, flex `gap`,… |
| `README.md` | 2 — e.g. Run one side alone with `pnpm dev:api` / `pnpm dev:web`. See [`CLAUDE.md` → How to Run](./CLAUDE.md) for the … |
| `apps/web/README.md` | 2 — e.g. The full rule set (rule #9 render-tree, rule #10 Taurus CSS) is in CLAUDE.md. |
| `docs/APK_TESTING.md` | 2 — e.g. see CLAUDE.md "Player Reliability", rule 9. |
| `docs/SLO_AND_ONCALL.md` | 2 — e.g. \| **Emergency-delivery latency** (T0) \| Trigger → online player renders the alert in **< 2 s** p95 (WS path);… |
| `docs/governance/FIRST-RESPONSE.md` | 2 — e.g. 1. **Product mission** — `CLAUDE.md` → Project Mission; `APP-PROFILE.md`. |
| `docs/template-finalization/PROGRESS.md` | 2 — e.g. ## The loop (one template at a time — NO batching, per CLAUDE.md) |
| `design-incoming/README.md` | 1 — e.g. instead of `inset`, per CLAUDE.md rule #10.) |
| `docs/EP6N_HARDWARE_EVAL.md` | 1 — e.g. Not in the codebase yet; mentioned as god-tier in CLAUDE.md |
| `docs/FABLE-HANDOFF.md` | 1 — e.g. domain fence + ground rules (CLAUDE.md rule numbers) + required checks + |
| `docs/SECRET-ROTATION.md` | 1 — e.g. \| Provider keys (`RESEND_API_KEY`, `ANTHROPIC_API_KEY`, `PEXELS_API_KEY`, `GOOGLE_MAPS_API_KEY`, POS `*_CLIEN… |
| `docs/design/NATIVE-FIRST-ONE-STORE.md` | 1 — e.g. \| **Emergency-path changes** (the watch runs while the lease is absent; D3 if chosen) \| — \| Explicit sign-off… |
| `docs/design/proposals/2026-09-11-widget-flagships/AUDIT.md` | 1 — e.g. Use the Standard Audit Surface checklist in CLAUDE.md as the domain map. `S` below means source/requirements … |
| `docs/design/proposals/2026-09-13-template-areas-audit/README.md` | 1 — e.g. Use the Standard Audit Surface checklist in CLAUDE.md as the domain map. Scope is the eight mounted builder p… |
| `docs/governance/OWNER-RULES.md` | 1 — e.g. \| standing \| Verify CI green before telling the owner to test; check the actual render before editing UI. \| g… |
| `docs/handoffs/2026-10-10-template-quality-refresh.md` | 1 — e.g. Scope: a full template-library inventory and visual baseline, followed by a verified first release batch. Thi… |
| `docs/handoffs/2026-10-19-codex-quick-wins.md` | 1 — e.g. 4. **Verification before claim** (CLAUDE.md §21): for any UI change, load the rendered page |
| `docs/handoffs/2026-10-31-foundry-standard/01-design-brief.md` | 1 — e.g. - Handoff: read order (AGENTS → North Star → CLAUDE.md → governance → latest handoff), run the |
| `docs/roadmap/ROADMAP.md` | 1 — e.g. (CLAUDE.md rule #10 — no `inset` shorthand, no flex `gap`). |
| `docs/spec/RBAC_MATRIX.md` | 1 — e.g. >   `canTriggerPanic` capability flag (CLAUDE.md emergency rules). |
| `docs/spec/THREAT_MODEL.md` | 1 — e.g. \| Unauthorized delegated panic trigger \| Critical \| `@AllowPanicBypass` decorator gates who may override the … |
| `packages/signage-design/README.md` | 1 — e.g. from the % geometry — Taurus-safe (CLAUDE.md rule #10). |

Plus 205 code, workflow and script files (266 lines) whose comments cite "CLAUDE.md rule #N" or a section by name.


Also: `docs/governance/OWNER-RULES.md` is the owner's file and was not touched; two of its mechanism cells name `CLAUDE.md` rows and `CLAUDE.md` §21.
