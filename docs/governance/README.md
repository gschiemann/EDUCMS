# Governance — how VenueOS implements the Foundry Standard

| File | What | Article |
|---|---|---|
| `standard/` | The vendored standard and protocols, pinned by `standard.lock` (version + SHA-256). Refresh with `kit/bootstrap.sh` from `gschiemann/foundry-standard` (private). | 45, 53 |
| `OWNER-RULES.md` | The owner's binding rules, readable by every vendor | 32 |
| `APP-PROFILE.md` | Mission, users, data, integrations, life-safety paths, approved exceptions | 6 |
| `AUTONOMY-REGISTER.md` | Register A (agent authority) and Register B (product automations), standing approvals | 15, 33, 34 |
| `IDENTITIES.md` | Who and what can act — human, machine and agent identities, what each may hold, the credential rules for models, and what is not yet mechanised. Checked in part by `.github/workflows/pr-provenance.yml` | 11, 16, 17, 53, 54 |
| `FREEZE.md` | The current freeze (launch) — present means active | 34 |
| `MECHANISMS.md` | Every normative article → the mechanism here, or GAP; the GAP count is the headline | preamble |
| `FIRST-RESPONSE.md` | The retrospective first response for an application that predates the standard | 10 |
| `decisions/` | Decision records that are not sensitive. Security findings and forensics live in the private standard repository's `decisions/`. | 31 |

The one page every model reads first is the North Star at the top of `AGENTS.md` (imported by `CLAUDE.md` and `GEMINI.md`). `CLAUDE.md` remains the application rulebook.
