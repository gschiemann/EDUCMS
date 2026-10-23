# Access control

**Owner:** VenueOS owner · **Last reviewed:** 2026-10-23 · **Covers:** the product's roles and sign-in, and VenueOS's own access to source code, hosting and vendor accounts

## Principles

- Least privilege. A person, an API key or a screen gets only what it needs, and a role can only hand out roles below its own.
- Every request is limited to the caller's own organization.
- Privileged actions are written to an audit log that cannot be edited.
- No shared accounts. Humans have their own logins; machines have their own scoped credentials.

## Roles in the product

| Role (name in the dashboard) | Who holds it | What it can do |
|---|---|---|
| `SUPER_ADMIN` (platform operator) | VenueOS staff only | Operate the platform across organizations. It cannot be granted through any customer-facing flow: user management, invites, single sign-on defaults or API keys. |
| `DISTRICT_ADMIN` (organization admin) | Customer | Manage every location, user, brand and piece of content in the organization |
| `SCHOOL_ADMIN` (location admin) | Customer | Manage screens, playlists, schedules and staff for one location |
| `CONTRIBUTOR` (editor) | Customer | Upload and edit content and schedules |
| `RESTRICTED_VIEWER` (viewer) | Customer | Read-only |

Sending an emergency alert is a separate per-person permission (`canTriggerPanic`) on top of the role. An admin grants it, it takes a deliberate press-and-hold or typed confirmation, and an API key can never send an alert.

## How access is limited

- **Granting roles.** You can assign only roles strictly below your own. Invites, direct user creation and the single sign-on default role all use the same check (`apps/api/src/auth/role-assignment.ts`).
- **Organization boundary.** Requests are scoped to the caller's organization. A CI gate fails the build when a new database lookup on an organization-owned table is not scoped; the list of tolerated exceptions is currently empty. The gate catches one common mistake pattern, so it is a guard, not a proof.
- **Disable, demote, remove.** Admins can disable or remove anyone below them in their own organization without contacting VenueOS. Demoting someone, removing their alert permission, disabling or removing them, or resetting their two-step sign-in revokes their sessions on every device at once. Without that, a token could stay valid for up to 30 days.
- **API keys.** Created per organization, limited to a role (never platform operator), optionally narrowed to named route families as read or write, shown once and stored only as a SHA-256 hash. They expire after 90 days unless the creator sets a shorter life, and 365 days is the maximum.
- **Screens.** Each screen gets its own credential at pairing. It lasts 1 hour, renews itself, and works only for that screen's own content and status. Removing a screen cuts it off on its next request.
- **Audit log.** Sign-ins, two-step events, user and permission changes, content and schedule changes, emergency alerts and all-clears, and screen pairing and removal are recorded with the person, organization, network address, action, target and time. Database triggers block UPDATE, DELETE and TRUNCATE on the audit table.

## Signing in

- **Passwords:** at least 8 characters, stored only as salted Argon2id hashes (64 MiB of memory, 3 passes). Never logged or emailed.
- **Brute-force limits:** 10 sign-in attempts per minute per network address. Per account, failures back off exponentially from the 5th, and at 20 failures the account is locked for 15 minutes. During a lock even the correct password is refused.
- **Second factor:** passkeys (user verification required: Face ID, Touch ID, Windows Hello or a hardware key), authenticator-app codes with one-time backup codes, or an emailed one-time code as a fallback that is not accepted for 7 days after a password reset. Authenticator secrets are encrypted at rest.
- **Who must use one:** admins and everyone allowed to send emergency alerts must hold a second factor wherever their organization has enforcement on. Organizations that existed on 2026-09-11 were set to enforced. New organizations start with enforcement off and can switch it on at any time. An admin can also require it for any single person, and that always applies immediately. VenueOS operator accounts must hold a second factor.
- **Single sign-on:** OpenID Connect, limited to the email domains the customer chooses. SAML is not available.
- **Sessions:** access tokens last up to 1 hour. A session without "keep me signed in" can renew for up to 12 hours after sign-in. With it, up to 30 days, using a single-use rotating credential in an HttpOnly cookie that page scripts cannot read. Presenting a spent credential signs that whole session out.
- **First sign-in:** a new person sets their own password and email before anything else works.
- **Break-glass.** One platform-wide setting can suspend the role-based two-step requirement so the owner can recover from a lockout. It prints a warning in the logs while set, and it never removes an admin's per-person requirement.

## VenueOS staff and vendor accounts

These rules apply to every account that can reach source code, production hosting, the database, secrets, billing, email sending or customer data:

1. Multi-factor authentication is on. A passkey or security key is preferred. Recovery codes live in the owner's password manager.
2. Each account belongs to one named person. No shared logins, and no credentials in chat, tickets or source code.
3. The smallest role that does the job. Automation uses its own scoped token, never a person's.
4. Secrets live in the hosting providers' secret stores and in GitHub Actions secrets, never in source. Production refuses to start if a required secret is missing. A secret that may have been exposed is rotated using [`docs/SECRET-ROTATION.md`](../SECRET-ROTATION.md), which lists every place each one is used.

How this looks today:

- The owner is the only person with access to production hosting, the database and vendor consoles. GitHub lists one collaborator.
- GitHub Actions tokens are read-only by default, and every third-party action is pinned to a full commit hash. Only the release workflow uses the Android signing key, which is kept in GitHub secrets with an offline copy held by the owner.
- Destructive database commands (such as a full reset) are refused unless the target is provably a local throwaway database.
- MFA on each vendor account is confirmed by the owner at the annual review below. The vendors are listed in [vendor-management.md](vendor-management.md).

## Joiners, movers and leavers

- **Customer users** are invited or created by an admin who outranks them, and role changes are audited. When someone leaves, their own organization's admin disables or removes them. A removed account cannot sign in, its email on the account row is replaced, and the audit trail keeps a record of what that person did.
- **VenueOS staff.** There is no one besides the owner today. Before anyone is given access: a named account, MFA, the smallest role, and an entry in the review below. On leaving, the same day: remove them from GitHub, hosting, the database, payments, email, monitoring, AI and password-manager vaults; revoke their tokens; rotate every secret they could read; and review the audit log for their last 30 days.

## Reviews

Access to vendor consoles, the GitHub repository and operator accounts is reviewed once a year with this policy, and after any security incident.

## Gaps

- **Not in place:** a written access-review log kept with these documents. Today the review happens but is not recorded anywhere.
- **Not in place:** SAML single sign-on. The library we would need has an unpatched advisory.
- **Not in place:** a second person who can recover the owner's accounts if the owner is unavailable.
