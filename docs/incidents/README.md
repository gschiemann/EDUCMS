# Incidents

One file per incident whose story used to sit inside a rule. The rule keeps its operative sentences (what to do, what never to do) and ends with "Incident: `docs/incidents/<file>`"; the story, the cause and the evidence live here. Each file has the sections What happened / Root cause / The rule it produced / Evidence. History cites commits, never lines (`scripts/check-rulebook.cjs` enforces it). The text was extracted verbatim from the old single-file `CLAUDE.md` on 2026-11-01; nothing was added except the headings, the pointers and, under Root cause, a one-sentence restatement where the old text gave the cause inline.

| Date | Incident | In one line | The rule it produced |
|---|---|---|---|
| 2026-04-19 | [alpine-native-build-failures](2026-04-19-alpine-native-build-failures.md) | Production builds failed: native modules would not compile on Alpine, plus four other build-time traps. | `docs/DEPLOY.md` — build failure modes and what never to do |
| 2026-05-09 | [safari-minified-bridge](2026-05-09-safari-minified-bridge.md) | A bridge script that Chromium tolerated crashed in WebKit and broke holiday-template editing in Safari for months. | `apps/web/CLAUDE.md` — cross-browser rules |
| 2026-05-13 | [inset-shorthand-136-widget-files](2026-05-13-inset-shorthand-136-widget-files.md) | 136 widget files used the CSS `inset` shorthand and rendered nothing on Chromium 83. | `apps/web/CLAUDE.md` — the `inset` rule |
| 2026-05-19 | [tailwind-inset-utility](2026-05-19-tailwind-inset-utility.md) | The same bug returned through Tailwind `inset-*` classes; 391 classes in 44 files. | `apps/web/CLAUDE.md` — the `inset` rule |
| 2026-05-26 | [agent-contention](2026-05-26-agent-contention.md) | Parallel agents sharing one working tree wiped each other's files. | `docs/governance/AGENT-DISPATCH.md` — worktree isolation |
| 2026-05-26 | [logo-bug-round-7](2026-05-26-logo-bug-round-7.md) | A fix was reported as done six times without being verified. | `docs/governance/AUDIT-SURFACE.md` §21 — verification before claim |
| 2026-05-28 | [lost-agent-reports](2026-05-28-lost-agent-reports.md) | Four agents' reports were never persisted and vanished when the context compacted. | `docs/governance/AGENT-DISPATCH.md` rule 8 — persist agent work |
| 2026-05-31 | [jest-gate-green-locally-red-in-ci](2026-05-31-jest-gate-green-locally-red-in-ci.md) | A test gate flipped to blocking on a local-green run turned CI red on every push. | `docs/DEPLOY.md` — watch CI to green |
| 2026-06-02 | [worktree-pileup](2026-06-02-worktree-pileup.md) | 154 leftover agent worktrees (83 GB) made git slow and erroring. | `docs/governance/AGENT-DISPATCH.md` — standing rule and workspace hygiene |
| 2026-06-07 | [uneditable-templates-shim](2026-06-07-uneditable-templates-shim.md) | A board left on an old apply-only shim could not be edited by click. | `apps/web/public/templates/CLAUDE.md` — the redesign invariant |
| 2026-06-08 | [favicon-removechild-crash](2026-06-08-favicon-removechild-crash.md) | Removing a React-owned node crashed client navigation in Safari. | `apps/web/CLAUDE.md` — cross-browser rules 6 and 7 |
| 2026-06-16 | [mobile-tap-lag](2026-06-16-mobile-tap-lag.md) | Tap lag on the mobile nav proved the main thread and GPU were busy. | `apps/web/CLAUDE.md` — the mobile performance standard |
| 2026-07-03 | [inset-cssom-serialization](2026-07-03-inset-cssom-serialization.md) | Four-sided inline style objects collapsed into the `inset` shorthand and hit the polyfill. | `apps/web/CLAUDE.md` — the `inset` rule and its detector |
| 2026-07-07 | [trusted-proxy-hops](2026-07-07-trusted-proxy-hops.md) | A client-IP pick that was too low made the throttle key rotate, so rate limits never fired. | `docs/ENVIRONMENT.md` — `TRUSTED_PROXY_HOPS` |
| 2026-08-28 | [player-1-1-6-fleet-failure](2026-08-28-player-1-1-6-fleet-failure.md) | Screens sat "online" and content-dead for days. | `apps/web/src/app/player/CLAUDE.md` — Player Reliability |
| 2026-09-16 | [schema-change-without-migration](2026-09-16-schema-change-without-migration.md) | Three columns shipped with no migration file; the fleet errored until the code was reverted. | `packages/database/CLAUDE.md` — a schema change ships a migration file |
| 2026-09-22 | [deploy-overlap-500s](2026-09-22-deploy-overlap-500s.md) | Deploys refused the new container's database connections and reads returned 500. | `packages/database/CLAUDE.md` — DATABASE_URL and the Supavisor pool |
| 2026-09-24 | [4k-to-1080p-playback](2026-09-24-4k-to-1080p-playback.md) | A 1080p player was sent a 4K video and dropped frames. | `apps/web/src/app/player/CLAUDE.md` — rule 16 |
| 2026-09-25 | [4k-field-follow-ups](2026-09-25-4k-field-follow-ups.md) | A 4K screen kept dropping frames while its cache report said 0 files. | `apps/web/src/app/player/CLAUDE.md` — rule 16 field follow-up |
| 2026-09-26 | [4k-cache-fill](2026-09-26-4k-cache-fill.md) | A 4K screen never filled its cache and streamed a 141 MB clip from origin. | `apps/web/src/app/player/CLAUDE.md` — rule 17 |
| 2026-10-23 | [retired-signing-key](2026-10-23-retired-signing-key.md) | A rotation finished and 14 screens went dark for 16 hours unnoticed. | `docs/ENVIRONMENT.md` — `DEVICE_*_PREVIOUS` and the owner fleet alarms |
