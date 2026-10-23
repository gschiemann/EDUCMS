---
title: Security overview for IT teams
category: IT & Security
updated: 2026-10-22
excerpt: How VenueOS is hosted, how sign-in and permissions work, how data and screens are protected, and where to send security questions.
---

# Security overview for IT teams

VenueOS is a cloud service for digital signage and emergency alerts. Your staff manage screens from a web dashboard; each screen runs the VenueOS player and receives its content and alerts from the VenueOS cloud. This page is written for the IT and security teams who review it.

## Hosting and data location

| Part | What it does | Where it runs |
|---|---|---|
| Dashboard | The web application your staff use | Vercel, global edge network |
| VenueOS service | Sign-in, content, scheduling, alerts and screen management | Railway, United States |
| Database and file storage | Accounts, settings and uploaded content | Supabase on Amazon Web Services, United States |
| Screen player | Plays content on each display | Android app on the display or media player, or a web browser |

All customer data is stored in the **United States**. Our hosting providers each publish their own independent security audit reports. Card payments are taken on Stripe-hosted pages, so card numbers never reach VenueOS.

Every provider that processes customer data, and when it does, is listed in [Annex B of our Data Processing Addendum](/dpa#subprocessors).

## Sign-in and identity

- **Passwords** must be at least 8 characters and are stored only as salted Argon2 hashes. Sign-in attempts are rate-limited.
- **Two-step sign-in**: passkeys (Face ID, Touch ID, Windows Hello or a hardware security key), authenticator apps with one-time backup codes, and an emailed one-time code as a fallback. The emailed code is not accepted for 7 days after a password reset. What staff see, step by step, is in [Signing in, passkeys and two-step sign-in](/help/signing-in).
- **Who must use it**: your organization can require two-step sign-in for every admin and for everyone allowed to send emergency alerts, and an admin can require it for any individual person.
- **First sign-in**: each new person sets their own password and email address the first time they sign in.
- **Single sign-on**: any OpenID Connect (OIDC) identity provider — for example Google Workspace, Microsoft Entra ID or Okta — limited to the email domains you choose. See [Setting up single sign-on](/help/sso).
- **Sessions**: access expires within an hour. "Keep me signed in" uses a single-use, rotating credential in a cookie that page scripts cannot read; if an old one is ever reused, that whole session is signed out.

## Who can do what

| Role | Can do |
|---|---|
| Admin (organization) | Manage every location, user, branding and content in the organization |
| Admin (location) | Manage screens, playlists, schedules and staff for one location |
| Editor | Upload and edit content and schedules |
| Viewer | Read-only access |

Permission to send emergency alerts is granted **separately, per person**. Every request is limited to the person's own organization, and automated tests on every code change check that each organization's data stays separate.

## Protecting data

- **In transit**: every connection uses HTTPS (TLS), with HSTS on the dashboard.
- **At rest**: the database and file storage are encrypted by the hosting provider. VenueOS additionally encrypts two-step sign-in secrets, single sign-on secrets and the credentials for services you connect.
- **Uploads** are checked by their actual content, not their file name. Disguised, damaged or unsupported files are refused.
- **Private files** — player software, floor plans and problem-report screenshots — are only served through short-lived signed links.
- VenueOS does **not** require student records. Student names and photos stay hidden on public sports screens until a school administrator confirms its directory-information and photo-release policies.

## Audit log

Privileged actions are recorded: sign-ins and two-step events, user and permission changes, content and schedule changes, emergency alerts and all-clears, and screen pairing and removal. Each record names the person, organization, network address, action, target and time. Database rules prevent audit records from being edited or deleted, and admins can filter the audit log in the dashboard and export it as CSV.

## Screens

- **Pairing**: the screen shows a one-time code, and an admin types it into the dashboard. The screen then receives its own credential.
- **Device credentials** are unique to each screen, short-lived and renewed automatically. Removing a screen in the dashboard cuts it off on its next request.
- **Least privilege**: a screen can fetch only its own assigned content and report only its own status.
- **Player software**: release builds are signed, and every update is checked against a fingerprint VenueOS recorded before it installs.
- **Stored content** is checked against its fingerprint before it is kept on the screen. Emergency content is kept in a separate, protected store.

What your network must allow is on [Network and firewall requirements](/help/network-requirements).

## Emergency alerts

Only people granted the alert permission can send alerts, with a deliberate press-and-hold or a typed confirmation, and every alert and all-clear is recorded in the audit log. Alert messages are cryptographically signed before they go out, reach screens over the real-time connection, and fall back to ordinary polling if that connection is unavailable. The [emergency system overview](/help/emergency-system) has the details, including what the system does not cover; text and media messages shown over normal content are covered in [Emergency broadcasts and staff SOS](/help/emergency-broadcast).

## How we build and run it

- Every change goes through version control and automated checks: type checking, automated tests including the emergency alert path, organization-separation checks, secret scanning and a dependency vulnerability audit.
- Secrets live in the hosting providers' secret stores, never in source code.
- The dashboard sends a Content Security Policy and is protected against cross-site request forgery and clickjacking. Server-side requests to addresses a user supplies cannot reach internal networks.
- New versions take traffic only after passing health checks. Nightly encrypted database backups are kept for 30 days. Live health is on the [status page](/status).

## Questions and vulnerability reports

Security questionnaires and documentation requests: security@venue-os.app. To report a vulnerability, see [Report a security vulnerability](/security).
