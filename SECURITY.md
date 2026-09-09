# Security Policy

VenueOS runs life-safety software. The same screens that show a lunch menu on
Tuesday show a lockdown alert on Friday, in K-12 schools, live venues, and
workplaces. We treat a security report as a first-class bug, not a nuisance.

If you have found a vulnerability, we want to hear from you, and we will not
take legal action against you for reporting it in good faith. See
**[Safe harbor](#safe-harbor)** below.

---

## Reporting a vulnerability

**Email: security@venue-os.app**

Please include, as far as you have it:

- What the issue is, and the impact you believe it has
- Steps to reproduce (a proof-of-concept, a request/response pair, or a short
  video all work)
- The affected URL, endpoint, app version, or APK version
- Whether you accessed, modified, or retained any data (see
  [Rules of engagement](#rules-of-engagement))

Email is the only reporting channel. This repository is **private**, so
GitHub's issue tracker and its private vulnerability reporting form are not
reachable by outside reporters — do not spend time looking for them. If you
have been given repository access, still report by email rather than by
opening an issue or a pull request: an issue is a disclosure to everyone who
holds access.

### What to expect

| Stage | Our commitment |
|---|---|
| Acknowledgement | Within **3 business days** |
| Initial assessment + severity | Within **10 business days** |
| Fix for Critical / High | Target **30 days** from triage |
| Fix for Medium / Low | Target **90 days** from triage |
| Public disclosure | Coordinated with you, normally after a fix ships |

If we are going to miss one of these, we will tell you rather than go quiet.
We will credit you in the advisory unless you ask us not to.

We do **not** currently run a paid bug bounty. We are a small team, and we would
rather be honest about that up front than imply a reward that does not exist.

---

## Scope

### In scope

- The dashboard and player web application (`venue-os.app` and its
  `*.vercel.app` deployments)
- The API (`/api/v1/*`)
- The Android player and manager APKs in `apps/player/`
- This repository's source code, CI workflows, and build/release pipeline

We are most interested in anything that would let someone:

- **Take over a screen** — display unauthorized content on a customer's display
- **Suppress or forge an emergency alert** — the highest-severity class here. A
  lockdown alert that does not display, or a fake one that does, is the worst
  outcome this product has.
- **Cross a tenant boundary** — read or write another school district's or
  venue's data
- **Escalate privilege** — reach an admin capability from a lower role, or from
  no account at all
- **Reach student or staff data** — anything touching FERPA/COPPA-covered
  records

### Out of scope

These are either known, accepted, or not vulnerabilities. Reports limited to
these will be closed politely:

- Missing security headers with no demonstrated exploit
- Rate limiting on non-authentication, non-destructive endpoints
- Clickjacking on pages with no state-changing action
- Self-XSS, or attacks requiring a fully compromised device or browser
- Social engineering of our staff or customers
- Denial of service through volumetric traffic
- Automated scanner output with no verified, reproducible impact
- Vulnerabilities in third-party services we consume (report to them; tell us
  too if it affects our customers)
- Findings that require physical access to an already-unlocked device, beyond
  the kiosk-hardening surface itself

---

## Rules of engagement

Testing is welcome within these limits:

1. **Use your own tenant and your own data.** Sign up for a trial rather than
   testing against a live school district.
2. **Do not access, modify, delete, or retain data that is not yours.** If you
   access someone else's data by accident, stop, and tell us what you saw so we
   can meet our notification obligations.
3. **Never test emergency triggers against a real deployment.** Firing a
   lockdown alert on a live school is a real-world safety event, not a finding.
   Tell us the vector; we will reproduce it ourselves in an isolated tenant.
4. **No denial of service, no volumetric or stress testing, no spam.**
5. **No physical intrusion, and no social engineering** of staff, customers, or
   contractors.
6. **Stop at proof.** Demonstrate the vulnerability, then stop — do not pivot,
   escalate further, or establish persistence.

## Safe harbor

If you make a good-faith effort to follow this policy, we will:

- Consider your research **authorized** under the Computer Fraud and Abuse Act
  and equivalent laws, and under our Terms of Service
- Waive any Terms of Service restriction that would otherwise prohibit it, for
  the limited purpose of your research
- Not pursue or support any legal action against you
- Work with you if a third party brings action, to make clear your research was
  authorized

This does not extend to actions that violate the rules above — particularly
accessing real customer data or triggering real emergency alerts.

If you are unsure whether something is in scope, ask us first at
security@venue-os.app. We would much rather answer a question than receive an
apology.

---

## Supported versions

| Component | Supported |
|---|---|
| API + dashboard | The currently deployed production release only |
| Android player APK | Latest release, plus the immediately preceding release |
| Android manager APK | Latest release only |

We are a continuously deployed product with a single production line. There are
no long-term support branches; fixes ship forward.

---

## For school districts and procurement

If you are evaluating VenueOS and need security documentation for a district
review, contact **security@venue-os.app**. Related material:

- Privacy policy: <https://venue-os.app/privacy>
- Terms and EULA: <https://venue-os.app/terms>
- FERPA questions: ferpa@venue-os.app
- COPPA questions: coppa@venue-os.app
- Data subject requests: dsr@venue-os.app

### Controls in place today

Stated plainly, so a reviewer can verify rather than take our word for it:

- **Passwords** are hashed with argon2id. We never store or log plaintext
  passwords, and we never ask for one over email or chat.
- **Sessions** use HttpOnly cookies plus JWTs with server-side revocation.
- **Tenant isolation** is enforced per query and additionally guarded by a CI
  gate that fails the build on an unscoped database query.
- **Emergency actions** are all written to an append-only audit log with the
  acting user, timestamp, and scope.
- **Realtime messages** are HMAC-signed and verified server-side before they
  can enter the broadcast bus.
- **Payment card data never touches our systems** — card entry happens only on
  Stripe-hosted pages (PCI SAQ-A).
- **Secrets** are environment-provided. The API refuses to boot in production
  if a required secret is missing, and CI scans every commit for leaked
  credentials.
- **Dependencies** in the production graph are scanned on every push and pull
  request, and the build fails on a HIGH or CRITICAL advisory
  (`scripts/npm-advisory-audit.cjs`). Moderate and low advisories are reported,
  not blocking. An advisory with no upstream fix can carry a dated waiver, and
  a waiver only holds while the script re-derives its "vulnerable path is
  unreachable here" proof against the installed tree on that same run — a
  dependency bump that re-opens the path turns the waiver off rather than
  hiding behind it.

### Known limitations

We would rather you learn these from us than from a pen test. They are graded
deliberately, because "we built it," "it is configured," "it is switched on in
production," and "we have proven it against the vendor" are four different
claims and only the first is answerable from source code.

- **MFA (TOTP) is implemented, and enforced on a dated schedule rather than
  from day one.** Enrollment, verification, backup codes, an encrypted secret
  at rest, and a forced-enrollment path that lets a held-back privileged user
  enrol without first holding a full session all ship
  (`apps/api/src/auth/mfa.controller.ts`). One policy module decides who must
  hold a second factor — SUPER_ADMIN / DISTRICT_ADMIN / SCHOOL_ADMIN, anyone
  carrying `canTriggerPanic`, plus any per-account override
  (`apps/api/src/auth/mfa-policy.ts:66`) — and both login and session refresh
  consult it (`auth.service.ts:345`, `auth.service.ts:537`). The **derived**
  requirement is advisory until **2026-10-04** and blocking after
  (`mfa-policy.ts:81`, `mfa-policy.ts:218`); a per-account override blocks
  immediately. Until that date a privileged account that has not enrolled can
  still sign in on a password alone. An env var can move the deadline or, as
  break-glass, switch the derived requirement off entirely.
- **SSO: OIDC is functional. SAML is not.** OIDC login, callback, issuer
  discovery, state/nonce binding, and an `enabled` gate on both the login and
  the callback are real code against `openid-client` 5.7.1
  (`apps/api/src/sso/sso.controller.ts:137`, `:157`;
  `apps/api/src/sso/sso.service.ts:528`). **SAML is deliberately
  non-functional**: `passport-saml` 3.x is not installed because of
  CVE-2025-54419, which has no patched release on that line, so the SAML login
  path always fails with "SAML SSO is not available in this build"
  (`sso.service.ts:464`), and arming a SAML config at all is SUPER_ADMIN-only.
  Do not read "SSO" on a feature list as "SAML."
- **Clever rostering is implemented but unvalidated and dormant.** The OAuth
  handshake, encrypted token storage, roster sync and its cron are written and
  mounted (`apps/api/src/integrations/clever/`), and gated on credentials being
  present (`clever.service.ts:96`). It has never been run against Clever's real
  API — the HTTP client says exactly that at the source
  (`clever-http.client.ts:37`). Treat it as untested until we tell you
  otherwise in writing.
- **We cannot tell you from source which of these is live for your tenant.**
  Whether an account has enrolled in MFA, whether OIDC is configured, and
  whether Clever credentials are set are per-deployment and per-tenant state,
  not code. If you need the posture of a specific environment, ask us and we
  will check it rather than guess.
- **This repository is private.** Outside researchers cannot read the source,
  open an issue on it, or use GitHub's private vulnerability reporting — email
  is the channel. Source review is therefore not a control you can exercise
  independently; the CI gates above are.
- **We do not claim the git history has never held a secret.** gitleaks runs on
  every pull-request diff and over full history on every push to master, and
  fails the build on a high-confidence finding
  (`.github/workflows/ci.yml`); its allowlist is per-fingerprint, never
  per-path (`.gitleaksignore`). That is a forward-looking gate, not a proof
  about every commit ever made.

---

*Last reviewed: 2026-09-08*
