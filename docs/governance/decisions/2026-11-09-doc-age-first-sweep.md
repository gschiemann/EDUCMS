# Doc-age first sweep (2026-11-09)

Decision record, Foundry Standard Phase 1 backlog item 18 (Article 46, doc-age). Mechanism: `scripts/check-doc-age.cjs`, test `scripts/__tests__/check-doc-age.test.cjs`, wired report-only in `.github/workflows/rulebook.yml`.

## Situation

The 2026-10 audit found security documents still reading "last verified 2026-05-29" five months later. Nothing measured document age. The sweep now does: every living Markdown file under `docs/` (not `docs/research/`, `docs/incidents/`, `docs/handoffs/`, `docs/governance/decisions/`), the root `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` and every nested `CLAUDE.md`, aged by its own "Last verified / Last updated / verified against code" header if it has one, else its last commit.

## Evidence

Run on this branch (clock 2026-11-08): **215 files scanned, oldest 208 days, 18 over 180 days.** 14 of the 215 carry a header date; the rest are dated by git. A git date only proves someone touched the file, not that it was verified, so the true backlog is likely larger.

The 18 over 180 days, oldest first:

| File | Age (days) | Date | Dated by |
|---|---|---|---|
| `docs/frontend/ACCESSIBILITY_NOTES.md` | 208 | 2026-04-14 | git |
| `docs/frontend/COMPONENT_ARCHITECTURE.md` | 208 | 2026-04-14 | git |
| `docs/frontend/FORM_VALIDATION_SPEC.md` | 208 | 2026-04-14 | git |
| `docs/frontend/FRONTEND_PLAN.md` | 208 | 2026-04-14 | git |
| `docs/frontend/STATE_MANAGEMENT_PLAN.md` | 208 | 2026-04-14 | git |
| `docs/ACCESSIBILITY_TODO.md` | 207 | 2026-04-16 | header |
| `docs/FEATURE_FLAGS.md` | 206 | 2026-04-17 | git |
| `docs/OBSERVABILITY.md` | 206 | 2026-04-17 | git |
| `docs/SECURITY_HYGIENE.md` | 206 | 2026-04-17 | git |
| `docs/UPTIME_MONITORING.md` | 206 | 2026-04-17 | git |
| `docs/PLAYER_APK_NOVA_TAURUS.md` | 202 | 2026-04-20 | git |
| `docs/MANAGER_ARCHITECTURE.md` | 195 | 2026-04-27 | git |
| `docs/MANAGER_PROVISIONING.md` | 195 | 2026-04-27 | git |
| `docs/ANDROID_COMPATIBILITY.md` | 189 | 2026-05-03 | git |
| `docs/CANVA_INTEGRATION.md` | 189 | 2026-05-03 | git |
| `docs/HARDWARE_BRIDGE.md` | 189 | 2026-05-03 | git |
| `docs/STREAMING_VS_COMPETITORS.md` | 189 | 2026-05-03 | git |
| `docs/TAURUS_DEPLOYMENT_GUIDE.md` | 186 | 2026-05-07 | header |

Next to cross the line (164 days, header 2026-05-29, all within about two weeks): `docs/governance/MECHANISMS.md` and the `docs/spec/` set (`API_VERSIONING.md`, `COMPLIANCE.md`, `DATA_RETENTION.md`, `INCIDENT_RESPONSE.md`, and the rest of that directory).

## Recommendation

Re-verify by risk, highest first:

1. Security and compliance: `docs/SECURITY_HYGIENE.md` (over the line now), then the `docs/spec/` set and `docs/governance/MECHANISMS.md` before they cross it.
2. Operations that gate an incident response: `docs/OBSERVABILITY.md`, `docs/UPTIME_MONITORING.md`, `docs/FEATURE_FLAGS.md` (kill switches).
3. Fleet and hardware: `docs/PLAYER_APK_NOVA_TAURUS.md`, `docs/TAURUS_DEPLOYMENT_GUIDE.md`, `docs/ANDROID_COMPATIBILITY.md`, `docs/HARDWARE_BRIDGE.md`, `docs/MANAGER_*.md`.
4. Accessibility: `docs/ACCESSIBILITY_TODO.md`, `docs/frontend/ACCESSIBILITY_NOTES.md`.
5. Planning and marketing material (`docs/frontend/*_PLAN.md`, `COMPONENT_ARCHITECTURE.md`, `FORM_VALIDATION_SPEC.md`, `CANVA_INTEGRATION.md`, `STREAMING_VS_COMPETITORS.md`): for each, either verify and stamp a "Last verified" header, or move to `docs/archive/` if it describes a design that was superseded.

Then flip the CI step to blocking by removing `continue-on-error` from the doc-age step in `.github/workflows/rulebook.yml`.

## Risk

- The sweep only measures age; stamping a header without checking the code defeats it. A verification must be against the code, and say so.
- Git-dated files can look fresh after a bulk edit (a path rewrite, a rename). The sweep can understate staleness, never overstate it.
- Report-only means nothing fails; the backlog can sit unread. Mitigation: the step prints the table on every rulebook run, and the weekly review reads the counts.

## Validation

`node scripts/check-doc-age.cjs` prints the table and exits 1 while any file is over the limit; `node --test scripts/__tests__/check-doc-age.test.cjs` passes (5 tests: file selection, header forms, header-over-git precedence, undated files, over-limit flag); `node scripts/check-rulebook.cjs` passes; `rulebook.yml` parses.

## Rollback

Revert the commit. Nothing depends on the script: the CI step is `continue-on-error: true`, and no runtime or deploy path reads it.

## Decision

Lead's call under the owner's standing go; re-verification is follow-up work.

## Update 2026-11-09 (first re-verification pass)

Outcome for the 18 files that were over 180 days (re-verified = read against code and corrected; archived = moved to `docs/archive/` with a note; pending = a `Verification pending` header):

| File | Outcome |
|---|---|
| `docs/SECURITY_HYGIENE.md` | re-verified and corrected |
| `docs/FEATURE_FLAGS.md` | re-verified and corrected |
| `docs/OBSERVABILITY.md` | re-verified and corrected |
| `docs/UPTIME_MONITORING.md` | re-verified and corrected |
| `docs/ANDROID_COMPATIBILITY.md` | re-verified and corrected |
| `docs/TAURUS_DEPLOYMENT_GUIDE.md` | corrected; NovaStar-side steps left `Verification pending` (needs a Taurus on the bench) |
| `docs/CANVA_INTEGRATION.md` | re-verified and corrected (kept: the integrations health card links to it) |
| `docs/PLAYER_APK_NOVA_TAURUS.md` | archived (superseded by the Taurus guide) |
| `docs/MANAGER_ARCHITECTURE.md` | archived (Device Owner plan forbidden by owner rule; Manager now bundled in the Player APK) |
| `docs/MANAGER_PROVISIONING.md` | archived (same) |
| `docs/HARDWARE_BRIDGE.md` | archived (BRIDGE tier retired in `packages/api-types/src/streaming.ts`) |
| `docs/STREAMING_VS_COMPETITORS.md` | archived (unverifiable competitor claims) |
| `docs/ACCESSIBILITY_TODO.md` | archived (finished sprint log) |
| `docs/frontend/ACCESSIBILITY_NOTES.md` | archived (stale component claims) |
| `docs/frontend/COMPONENT_ARCHITECTURE.md` | archived (April plan) |
| `docs/frontend/FORM_VALIDATION_SPEC.md` | archived (S3 flow not what runs) |
| `docs/frontend/FRONTEND_PLAN.md` | archived (April plan) |
| `docs/frontend/STATE_MANAGEMENT_PLAN.md` | archived (names a store that does not exist) |

Over-180 count after this pass: 0 (see the sweep). Not touched and next to cross: `docs/MOBILE_APP_ROADMAP.md` (178 days) and the 164-day set named above.
