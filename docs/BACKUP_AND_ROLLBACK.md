# Backup & Rollback Runbook

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
