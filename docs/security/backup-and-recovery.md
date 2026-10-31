# Backup and recovery

**Owner:** VenueOS owner · **Last reviewed:** 2026-10-23 · **Covers:** the production database, uploaded files, source code, secrets and configuration

## What is backed up

| Data | How | How often | Kept |
|---|---|---|---|
| Database: accounts, settings, content records, audit log | A GitHub Actions workflow (`db-backup.yml`) takes a full `pg_dump` over a TLS connection that verifies the server certificate, encrypts it with AES-256 (openssl, PBKDF2 key derivation) and uploads only the encrypted file as a workflow artifact. The plaintext exists only inside the runner and is deleted there. The job fails rather than encrypt an empty dump | Every night at 09:17 UTC | 30 days |
| Database, provider copy | The database provider's plan includes its own daily backups with short retention. We do not rely on them, because they sit in the same account as the data. Point-in-time recovery is not part of our plan | Daily (provider) | Per plan |
| Uploaded files: images, video, documents | Held by the storage provider, which replicates them for durability. We keep no separate copy | Continuous (provider) | Until the customer deletes them |
| Source code and releases | GitHub plus the owner's local clones. Tagged restore points (`backup/pre-sprint-N-...`) before risky changes. Player release builds are kept in GitHub Releases | Every push | Indefinite |
| Secrets and configuration | The hosting providers' variable stores, plus an inventory of every secret, where it lives and what reads it ([`docs/SECRET-ROTATION.md`](../SECRET-ROTATION.md)). Values are kept in the owner's password manager, never in git | When they change | n/a |
| Cache and queue (Redis) | Not backed up, by design. It holds sessions, rate-limit counters and in-flight messages. Losing it signs people in again and screens fall back to polling | n/a | n/a |

The backup encryption key is a GitHub secret and is also held in the owner's password manager. Rotating it makes older backups unreadable, so the previous key is kept until the artifacts it protects have expired.

If the cloud is unreachable, screens keep playing the last content they received, including their cached emergency content. While the API is down, operators cannot send a new alert from the dashboard.

## Checking that backups happen

- A failed backup run opens an `ops` issue automatically.
- The ops sweep (`scripts/ops-sweep.mjs`, run at the start of each working session) reports red if the newest good backup is more than 36 hours old.
- Why both exist: after the database password was rotated on 2026-09-04, the backup kept using the old password and failed nine nights in a row before anyone saw it. Since then every secret has a written list of the places it is used.

## Recovery targets

| Target | Value | Status |
|---|---|---|
| Recovery point, database (RPO) | 24 hours: the last nightly dump. The sweep reports a missed night after 36 hours | A design target. The 2026-09 failure showed it slips when a night fails unseen |
| Recovery time, database and API (RTO) | 4 hours from the decision to restore | **Untested.** Never exercised end to end |
| Uploaded files | No separate target; depends on the storage provider | **Untested.** No independent copy exists |

## Restore procedure (database)

This procedure comes from the backup workflow's own instructions. It has not been run against a fresh provider project, so expect to adjust it. For example, restore only the `public` schema if the provider's managed schemas reject the restore.

1. Download the newest good artifact of the DB Backup workflow from the Actions page, or with `gh run download <run id> --name venueos-db-backup-<run id>`.
2. Get the encryption key from the password manager and decrypt: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in venueos-db.dump.enc -out venueos-db.dump -pass env:BACKUP_ENC_KEY`.
3. Create an empty Postgres database. Use a new project at the database provider, or a local database first to inspect the data.
4. Restore: `pg_restore --clean --if-exists --no-owner --no-privileges -d "$TARGET_DATABASE_URL" venueos-db.dump`. The dump carries the audit-log immutability triggers and the migration history.
5. Spot-check the counts of organizations, users and screens, and the newest audit-log row.
6. Point the API at it. Stage the new connection strings in the hosting platform without deploying, update the GitHub secret the backup uses, then deploy once.
7. Confirm `/api/v1/health`, `/health/ready` and `/health/emergency-path`, and sign in.
8. If the restore follows a compromise, rotate secrets first ([`docs/SECRET-ROTATION.md`](../SECRET-ROTATION.md)).

A customer's data leaves our backups within 30 days of its deletion, because that is how long the encrypted dumps live.

## Gaps

- **Planned:** a restore drill into a scratch database, timed and written up here. The older runbook asks for one every quarter. None is recorded.
- **Not in place:** an independent copy of uploaded files.
- **Not in place:** failover to a second region or a standby database.
- **Not in place:** an automated export of hosting settings. They are rebuilt from the secret inventory.
