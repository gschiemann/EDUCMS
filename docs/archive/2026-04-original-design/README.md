# Archive — Pre-launch April-2026 swarm design docs

**HISTORICAL ONLY. Do not treat anything in this folder as current.**

These documents were written on **2026-04-13** by the original pre-launch
build swarm (the "@BackendDev / @Orchestrator / @Frontend" voice). They
describe a *to-be-built* K-12 "School Digital Signage CMS" and capture the
plan as it stood before any code shipped.

The product that actually shipped diverged substantially from these specs:

- The company became **VenueOS** — a multi-vertical (K-12, Sports,
  Restaurant, Retail, Healthcare, Corporate) signage + emergency platform,
  not a K-12-only CMS.
- Realtime is **raw signed WebSockets + Redis pub/sub** — *not* Socket.io
  (as some of these docs assume).
- Tenant isolation is **Prisma application-layer scoping** — *not* Postgres
  Row-Level Security.
- Deploy is **Railway (API) + Vercel (web)** with push-to-master = prod —
  *not* the ArgoCD/Flux/Terraform/Vault/staging pipeline these docs plan.
- Several of these docs assert controls or architecture that were never
  built, or that were built differently. Reading them as "current state"
  will mislead you.

## For current reality, read instead:

- **`CLAUDE.md`** (repo root) — the living source of truth for the codebase,
  rules, and roadmap.
- **`docs/research/2026-05-28-opus48-audit/00-MASTER-SYNTHESIS.md`** — the
  most accurate snapshot of what is actually shipped (every claim traced to
  its caller / a real curl).
- **`CONTRIBUTING.md`** (repo root) — the "start here" pointer for new
  contributors.

## Why keep these at all?

Provenance. They record the original intent and the decisions made before
launch, which is occasionally useful for "why was it built this way"
archaeology. They are kept verbatim and unedited.

## What is NOT in this folder

The following 2026-04-13 docs were deliberately left in place and are being
kept *live and truthful* by current maintainers — do not assume they belong
here:

- `THREAT_MODEL.md`, `SECURITY_BASELINE.md`, `TEST_STRATEGY.md`,
  `RISK_REGISTER.md` (repo root) — being reconciled against shipped reality.
- `RBAC_MATRIX.md` (repo root) — the one original spec that still broadly
  matches the code.
