# Integration Audit — §6 Streaming · §7 Sports/Data · §8 POS · §9 Comms · §12 Design Imports · §13 Public Alerts

_Agent a0adb7fbfd7ec38f1 · read-only grep+read, every claim file:line-traced · 2026-05-30_

## Coverage (D/UX/F × section)
| Section | D | U | F | Coverage |
|---|---|---|---|---|
| §6 Streaming | B | B | B | Covered |
| §7 Sports/Data | A | B | B | Covered |
| §8 POS/Commerce | B | B | B/C | Covered |
| §9 Communications | C | C | F | Covered |
| §12 Design Imports | B | B | C | Covered |
| §13 Public Alerts | N/A | N/A | N/A | NOT-BUILT |

## REAL vs COSTUME — headlines
**§6 Streaming:** YouTube/Twitch/custom-HLS/public-broadcasters = REAL. Vimeo = paste-URL works, OAuth-connect COSTUME. RTSP = COSTUME (warning box, no transcode gateway). MPEG-DASH = honest "not supported." NFHS/Facebook-Live = NOT-BUILT. Soundtrack Your Brand = COSTUME (tier=DIRECT but connect 400s).

**§7 Sports:** manual/phone control, CTS HTTP-snapshot ingest, game-state push, auto-celebrate = REAL. CTS RS485 hardware bridge = NOT in repo (external operator process POSTs to ingest endpoint). Daktronics / Sportzcast / Scorebird / Genius / Sportradar / MaxPreps / GameChanger = NOT-BUILT (COMING_SOON).

**§8 POS:** **Square = REAL end-to-end** (OAuth, token-exchange, catalog poll, HMAC webhook, idempotency via ProcessedPosEvent, token refresh). Custom-webhook BYO POS = REAL. Toast/Clover/Lightspeed/Shopify/Stripe-Catalog = COSTUME (PARTNER-gated, connect 403/400 — honestly downgraded 2026-05-28). Aloha = CLOSED (CSV workaround, honest). Stripe Terminal = NOT-BUILT.

**§9 Comms:** Email (Resend) + outbound webhook = REAL (SSRF-safe, retry worker). **Twilio + Slack = COSTUME** — env vars recognized, health shows DEGRADED, but ZERO send code. Teams/APNs/FCM/Sendgrid/PagerDuty = NOT-BUILT.

**§12 Design imports:** single-page PDF + image upload = REAL. **Multi-page PDF = NOT-BUILT** (`imports.controller.ts:239-240`, pages hardcoded 1). PPTX = removed (honest 400). Canva/Slides/PPT-Online/Figma = NOT-BUILT (COMING_SOON).

**§13 Public alerts (CAP/IPAWS/Raptor/RapidSOS/PA-speaker):** entirely NOT-BUILT. Only outbound `emergency.triggered`/`emergency.cleared` webhook exists. Roadmap V2 — must NOT be implied in sales.

## P0 (cross-section)
1. **§9 Twilio/Slack "sold-but-not-built":** health returns DEGRADED (implies "ready, misconfigured") when env set, but there's no send code at all. `integrations-health.controller.ts:694-712`. Fix: status COMING_SOON regardless of env; pull the env vars from CLAUDE.md until shipped. A customer setting `TWILIO_ACCOUNT_SID` expecting SMS emergency alerts gets nothing.
2. **§7 Sports feed token not revocable:** `makeFeedToken(gameId)` (`sports.controller.ts:466-486`, `sports-feed-token.ts`) — permanent machine write access to score/clock, no rotation/expiry visible.
3. **§12 Multi-page PDF gap:** every Canva/Slides export is multi-page; import takes page 1 only. The literal operator ask ("bring my Canva design in as a template") under-delivers.
4. **§13 No CAP/IPAWS:** emergency system is closed-loop (VenueOS→own screens). Any material implying gov-alert integration is false.

## P1
4. §6 Soundtrack OAuth = green tile that 400s (`streaming.ts:326-338` vs `streaming.service.ts:121-123`).
5. **§6 `backdrop-filter: blur(4px)` in ad overlay `StreamingWidget.tsx:395`** — Chromium-83/Taurus violation → solid opaque rectangle on LED walls. (NOTE: lead should confirm whether StreamingWidget ships to Taurus before treating as P1 — see CLAUDE.md scope clarification.)
6. §8 Square OAuth CSRF `stateCache = new Map()` in-process (`pos-oauth.controller.ts:81`) → intermittent expired-state on multi-replica.
7. §12 Canva Connect advertised (CLAUDE.md env vars) but OAuth flow doesn't exist.

## P2
- §6 `/streaming/validate` oEmbed probe has zero tests. §8 Square cron sync (`pos-sync.cron.ts`) registration unconfirmed. §8 no Stripe Terminal. §9 outbound webhook events limited to emergency.* only (screen.offline etc. never fire). §12 `/settings/imports`→`/templates/imports` redirect unverified.
