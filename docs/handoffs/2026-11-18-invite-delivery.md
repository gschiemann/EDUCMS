# Invitations that were sent and never seen (2026-11-18)

The owner invited two new people to one location at 11:25 and 11:26 CT. Both said the invitation never came. This is what was found, what changed, and what is still unproven. No address or name of the people involved is recorded here.

## What happened

- **Our side worked.** Both `user_invites` rows exist, both `email_logs` rows are `SENT`, the link in the body points at the production web origin. Both were sent an hour after the day's second deploy, so the deploys did not cause it.
- **The provider's side worked.** Resend (read through its connector, status and domain setup only, never a message body) shows both messages `delivered`: 0 bounced, 0 delayed, 0 suppressed. The sending domain's DKIM and both SPF records are verified. DNS carries a DMARC record (`p=none`). The one failed record on the domain is the receiving MX, which does not affect sending.
- **"Delivered" means the recipients' mail server accepted the message.** What that server did next cannot be seen by any sender. The same corporate domain had used 6 of 6 emailed sign-in codes within ten minutes since 2026-10-05, so the domain does not block the sender outright.
- **The likely reason, not proven:** the subject was `<inviter address> invited you to <workspace> on VenueOS`, and the inviter's address was inside the recipients' own organisation. Mail from outside that names an internal address in its subject, with a short text body and one link, is the shape impersonation filters quarantine. Open tracking is off, so nothing shows whether either message was ever opened.

## Why the administrator was stuck (the product defects)

1. **No link.** `POST /api/v1/invites` returns the one-time link every time, but the People page showed it only when the provider REFUSED the mail (`emailDelivered: false`). When the provider accepted it, the page said "Invitation sent" and the link was gone.
2. **No second try.** Inviting the same address again inserted a second `user_invites` row for the same placeholder user, and `user_id` is unique. The test fake did not enforce that constraint, so the tests were green while the path could not work.
3. **"Sent" meant "handed over".** `email_logs.status` never recorded what the provider reported afterwards. (It would have said `delivered` here; the first two points are what would have helped on the day.)
4. Only three invitations had ever been sent by this system and none had been accepted, so the mail path had never been proven end to end with an outside mailbox.

## What changed

- **Mail.** Subject is now `You're invited to <workspace> on VenueOS`. The body names the inviter by name when the account has one, by address otherwise. The message has an HTML part beside the text (no remote image, no tracking, the same link). Names are HTML-escaped and a name cannot add a line to the subject. Only the text with the token redacted is kept in `email_logs`.
- **Delivery state.** `email_logs` gains `provider_id`, `delivery_status`, `delivery_checked_at` (migration `20261118120000_email_delivery_status`, additive, nullable, idempotent). The provider's id is stored at send time. `EmailService.inviteDelivery` reads the provider's last event on demand: at most once per 30 s per message, never again once final, 4 s limit, never an error for the caller. It reads `last_event` only; the provider's answer also carries the body with a live link, which is neither logged nor stored.
- **Invite again.** `createInvite` on a person who has not accepted replaces the earlier invitation's token in the same transaction, so exactly one link is valid: the newest. The audit row carries `reissued: true`. The fake now enforces the unique `user_id`.
- **`GET /api/v1/invites`** (same roles as creating one, caller's tenant only, 30 per minute): pending invitations with expiry and delivery state. At most 100 rows; only the newest 5 may ask the provider in one call. Nothing polls it: the People page reads it on open and after an invitation.
- **People page.** The one-time link is shown after every invitation. Pending invitations show what the provider reported and the expiry, and offer "Send again", which shows the new link. Strings in en, es, zh.

## Evidence

- API: email and onboarding suites 111 tests; full suite 12,615 pass with the same four suites failing as on master (ffmpeg and the local Prisma stand-in), nothing new. Web: People suites 65 tests; `tsc --noEmit` clean; i18n parity 7,659 keys.
- 15 deliberate breakages (re-issue removed, list not tenant-scoped, non-waiting people listed, refresh cap ignored, address back in the subject, HTML unescaped, line break kept in the subject, final state asked again, re-check window ignored, `refresh:false` ignored, provider id not stored, an older or different mail counted, link hidden when sent, Send again posting another role, every state reading as delivered): 15 of 15 fail a test. Two survived the first pass and the tests were strengthened.
- The provider's `last_event` field and its values were checked against Resend's retrieve-email and event documentation on the day.

## Not verified

- That the new subject and HTML part change what the recipients' filter does. Only a message trace at the recipient can show that.
- The HTML part in real mail clients. It is plain table markup; nobody looked at it in Outlook or Gmail.
- A full invite, Send again and accept in a real browser, WebKit included. CI's suites do not cover this path.
- `GET https://api.resend.com/emails/{id}` against the live account: the code path is unit-tested against the documented shape, not against the provider.
- Rows written before this change have no provider id, so the two invitations of the day read "Sent. Delivery was not recorded for this one." until they are sent again.

## Review and approval

Owner, in chat, 2026-11-18 13:04 CT: "Go waive", in answer to the three parts listed above and the note that it touches sign-in code. Not reviewed by a different vendor; the waiver row is in `docs/governance/AUTONOMY-REGISTER.md`. Method note: this session read vendor documentation and delivery metadata while holding write tools.

## Left open

- There is no way to revoke a pending invitation from the dashboard.
- The DMARC record has no report address, so nobody receives the reports that would show how receivers treat the domain.
- Delivery events by webhook would be fresher than asking on demand, but need a signing secret that an agent session must not hold.
- The installer move of the same day (pull request #337) was verified in production; its facts are in that pull request's last comment.
