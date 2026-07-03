# #236 — outbound email send-path audit (2026-07-03)

EmailService (apps/api/src/email/email.service.ts): logs every message to `email_logs`
(QUEUED→SENT/FAILED) then dispatches via raw fetch to Resend. `isConfigured()` =
`!!RESEND_API_KEY`. In `#dispatch`, unset key → dev logs+returns; **prod THROWS** a
plain Error. The global AllExceptionsFilter masks non-HttpException errors to a bare
500 — so **any unguarded EmailService caller turns "email not configured" into an
opaque 500 that also strands work already committed earlier in the request.**

## CODE-BUGs (fix — all safe/additive)
1. **onboarding.service.ts:415** — `emailDelivered: !!process.env.EMAIL_PROVIDER`.
   EMAIL_PROVIDER is a DEAD env var (grep: referenced nowhere). So emailDelivered is
   ALWAYS false → the invite UI ALWAYS shows "email isn't configured, copy this link",
   even in a fully-configured, correctly-sending deploy. Fix: `this.emailService.isConfigured()`.
2. **onboarding.service.ts:180 (signup/welcome)** — unguarded `await sendWelcome()` AFTER
   the tenant+DISTRICT_ADMIN are committed. Prod w/o key → throws → /signup 500s, but the
   account exists; retry hits "email already exists" dead-end. Highest blast radius (turns
   away new customers). Fix: try/catch, log+continue.
3. **onboarding.service.ts:389 (invite)** — same unguarded throw after the invite/user
   commit → 500 + misleading "Could not send invitation" while the invite row exists.
   Fix: try/catch, return the {acceptUrl, emailDelivered} copy-link shape.
4. **bug-analyzer.service.ts (~401)** — the AUTOMATIC AI-analysis path (analyze() → status
   PROPOSED) never sends `sendBugFixProposed`; only the manual chat-writeback endpoint
   (bugs.controller.ts:875-893) does. Every auto-analyzed bug misses its "fix proposed"
   email. Fix: add the fire-and-forget notify after the PROPOSED persist.
5. **onboarding.service.ts:221 (password reset)** — unguarded `await sendPasswordReset()`;
   a live-but-flaky Resend call 500s the no-enumeration `{ok:true}` endpoint. Fix:
   try/catch, still return {ok:true, emailConfigured}.

## WORKING (correctly guarded fire-and-forget — no change)
Asset pending-review + decision emails (assets.controller.ts), bug "we got it" + owner
alert + fix-shipped (bugs.controller.ts), efficiency/egress alerts (its own guarded Resend
fetch). Password-reset UI correctly branches on `emailConfigured` (no false "check inbox").
No "UI lies check-your-inbox while silently failed" case found — the damage class here is
the inverse (over-eager 500s on already-committed work).

## CONFIG for Greg (not code)
- RESEND_API_KEY set in Railway prod?
- EMAIL_FROM = an address on a Resend-VERIFIED custom domain (the default onboarding@resend.dev
  only delivers to the Resend account owner; all other recipients silently dropped by Resend).
- EMAIL_REPLY_TO optional.
- (Ops gap, not scored) no admin UI to inspect/replay FAILED email_logs rows — worth adding
  once the try/catch fixes spike FAILED volume.

Audit was READ-ONLY. Fixes dispatched separately.
