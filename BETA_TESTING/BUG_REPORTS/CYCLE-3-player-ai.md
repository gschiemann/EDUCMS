# Cycle 3 — Player + AI-imports retest

Static review only. Verifies cycle 1+2 fixes; flags new defects.

---

## VERIFIED FIXED — cycle 1 + 2

### Player
- **player-001** GREEN. `sw-player.js:236-256` — `setHash` written ONLY after every asset re-checked via `cache.match()`. Failure path explicitly leaves the stored hash unset and logs a warning. Comment + acceptance match.
- **player-002** GREEN. `SIZE_BY_URL` map + `measureResponseSize()` (sw-player.js:35, 327-337). Falls back to `asset.size` hint → content-length → `blob.size`. `META_CACHE` mirror via `sizeMetaKey` (line 36, 380-401) hydrates after cold-boot SW restart. Eviction loop also clears the size meta on delete (line 154, 184).
- **player-003** GREEN. `usb-export.controller.ts:173-182` throws 403 `USB_INGEST_DISABLED` when `tenant.usbIngestEnabled === false`. Auto-flip code is gone; HMAC key is only minted when ingest is already on (line 184-198).
- **player-008** GREEN. `player-ota.controller.ts:416-423` — `@UseGuards(JwtAuthGuard, RbacGuard)` + `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)` + `@Throttle({30/60s})`.

### AI-imports
- **ai-imports-001** GREEN. `api-client.ts:80-83` checks `options.body instanceof FormData` and emits no Content-Type header so the browser sets the multipart boundary.
- **ai-imports-002** GREEN. `supabase-storage.service.ts:62-63` adds both pptx + ppt mimes to `ALLOWED_MIMES`. `updateBucket` is called every boot (line 83) so existing buckets get the new allowlist on next deploy.
- **ai-imports-003** GREEN. `imports.controller.ts:75-89` — `sanitizeOriginalName` (control char strip + 200-char cap) and `sanitizePlaylistName` (control + reserved Windows chars + whitespace collapse + 200-char cap). Used at lines 152-154; empty result falls back to `'Imported design'`.
- **ai-imports-004** GREEN. `sample-data.controller.ts:167, 272` — distinct displayName tags `[Sample] Restaurant Webhook` / `[Sample] Retail Webhook`. Lookup by displayName, not providerId. Unique-error fallback returns a friendly message instead of merging.
- **ai-imports-006** GREEN. `AiGenerateButton.tsx:230-237` — `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}`, `dialogRef`. `useEffect` (line 133-175) auto-focuses textarea, traps Tab/Shift+Tab, restores focus on unmount.
- **ai.service.ts hardening** GREEN. 2000-char context cap (line 100), `ALLOWED_VERTICALS` set (106-110), `ALLOWED_TONES` set (116-119), 30/hr/tenant in-memory window (122-131).

### WS reconnect (revalidated from cycle 1 GREEN)
- `apps/web/src/app/player/page.tsx:71-74` `backoffMs(attempt, baseMs, maxMs)` — full-jitter exponential backoff. Used by register (line 1396), poll (1510), heartbeat (1772), WS reconnect (2065, 2080). Still GREEN.

---

## NEW BUGS — cycle 3

### P0-1 — `lastEmergencySetHashRef` updated BEFORE the SW confirms cache, defeats the whole player-001 fix

**File:** `apps/web/src/app/player/page.tsx:1241-1258` (`refreshEmergencyCache`).

```ts
if (data.setHash && data.setHash === lastEmergencySetHashRef.current) return;
lastEmergencySetHashRef.current = data.setHash || '';   // ← updated synchronously
await precacheEmergency(data.assets || [], data.setHash || '');
```

The page caches the new `setHash` in the ref BEFORE the SW finishes downloading. `precacheEmergency()` in `offline-cache.ts:58-65` is a fire-and-forget `postMessage` — it returns immediately. The next 5-min interval tick reads `lastEmergencySetHashRef.current === data.setHash` and short-circuits with `return`, never re-pushing.

This nullifies the player-001 fix at the application layer. The SW correctly refuses to write its own `__edu_emergency_set_hash__` on partial download — but the player's in-memory ref is poisoned for the lifetime of the tab. Symptom: same as before player-001 — emergency cache silently empty, `🛡️ NEVER evicted` promise broken.

**Fix:** await the SW's `PRECACHE_EMERGENCY_DONE` message with `complete: true` before updating the ref, OR don't track this on the page at all and let the SW be the single source of truth on whether re-push is needed.

### P0-2 — SW VERSION bump to v2 breaks emergency cache on every existing player until install completes

**File:** `apps/web/public/sw-player.js:26-30`.

`VERSION='v2'` causes the activate handler (line 50-61) to delete every `edu-player-*` cache that doesn't match the new `v2` keys — including `edu-player-emergency-v1`. The new `EMERGENCY_CACHE='edu-player-emergency-v2'` starts empty.

Service Worker activation is gated on `clients.claim()` AND existing tabs typically run the OLD SW until they're refreshed (Cache.match still serves from v1 until the page reloads). When the new SW activates, it nukes v1 BEFORE v2 is populated. The player must hit the network for emergency assets until `refreshEmergencyCache()` next runs (up to 5 minutes per the cycle on line 1264).

The 5-minute window where the kiosk has NO emergency assets cached AND the device may be offline is a life-safety gap. If a lockdown fires during the activation window the player drops to network-only retrieval — which is the offline-first contract violation.

**Fix:** stage the migration. Open both `edu-player-emergency-v1` and `edu-player-emergency-v2`, copy entries forward in the `activate` handler, then drop v1. Or, gate the deletion behind a successful first-precache.

### P1-1 — `sanitizeOriginalName` strips legitimate Unicode-NFC composition marks but not their decomposed form

**File:** `apps/api/src/imports/imports.controller.ts:76-79`.

```ts
const s = String(raw || '').replace(/[\r\n\t\x00-\x1f]/g, '').trim();
return s.slice(0, NAME_MAX_LEN);
```

The C0-control regex correctly strips ASCII control chars but does not normalize. A filename like `café_menu.pdf` (the `é` may arrive as either NFC `0xE9` or NFD `e + 0x301` combining acute) round-trips fine for NFC. NFD `e + U+0301` survives, and the 200-char `slice` operates on UTF-16 code units, not grapheme clusters — clipping in the middle of a combining sequence corrupts a glyph. Low impact (filenames seldom hit 200 chars), but a Korean / Vietnamese / Hebrew operator name combined with the path tail can land on the boundary.

The bigger risk: zero-width joiner / RTL override (U+200B-200F, U+2028-2029, U+FEFF) survive both regex passes. RTL override in `originalName` flips the rendering direction in the asset library, swapping `evil.exe` to `exe.live`-looking text.

**Fix:** add `​-‏‪-‮ - ﻿` to the strip class; consider `s.normalize('NFC').slice(...)`.

### P1-2 — Sample-data wipe doesn't bound `posMenuItem` rows; tenant has both restaurant + retail simultaneously after `[Sample] Restaurant Webhook` is wiped, retail items remain orphaned

**File:** `apps/api/src/sample-data/sample-data.controller.ts:381-407`.

The fix correctly creates two distinct connections per tagged displayName. Wipe deletes the Connection rows, and the cascade should remove `posMenuItem` rows IF Prisma is configured for `onDelete: Cascade`. Need to verify schema. If the FK is `Restrict` (default unless declared), the delete throws on FK violation when items exist; if `SetNull`, items orphan with `connectionId = NULL`. Either case the wipe API silently swallows the throw via the for loop's lack of try/catch (line 389-391, 395-397), or the cascade-less rows keep rendering on the menu-board widget until the tenant is dropped.

Same risk applies to `streamProviderConnection` channel rows.

**Fix:** verify `onDelete: Cascade` on `posMenuItem.connectionId` and `streamingChannel.connectionId`. If not present, add explicit `posMenuItem.deleteMany({ where: { connectionId: c.id } })` before each connection delete.

### P1-3 — AI rate-limit slot consumed BEFORE Anthropic call (cycle 1 P2 still open)

`ai.service.ts:130-131` increments `recent` and persists, then runs the fetch (148-175). 4xx/5xx from Anthropic still costs the tenant a slot. Cycle 1 flagged P2; the cycle-2 fix log doesn't mention it. Still applicable.

### P1-4 — `count` non-numeric input pollutes prompt (cycle 1 P2 still open)

`ai.service.ts:133` — `Math.min(Math.max(opts.count ?? 3, 1), 5)` returns `NaN` for `count: "five"`. Still open from cycle 1.

### P2-1 — AiGenerateButton focus trap walks ALL focusable elements every Tab keystroke

`AiGenerateButton.tsx:147-166` — `querySelectorAll` on each Tab. For a 6-button modal it's free; if a future cycle adds more controls (image previews, drag handles), this is O(N) per keystroke. Worth memoizing inside the effect once on mount.

### P2-2 — Player calls `getLatestVersion` (now admin-gated) at boot but player isn't authenticated

**File:** `apps/web/src/app/player/page.tsx:1090-1099` (cycle 1 P1-5 noted the endpoint was unauthenticated).

The cycle-2 fix gated the endpoint to admin roles. If the player still calls `/player/latest-version` from kiosk context (no JWT), it now 401s on every poll. Need to verify the player consumer either was migrated to a different endpoint or the call was removed. If not, the splash's `latestApkVersion` field is permanently null and a non-blocking error shows in console.

---

## Verdict

Player cycle 1+2 P0/P1 fixes (001/002/003/008) all valid in-file but cycle-3 surfaces a NEW P0 (page.tsx ref poisoning) and a new P0 (SW v1→v2 cache wipe race) introduced by the very fixes themselves. Re-test after addressing P0-1 and P0-2 before declaring player area shipped. AI-imports area is largely clean; only Unicode edge cases + already-known cycle 1 P2 carry-overs remain.
