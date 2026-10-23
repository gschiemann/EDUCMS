# VenueOS security policies

These are the written security policies a district, venue or enterprise security review asks for. Each one describes what VenueOS does today, not what we hope to do. Where a control does not exist yet, the document says so.

**Owner:** VenueOS owner · **Contact:** security@venue-os.app · **Last reviewed:** 2026-10-23 · **Review cadence:** once a year (next due 2027-10-23) and after any SEV-1 or SEV-2 incident

## The policies

| Policy | What it covers |
|---|---|
| [Access control](access-control.md) | Roles, sign-in, two-step verification, least privilege, vendor-account MFA, joiners and leavers |
| [Incident response](incident-response.md) | Severity levels, roles, timelines, customer notice, and a worked example from the 2026-10-21 hosting-provider exposure |
| [Vulnerability management](vulnerability-management.md) | Scanning in CI, triage, fix targets by severity, how to report a vulnerability |
| [Change management](change-management.md) | How code reaches production, required checks, database migrations, player release rings, rollback |
| [Backup and recovery](backup-and-recovery.md) | What is backed up, retention, restore steps, recovery targets (and which are untested) |
| [Vendor management](vendor-management.md) | Every sub-processor and what data it sees; how a vendor is added, reviewed and removed |
| [Data handling](data-handling.md) | Data classes, encryption, retention, student data, deletion |

## How to read them

- A control with no label is **in place today** and can be checked in the repository or the platform settings. Where it helps, the document names the file or setting.
- **Planned** means we intend to build it. No date is promised.
- **Not in place** means there is no control today and no committed plan.
- Everything is stated as of the review date above. Cadences and job names in CI move over time, so the workflow files in `.github/workflows/` are the source of truth for them.

## What these documents are not

They are not a certification, a third-party audit report or an attestation, and VenueOS does not currently hold one. They are also not a contract. Contractual commitments are in the Terms of Service and the Data Processing Addendum, and if a policy here and the DPA ever differ, the DPA controls.

## Related documents

- [`SECURITY.md`](../../SECURITY.md) and the public `/security` page: how to report a vulnerability, scope, safe harbor
- Public `/dpa` (sub-processor list, incident notice, deletion), `/privacy`, `/ferpa`, `/coppa` and `/status`
- [`docs/SECRET-ROTATION.md`](../SECRET-ROTATION.md): every place each secret lives, and the zero-downtime rotation steps
- [`docs/SLO_AND_ONCALL.md`](../SLO_AND_ONCALL.md): what is monitored and the gaps
- [`docs/BACKUP_AND_ROLLBACK.md`](../BACKUP_AND_ROLLBACK.md): the older backup runbook; where it differs from [backup-and-recovery.md](backup-and-recovery.md), the newer document is current

## Review log

| Date | Change |
|---|---|
| 2026-10-23 | First publication of the seven policies. |
