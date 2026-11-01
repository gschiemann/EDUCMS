# First response — VenueOS (retrospective)

Article 10 asks for this before any code. VenueOS predates the standard (first commit 2026-04), so this is the retrospective mapping; the open items are the honest part.

1. **Product mission** — `CLAUDE.md` → Project Mission; `APP-PROFILE.md`.
2. **Unknowns** — the launch GUQ classes' on-glass qualification; whether the hardware gate covers field-candidate builds (it does not today); the error budget for alert delivery (SLO proposed, not contracted).
3. **Architecture** — `CLAUDE.md` → Technology Stack, Monorepo Layout; `docs/MANAGER_ARCHITECTURE.md`.
4. **Security model** — the 2026-09 security audits and remediation (private); `docs/SECRET-ROTATION.md`, `docs/SECURITY_HYGIENE.md`; the agent threat model is new (Article 11) — **open:** agent credentials are not yet per-vendor or scoped.
5. **Data model** — `packages/database/prisma/schema.prisma`; classification in `APP-PROFILE.md`.
6. **Critical workflows** — `APP-PROFILE.md`; life-safety paths in `AUTONOMY-REGISTER.md`.
7. **Testing strategy** — 22 CI workflows and ~35 guard scripts (`MECHANISMS.md`); the hardware qualification matrix is the real-target gate — **open:** it has no PASS rows for the launch classes.
8. **Observability** — `docs/OBSERVABILITY.md`, `docs/SLO_AND_ONCALL.md`, health endpoints, capacity watch, fleet alarms; **open:** no paging rotation; no continuous on-glass alert drill.
9. **Autonomous operations** — Register B is the current state; Register A caps every agent category at L2.
10. **Human approval map** — the consequential list in `AGENTS.md`; standing approvals and the launch freeze in this folder.
11. **Roadmap** — `docs/roadmap/ROADMAP.md`; launch tracker (private).
12. **Definition of done for the launch** — the owner's launch bar (2026-10-11): perfect glass, no stutter, most secure, re-audit on every new model; hardware qualification PASS for every launch class.
13. **Reusable components** — exported to the kit at adoption: the subtractive kill-switch rule, the migration-file CI gate pattern, the hardware qualification gate pattern, the hygiene and ops-sweep scripts (portable versions: Phase 1).
