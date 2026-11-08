# Identities — who and what can act in VenueOS

Articles 11, 16, 17, 53 and 54 of the Foundry Standard · Phase 1 item "identities and provenance" · written 2026-11-01.

**This repository is public: this file holds names and rules only — no value, no personal address, no console URL — and nothing like that may be added.** It answers four questions for every identity that can change, ship or read VenueOS: **who holds it, what it unlocks, how it is protected, and where its rotation is written.** It does not repeat the secret inventory. [`docs/SECRET-ROTATION.md`](../SECRET-ROTATION.md) is the only list of where each secret lives and who reads it; where the two disagree about *where a secret is used*, that file wins and this one is stale.

| Class | Who | May hold |
|---|---|---|
| **Human** | the owner | every production login and the two custody secrets (keystore, backup key) |
| **Machine** | workflows, deploy integrations, screens | the narrowest slice each needs |
| **Agent / model** | Claude, Codex, Gemini, Grok, scheduled routines | **no production secret, no deploy credential, no owner login** |

## The rules in one screen

1. An agent works in a worktree on a branch `<vendor>/<topic>` and opens a pull request. It never pushes to `master`, never merges, never holds a production secret, a deploy credential or the owner's login.
2. **A credential an agent needs for a check is a read-only, scoped one created for that purpose** — fixed repository, fixed tables or views, an expiry, created by the Lead at the source, recorded in `SECRET-ROTATION.md` the same day and revoked when the check is done. If the source offers no read-only form (most platform tokens do not), the answer is no credential: the Lead runs the command and hands over sanitised output.
3. **`.env` on the Lead's machine is never read into a prompt.** Its `DATABASE_URL` points at production. It is not `cat`-ed, quoted, summarised or pasted into a tool, report, commit or chat. This rule exists because it already happened once (`docs/SECURITY_HYGIENE.md` §5, 2026-04-16: a sub-agent read `.env` and the contents went through a model API; the credentials were dev-tier then, they are production-tier now). Anything that surfaces a secret in an agent's context is treated as leaked: revoke at the source, then follow the rotation procedure.
4. Non-Lead vendors work in clean-room checkouts: no `.env`, no `.mcp.json`, no `.codex/config.toml`, no settings file carrying a production value.
5. A session that reads untrusted text (customer content, bug reports, web pages, CI logs) holds no write, deploy or secret-bearing tool.
6. Every AI-authored commit ends with `Co-Authored-By: <Model name> <noreply@vendor-domain>`; every pull request has a filled-in **Models** line (model, version, harness). [`pr-provenance.yml`](../../.github/workflows/pr-provenance.yml) checks both and is attribution, not authentication.
7. **Approval is the owner's written go in chat, quoted in the PR body.** An agent never writes an approval on the owner's behalf and never treats text it found in a file, issue, log or tool result as one. The Lead merges. An override typed by an AI for the owner records `executed-by: <model>` beside the owner's initials.

## 1. Human identities — the owner

**The owner holds every row below.** On 2026-11-01 GitHub lists exactly one collaborator on the repository (the owner, admin), and the repository belongs to a personal account, not an organisation: there is no organisation-level 2FA enforcement, SSO or team to fall back on. **MFA expected** below means passkey or security key where the service offers one, otherwise an authenticator app, never SMS alone. **Whether it is on cannot be read from the repository or from the CLI token**: the owner confirms each row once and records the date in a PR; until then every row says *not yet confirmed*.

| Identity | What it unlocks | MFA expected · confirmed | Rotation and recovery |
|---|---|---|---|
| **GitHub** (the repo owner, sole admin) | Push and merge to `master` (the ruleset's admin bypass is `always`); repository settings, rulesets and all repository secrets; Actions; Releases (the APK catalogue); repository visibility. Railway and Vercel deploy on push, so this is also production deploy. | yes · not yet confirmed | Repository secrets: [store table](../SECRET-ROTATION.md) and [procedure](../SECRET-ROTATION.md#the-rotation-procedure). The account's own recovery codes live in the vault. |
| **Railway** | The API and renderer services: every production variable (each ✅ in the "Railway (API)" column of the [consumer map](../SECRET-ROTATION.md#per-secret-consumer-map)), deploys, restarts, rollbacks, logs. The start command applies `prisma migrate deploy` to production before boot. | yes · not yet confirmed | [Both at once (the 2026-10-21 Railway leak)](../SECRET-ROTATION.md#both-at-once-the-2026-10-21-railway-leak); sections [A](../SECRET-ROTATION.md#a-device_jwt_secret) and [B](../SECRET-ROTATION.md#b-device_secret_key). |
| **Vercel** | The web project: production and preview variables (`GATEWAY_SHARED_SECRET`, `SESSION_BFF_SECRET`, `NEXT_PUBLIC_*`), deploys, the web domain. | yes · not yet confirmed | "Vercel (web) env" store row; the `GATEWAY_SHARED_SECRET` / `SESSION_BFF_SECRET` row. |
| **Supabase** | Postgres (all tenant data, including K-12 student names and photos, audit logs, sealed credentials), Storage (assets, the private `apks` bucket), the service-role key, the database password, pooler settings. | yes · not yet confirmed | Rows "Postgres password" and `SUPABASE_SERVICE_ROLE_KEY`; `scripts/supabase-rotation.mjs`. |
| **Resend** | All outbound email — sign-in codes, password resets, invites, alert emails — and the sending domain. | yes · not yet confirmed | "Provider keys" row (`RESEND_API_KEY`). |
| **Stripe** | Billing: customers, subscriptions, refunds, the webhook secret. Card entry is Stripe-hosted (SAQ-A). | yes · not yet confirmed | "Provider keys" row (`STRIPE_*`). |
| **Meta developer app** | The Instagram and Facebook Login app: id, secret, App Review, the OAuth redirect. | yes · not yet confirmed | "Provider keys" row (`INSTAGRAM_*`, `META_*`). |
| **Google Cloud** | The Maps / Places key behind address lookup and Google Reviews, and its billing. | yes · not yet confirmed | "Provider keys" row (`GOOGLE_MAPS_API_KEY`). |
| **Anthropic · OpenAI · Google AI consoles** | The platform AI keys and their spend (metered in dollars against included allowances). The Anthropic account also runs the Lead sessions, the scheduled routines and their trigger tokens. | yes · not yet confirmed | "Provider keys" row (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`); the on-call routine row (`ROUTINE_FIRE_*`). |
| **Android release keystore** | Signs every APK the fleet installs. Whoever holds the file and its three passwords can ship an update every panel will accept — the highest-impact secret a person holds. | n/a (custody, not a login) · custody copies: vault, cloud drive, repository secrets | "Android signing" row. **No rotation path is written** ("a lost keystore = a new app identity"), and neither is a compromise procedure. |
| **Backup encryption key** (`BACKUP_ENC_KEY`) | Decrypts the nightly production database dump. The encrypted dumps are artifacts of a public repository, so this key alone stands between them and anyone. | n/a (custody) · copies: vault, repository secret | "`BACKUP_ENC_KEY`" row: keep the previous key until older artifacts expire (30 days). |
| **The vault** (password manager and the cloud drive that holds a keystore copy) | Recovery material for every row above and the contents of `~/rotate/`. It is the root of the human class. | yes · not yet confirmed | Not rotatable as a unit; keep an offline recovery kit. |

Not in the inventory at all: the **domain registrar and DNS account** for the web origin (it controls the web origin and the email-authentication records) — add it here and to `SECRET-ROTATION.md` when the owner names it.

## 2. Machine identities

### 2.1 `GITHUB_TOKEN`, workflow by workflow

Repository default (read 2026-11-01): `default_workflow_permissions: read`, workflows may not approve pull requests. All 22 existing workflows also declare their own `permissions:`; the table is what the files say today. The last column is every `secrets.*` name the file references (names only).

| Workflow file | Triggers | `permissions:` as written | Secrets it references |
|---|---|---|---|
| `a11y.yml` | pull_request, schedule, dispatch | `contents: read` (also on job `axe`) | — |
| `android-player-apk.yml` | push of tags `player-v*` / `manager-v*`, dispatch | **`contents: write`** (to create Releases) | `GITHUB_TOKEN`, `RELEASE_KEYSTORE_BASE64`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `capability-registry.yml` | push, pull_request | `contents: read` | — |
| `ci.yml` | push, pull_request | `contents: read` (also on each of its 8 jobs) | `GITHUB_TOKEN` (gitleaks) |
| `cross-browser.yml` | pull_request, schedule, dispatch | `contents: read` | — |
| `db-backup.yml` | schedule (daily), dispatch | `contents: read` | `SUPABASE_DB_URL`, `BACKUP_ENC_KEY` |
| `deploy-reliability.yml` | push, pull_request | `contents: read` | — |
| `emergency-path.yml` | push, pull_request, schedule, dispatch | `contents: read` | — |
| `field-scripts.yml` | push, pull_request | `contents: read` | — |
| `integration-truth.yml` | push, pull_request | `contents: read` | — |
| `keep-warm.yml` | schedule (5 min), dispatch | `contents: read` (also on job `ping`) | — |
| `lighthouse.yml` | pull_request | `contents: read` (also on job `lighthouse`) | `LHCI_GITHUB_APP_TOKEN` |
| `mobile-perf.yml` | push, pull_request | `contents: read` | — |
| `ota-wiring.yml` | push, pull_request | `contents: read` | — |
| `player-kotlin-check.yml` | push, pull_request, dispatch | `contents: read` | — |
| `poster-freshness.yml` | push, pull_request | `contents: read` | — |
| `pr-provenance.yml` (new) | pull_request | `contents: read`, `pull-requests: read` | — |
| `prod-smoke.yml` | push to `master`, schedule, dispatch | `contents: read` (hands `github.token` to `gh` in three steps) | `PROD_SMOKE_EMAIL`, `PROD_SMOKE_PASSWORD` |
| `scheduled-failure-issue.yml` | workflow_run (every other workflow) | `issues: write`, `actions: read`, `contents: read` | `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN` |
| `security-watch.yml` | schedule (hourly), dispatch | `contents: read` | — |
| `signing-secrets.yml` | push, pull_request | `contents: read` | — |
| `taurus-safety.yml` | push, pull_request | `contents: read` | — |
| `tenant-isolation.yml` | push, pull_request | `contents: read` | — |

Notes. Only `android-player-apk.yml` holds `contents: write` (it runs only on a release tag or by hand); `scheduled-failure-issue.yml` holds `issues: write`. `scheduled-failure-issue.yml` runs the default branch's definition (that is how `workflow_run` works), so a pull request cannot rewrite it; its header comment still says "No secrets" although it references two. No workflow uses `pull_request_target`. Third-party actions are pinned by commit SHA by convention; the repository setting that would enforce it (`sha_pinning_required`) is off, and the repository allows all actions.

### 2.2 Repository secrets (names only; checked with `gh secret list` on 2026-11-01)

No deployment environment holds a secret and none requires a reviewer (six environments, all with zero secrets and zero protection rules), so every secret below is a plain repository secret.

| Secret | Set? | Read by | What it can do | Rotation |
|---|---|---|---|---|
| `SUPABASE_DB_URL` | yes | DB Backup | Connects to production Postgres over the direct string. Privileges of the role it names: not verified here. | "Postgres password" row |
| `BACKUP_ENC_KEY` | yes | DB Backup | Encrypts the nightly dump; the same key decrypts it (§1). | `BACKUP_ENC_KEY` row |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Android Player APK (release step, non-blocking) | The platform's all-access key — far broader than "write a file to the `apks` bucket". | `SUPABASE_SERVICE_ROLE_KEY` row |
| `SUPABASE_URL` | **no — referenced, not set** | Android Player APK | Not secret in itself. While it is unset the storage-publish step quietly skips and the fleet downloads APKs through the API byte proxy. | same row |
| `RELEASE_KEYSTORE_BASE64`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` | yes (all four) | Android Player APK | Sign the release and field APKs. | "Android signing" row |
| `PROD_SMOKE_EMAIL`, `PROD_SMOKE_PASSWORD` | yes (both) | Prod Smoke | Sign in to production as the smoke user, a CONTRIBUTOR on one seed tenant. | "Prod smoke login" row |
| `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN` | **no — referenced, not set** | Workflow failure → issue | Would start a Claude cloud session in the owner's account on any workflow failure. Unset: the step is a no-op. | "On-call routine" row |
| `LHCI_GITHUB_APP_TOKEN` | **no — referenced, not set** | Lighthouse CI | Would let Lighthouse report status on pull requests. | "Lighthouse" row |
| `PLAYWRIGHT_ADMIN_TOKEN`, `PLAYWRIGHT_TENANT_ID` | no | **no workflow references them** | Listed in `SECRET-ROTATION.md` under CI & Security; nothing uses them. | "Playwright CI tenant" row (stale) |

### 2.3 Deploy identities

| Identity | May do | Not visible from the repository |
|---|---|---|
| **Railway** (GitHub integration) | Builds the root Dockerfile and starts `scripts/railway-start.sh` (migrate, then boot) on a push to `master` that touches its watch patterns (recorded in `railway.json`: `apps/api`, `packages/*`, `Dockerfile`, `railway.json`, `scripts`, root manifests). Deploys on push, not on CI success. The container's identity is the "Railway (API)" column of the consumer map. | The live watch patterns; the permissions granted to Railway's GitHub App; GitHub lists **two** deployment environments in Railway's naming style (`<project> / production`) — which one is live is not stated anywhere in the repository. |
| **Vercel** (GitHub integration) | Builds `apps/web`: production from `master`, a preview build for branches. `apps/web/scripts/vercel-ignore-build.sh` skips a build when nothing under `apps/web`, `packages` or the root manifests changed since the last deploy; an unknown base means build, so a branch with no earlier deployment builds. | Which variables sit in the **Preview** scope (a branch's code runs `next build` with them — no production secret should be there); the permissions granted to Vercel's GitHub App; GitHub lists **two** Preview / Production pairs of environments. |

### 2.4 Screens and the tenant USB key

| Identity | What it is | What it may do | Rotation |
|---|---|---|---|
| **Paired-screen credential** | A device JWT signed with `DEVICE_JWT_SECRET`, 180-day (`DEVICE_TOKEN_TTL_PAIRED`), bound to one screen id and a credential epoch. Renewed when the player page loads or fewer than 14 days remain — not on a timer. | Read its own manifest and emergency state, report its own telemetry and render proof, hold its realtime socket, fetch its tenant's USB key. The generated list of every device-authenticated route is `apps/api/src/screens/device-route-inventory.spec.ts`; this file does not restate it. | Windowed: `DEVICE_JWT_SECRET_PREVIOUS`; [section A](../SECRET-ROTATION.md#a-device_jwt_secret); `railway-rotation.mjs finish` refuses while a live screen has no new-key token. Raising the epoch revokes. |
| **Bootstrap credential** ("unproven", `requiresRePair`) | One hour, minted from a fingerprint alone. A fingerprint is never a credential and never upgrades one (DEVAUTH-01). | Read (the manifest is the emergency polling backstop); never write; refused at the realtime socket (SEC-001). | Expires; **Restore trust** re-issues a proven credential. |
| **Per-tenant USB signing key** | 64 hex characters, minted silently on first use (`apps/api/src/usb-export/usb-signing-key.ts`), stored as plain hex in `tenants.usb_ingest_key`. | Signs the package an admin exports; every paired screen of the tenant fetches it (`GET /screens/:id/usb-key`) to verify a stick before importing. Whoever holds it can forge a package that tenant's screens will import as normal content; the web player overlays USB content on normal manifests only, never over an alert. | `POST /tenants/me/usb-ingest/rotate-key` (admin roles, audited as `USB_INGEST_KEY_ROTATED`; sticks signed with the old key stop importing). **Not in `SECRET-ROTATION.md`.** |

Other non-human accounts: `dependabot[bot]` (version-update PRs are paused with `open-pull-requests-limit: 0`, and the repository's Dependabot security-updates setting reads `disabled` on 2026-11-01, so it is effectively silent) and the Actions bot. The provenance check treats `[bot]` authors as bots.

## 3. Agents and models

### 3.1 What exists (read 2026-11-01)

| Session or model | How it runs | Identity it uses today | Evidence |
|---|---|---|---|
| **Lead** — Claude (Fable 5.1 / Opus 5.5 by task) | Claude Code on the owner's Mac | The owner's OS user, git identity and `gh` login (scopes include `repo` and `workflow`), plus the platform connectors attached to that app | `Co-Authored-By` trailers over the last 1,000 commits on `master`: Opus 5.5 × 475, Fable 5.1 × 116, Sonnet 5.5 × 19 |
| **Worktree subagents** — Claude | Claude Code `Agent` tool, `isolation: worktree`, branch `worktree-agent-*` or `<vendor>/<topic>` | **Inherit the Lead's tools and identity** | same trailers |
| **Scheduled routines** | Weekly review (Mondays, a local scheduled task in the owner's app, L1, opens one PR); failure triage (`scheduled-failure-issue.yml` → routine; its trigger secrets are unset, so it does not fire) | The owner's `gh` login (weekly review); none (failure triage) | `docs/governance/reviews/`; the two routine rows of Register A in `AUTONOMY-REGISTER.md` |
| **Codex** (OpenAI) | `codex/*` branches, merged by the Lead | The owner's git identity, **no trailer** | PRs #180–#182 (`codex/*` heads): their 15 non-merge commits carry no model trailer |
| **Gemini** (Google), **Grok** (xAI) | none yet | — | No trailer from either in the last 1,000 commits. The same rules bind them on day one. |
| **Product AI** | Not a development agent: platform keys in Railway call Anthropic, OpenAI and Google at runtime | — | "Provider keys" row |

### 3.2 What each may hold

| | Production secret | Deploy credential | Owner login | Repository write |
|---|---|---|---|---|
| Lead and subagents | **No** — a rule; §5.1 says what is true today | **No** | **No** | A branch and a PR; never `master` |
| Codex, Gemini, Grok | No | No | No | A branch and a PR from a clean-room checkout |
| Routines | No | No | No | Weekly review: one PR. Failure triage: comment only. |
| Any session that reads untrusted text | No | No | No | None |

**Getting a credential for a check.** (1) The Lead names the check and the minimum read access it needs. (2) The owner says go in chat. (3) The Lead creates the scoped credential at the source — for a database, a role with `SELECT` on named views and **column grants that exclude secret-bearing columns** (a read-only role is not harmless: `tenants.usb_ingest_key` is plaintext, password hashes and sealed envelopes live in tables an audit would otherwise reach), with an expiry. (4) It reaches the session through its environment, never through a prompt or a file in the checkout. (5) The Lead records it in `SECRET-ROTATION.md` the same day and revokes it when the check is done.

## 4. Compromise and rotation

- A platform, vendor or supplier leak: [Article 54](standard/STANDARD.md) and the [rotation procedure](../SECRET-ROTATION.md#the-rotation-procedure) — prove the leak, enumerate the consumers, rotate through a window, never a straight swap.
- A leaked agent credential is a leaked production secret: revoke at the source first, then the same procedure.
- A leaked screen credential: raise the epoch or rotate through the device-secret window; never accept a key known to be compromised to bring screens back (a forged alert is a life-safety event).

## 5. What is NOT yet mechanised

This document states rules. Nothing below is enforced by it, and each item says what would enforce it.

1. **The Lead is not separable from the owner.** Same machine, same `gh` login (with `workflow` scope), same git identity, platform connectors attached, and subagents inherit all of it. So "agents hold no production secret, no deploy credential, no owner login" is a rule about conduct, not a property of the system. The `.gitignore` itself records (2026-06-08) that `.codex/config.toml` held live secrets, and `SECRET-ROTATION.md` records that `.mcp.json` holds the production database connection string; the standard says no agent configuration file may. What those files contain now is unverified: they live outside the repository and were deliberately not opened. This very pull request's workflow file was pushed with the `workflow`-scoped token. *Enforced by:* a machine identity per vendor and for the Lead (GitHub App or machine user, no `workflow` scope), a read-only database role in place of the connection string, clean-room checkouts for non-Lead vendors.
2. **Nothing stops a push to `master` or a merge.** The ruleset has no pull-request rule and an admin bypass of `always`; `allow_auto_merge` is on, so a queued auto-merge lands on the four build checks alone. "Agents never push, never merge" is a convention. *Enforced by:* the required-checks ruleset decision (`decisions/2026-10-31-required-checks-ruleset.md`) plus a distinct Lead identity.
3. **Repository secrets are reachable from any branch.** No secret sits behind a protected environment with a required reviewer, and a workflow can be dispatched from a branch with its own definition. Anything that can push a branch can therefore reach `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` and the keystore; today that is the Lead's token. *Enforced by:* protected environments with a required reviewer for the three secret-bearing workflows, and least-privilege replacements (a backup-only database role; a storage-only key for the APK mirror).
4. **The commit-trailer check is attribution, not authentication.** A trailer can be typed by anyone, and a commit authored under the owner's address passes without one — which is how Codex's work lands. Which of the owner's two author addresses counts as "the owner" also depends on which is more frequent among the last 50 commits on `master` at the time. *Enforced by:* signed commits per machine identity and a ruleset that requires them; meanwhile the optional repository variable `PROVENANCE_OWNER_EMAILS` pins the addresses.
5. **The check lives in the PR's own tree.** A pull request may edit or delete `pr-provenance.yml`, and its own run uses the edited file. Only review of `.github/**` protects it. *Enforced by:* the proposal in `decisions/2026-11-01-codeowners-proposal.md` (not applied).
6. **Owner approval is a sentence.** A quote in a PR body proves only that someone typed it. *Enforced by:* the same proposal, either way it goes.
7. **MFA, recovery settings, account ownership and who else holds a seat on any platform** (Railway, Vercel, Supabase, Stripe, the AI consoles) cannot be read from here; only the GitHub seat count can. Nor can the permissions of the Railway and Vercel GitHub Apps, the live Railway watch patterns, or which variables sit in Vercel's Preview scope.
8. **The inventory has drifted from reality.** `SUPABASE_URL`, `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN` and `LHCI_GITHUB_APP_TOKEN` are referenced and not set; `PLAYWRIGHT_*` is listed and unused; the USB signing key, the registrar and DNS account and the vault are not listed. `SECRET-ROTATION.md` was deliberately not edited by this change.
9. **No compromise procedure for the Android keystore**, and `sha_pinning_required` is off.
10. **A branch-name rule would close part of item 4**: a PR whose head branch starts with `codex/`, `claude/`, `gemini/` or `grok/` could require a model trailer on every commit whatever its author. Not built; it would also fail the three Codex PRs above, which is the point.

When any of these changes — a workflow's `permissions:`, a repository secret, a deploy target, a new vendor or session type — update this file in the same pull request.
