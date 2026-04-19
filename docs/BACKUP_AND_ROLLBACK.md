# Backup & Rollback Runbook

> **⚠️ SCALING CONSTRAINT — READ BEFORE SCALING API**
>
> **Do not scale the API above 1 replica** until a Redis-backed
> WebSocket adapter is added. The NestJS WebSocket gateway is
> currently single-pod: signed emergency messages published by
> one pod won't fan out to clients connected to another pod,
> which silently breaks the emergency system across replicas.
>
> `railway.json` pins `numReplicas: 1` to enforce this. If
> Railway ever rejects that key, leave the service configured
> to 1 replica in the Railway dashboard instead. See audit
> notes 2026-04-19.



## Sprint 0 baseline backup

Created: 2026-04-16

### What was backed up

| Layer | Location | Contents |
|---|---|---|
| **Git tag (offsite)** | `origin` on GitHub — tag `backup/pre-sprint-0-20260416-170111` | Full committed history at HEAD commit `b934d39` |
| **Local tarball** | `C:\Users\gschi\OneDrive\Desktop\EDU-CMS-backups\edu-cms-backup-20260416-170111.tar.gz` (220 MB) | Entire working tree including `.git`, uncommitted edits in `apps/api/src/templates/*`, `apps/web/src/**`, and the untracked `sunny-meadow-preview.html` |

Uncommitted files preserved in tarball only (not pushed to remote):
- `apps/api/src/templates/system-presets.ts` (modified)
- `apps/api/src/templates/templates.controller.ts` (modified)
- `apps/web/src/app/layout.tsx` (modified)
- `apps/web/src/components/widgets/WidgetRenderer.tsx` (modified)
- `sunny-meadow-preview.html` (untracked)

---

## Rollback procedures

### A) Revert to the tagged commit (discards all work since tag)

```bash
cd "C:\Users\gschi\OneDrive\Desktop\EDU CMS"
git fetch --tags
git checkout master
git reset --hard backup/pre-sprint-0-20260416-170111
```

> Destructive. Loses any commits and uncommitted work made after the tag.
> Only run if you're sure. Consider `git stash` first to preserve current work.

### B) Recover uncommitted files from tarball (non-destructive, one file)

```bash
cd /tmp
mkdir -p edu-recover && cd edu-recover
tar -xzf "/c/Users/gschi/OneDrive/Desktop/EDU-CMS-backups/edu-cms-backup-20260416-170111.tar.gz" \
  "EDU CMS/apps/web/src/app/layout.tsx"
# then copy out the file you need
```

### C) Full restore from tarball (nuclear option, rebuilds everything)

```bash
cd /c/Users/gschi/OneDrive/Desktop
# move the live copy aside first — never delete
mv "EDU CMS" "EDU CMS.broken-$(date +%Y%m%d-%H%M%S)"
tar -xzf EDU-CMS-backups/edu-cms-backup-20260416-170111.tar.gz
cd "EDU CMS"
pnpm install  # rebuild node_modules
```

### D) Inspect the tag without checking it out

```bash
git show backup/pre-sprint-0-20260416-170111 --stat
git diff backup/pre-sprint-0-20260416-170111..master
```

---

## Future backups

Before each sprint, the Integration Lead (or Claude on request) should:

1. `git tag "backup/pre-sprint-N-$(date +%Y%m%d-%H%M%S)"` then push to origin
2. Re-run the tarball command (see [scripts/backup.sh](../scripts/backup.sh) once it exists)
3. Append a row to the "What was backed up" table above

Keep the 3 most recent tarballs; older ones can be deleted since the git tag covers committed history.

---

## Supabase PITR retention + manual `pg_dump` cadence

Git backs up code — not the Postgres database. Data recovery depends on
Supabase Point-In-Time Recovery (PITR) plus manual dumps as a belt-and-
suspenders safety net. Review the plan below before any pilot customer
onboards.

### Supabase PITR

- **Free tier:** 7 days of PITR retention. Adequate for the current
  internal demo / scratch data, **not** enough for production pilots.
- **Pro tier ($25/mo minimum):** 14-day PITR. **Upgrade before the
  first pilot customer signs** — discovering data loss after the
  free-tier window has closed is unrecoverable.
- **How to restore:** Supabase dashboard → Database → Backups → pick
  a timestamp → click "Restore to new project". Practice this at
  least once before any customer depends on it.

> Do NOT assume PITR protects against application-level corruption
> (bad migration, rogue delete). PITR protects against time; it
> cannot undo a commit you don't notice for 8 days.

### Manual `pg_dump` cadence

In addition to PITR, run a weekly `pg_dump` and store it off-Supabase.
Cheap insurance against Supabase-side outages, accidental project
deletion, or billing lapses.

**Command** (run from any box with `pg_dump` 15+ and `DIRECT_URL` set):

```bash
# Use DIRECT_URL (not the pgbouncer pooler) — pg_dump needs session state.
TS=$(date -u +%Y%m%d-%H%M%SZ)
OUT="educms-${TS}.dump"
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --compress=9 \
  --file="${OUT}" \
  "${DIRECT_URL}"

# Restore (into an empty DB):
# pg_restore --clean --if-exists --no-owner --no-privileges -d "$TARGET_URL" "$OUT"
```

**Storage:** upload to a private S3-compatible bucket (Backblaze B2,
Cloudflare R2, or Wasabi — all cheap / free-tier for weekly dumps).
Do **not** commit dumps to git and do **not** leave them on the
laptop long-term (PII risk). Retain 12 weekly + 12 monthly dumps.

**Automation:** once funded, wrap the command above in a cron job on a
small VPS (or GitHub Actions with a scheduled workflow writing to R2
via `rclone`). For now, a weekly calendar reminder + manual run is
acceptable.

**Restore drill:** run a full `pg_restore` into a throwaway Supabase
project **every quarter**. An untested backup is a hope, not a plan.
Log the drill date + duration + any gotchas in this doc when it runs.
