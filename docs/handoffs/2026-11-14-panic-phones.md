# Emergency mobile workflow — panic session restore + panic phones (2026-11-14)

Owner (2026-11-10): "last thing we need is a login holding back an emergency trigger for a teacher." Built as two drafts. This is the emergency path (life-safety CHANGE class): the owner's written go, a different-vendor review and an on-glass drill before merge. Nothing has run on a real phone, in WebKit end to end, or on real screens.

- **A — `claude/panic-session-restore`** (web only; mergeable on its own)
- **B — `claude/panic-device`** (built on A; API, schema and web)

## What a teacher sees

- **The six buttons show at once.** While the phone checks who is signed in, a line says "Checking your sign-in — you can hold a button now".
- **Order of the check:** this phone's emergency setup, then the saved "keep me signed in" session, then sign-in. Sign-in appears only when there is neither, on a page that says it is for the emergency button and to notify security manually in a real emergency.
- **No signal is never treated as "signed out".** The buttons stay, with a "can't reach VenueOS" line.
- **A press during the check** waits at most 6 s after the 3-second hold, then sends. If it cannot send, the screen says "NOT broadcast — notify security manually". A press is never dropped and never shown as sent when it wasn't.
- **Session expired at the press:** one restore and at most one resend. A refused request did nothing, so it cannot send twice.
- **(B) One-time setup:** "Keep this phone ready for emergencies" → Keep ready. It needs a sign-in less than 15 minutes old.
- **(B) A ready phone** can raise alerts and see live ones. It can never end one: ending an alert needs a full sign-in.

## What an admin can do (B)

- **People → person → "Emergency phones":** each phone with its type, setup date and last use, and a Turn off button.
- **Automatic switch-off:** disabling the account, removing the alert permission, moving the person to another organisation, or an admin two-factor reset turns that person's phones off for good.
- **Audit:** every setup, use, refusal and switch-off writes an immutable `AuditLog` row (`PANIC_DEVICE_ENROLLED` / `USED` / `REFUSED` / `REVOKED`). The `TRIGGER_EMERGENCY` row names the phone.
- **Kill switch:** `PANIC_DEVICE_DISABLED=1` refuses every phone without revoking any; unsetting it restores them all.

## Threat model

- **Lost or stolen phone:** whoever has the unlocked phone can raise an alert until an admin switches the phone off. They can never end an alert, open the dashboard or change anything. Mitigations: the phone's lock screen, the 3-second hold, the audit row on every use, the existing alert emails to admins, and instant switch-off.
- **XSS on our origin:** the credential is an HttpOnly cookie, so no page script can read it. The enrolment reply never contains the secret.
- **Cookie theft:** the server stores only sha256 of a 256-bit secret. The cookie is accepted only through our web server (`SESSION_BFF_SECRET`, fail closed). It is Secure, SameSite=Strict, path `/api/panic`. Uses are rate-limited per phone and per real client address, and logged.
- **Replay:** the secret is deliberately stable rather than rotated on each use. The existing rotation has no grace window, so one lost reply would lock a teacher out mid-emergency. Theft is answered by switch-off and the audit trail.

## Open decisions (recommendation)

1. Confirm `SESSION_BFF_SECRET` is set on Railway and Vercel. Phones refuse to work without it. **Confirm read-only before merge.**
2. Should a teacher changing their own password switch off their phone? **No**; the admin two-factor reset already does.
3. Require Face ID at the press? **No.**
4. Super admins cannot set up a phone. **Keep.**
5. At most 5 phones per person, and setup within 15 minutes of a sign-in. **Keep both.**

## Verification record

- **A:** web tests 36 suites, 421 pass, including restore-before-sign-in, 401-then-restore, press-during-restore, and no session → sign-in.
- **B:**
  - Panic-phone API specs: 94 pass.
  - Isolation matrix, route-guard inventory, CSRF and env-schema: 650 pass.
  - Users: 118 pass. Emergency, role-guard and session specs: 653 pass.
  - Web: BFF 18, panic page 39, login/People/emergency components 244, admin panel 3 — all pass.
  - Migration `20261114120000_panic_devices` applied twice to a throwaway Postgres.
  - Gates: schema-migration, tenant isolation, env, i18n, mobile-perf, inset and rulebook all pass.
- **Unverified:**
  - The full API suite (the owner's rule asks for it before an auth push).
  - Browser e2e, including `emergency-targeting.spec.ts`.
  - A real phone.
  - Production `SESSION_BFF_SECRET` and the forwarded `x-real-ip`.
- **Left alone:** the legacy `/dashboard`, `/screens`, `/schedules` and `/assets` pages each redirect to sign-in in their own code. The sign-in page's already-signed-in redirect rescues them.
