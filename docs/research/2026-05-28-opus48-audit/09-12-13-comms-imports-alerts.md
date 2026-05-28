# AUDIT — §9 Communications · §12 Design Import · §13 Public Alert

> Opus 4.8 full-app audit, 2026-05-28. Read-only. Email pipeline (Resend) is the
> known-real bar; calibrated every other integration against it. Verdicts
> file:line-evidenced.

## Page 1 — Coverage (WORKS / PARTIAL / COSTUME / N-A)

### §9 Communications
| Integration | D | UX | F | Verdict |
|---|---|---|---|---|
| Email (Resend) | A | A | A | **WORKS** — real `fetch('https://api.resend.com/emails')`, fail-closed in prod, 9 send methods all with live callers |
| Twilio SMS/voice | — | — | F | **N-A (not built)** — honest COMING_SOON |
| Slack outbound | — | C | F | **COSTUME-honest** — env probe "not wired up"; no send code |
| MS Teams outbound | — | C | F | **N-A** — no code |
| PagerDuty/OpsGenie | — | D | F | **N-A** — placeholder text only |
| APNs/FCM push | — | — | F | **N-A** — honest COMING_SOON |
| Generic webhook outbound | B+ | B | B+ | **WORKS (narrow)** — HMAC-signed, wired to emergency trigger/clear only; no retry queue, 2 of ~7 events live |

### §12 Design Import
| Integration | D | UX | F | Verdict |
|---|---|---|---|---|
| PDF/image upload → Template/Playlist | A | A | B+ | **WORKS** — single-page only |
| Multi-page PDF page-split (Sprint 10) | — | B | F | **NOT BUILT** — UI honest "1 of 1 pages"; no pdfjs-dist |
| PPTX/PPT → PDF → PNG (Sprint 10) | — | A | F | **NOT BUILT + REMOVED** — PPTX rejected at upload; no libreoffice |
| `import-deck` endpoint + schema | — | — | F | **NOT BUILT** — endpoint + processingStatus/parentAssetId/pageNumber fields don't exist |
| Canva Connect (Sprint 11) | — | C | F | **COSTUME** — env probe + .env.example placeholders; no OAuth, no IntegrationToken, no picker |
| Google Slides / PowerPoint Online / Figma | — | — | F | **N-A (not built)** — honest COMING_SOON |
| Keynote fallback | — | C | C | **PARTIAL (copy-only)** — ".key not accepted, export PDF" message |

### §13 Public Alert — 100% genuinely-future, marked N-A honestly (not failed)
CAP inbound / IPAWS inbound / Raptor SOS / RapidSOS / PA-IP-speaker = **N-A (not
built)**, all V2. IPAWS outbound = **N-A correctly OUT of scope** (FEMA auth).
Zero grep hits for `raptor|rapidsos|valcom|singlewire|informacast|ipaws`; CAP hits
were false positives (capture/capacity/caption).

---

## §9 — The email bar (WORKS, genuinely)
`email.service.ts:426` real POST to Resend. Fail-closed in prod (`:397-404` — missing
key *throws* so UI can't lie "check your inbox"). Durable `email_logs` row first
(`:96`). All 9 send methods have live callers (bug filed/owner-alert/fix-proposed/
shipped ← bugs.controller; asset pending/decision ← assets.controller; welcome/
password-reset/invite ← onboarding.service). Bug owner-alert fan-out real with
solo-owner edge case (includes reporter when only admin).

**Email gap (ranked #1):** `RESEND_API_KEY` + `EMAIL_FROM` are **absent from
`.env.example` AND the CLAUDE.md env table** — only documented in a code comment
(`email.service.ts:360`). Default sender `onboarding@resend.dev` (`:412`) is
Resend-rate-limited to the account owner's own email + spam-filtered elsewhere. So
even *with* a key, bug-alert emails to other admins likely don't deliver without a
verified domain. **Most probable root cause of Greg's "no bug emails getting sent."**

## §9 — Twilio/Slack/Teams/Push (honest COSTUME/N-A)
`integrations-health.controller.ts:665-715` is candid: Twilio "set, but V2 not wired
yet / No code path today"; Slack "set, but outbound dispatch not wired"; Push
"Coming in V2" (the panic-page "push" is `router.push()` navigation, not
notifications). Correctly labeled COMING_SOON — opposite of the 2026-05-21 theater.

## §9 — Generic outbound webhook (WORKS, narrow)
`webhook-dispatch.service.ts` real: HMAC-SHA256 `sha256=...` over `${ts}.${body}`
(`:92`), 8s AbortController, records lastDeliveryStatus/Error. Wired into emergency
(`emergency.controller.ts:510,667` — emergency.triggered/cleared). UI real
(`settings/developer/page.tsx:564`). **Two limits:** (a) **no retry queue** (`:28`
"retry worker ships in a follow-up") — receiver down during lockdown silently
misses the alert; (b) **only 2 of ~7 events fire** — `screen.online/offline` is
detected (`notifications.service.ts:scanOfflineScreens`) + advertised but never
dispatched.

## §12 — PDF/image import (WORKS single-page)
`imports.controller.ts POST /imports/design` — real + hardened: filename sanitize
incl unicode/RTL strip + NFC, SSRF-free, Supabase upload, dup-name `(N)` suffix,
AuditLog (`:396`). PDF→WEBPAGE-iframe zone, image→IMAGE zone. Player renders PDF via
iframe. `/settings/imports` → `router.replace` redirect to `/templates/imports`
(matches CLAUDE.md "imports = feature not setting").

## §12 — Sprint 10 pipeline (NOT BUILT — biggest §12 gap)
**No pdfjs-dist, no libreoffice, no pdf-lib, no bullmq** in apps/api/package.json
(only sharp, for image opt). **No import-deck endpoint, no
processingStatus/parentAssetId/pageNumber/sourceFormat fields** (zero grep hits).
PPTX deliberately removed from accepted MIMEs (`imports.controller.ts:84-89` — a
.pptx playlist "showed blank"). Real capability = "drop one PDF page or one image →
one Asset." Multi-slide-deck story is unbuilt.

## §12 — Canva Connect (COSTUME)
No OAuth controller, no IntegrationToken model, no picker. Only env probe
(`integrations-health.controller.ts:723`) + .env.example placeholders. Note
.env.example:161 + CLAUDE.md Canva note reference the **stale** `/settings/imports`
path (moved to `/templates/imports`).

---

## TOP 10 RANKED FIXES (things that SHOULD work now but don't)
1. **Document + set `RESEND_API_KEY` + verify a sender domain.** Entire email
   pipeline (incl Greg's missing bug-alerts) hinges on an env var in neither
   `.env.example` nor the CLAUDE.md table. Add both `RESEND_API_KEY` + `EMAIL_FROM`,
   verify a custom domain so `EMAIL_FROM` isn't the owner-only `onboarding@resend.dev`.
2. **Surface email-not-configured in bug-reporter + owner-alert UX.**
   `isConfigured()` exists (`:379`) but bug flow swallows failures
   (`bugs.controller.ts:416`). Show "email not configured" like password-reset does.
3. **Add the webhook retry queue.** `emergency.triggered` is highest-stakes + has no
   retry (`webhook-dispatch.service.ts:28`). 3 retries w/ backoff for `emergency.*`.
4. **Dispatch the webhook events that already exist** (`screen.online/offline`
   detected + advertised but never sent) — wire it or remove from the advertised list.
5. **Fix stale Canva path** in `.env.example:161` + CLAUDE.md (→ `/templates/imports`).
6. **Ship multi-page PDF page-split worker (Sprint 10 core)** — add pdfjs-dist, N
   pages → N Assets → one Playlist. Biggest §12 gap; UI already honest, clean add.
7. **PPTX support via libreoffice headless** (Sprint 10) — currently rejected.
8. **Decide Canva Connect: build the OAuth picker or stop probing** — `CANVA_CLIENT_ID`
   lights a DEGRADED row promising a picker that doesn't exist.
9. **Wire ONE real outbound notification channel for emergencies (Slack webhook
   cheapest)** — `WebhookDispatchService` already fans out emergency.triggered; a thin
   Slack formatter makes "ops gets paged on lockdown" real with minimal code.
10. **Keynote: make the fallback actionable** — inline "how to export from Keynote"
    instead of a dead-end MIME rejection.

## Bottom line
- **§9:** Email is genuinely production-grade. The "no emails" incident is a
  config/domain-verification gap, not broken code. Webhook real but narrow. SMS/
  Slack/Teams/Push honestly N-A — no costume-theater (improvement over 2026-05-21).
- **§12:** Single-page PDF/image import truly works + UX is excellent + honest. The
  Sprint 10 conversion pipeline + Sprint 11 Canva/Slides/Graph/Figma OAuth are NOT
  built (deps absent). Canva is the one COSTUME.
- **§13:** Entirely genuine-future, correctly N-A, nothing inflated.
- `integrations-health.controller.ts` deserves credit — labels every unbuilt
  integration COMING_SOON/DEGRADED with an actionable reason, not a green lie.
