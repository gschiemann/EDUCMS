# Data Retention & Deletion — VenueOS (EDU CMS)

**Status:** Current / living. **Last verified against schema + code:** 2026-05-29.
**Pairs with:** `COMPLIANCE.md` (what data + why) and `SECURITY_BASELINE.md`
(how it's protected). Retention values marked **(policy target)** are the
intended policy, not an automated job that exists today — those are tracked in
§5. Values marked **(enforced)** point to the mechanism that enforces them.

---

## 1. Data classification

| Tier | Definition | Examples here |
|---|---|---|
| **P1 — Authentication secrets** | Anything that grants access if leaked | password hashes, MFA secrets, OAuth refresh tokens, API key hashes, session/JWT material |
| **P2 — Personal data (operators)** | Identifies a staff user | name, email, phone, IP address, device fingerprint |
| **P3 — Operator-published people** | A person named/shown in signage by operator choice | staff spotlight images, sports roster name/number/photo |
| **P4 — Operational content** | Signage + config | assets, templates, playlists, schedules, branding |
| **P5 — Forensic / audit** | Immutable record of privileged actions | `AuditLog`, game event log, Stripe-event ledger |
| **P6 — Telemetry / support** | Operational signals | playback samples, touch events, player logs, bug reports, email logs |

**Note:** there is **no student-academic-record tier** — none is stored (see
`COMPLIANCE.md` §1–2).

## 2. Retention table (data class → location → retention → deletion)

| Data | Model / store | Retention | Deletion mechanism |
|---|---|---|---|
| Operator account (name/email/phone) | `User` (`schema.prisma:357`) | Life of the relationship | Operator-initiated delete via `users.controller.ts`; cascades to owned rows |
| Password hash (Argon2id) | `User.passwordHash` | With the account | Deleted with the user row |
| MFA TOTP secret (AES-encrypted) | `User.mfaTotpSecret` | With the account / until MFA disabled | Cleared on MFA disable; deleted with user |
| MFA backup codes (Argon2id hashes) | `User.mfaBackupCodes` | Until consumed / re-generated | Single-use removal on consume |
| Password-reset token | `PasswordResetToken` (`expiresAt` `schema.prisma:455`) | Short-lived | **(enforced)** auto-expires via `expiresAt`; single-use |
| User-invite token | `UserInvite` (`expiresAt` `schema.prisma:503`) | Short-lived | **(enforced)** `expiresAt`; consumed on accept |
| Passkey (WebAuthn) | `Passkey` (`schema.prisma:479`) | Until user removes it | User-initiated delete |
| JWT (user, 1 h / 30 d remember-me) | stateless + Redis revocation set | TTL-bounded | **(enforced)** expiry; logout SADDs to `jwt_revoked_list` (`jwt-auth.guard.ts:100`) |
| Tenant / org profile + branding | `Tenant`, `TenantBranding` | Life of the tenant | Tenant purge via `tenants.controller.ts` (cascades) |
| Integration OAuth tokens (encrypted) | `*ProviderConnection`, `TenantSSOConfig` | Until disconnect | **(enforced)** disconnect purges the token; cascades on tenant delete |
| Screen device identity + IP/OS/browser | `Screen` (`schema.prisma:660-662`) | Life of the paired screen | Unpair/delete via `screens.controller.ts` |
| Assets (image/video/PDF) | `Asset` + Supabase storage | Until operator deletes | Operator delete; storage object removed |
| Operator-published people (sports roster) | `RosterPlayer` (`schema.prisma:1847`) | Until game/roster deleted | **(enforced)** `onDelete: Cascade` from `Game` (`schema.prisma:1862`) |
| Templates / playlists / schedules | `Template`/`Playlist`/`Schedule` | Until operator deletes | Operator delete |
| **Audit log** | `AuditLog` (`schema.prisma:1024`) | **Append-only, retained** | **(enforced)** DB trigger blocks UPDATE/DELETE (`migrations/20260526010000_audit_log_immutability/migration.sql`); only a deliberate, itself-audited `DROP TRIGGER` migration can purge |
| Stripe event ledger | `ProcessedStripeEvent` (`schema.prisma:559`) | Retained for idempotency/forensics | Manual only |
| Playback samples (telemetry) | `PlaybackSample` (`schema.prisma:1280`) | **90 d (policy target)** | **(gap)** time-based sweep not yet automated — §5 |
| Touch events | `TouchEvent` (`schema.prisma:1251`, "retention sweep" comment) | **90 d (policy target)** | **(gap)** sweep not yet automated — §5 |
| Player logs | uploaded via `player-logs.controller.ts` | **30 d (policy target)** | **(gap)** sweep not yet automated — §5 |
| Email log | `EmailLog` (`schema.prisma:590`) | **180 d (policy target)** | **(gap)** sweep not yet automated — §5 |
| Bug reports + screenshots | `Bug` (`schema.prisma:1997`) | Until resolved + retention window | Operator/SUPER_ADMIN delete |

## 3. Storage locations

- **PostgreSQL (Supabase)** — all relational data above. US region (confirm per
  deploy; document in the DPA).
- **Supabase Object Storage** — asset binaries, branding logos, screenshots,
  floor plans. Public bucket for general assets (mime-allowlisted, SVG blocked,
  `supabase-storage.service.ts:57`); sensitive assets use signed short-TTL URLs.
- **Redis (Railway/managed)** — ephemeral: pub/sub, JWT revocation set,
  per-user invalid-before epochs, rate-limit counters. No durable PII.
- **Sentry** — error traces (stack traces scrubbed in prod, `AllExceptionsFilter`);
  configure PII scrubbing per Sentry project.
- **Stripe** — card data (we never store it); customer/subscription metadata.

## 4. Deletion & data-subject (DSAR) path

**Operator account deletion (available today):**
1. Admin deletes the user via the dashboard → `users.controller.ts` delete path.
2. Owned/authored rows cascade or are reassigned per FK rules.
3. The deletion itself is written to `AuditLog` (which remains immutable).

**Full tenant purge (available today):**
1. SUPER_ADMIN deletes the tenant via `tenants.controller.ts`.
2. Cascades remove the tenant's users, screens, content, integration tokens.
3. Supabase storage objects for that tenant are removed.

**DSAR request (operator personal data):**
- A district can request export/deletion of a named operator's personal data.
  Today this is a **manual, support-assisted** flow (export the `User` row +
  authored content references; then delete as above). **(policy target:** a
  self-serve export + a documented SLA — §5.)

**What CANNOT be deleted by design:** `AuditLog` rows. Forensic integrity
outranks convenience; a legitimate retention purge must be a deliberate
`DROP TRIGGER` migration that is itself audited
(`migrations/20260526010000_audit_log_immutability/migration.sql` header).

## 5. Known gaps (tracked, NOT done)

1. **No automated time-based retention sweeps** for P6 telemetry
   (`PlaybackSample`, `TouchEvent`, player logs, `EmailLog`). The schema is
   retention-aware (`createdAt` indexes, "retention sweep" comments) but the
   cron isn't built. Until then these grow unbounded. **Build a daily sweep
   cron** honoring the policy-target windows in §2.
2. **No self-serve DSAR export** — operator-data export is manual; formalize a
   self-serve export + a deletion SLA (e.g. 30 days) in the DPA.
3. **Audit-log long-term retention policy** — currently "retain indefinitely."
   If a district DPA mandates a max retention, that becomes the deliberate
   `DROP TRIGGER` + archive migration (and the archive must stay tamper-evident).
4. **Backups** — point-in-time DB backups live with Supabase; deletion of a
   data subject does not retroactively purge historical backups until they age
   out. Document the backup retention window in the DPA.

## 6. Discipline

- New model holding P1/P2/P3 data → add a row to §2 with its location +
  retention + deletion mechanism before merge.
- New telemetry table → wire it into the retention sweep (§5 item 1), don't
  let it accumulate unbounded.
- Never add a deletion path for `AuditLog` outside an audited `DROP TRIGGER`
  migration.
