# Cycle 1 — Triage — 2026-05-03

Aggregated from the 6 area reports. Use this as the work-list for fix agents.

**Cumulative findings:** 13 P0 · 27 P1 · 24 P2

**Fixed in this cycle (commit `d1e8ff7`):** 4 P0
**Still open after this cycle:** 9 P0 · 27 P1 · 24 P2

## ✅ FIXED in this session

- [x] `integrations BUG-001` — ConnectModal `agreed` default (`streaming/page.tsx:501`). 11 of 13 streaming providers couldn't be connected. Fixed by flipping default to `!provider.requiresVenueLicense` so the venue-license confirmation only fires when actually required.
- [x] `integrations BUG-002` — BridgeSetupModal continue routes into ConnectModal. Auto-fixed by the BUG-001 fix (custom-hls has `requiresVenueLicense=undefined` → button now enabled).
- [x] `ai-imports BUG-001` — apiFetch hard-set `application/json` killed every multipart upload. Fixed in `api-client.ts:74` with FormData detection (browser sets multipart/form-data; boundary= ... automatically).
- [x] `ai-imports BUG-002` — Supabase bucket missing PPTX/PPT mimes. Added to `ALLOWED_MIMES` in `supabase-storage.service.ts:51`.
- [x] `emergency BUG-001` — Hold-to-trigger was 1500ms, CLAUDE.md requires 3000ms (life-safety). Fixed in `panic/page.tsx:11`.

## 🔴 P0 — REMAINING (9, must fix in cycle 2)

### Security (auth + emergency)

- [ ] `auth BUG-001` — Cross-tenant SSO config write. `apps/api/src/sso/sso.controller.ts:140-172` accepts `:tenantSlug` from URL and never validates against caller's tenant. DISTRICT_ADMIN of one tenant can take over another tenant's login flow. Fix: in each handler, resolve `getConfigByTenantSlug(tenantSlug).tenantId` and compare to `req.user.tenantId`; reject unless SUPER_ADMIN or parent district.
- [ ] `auth BUG-002` — Role escalation at user creation. `apps/api/src/users/users.controller.ts:26-48` writes user-supplied `role: string` directly. Fix: validate against `ALLOWED_INVITE_ROLES` whitelist + run `validatePassword` + `isValidEmail`.
- [ ] `emergency BUG-002` — All-clear hardcodes `overrideId='global_clear'`. `apps/web/src/actions/trigger-emergency.ts:41` breaks audit chain-of-custody for forensic review. Fix: pass the actual overrideId returned from the trigger response.
- [ ] `emergency BUG-003` — Device-scope all-clear doesn't delete `screenEmergencyOverride`. `apps/api/src/emergency/emergency.controller.ts:520-531` — screens stuck on lockdown after reboot. Fix: explicit delete-by-screenId in the device-scope branch.
- [ ] `emergency BUG-004` — DISTRICT_ADMIN tokens may have undefined `tenantId`. `apps/api/src/screens/screen-emergency.controller.ts:359` — Prisma silently strips `undefined` filter, opens cross-tenant bulk-trigger. Fix: explicit tenantId presence check + 403 when missing.

### Reliability (player)

- [ ] `player BUG-001` — Service Worker writes emergency `setHash` BEFORE downloads complete. `apps/web/public/sw-player.js refreshEmergencyCache` short-circuits if interrupted, permanently skips re-push, silently breaks the "🛡️ NEVER evicted" emergency tier. Fix: write hash AFTER all downloads succeed; on partial failure, leave hash unset so next sync retries.
- [ ] `player BUG-002` — `sumCacheBytes` uses `content-length` which is missing for opaque/CORS Supabase responses. Soft-cap eviction never fires; dashboard shows 0 bytes. Fix: read `(await blob.size)` instead, or add Content-Length to Supabase responses.
- [ ] `player BUG-003` — USB export auto-flips `usbIngestEnabled` to `true` and mints HMAC keys silently on first call. Contradicts CLAUDE.md "default false; admins must opt in." Fix: refuse export when flag is false; require explicit admin enable in Settings → USB.

## 🟡 P1 — fix this week (27)

### auth (4)
- BUG-003 — Schedule create/update missing cross-tenant FK validation
- BUG-004 — Playlist create accepts foreign templateId
- BUG-005 — `PUT /users/:id/role` missing role enum validation
- BUG-006 — Argon2 timing oracle on user-not-found path (email enumeration)

### editor (3)
- BUG-001 — `FITNESS_WORKOUT_TIMER` has no editor case in PropertiesPanel (JSON-only)
- BUG-002 — 12 of 19 RESTAURANT/BAR/RETAIL widgets have no editor case
- BUG-003 — JSON-parse failure leaks string into `cfg.creatives` / `classes` / `quotes` arrays mid-keystroke

### integrations (4)
- BUG-003 — POS oauth2 providers save empty PENDING rows silently
- BUG-004 — Ad-network ConnectModal has no PARTNER vs DIRECT differentiation
- BUG-005 — PropertiesPanel picker links use relative `href="settings/streaming"` (404 from template builder)
- BUG-006 — `StreamProviderListItem` API type missing `bridgeSteps`

### emergency (6)
- BUG-005 — Client-side WS verification only checks signature presence not validity (acknowledged tech debt)
- BUG-006 — Per-screen audit failures silently swallowed (asymmetry with tenant-wide controller's transaction wrapping)
- BUG-007 — SOS location string not strictly bounded (log injection risk)
- BUG-008 — Floor plan dimensions from client without server-side probe
- BUG-009 — `ScreenEmergencyController.allClear` lacks `@AllowPanicBypass` (asymmetric with trigger)
- BUG-010 — Player does NOT subscribe to `device:<screenId>` channels — Sprint 8b WS broadcasts only reach screens via HTTP polling

### player (6)
- BUG-004 — Capability data collected but typed body drops it; no schema columns; never reaches dashboard
- BUG-005 — SW `precachePlaylist` evicts entries by raw URL — Supabase signed URLs rotate hourly, evicting entire cache
- BUG-006 — `ALL_CLEAR` is in `SENSITIVE_TYPES` — if it arrives before AUTH_OK on clock-skewed kiosk, silently dropped
- BUG-007 — WS HELLO falls back to unsigned `dev_<screenId>_unknown` tokens; in prod with DEV_WS_ALLOW=false, real-time silently degrades to polling
- BUG-008 — `/api/v1/player/latest-version` is unauthenticated and unthrottled
- BUG-009 — Pairing code 10-attempt collision retry without uniqueness fallback — 11th miss = 500

### ai-imports (4)
- BUG-003 — Filename not sanitized/length-capped in imports
- BUG-004 — Retail+restaurant sample loaders share one POS connection (`@@unique([tenantId, providerId])`) — silently mix into one labelled connection
- BUG-005 — Imports dropzone has no keyboard/SR path
- BUG-006 — AiGenerateModal missing `role="dialog"` / `aria-modal` / focus trap

## 🔵 P2 — defer (24, batched fix in cycle 3+)

See individual area reports — UX polish, edge cases, Sprint-2 hardening.

## Next-cycle plan

1. **Cycle 2 starts here.** Dispatch one fix agent per remaining P0 (9 agents in parallel, run_in_background, each gets a single bug).
2. After fixes land, run `pnpm preflight`, commit per-bug or as a single batch.
3. Re-test the fixed areas with the same agent briefs (auth + emergency + player will all need re-test).
4. Repeat for P1s in waves.
