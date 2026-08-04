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

Do **not** open a public GitHub issue or pull request for a vulnerability.
This repository is public; an issue is a disclosure.

If you prefer a coordinated channel, you can also use GitHub's
[private vulnerability reporting](https://github.com/gschiemann/EDUCMS/security/advisories/new)
on this repository.

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
- **Dependencies** are scanned on every push, and the build fails on a known
  vulnerable production dependency.

### Known limitations

We would rather you learn these from us than from a pen test:

- **MFA is not yet available.** It is on the roadmap. Today, account security
  rests on password strength and session revocation.
- **SSO (SAML/OIDC) and Clever rostering are not yet shipped.** District
  identity integration is planned, not delivered.
- **This repository is public.** Source code being readable is deliberate, not
  an oversight. No credential, key, or customer datum is stored in it, and CI
  enforces that on every commit.

---

*Last reviewed: 2026-08-04*
