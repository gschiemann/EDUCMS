# CYCLE-5 Fix Log

P2 polish batch — backend bugs (2026-05-03).

## ai-rate-limit-leak — failed Anthropic call still consumed quota slot

**Severity:** Low (UX / fairness; not security).

**Bug:** `AiService.generate` pushed `now` onto the per-tenant rate-
limit list BEFORE awaiting the upstream Anthropic call. Any 5xx, parse
failure, or empty completion still chewed a slot from the 30/hour cap,
so a flaky upstream could lock a tenant out of an in-spec quota.

**Fix:** Removed the early `recent.push(now)`. The increment now runs
only after `options.length > 0` is verified, i.e. after a usable
non-empty result is returned. All earlier throw paths (auth missing,
non-2xx, fetch error, empty parse) are free.

**Files changed:** `apps/api/src/ai/ai.service.ts`

## ai-tenant-map-leak — `recentByTenant` Map grew unbounded

**Severity:** Low (slow leak; pod-restart-bounded).

**Bug:** Every tenant that ever called `generate` got a permanent
entry in `recentByTenant`. The per-tenant array was filtered by the
1-hour window, but the Map key was never removed, so on a
high-tenant-count pod the Map kept growing forever.

**Fix:** When the filtered list is empty during the rate-limit check,
`delete` the Map entry instead of writing back an empty array. Long-
quiet tenants now drop out of memory automatically.

**Files changed:** `apps/api/src/ai/ai.service.ts`

## imports-supabase-error-leak — raw upstream error returned to client

**Severity:** Medium (information disclosure — bucket names, signed
URL fragments, stack frames could surface in error responses).

**Bug:** `ImportsController.importDesign` interpolated `err.message`
from the failed `storage.upload` call directly into the
`HttpException` body. The browser saw raw Supabase storage errors.

**Fix:** Added a `Logger` to the controller. On upload failure, log
the actual error (with tenantId, storage path, message, stack) for
operator forensics. Return a generic
`"Upload failed. Try again or contact support."` to the client.

**Files changed:** `apps/api/src/imports/imports.controller.ts`

## imports-duplicate-playlist — re-import created another Playlist row

**Severity:** Low (UX clutter; not data corruption).

**Bug:** Re-importing the same Canva file always created a new
Playlist with the identical `name`, leaving operators with stacks of
"My Menu", "My Menu", "My Menu" rows. No conflict detection.

**Fix:** Before creating the Playlist, query
`tenantId + (name === niceName OR name startsWith "${niceName} (")`.
If any are found, parse the existing `(N)` suffixes, pick the lowest
free `N >= 2`, and use `${niceName} (N)` as the new name. The
original is preserved; the re-import is clearly disambiguated.
Downstream `message` strings now reference `playlistName` so the
operator sees the actual stored name.

**Files changed:** `apps/api/src/imports/imports.controller.ts`

## emergency-spec-global-clear — search for legacy literal

**Severity:** None (no occurrences found).

**Action:** Grepped `apps/api/src/emergency` and the entire
`apps/api` tree for the literal string `'global_clear'`. Zero
matches. The cycle-1 emergency-002 fallback shape `clear_<uuid>` is
already the canonical form across spec files. **No edit required.**

## streaming-iframeOnly-stuck-pending — iframeOnly providers never auto-flipped to ACTIVE

**Severity:** Medium (broken integration — operators created an
iframe-embed connection and the player refused to play it because
status stayed PENDING).

**Bug:** `StreamingService.createConnection` only flipped to
`ACTIVE` when `provider.auth === 'none'`. iframe-only providers
(public-broadcasters, YouTube embed catalog) need no further auth —
the embed URL is the whole integration — but landed in PENDING and
sat there.

**Fix:** Introduced `autoActiveAuth = auth === 'none' || auth === 'iframeOnly'`.
Both kinds now save in ACTIVE. PARTNER / BRIDGE / apiKey / license /
customHls / oauth2 paths unchanged.

**Files changed:** `apps/api/src/streaming/streaming.service.ts`

## ad-network-salesLedOnly — sales-led networks bypassed self-serve gate

**Severity:** Medium (silent operational failure — operator thinks
inventory is wired up, never earns).

**Bug:** `AdsService.createConnection` rejected `CLOSED` tier and
`k12Forbidden`-on-K12, but didn't check `network.salesLedOnly`.
Networks like Loop Media (require a signed publisher contract) flowed
through to a PENDING row and the wizard surfaced a misleading
"connected" state.

**Fix:** Added an early `if (network.salesLedOnly) throw new ForbiddenException(...)`
mirroring the CLOSED tier rejection, with a message routing the
operator to sales.

**Files changed:** `apps/api/src/ads/ads.service.ts`

## Verification

`cd apps/api && npx tsc --noEmit | grep -v spec.ts | grep error` —
zero non-spec TypeScript errors. Existing spec-file errors are
pre-existing and unrelated to this batch.

---

# CYCLE-5 P2 polish batch — frontend bugs (2026-05-03)

## ai-NaN-count — `Generate NaN options` in prompt when count is non-numeric

**Severity:** Low (cosmetic prompt corruption — backend already clamps
via `Math.min(Math.max(opts.count ?? 3, 1), 5)`, but `Math.min/max` of
NaN returns NaN, so a NaN count would propagate into the user prompt
as the literal string `Generate NaN distinct options`).

**Bug:** `AiGenerateButton.AiGenerateModal.run()` always sent
`count: 3` hardcoded, but no defensive clamp existed if a future
caller / refactor passed a non-numeric value (form input, env, prop
drilling). The `?? 3` on the server only catches `null` / `undefined`,
not `NaN`.

**Fix:** Compute `safeCount = Number.isFinite(rawCount) ? Math.max(1,
Math.min(5, Math.trunc(rawCount))) : 3` before serializing, so the
body always carries a finite integer in `[1, 5]`.

**Files changed:** `apps/web/src/components/ai/AiGenerateButton.tsx`

## streaming-picker-no-catch — picker spins forever on transient 401/5xx

**Severity:** Medium (UX dead-end — operator sees "Loading channels…"
indefinitely with no way to know the request failed).

**Bug:** `StreamingChannelPickerField` used `useQuery({ data,
isLoading })` without surfacing `isError`. A 401 (session expired) or
transient 5xx left the picker stuck on the loading message because
`isLoading` flips to `false` on error but `data` stays `undefined` —
falling through to the empty-list message that points at Settings →
Streaming, which is wrong for a real fetch failure.

**Fix:** Destructured `isError` from `useQuery` and added a separate
rose-colored "Couldn't load channels — try refresh." message that
renders when `!isLoading && isError`. The empty-state message now
only fires when `!isLoading && !isError && (no data)`.

**Files changed:**
`apps/web/src/components/template-builder/PropertiesPanel.tsx`
(`StreamingChannelPickerField`)

## pos-picker-error-swallow — `.catch(() => [])` hid real fetch failures

**Severity:** Medium (operator support burden — admin sees "No POS
connected yet" pointing at /settings/pos when their POS IS connected
and the backend is just briefly down).

**Bug:** `PosCategoryPickerField` had `queryFn: () =>
apiFetch('/pos/categories').catch(() => [] as PosCategoryDto[])`. Any
transient 5xx or 401 collapsed silently into an empty array, which is
indistinguishable from "no POS connected".

**Fix:** Removed the `.catch`, destructured `isError` from useQuery,
and split the messaging: rose "Couldn't load POS categories — try
refresh." when fetch fails, slate "No POS connected yet" only when
the fetch succeeded with an empty result.

**Files changed:**
`apps/web/src/components/template-builder/PropertiesPanel.tsx`
(`PosCategoryPickerField`)

## editor-section-labels — fitness scene prefixes rendered as raw "LF" / "Mq"

**Severity:** Low (visual polish — but every fitness scene's editor
panel had at least one section header reading `LF`, `Mq`, `Cond`,
`Cta`, etc. instead of human language).

**Bug:** `SECTION_LABELS` is the lookup that turns dot-prefixes
(`header.t1`, `lf.score`, `mq.line1`) into pretty section headers in
the auto-form. ~30 fitness-scene prefixes were missing, so they fell
through to `prettyTitle()` which uppercases short prefixes — giving
`LF`, `Mq`, `Cond`, `Cta`, `Lb`, `Vs`, `Tv`, `In`, `Mod`, etc.

**Fix:** Audited every `DEFAULTS` export across
`apps/web/src/components/widgets/fitness/Fitness*Widget.tsx` (15 files)
and added 50+ missing prefixes — `head`, `header`, `body`, `foot`,
`lf`, `mq`, `marquee`, `tutorial`, `timer`, `deadlift`, `reformers`,
`scorebug`, `roster`, `zones`, `lanes`, `flow`, `promo`, `log`, `rec`,
`feature`, `greet`, `service`, `tv`, `live`, `nowplaying`, `play`,
`ch`, `leader`, `lb`, `ksched`, `sched`, `round`, `weigh`, `vs`,
`meet`, `event`, `setter`, `sign`, `slot`, `strap`, `strip`, `rules`,
`runs`, `reset`, `exit`, `valet`, `cond`, `cta`, `found`, `instr`,
`news`, `ath`, `left`, `right`, `top`, `in`, `screen`, `mod`. Skipped
the 6 already in the table (`hero`, `next`, `routes`, `stats`,
`ticker`, `banner`) to avoid duplicate-key churn.

**Files changed:**
`apps/web/src/components/template-builder/PropertiesPanel.tsx`
(`SECTION_LABELS` map)

## v2-ops-console-not-k12-only — Ops Console widgets hidden from non-K12 tenants

**Severity:** Medium (functional gap — v2 admin-tier Ops Console
widgets are neutral cyber-aesthetic and meant for any tenant, but
were filtered out for non-K12 verticals).

**Bug:** `K12_ONLY_CATEGORIES` in `VariantPicker.tsx` included
`'OFFICE'`. The v2 admin-tier "Ops Console" widgets carry
`category=OFFICE` but they're neutral, so they're equally relevant
to gym, restaurant, retail, or corporate tenants. The K-12 gate hid
them from those verticals.

**Fix:** Removed `'OFFICE'` from `K12_ONLY_CATEGORIES` and updated
the preceding comment block to explain.

**Files changed:**
`apps/web/src/components/template-builder/VariantPicker.tsx`

## asset-picker-uncontrolled — URL field doesn't refresh on library pick

**Severity:** Medium (operator confusion — picking from "Browse
library" updated the thumbnail but the URL field showed the old
value, making it look like the picker silently failed).

**Bug:** `AssetPickerField` rendered the URL input with
`defaultValue={value}` (uncontrolled). When `onChange(picked)` fired
from the AssetLibraryModal, the parent re-rendered with the new
value but the uncontrolled input ignored the prop change. Only the
thumbnail updated; the URL field still displayed the previous URL.

**Fix:** Extracted a small `ControlledUrlInput` helper that mirrors
`value` from props into local `draft` state via `useEffect`, but
defers parent `onChange` to `onBlur` (and Enter key). Picker / clear
button updates flow back into the field; per-keystroke onChange
still doesn't thrash the parent widget config.

**Files changed:**
`apps/web/src/components/template-builder/PropertiesPanel.tsx`
(new `ControlledUrlInput` helper + `AssetPickerField` integration)

## streaming-quickstart-music-still-broken-after-fix — wiring spot-check

**Severity:** N/A (verification only — no code change).

**Investigation:** Confirmed the Quick Start "Background music" card's
`onClick` calls `setShowSoundtrackComingSoon(true)` (line 222), and
the `<SoundtrackComingSoonModal />` renders via the
`showSoundtrackComingSoon` state guard (line 367). The CYCLE-4 fix
is in place; no regressions.

**File reviewed (no changes):**
`apps/web/src/app/[schoolId]/settings/streaming/page.tsx`

## unicode-NFC-not-stripped — bidi controls + zero-width spaces survive sanitize

**Severity:** Medium (security — invisible bidi control characters
in filenames can spoof UI display; visually-identical NFC vs. NFD
forms caused dedupe / search inconsistencies).

**Bug:** `sanitizeOriginalName()` and `sanitizePlaylistName()`
stripped C0 controls (`\x00-\x1f`) but did not:
  1. Strip Unicode bidi control / zero-width chars (U+200B-U+200F,
     U+202A-U+202E, U+2060, U+FEFF) — operator-uploaded filenames
     could carry RTL override marks that flip the perceived display
     of the filename, a known phishing vector.
  2. Normalize Unicode forms — `"café"` (NFC composed `é`) and
     `"café"` (NFD `e` + combining acute) render identically but
     compare unequal at the byte level, causing dedupe / search to
     miss matches that should obviously hit.

**Fix:** Added `.normalize('NFC')` as the first step in both
sanitizers, plus a shared `STRIP_ZW_RTL` regex that drops the bidi /
zero-width / BOM ranges before the rest of the existing pipeline runs.

**Files changed:** `apps/api/src/imports/imports.controller.ts`

---

**P2 polish batch — TS check:**
`cd apps/web && npx tsc --noEmit 2>&1 | grep -E
"AiGenerateButton|PropertiesPanel|VariantPicker|streaming/page"` —
zero matches (clean). `cd apps/api && npx tsc --noEmit 2>&1 | grep
imports.controller` — zero matches (clean). Pre-existing test-file
errors in `apps/web/src/components/RoleGate.test.tsx` and
`apps/api/src/screens/screens.register.spec.ts` are unrelated.
