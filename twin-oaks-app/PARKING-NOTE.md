# Twin Oaks OS — complete app, parked on this branch

**This directory is the entire Twin Oaks OS application** — a standalone
business-management app for Twin Oaks Farm & Tech LLC. It is NOT part of
EDUCMS/VenueOS; it lives on this EDUCMS branch only because the Claude
session that built it can push to granted repositories but GitHub does not
allow the integration to *create* new repositories (403 by design).

State: **V1 financial core, built and verified** — typecheck + production
build green, all routes smoke-tested, seeded flows verified end-to-end at
iPhone viewport. See `README.md` (run instructions), `docs/SPEC.md`
(owner-written master specification — source of truth), `docs/ROADMAP.md`
(build status), `CLAUDE.md` (developer guide).

## Migrating to the standalone `twin-oaks-app` repository (~2 minutes)

1. Create the empty repo on GitHub (github.com/new → `twin-oaks-app`,
   public, no README/gitignore/license), or have any tool with repo-creation
   rights do it.
2. From a checkout of this branch:

   ```bash
   git clone --branch claude/new-app-repository-2n8nuo \
     https://github.com/gschiemann/EDUCMS educms-parked
   cd educms-parked/twin-oaks-app
   git init -b main && git add -A && git commit -m "Twin Oaks OS V1 foundation"
   git remote add origin https://github.com/gschiemann/twin-oaks-app
   git push -u origin main
   ```

   (Or simply tell a Claude session "the twin-oaks-app repo exists now —
   move Twin Oaks OS into it" and point it at this branch.)

3. Delete this branch from EDUCMS afterwards.

Notes: the GitHub Actions workflow in `.github/workflows/ci.yml` only
activates once the app sits at the root of its own repository. `.env` is
never committed — copy `.env.example` to `.env` (dev defaults work as-is).
