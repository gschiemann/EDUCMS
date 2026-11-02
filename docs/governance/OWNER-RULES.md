# Owner rules — VenueOS

Article 32. The owner's binding corrections, written where **every** vendor can read them. A rule here outranks the standard and `CLAUDE.md`. No customer names, no secrets. Mechanism column: what enforces it today, or GAP. Dates are when the owner said it.

| Date | Rule (the owner's intent) | Scope | Mechanism or GAP |
|---|---|---|---|
| 2026-11-01 | The launch-week hold is lifted: finish all development; API restarts are acceptable; do not use the word "freeze" with the owner — say what is held and why, in plain words. | global | `FREEZE.md` removed; Phase 1 items proceed to merge |
| 2026-10-31 | Adopt the Foundry Standard above every app; the lead reviews every other model's finding and must agree 100 % before it is implemented; cost-first routing — not everything is built with the frontier model; a full audit of the standard and the app on every new LLM. | global | `AGENTS.md`, `docs/governance/standard/`, `FRONTIER-INTAKE.md` |
| 2026-10-31 | The owner does not operate GitHub or consoles: his approval is a written go in chat; the lead merges, applies approved settings, and reports what changed. | global | `MULTI-AGENT.md` roles; PR bodies say "owner approval = a written go; the lead merges" |
| 2026-10-31 | Launch week: no disruption to the application or any account; explain each change's blast radius (does merging it deploy? does it touch accounts, data, screens?) before doing it; zero-runtime items first, deploy-causing items held as unmerged PRs until the owner says. | app, temporary (launch freeze) | `FREEZE.md` named exceptions |
| 2026-10-31 | Build the self-improvement loop so it actually runs: the weekly review routine (zero runtime), approved during the freeze. | global | `docs/governance/reviews/`, autonomy register row |
| 2026-10-26 | "Wrap up" never pauses approved launch work; ask before pausing anything. | app | PROSE — this file |
| 2026-10-24 | Never fight the panel vendor's own CMS: no vendor-warning UI; write device values only on a real change, read-before-write, respect external changes, no re-assert loops. | app (Goodview class) | PROSE; tests on the vendor-backlight path |
| 2026-10-24 | Every screen and menu is cutting-edge (tvOS / Google TV class), designed with real thought, screenshot-verified — never functional-plain. | app | PROSE |
| 2026-10-23 | Launch-ready standing approval: stop asking for launch-tracker work. | app, temporary | `AUTONOMY-REGISTER.md` standing approvals; `FREEZE.md` |
| 2026-10-19 | Native-first video is a launch gate — "we don't launch until we are up with the best". | app | `PLAYER_NATIVE_VIDEO` rows in `CLAUDE.md`; hardware qualification |
| 2026-10-18 | Audit the shape of the system against the best players, not symptoms against our own rules. | global | PROSE |
| 2026-10-18 | Native-first and the one content store must never break emergency alerting — seven invariants and proof before ship. | app | emergency-path tests; `emergency-path.yml` |
| 2026-10-18 | Engine behaviour auto-detects per device; no operator setting; flags are the lead's kill switches only. | app | env rows `PLAYER_*` (subtractive) |
| 2026-10-17 | No device owner, ever. Capability work targets Android 13+; Android ≤ 11 is one Install tap per update. | app | PROSE; APK policy table |
| 2026-10-17 | Native-first — every screen runs the best engine; never default back to WebView unless it is the best. | app | `native-video.ts` enrolment |
| 2026-10-12 | Never flip between web and native video on the glass — one seamless takeover per content, then stay. | app | player tests |
| 2026-10-12 | Never mass-force OTA during playback — one screen per hardware class, off-hours. | app | PROSE (Register A row); field-build windows table |
| 2026-10-12 | Launch decisions: VenueOS brand only; double-sided units run any video combination; bare-minimum ops with pre-degradation alerts; maximum control over the launch panel class; repo goes private last. | app | this file; `APP-PROFILE.md` exceptions |
| 2026-10-12 | Repo stays public until CI billed minutes are under ~3,000 / month. | app | PROSE |
| 2026-10-11 | Launch bar: perfect glass, no stutter (device-aware), the most secure product, and a security re-audit on every new model. | app | hardware qualification; `FRONTIER-INTAKE.md` Tier A |
| 2026-10-05 | Customer security documents are technical but state only what signage vendors publish — never certifications or support-access claims we lack; a new file name per version. | global | PROSE |
| 2026-10-05 | A panel that is off must still be able to show an alert — never ship a player whose alert path depends on a live web page. | app | native alert watch (APK ≥ 1.1.22); camera drill |
| 2026-10-03 | "Stop having me do shit, you do it" — never hand the owner scripts or console snippets; use your own tools or build a config-driven path. | global | PROSE |
| 2026-10-03 | The player respects a remote power-off; the on/off schedule overrides it at each trigger. | app | `effectivePowerCommand`; tests |
| 2026-09-27 | K-12 student names and photos are default-DENY on public screens until admin FERPA attestation and per-student opt-out / photo release. | app | PROSE — confirm the gate in code |
| 2026-09-26 | No lower-resolution stand-in on a 4K screen — download the whole file, then play. | app | `mediaReadiness.ts`; readiness-gated playback tests |
| 2026-09-23 | The lead owns everything; other models work for the lead; world-class or it goes back. | global | `MULTI-AGENT.md` roles |
| 2026-09-21 | Run the whole API test suite before any auth or guard push. A wrong re-auth password is 403, never 401. A state the system can heal itself must never ask the operator. | app | PROSE; auth specs |
| 2026-09-21 | Agent worktrees are cut from `origin/master`, never from a local branch. | global | PROSE |
| 2026-09-13 | `node scripts/ops-sweep.mjs` first, every session. | app | `AGENTS.md` cadence |
| 2026-09-11 | Own the audit loop; get eyes on the surface before the first fix; audits are exhaustive (all 21 sections) or worthless; never claim something is absent without the search that proved it. | global | `CLAUDE.md` Standard Audit Surface |
| 2026-09-04 | Walk the real recovery path before enabling any lockout. Prove a secret leaked and enumerate its consumers before rotating. | global | `docs/SECRET-ROTATION.md` |
| 2026-09-01 | No unrequested UI controls; diagnose geometry before touching it. | global | PROSE |
| standing | Every new user-facing string ships in en + es + zh. | app | `apps/web/tools/check-i18n-parity.cjs` |
| standing | No long background polls — point-in-time checks only. Proactively watch Supabase / Railway / Vercel health. | global | capacity watch; `ops-sweep` |
| standing | Short bulleted status reports, not novels. The lead is a developer, not a designer. Don't over-engineer. Don't rebuild existing template patterns. | global | PROSE |
| standing | Never discard agent work; persist a returning agent's report immediately. | global | PROSE |
| standing | Verify CI green before telling the owner to test; check the actual render before editing UI. | global | `CLAUDE.md` §21 |
| standing | No `inset` shorthand in player or widget styles (Taurus). Mobile performance standard locked. No fast carousels or cropped previews. AI board typography is priority one. | app | `check-inset-serialization.cjs`, `taurus-safety.yml`, `check-mobile-perf.cjs` |
| standing | Watch usage and save state at 75 % without being asked. | global | PROSE |
| standing | A test fixture is cut from the producer, never hand-written. Never run `pnpm --filter api run lint` (it auto-fixes). | app | PROSE |
