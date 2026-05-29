# Integration Re-Verify — §9 Comms · §12 Design Import · §13 Public Alert

> Opus 4.8 read-only re-verification, 2026-05-28 (Wave 3). Every claim in the
> baseline (`09-12-13-comms-imports-alerts.md`) re-checked against current code.
> Baseline is partly STALE — two gaps were fixed in commits dated 28 May 16:25.
> Verdict scale: WORKS / PARTIAL / COSTUME / NOT-BUILT(honest).

## Bottom line
**Honesty is good across all three categories — no green-badge theater.** The
worst offense is ONE misleading word ("provisioned") behind a Canva env flag, plus
some stale docs. Actual capability:
- **§9 Comms:** 2 of 8 work (Email/Resend + outbound webhook), in-app notifications work, 6 channels honestly labeled "Coming in V2", 0 fake.
- **§12 Design import:** 1 of 7 works (single-page PDF/image), 5 honest-future, 1 latent costume (Canva "provisioned" string).
- **§13 Public alert:** 0 of 5 built, 0 surfaced as available, 100% honest (only an EULA disclaimer mentions it).

## §9 Communications
| Integration | Verdict | Evidence | Gap |
|---|---|---|---|
| Email (Resend) | **WORKS** | `email/email.service.ts:426` real `fetch(api.resend.com/emails)`; prod fail-closed `:397-404`; durable `email_logs` first `:96`; all 9 send methods have exactly 1 live caller | Operational only: default `EMAIL_FROM=onboarding@resend.dev` `:412` only delivers to Resend account owner — needs verified domain |
| Generic outbound webhook | **WORKS** | `webhooks/webhook-dispatch.service.ts:195` HMAC-SHA256 POST + 8s abort; retry worker `webhook-retry.worker.ts` (`FOR UPDATE SKIP LOCKED`, backoff 5/30/120s); registered `webhooks.module.ts:22` | Only 2 events exist (`emergency.triggered/.cleared`); `ALLOWED_EVENTS` `webhooks.service.ts:29-32` restricts subs to those — honest |
| In-app notifications (bell) | **WORKS** | `notifications/notifications.service.ts:50,68,263` real DB rows + dedupe + offline scanner | DB-only (not external) — correct |
| Twilio SMS/voice | **NOT-BUILT (honest)** | `integrations-health.controller.ts:691-701` "Coming in V2… No code path today" | whole client missing |
| Slack outbound | **NOT-BUILT (honest)** | `:703-713` "not wired up yet" | — |
| MS Teams | **NOT-BUILT (honest)** | folded into Slack row `:704` | — |
| PagerDuty/OpsGenie | **NOT-BUILT (honest)** | no code, not surfaced | — |
| APNs/FCM push | **NOT-BUILT (honest)** | `:715-722` "Coming in V2"; panic page "push" is `router.push()` navigation (`panic/page.tsx:159…`), not notifications | no SW push/FCM/APNs |

## §12 Design Import
| Integration | Verdict | Evidence | Gap |
|---|---|---|---|
| PDF/image → Asset+Playlist(+Template) | **WORKS** | `imports/imports.controller.ts:145-456` real Supabase upload + Asset + 1-item Playlist + optional Template, SHA-256, dedupe, AuditLog `:396`; FE accepts `.pdf,.png,.jpg,.jpeg,.webp` | single-page only |
| Multi-page PDF split (Sprint 10) | **NOT-BUILT (honest)** | `:430` "on a follow-up"; no `pdfjs-dist` dep | needs pdfjs + N-page worker |
| PPTX→PDF→PNG (Sprint 10) | **NOT-BUILT + REMOVED** | `:84-89` PPTX *rejected* at fileFilter (blank-playlist bug); no libreoffice/pdf-lib | needs headless LibreOffice |
| `import-deck` endpoint + schema | **NOT-BUILT** | zero hits for `import-deck/processingStatus/parentAssetId/pageNumber/sourceFormat`; no bullmq | entire Sprint 10 schema absent |
| Canva Connect (OAuth) | **COSTUME (latent)** | no OAuth controller, no `IntegrationToken` model, no picker; only env probe `:745-756` | see ranking #1 |
| Google Slides / PPT Online / Figma | **NOT-BUILT (honest)** | `:758-783` all COMING_SOON | Sprint 11 |
| Keynote | **PARTIAL (copy-only)** | `:172-174` "export to PDF first" | no self-hostable converter |

## §13 Public Alert — 100% NOT-BUILT, correctly
CAP/IPAWS inbound, Raptor, RapidSOS, PA-IP-speaker (Valcom/Atlas/SingleWire/InformaCast): **zero** code hits across `apps/`+`packages/` for `raptor|rapidsos|valcom|singlewire|informacast|ipaws` — the 1 hit is a *disclaimer* on `terms/eula/page.tsx:113`. ("Atlas" = travel-poster template, false positive.) Not surfaced anywhere as available. IPAWS outbound = N-A (FEMA auth, deliberate).

## Costumes ranked by customer visibility
1. **Canva "OAuth flow is provisioned"** — `integrations-health.controller.ts:750`: when `CANVA_CLIENT_ID` is set the row says "OAuth flow is provisioned but the live picker UX is still pending" — FALSE (no controller/token exchange/model). Mitigation: shows DEGRADED (amber) not green; default no-env state is honest ("Pending Canva partner approval"). Low visibility unless someone sets Canva env vars. **FIX: reword to truth.**
2. **Stale docs/config**: `.env.example:184` + `CLAUDE.md:99` say Canva "lights up `/settings/imports`" and "Stage-1 PDF/PPTX uploads work" — both stale: path moved to `/templates/imports` (redirect stub remains), and PPTX is now rejected. `configurePath` at `integrations-health.controller.ts:741` still points the working PDF-import row at the old `/settings/imports`. Doc/config drift. **FIX: update.**

No green-badge theater. The integrations-health probe + test-integrations UI (`test-integrations/page.tsx:102-106`, coming-soon=grey, gated `?admin=1`) tell the truth.

## ACTIONABLE FIX LIST (small, honest-labeling)
1. `integrations-health.controller.ts:750` — reword Canva "OAuth flow is provisioned but picker pending" → truthful "Canva Connect not yet built (Sprint 11)".
2. `integrations-health.controller.ts:741` — `configurePath` `/settings/imports` → `/templates/imports`.
3. `.env.example:184` — Canva note: `/settings/imports` → `/templates/imports`; drop "PPTX uploads work" (PPTX rejected; PDF/image only).
4. `CLAUDE.md:99` — same correction as #3.
