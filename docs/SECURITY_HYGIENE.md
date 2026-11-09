# Security & Repo Hygiene

**Last verified against code:** 2026-11-09

Originally the Sprint 1 action plan of 2026-04-16 (Task 10). Re-verified 2026-11-09 against the repository; each item below says what is true now. The authoritative live statements are `docs/DEPLOY.md` ("Repository visibility"), `docs/SECRET-ROTATION.md` and `docs/ENVIRONMENT.md`.

## Findings, re-checked

1. **No `.env` in git.** `git ls-files` lists only `.env.example` and `apps/api/.env.example`. The root `.gitignore` covers `.env`, `.env.local`, `.env.*.local`, `apps/**/.env` and `packages/**/.env`. (The April text cited `.gitignore` line numbers; they moved, so none are cited now.) The full-history check (`git log --all --full-history -- '**/.env'`) was not re-run in this pass: unverified for the whole history; the CI gitleaks job (below) is the standing check.
2. **Repo visibility: public.** `docs/DEPLOY.md` records it as public again since 2026-09-14 (it was private 2026-08-01 to 2026-09-14). The April plan to flip it private as P0 was overtaken by that history; public is a cost decision recorded there, with its consequences (no credentials, customer names or PII in any commit, PR or issue). This document does not decide visibility.
3. **Working copy inside a cloud-sync folder.** The April finding named a Windows OneDrive path. The current checkout is a macOS path under the user's Desktop; whether that folder is cloud-synced is unverified. The principle stands: files excluded from git are not excluded from a sync client, so keep `.env` files outside any synced path or exclude them from sync.
4. **`docker-compose.yml` defaults remain weak and dev-only.** The `api` service still hardcodes a `cms_user:cms_password` database URL and `dev_only_*_CHANGE_ME` values for `JWT_SECRET` and `SESSION_SECRET`; the GrowthBook service carries `*_CHANGE_ME_IN_PRODUCTION` placeholders. The April P1 item (replace with `${VAR:?}` references) is **not done**. Production does not use compose: it refuses to boot without `JWT_SECRET`, `SESSION_SECRET`, `DEVICE_SECRET_KEY` and `DEVICE_JWT_SECRET` (`apps/api/src/security/required-secret.ts`). Do not use this compose file for any shared environment.
5. **Credentials seen by an audit agent.** A historical event; the April note said the values were dev-tier. The rule that survives: agents report patterns of secret exposure, never values, and `/.codex/` (agent config that can hold secrets) is gitignored. Rotation procedure: `docs/SECRET-ROTATION.md`.

## April action plan: status today

| Item | Status |
|---|---|
| P0 flip repo private | Superseded: public by decision, see finding 2 |
| P0 move repo out of OneDrive | Windows-specific; unverified for the current machine, see finding 3 |
| P0 rotate Supabase credentials | Not verifiable from the repo; procedure is `docs/SECRET-ROTATION.md` |
| P1 harden `docker-compose.yml` | Not done (finding 4) |
| P1 move `sunny-meadow-preview.html` out of root | Done: the file is gone and `/sunny-meadow-preview.html` is in `.gitignore` |
| P2 expand `.gitignore` | Partly done. Present: `*.key`, `*.pem`, `*.pfx`, `*.p12`, `*.crt` (one deliberate exception, the Supabase public root CA), `*.tar.gz`/`*.tgz`, `test-results/`, `playwright-report/`, `.vercel`, `.mcp.json`, `/.codex/`. Not present: `*_rsa`, `*_ecdsa`, `*_ed25519`, `id_rsa*`, `.aws/`, `.gcp/`, `.azure/`, `.docker/config.json`, `coverage/` |
| P2 pre-commit secret scan (Husky + gitleaks) | Husky exists (`.husky/pre-commit`, `.husky/pre-push`, installed by the root `prepare` script); the pre-commit hook enforces lockfile sync and the `inset` grep, **not** gitleaks |
| P2 CI secret scan | Done: job `secret-scan` ("Secret Leak Scan (gitleaks)") in `.github/workflows/ci.yml`, with `.gitleaksignore` at the repo root |

## Recurring check (read-only, no secret output)

```
git ls-files | grep -iE "(^|/)\.env($|\.)" | grep -v '\.example'   # expect no output
git check-ignore .env apps/api/.env packages/database/.env        # expect all three printed
git log --all --full-history -- '**/.env*' '**/*.key'            # expect only .example files, if any
```
