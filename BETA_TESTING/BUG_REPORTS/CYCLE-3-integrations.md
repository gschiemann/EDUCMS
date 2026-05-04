# CYCLE-3 — Integrations retest report

Area: Streaming / POS / Ad-network. Static read of cycle 1+2 fixes plus
fresh walk of TEST_PLAN.md Area 3.

## Cycle 1+2 fixes — verification

| ID | Status | Evidence |
|---|---|---|
| integrations-001 | PASS | `apps/web/src/app/[schoolId]/settings/streaming/page.tsx:510` — `agreed` defaults to `!provider.requiresVenueLicense`. iframeOnly (YouTube/Twitch) and customHls (Custom HLS) tiles now reach Connect with `agreed=true`. |
| integrations-002 | PASS | Same file. `BridgeSetupModal.onContinue` (line 363) routes to ConnectModal for `custom-hls`. custom-hls has `requiresVenueLicense: undefined`, so `agreed` defaults true → Connect button enabled. |
| integrations-003 | PASS | `apps/api/src/pos/pos.service.ts:86` throws `BadRequestException` when `provider.auth === 'oauth2'`. Front-end `apps/web/src/app/[schoolId]/settings/pos/page.tsx:319` disables Connect for oauth2. Belt-and-suspenders OK. |
| integrations-004 | PASS | `apps/web/src/app/[schoolId]/settings/monetize/page.tsx:256-264` — handleClick branches: CLOSED→docsUrl, PARTNER→docsUrl/websiteUrl in new tab + mailto fallback, DIRECT→ConnectModal. |
| integrations-005 | PASS | `PropertiesPanel.tsx:3688-3689,3769-3770` — both pickers resolve schoolId from `useParams()` and emit `/${schoolId}/settings/streaming` (line 3723) and `/${schoolId}/settings/pos` (line 3796). |
| integrations-006 | PASS | `packages/api-types/src/streaming.ts:423-427` and rebuilt `packages/api-types/dist/streaming.d.ts:134-138` both expose `bridgeSteps`. `apps/api/src/streaming/streaming.service.ts:45` passes it through. |

## NEW bugs found

### P1 — integrations-007 — Streaming oauth2 has no API-side reject (asymmetric vs POS)
`apps/api/src/streaming/streaming.service.ts:89-138` does NOT throw
when `provider.auth === 'oauth2'`. POS service does (cycle-2 fix #003).
Vimeo Live + Soundtrack Your Brand are oauth2; if a curl/Postman call
bypasses the disabled front-end button, the service writes a sealed-
empty PENDING `streamProviderConnection` row that the operator can
never resolve. The Connect Modal already shows "OAuth flow not yet
implemented" (page.tsx:602), so the API parity gap is the only issue.
Add the same `if (provider.auth === 'oauth2') throw new BadRequestException(...)` guard before the create.

### P1 — integrations-008 — Quick Start "Background music" leads to dead-end modal
`apps/web/src/app/[schoolId]/settings/streaming/page.tsx:204-215` Quick
Start card 4 opens ConnectModal for `soundtrack` (auth=oauth2). The
modal renders the "OAuth not yet implemented" amber notice and the
Connect button stays disabled (line 630 disables on `provider.auth ===
'oauth2'`). Marketing copy ("OAUTH · ~$35/MO") promises an action that
cannot complete. Either route the card to docsUrl + mailto like the
ad-network PARTNER fix, or hide the card until OAuth callback ships.

### P2 — integrations-009 — Sample-data restaurant + retail are mutually exclusive per tenant
`apps/api/src/sample-data/sample-data.controller.ts:161-348` — the
cycle-2 fix to ai-imports-004 catches the unique-constraint collision
and returns `{ ok: false, message: "wipe sample data first" }` when
loading the second loader after the first. Restaurant and retail share
`providerId='custom-webhook'` and the schema has
`@@unique([tenantId, providerId])` (schema.prisma:1046). Operator
demoing both verticals in one tenant has to wipe between switches.
Each loader is internally idempotent (re-runnable safely), but
cross-loader is not. Either rename the providerId for retail
(`custom-webhook-retail`) or document this as expected behavior in the
sample-data dialog.

### P2 — integrations-010 — `/streaming/channels` 401 falls through silently in PropertiesPanel
`PropertiesPanel.tsx:3690-3694` and `:3771-3775` — POS picker uses
`.catch(() => [])` to swallow 401/network errors gracefully, but the
streaming picker has NO `.catch`. When a CONTRIBUTOR opens the editor
for a STREAMING widget and the controller returns an error, react-
query keeps `data` undefined and only shows "Loading channels…"
forever (line 3719). The empty-state CTA at line 3720 only shows when
`data` is empty array, not on error. Mirror the POS picker's pattern.

### P2 — integrations-011 — `/pos/categories` empty-array path also catches transient 5xx
Symmetrical observation: `PropertiesPanel.tsx:3773` swallows ALL
errors via `.catch(() => [])`, including transient 502/503. Operator
sees "No POS connected yet" with the connect link even when the POS
truly is connected. Distinguishing "no rows yet" from "fetch failed"
matters once a real customer walks the empty-state link to a settings
page that already has a connection. Filter the catch to network-only.

### P3 — integrations-012 — Ad-network ConnectModal still ignores `network.salesLedOnly`
`apps/web/src/app/[schoolId]/settings/monetize/page.tsx:305-419` —
the modal does not check `network.salesLedOnly`. Cycle-2 fix #004
re-routed PARTNER networks to the publisher page, but salesLedOnly
networks (Atmosphere, Lamar — both currently CLOSED, so caught by the
isClosed branch) would otherwise reach the modal. Defensive: also
short-circuit when `salesLedOnly === true` so a future PARTNER+
salesLed network doesn't slip through.

### P3 — integrations-013 — Provider catalog `iframeOnly` connections never become ACTIVE
`apps/api/src/streaming/streaming.service.ts:133` — connection saves
`status: provider.auth === 'none' ? 'ACTIVE' : 'PENDING'`. iframeOnly
providers (YouTube, Twitch) collect zero credentials at connect time
yet land in PENDING forever. The status pill in the UI shows amber
PENDING permanently. Either flip iframeOnly to ACTIVE on create or
flip to ACTIVE when the operator picks their first channel.

## Walk of TEST_PLAN.md Area 3 — coverage notes

- All 13 streaming providers connectable post-fix-001: PASS for
  `none`, `customHls`, `iframeOnly`, `license`, `apiKey`. FAIL for
  `oauth2` (vimeo-live, soundtrack) — see #008.
- Sample-data idempotent + tagged: PASS for individual loaders;
  cross-loader collision = #009.
- Ad-network PARTNER tile: PASS — opens vendor page in new tab with
  noopener,noreferrer + mailto fallback.
- StreamProviderListItem.bridgeSteps: PASS — backend returns it; web
  app's BridgeSetupModal consumes it correctly.

Nothing above blocks the pilot. #007 + #008 are the highest-value
follow-ups; the others are polish.
