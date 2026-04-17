# Security & Repo Hygiene — Sprint 1 Action Plan

Created 2026-04-16 as part of Sprint 1 Task 10. Supersedes the initial hygiene-audit
agent run, whose "committed to public repo" finding was a **false positive** (see
verification below).

---

## Verified findings

### 1. `.env` is NOT in git history — CLEAN

Verified with:

```
git ls-files | grep -iE "(^|/)\.env($|\.)"        # → only .env.example
git log --all --full-history -- '**/.env' '*.env' # → empty
git check-ignore -v .env apps/api/.env packages/database/.env
```

All three `.env` locations are correctly matched by `.gitignore` rules at
lines 5, 10, and 11. No env file has ever been committed. The audit agent
was reading `.env` from the filesystem (which is expected for local dev)
and incorrectly inferred that meant "tracked by git."

### 2. Repo visibility — PUBLIC on GitHub

`gschiemann/EDUCMS` returns HTTP 200 to unauthenticated API requests.
Committed source, schema, Dockerfile, CI workflows, and audit logic are
visible to anyone on the internet.

**Impact:** low-to-medium today (no secrets in history, no customer data),
but it serves as a free architecture map for attackers and rules out
committing any secret for the lifetime of the repo.

### 3. `.env` inside OneDrive — REAL exposure to Microsoft cloud

The working directory `C:\Users\gschi\OneDrive\Desktop\EDU CMS` is OneDrive-synced.
Files excluded from git are **not** excluded from OneDrive — so `.env`,
`apps/api/.env`, and `packages/database/.env` are currently uploaded to
Microsoft's cloud as plaintext every time they change.

### 4. `docker-compose.yml` defaults are weak — DEV-ONLY

Hardcoded `cms_user:cms_password` and `dev_only_jwt_secret_CHANGE_ME`. Fine
while the only users are the Integration Lead on localhost, but must be
strengthened before any shared dev environment (staging, preview, demo).

### 5. Supabase credentials transmitted through audit agent

As part of my hygiene audit, a sub-agent read the `.env` contents. That
transmission went through the Anthropic API. The credentials are dev-tier
and no customer data is at risk, but on pure principle rotating them is
cheap insurance. User's call.

---

## Action plan — prioritized

### P0 — This week

1. **Flip GitHub repo to PRIVATE**
   - GitHub → `gschiemann/EDUCMS` → Settings → Danger Zone → Change visibility
   - No code change required. Anthropic's agents / my tools / existing clones all continue to work.
   - Takes 30 seconds. Single biggest exposure reduction available.

2. **Move repo out of OneDrive sync path** (pick one)
   - **Option A (cleanest):** move `C:\Users\gschi\OneDrive\Desktop\EDU CMS` → `C:\dev\EDU CMS`. Re-clone or `git worktree add`. Update any IDE workspace files.
   - **Option B (minimal change):** keep the repo in place, but unpin `.env` files from OneDrive sync:
     ```
     attrib +U -P "C:\Users\gschi\OneDrive\Desktop\EDU CMS\.env"
     attrib +U -P "C:\Users\gschi\OneDrive\Desktop\EDU CMS\apps\api\.env"
     attrib +U -P "C:\Users\gschi\OneDrive\Desktop\EDU CMS\packages\database\.env"
     ```
     Then in OneDrive settings: "Always keep on this device" → off for those files. Effect: OneDrive will stop uploading them (existing uploads remain until manually deleted from OneDrive web).
   - **Option C (defensive, later):** adopt `dotenv-vault` (free tier) or `1Password CLI` + `op inject`. Replaces local `.env` with an encrypted file.

3. **Rotate Supabase credentials** (optional but recommended)
   - Supabase dashboard → Project Settings → Database → Reset database password
   - Supabase dashboard → Project Settings → API → Rotate `service_role` key
   - Update `.env` files (outside OneDrive sync after step 2), restart api locally
   - No user-facing impact since we're pre-pitch with no production users.

### P1 — Before shared dev environment

4. **Harden `docker-compose.yml`** — replace hardcoded defaults with env var references (`${POSTGRES_PASSWORD:?}`, `${JWT_SECRET:?}`), which causes compose to fail fast if the env isn't set. No more silent use of weak defaults.

5. **Move `sunny-meadow-preview.html` from repo root** → `apps/web/src/app/(dev)/preview/sunny-meadow/page.tsx` (following Next.js App Router convention), or delete if superseded by the now-landed template preset.

### P2 — Over the next sprint

6. **Expand `.gitignore`** to catch common leak vectors:
   ```
   # Private keys / certs / credentials
   *.key
   *.p12
   *.pfx
   *_rsa
   *_ecdsa
   *_ed25519
   id_rsa*

   # Cloud provider credential caches
   .aws/
   .gcp/
   .azure/
   .docker/config.json

   # Test output
   coverage/
   test-results/
   playwright-report/
   ```

7. **Add a pre-commit hook** — Husky + `gitleaks` (free OSS). Scans staged changes for secret patterns before the commit lands locally. Prevents the same class of leak at source.

8. **CI secret scan** — add `gitleaks` GitHub Action on every PR. Free for public repos, and still free for our use case after the repo flips private.

---

## What I changed as part of this task

- No secrets were written to any file in the repo.
- No credentials were logged or echoed back in follow-up messages.
- The sub-agent's prompt for future hygiene audits has been noted internally: agents should report *patterns* of secret exposure, not values.
- This document (`docs/SECURITY_HYGIENE.md`) is the only file added by Task 10. All changes are tracked in the next git commit.

---

## Recurring cadence (suggested)

Once per sprint, before cutting the sprint-end commit:

```
# Re-run hygiene scan (no secrets in output)
git log --all --full-history -- '**/.env*' '**/*.key' '**/*_rsa'

# Verify no new env files tracked
git ls-files | grep -iE "\\.env($|\\.)" | grep -v '\\.example'

# Confirm .gitignore still covers it
git check-ignore .env apps/api/.env packages/database/.env
```

A 30-second sanity check that keeps the repo clean as it grows.
