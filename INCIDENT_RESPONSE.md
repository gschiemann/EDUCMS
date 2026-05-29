# Incident Response Runbook — VenueOS (EDU CMS)

**Status:** Current / living. **Last verified:** 2026-05-29.
**Scope:** security breaches, false / failed **emergency** fires (life-safety),
and data leaks. Reuses the existing recovery procedures rather than inventing
new ones: rollback lives in `docs/BACKUP_AND_ROLLBACK.md`; deploy/health
recovery lives in CLAUDE.md "Deploy reliability". This runbook is the
**incident wrapper** around those tools: detect → contain → eradicate →
recover → communicate → post-mortem.

**Severity ladder:**
- **SEV-1** — life-safety (false or failed emergency alert) OR confirmed
  cross-tenant data breach OR full auth bypass. All hands, immediate.
- **SEV-2** — single-account compromise, single-tenant data exposure, payment
  integrity issue, or API down for the fleet.
- **SEV-3** — degraded feature, contained abuse, no data/safety impact.

**Roles (assign at declaration, even if one person wears all hats):** Incident
Commander (owns the call), Comms Lead (district + internal), Scribe (timeline →
becomes the post-mortem). For VenueOS today the lead engineer is IC by default.

---

## 1. Detection — how an incident surfaces

| Source | Watch for |
|---|---|
| Sentry | 5xx spike, `AllExceptionsFilter` captures, auth-error bursts |
| Railway logs | `[security] refusing to start`, CSRF_BLOCK floods, `DROPPED unverified message` on a WS channel, DB pool timeouts |
| `/api/v1/health` + `/health/ready` + `/health/emergency-path` | liveness 200 but `db`/`redis` degraded; readiness 503; emergency-path failing |
| `prod-smoke.yml` / Vercel cron `/api/cron/keepwarm` | post-deploy smoke red; keepwarm non-200 |
| Audit log (`/audit`) | unexpected `TRIGGER_EMERGENCY`, mass role changes, AI-key changes, license ops |
| District report | "the screens are showing a lockdown and there's no emergency" / "we triggered and nothing happened" |
| gitleaks (pre-commit + CI) | secret committed to the **public** repo |

**The `DROPPED unverified message` log line is a security signal** — it means
something published to a `tenant:*`/`group:*`/`device:*` Redis channel without a
valid HMAC (`redis.service.ts:139`). One-off can be clock skew; a sustained
stream means a compromised Redis or a forged-publish attempt → treat as SEV-1.

---

## 2. SEV-1 · False emergency fired (a lockdown/evac alert is showing and shouldn't be)

**This is life-safety. Speed beats elegance. The all-clear path is the primary
containment tool — it is faster and safer than a rollback.**

1. **CONTAIN — clear the alert.** Issue an **all-clear** for the affected scope
   via the dashboard / mobile panic page →
   `POST /api/v1/emergency/:overrideId/all-clear`. This clears
   `Tenant.emergencyStatus`, publishes a signed `ALL_CLEAR`, and screens
   reconcile within ~10 s (WS + manifest-poll backstop).
2. **VERIFY** screens returned to normal content (spot-check a few; the manifest
   poll guarantees convergence even if a WS message was missed).
3. **IDENTIFY the source** from the immutable `AuditLog`: the
   `TRIGGER_EMERGENCY` row carries `userId`, scope, severity, timestamp
   (`emergency.controller.ts:441`). Was it (a) an authorized operator mistake,
   (b) a compromised account, or (c) a forged publish (look for
   `DROPPED unverified message` — if the message was *accepted*, the HMAC was
   valid, so the secret or an operator account is the issue, not Redis)?
4. **ERADICATE per cause:**
   - Operator mistake → coach; no system change.
   - Compromised account → §3 (revoke + reset).
   - Forged-but-valid signature → the signing secret is compromised → **rotate
     `DEVICE_SECRET_KEY`** (the HMAC key, `redis.service.ts:14`) immediately;
     redeploy; treat as full SEV-1 secret-rotation (§4).
5. **DO NOT** weaken the emergency safeguards to "make it stop" — never disable
   the HMAC gate, never skip the audit write (CLAUDE.md emergency rule).

## 2b. SEV-1 · Emergency FAILED to fire (operator triggered, screens didn't change)

1. **Check `/api/v1/health/emergency-path`** — it verifies DB + WS-signer chain.
   If red, the trigger never signed/published.
2. **Confirm the trigger was recorded** (`AuditLog` `TRIGGER_EMERGENCY`). If the
   row exists but screens didn't update → fan-out/transport issue.
3. **Redis down?** The HTTP-polling backstop still carries the live
   `emergency` field in each screen's manifest — screens converge on the next
   poll. If polling is also failing, the API itself is down → §5.
4. **Re-trigger** once the path is green; verify on a screen.
5. Treat any "emergency did not reach screens" as SEV-1 even after recovery —
   it is the worst failure mode this product has.

## 3. SEV-1/2 · Account compromise / auth bypass

1. **CONTAIN — revoke the session(s):**
   - Single token: logout SADDs it to `jwt_revoked_list`; the guard denies on
     every request and **fails closed** (`jwt-auth.guard.ts:100-126`).
   - All of a user's sessions: trigger a **role/privilege change** (or a
     dedicated revoke-all) so the per-user **invalid-before epoch** rejects
     every token issued earlier (`jwt-auth.guard.ts:113-118`).
2. **Force a password reset** for the account; require MFA re-enrollment if the
   MFA secret may be exposed.
3. **Scope the blast radius** from `AuditLog`: what did the actor touch? Any
   cross-tenant access (should be impossible via app-layer scoping — if it
   happened, that's a SEV-1 isolation bug → §6).
4. **If the bypass was systemic** (e.g. a guard regression), roll back to the
   last-good tag (`docs/BACKUP_AND_ROLLBACK.md`) and patch forward.

## 4. SEV-1 · Secret exposure (committed key, leaked env)

The repo is **PUBLIC** — a committed secret is live to the world immediately.

1. **Rotate the exposed secret NOW** (Railway/Vercel env):
   - `JWT_SECRET` / `SESSION_SECRET` → invalidates all sessions (users
     re-login); acceptable cost.
   - `DEVICE_SECRET_KEY` (WS HMAC) / `DEVICE_JWT_SECRET` → re-pair/redeploy;
     this is the emergency-signing key, so prioritize it.
   - `STRIPE_*` → rotate in Stripe + env; re-point the webhook secret.
   - Provider keys (Resend / AI / Clever / Square) → rotate at the provider.
2. **Redeploy** so the boot-time `requireSecret()` picks up the new value
   (`security/required-secret.ts`).
3. **Purge the secret from git history** if committed (BFG/filter-repo) and
   force-push; confirm gitleaks is green.
4. **Review** for any use during the exposure window (provider dashboards,
   `AuditLog`).

## 5. SEV-2 · API down / fleet can't reach the server

Follow CLAUDE.md "Deploy reliability":
1. `curl https://<railway-api>/api/v1/health` — if 502, the container is down
   (health always returns 200 when merely degraded).
2. **Railway → Deployments → Restart latest** (auto-restart covers most blips:
   10 retries / 300 s). Do **not** weaken the restart policy.
3. **DB errors** → Supabase pooler hiccup; confirm `DATABASE_URL` has
   `connection_limit>=10&pool_timeout>=20` (boot now refuses without it,
   `main.ts:156-178`; memory: `connection_limit=1` was the silent killer).
4. **UI "can't reach server"** → check `NEXT_PUBLIC_API_URL` in Vercel.
5. **Emergencies still work with Redis down** (HTTP-polling fallback) — don't
   panic-disable realtime.

## 6. SEV-1 · Cross-tenant data leak

Tenant isolation is **app-layer** (Prisma `tenantId` scoping), so a leak means a
missing filter or an authz regression, not a DB-policy failure.
1. **CONTAIN** — if a specific endpoint is leaking, disable/guard it (feature
   flag or hotfix) and redeploy.
2. **Quantify** via `AuditLog` + logs: which tenants' data, which records, who
   accessed.
3. **Eradicate** — add the missing `where: { tenantId }` / ownership check;
   add a regression test (`TEST_STRATEGY.md` §4 cross-tenant IDOR target).
4. **Notify** affected districts per §7 + the DPA's breach-notification clause.

## 7. Communication

- **Internal:** declare in the team channel with SEV + IC + one-line impact.
  Scribe keeps the timeline.
- **District-facing (SEV-1/2 with safety or data impact):** Comms Lead notifies
  affected district contacts. For a **false emergency**, the message is: what
  showed, that it was cleared at HH:MM, that it was not a real threat, and the
  cause once known. For a **data incident**, follow the DPA breach clause +
  applicable state breach-notification law (`COMPLIANCE.md` §5).
- **Status:** if/when a public status page exists (Phase C backlog), post there.

## 8. Recovery & rollback

- **Roll back code:** `git reset --hard backup/pre-<thing>-TIMESTAMP` per
  `docs/BACKUP_AND_ROLLBACK.md`; redeploy; verify `/health` + `prod-smoke`.
- **Before risky changes** (so rollback exists): tag + push per the same doc.
- **Verify before declaring resolved** — screens normal, health green, smoke
  green, Vercel/Railway "Ready" newer than the fix (CLAUDE.md §21).

## 9. Post-incident (required for every SEV-1, recommended for SEV-2)

1. Write a blameless post-mortem from the Scribe timeline: detection time,
   containment time, root cause, blast radius, what worked, what didn't.
2. **File the systemic fix** and a **regression test** so it can't recur.
3. **If it's a recurring class, add a memory + CLAUDE.md rule** — that's how the
   `inset:0`, `connection_limit=1`, and `verifyMessage()`-theater lessons became
   permanent guardrails. Sweep the whole class, not just the one instance
   (memory: `feedback_audits_must_be_exhaustive`).
4. Close any KNOWN GAP this incident exercised in `SECURITY_BASELINE.md` /
   `THREAT_MODEL.md`.

---

## Quick command reference

```bash
# Health / readiness / emergency path
curl https://<railway-api>/api/v1/health
curl https://<railway-api>/api/v1/health/ready
curl https://<railway-api>/api/v1/health/emergency-path

# Roll back to last-good (see docs/BACKUP_AND_ROLLBACK.md)
git reset --hard backup/pre-<thing>-YYYYMMDD-HHMMSS && <redeploy>

# After rotating a secret, redeploy so requireSecret() reloads it.
```
