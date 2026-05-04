# CYCLE 1 — AI generation + Canva imports + Sample data

Tester: Cycle-1 ai-imports agent. Scope: `apps/api/src/{ai,imports,sample-data}`,
`apps/web/src/components/ai/AiGenerateButton.tsx`,
`apps/web/src/app/[schoolId]/settings/{imports,test-integrations}/page.tsx`,
`apps/api/src/storage/supabase-storage.service.ts`. Static review only.

Already-fixed in `e2c9330` (skipped): AI 2000-char cap, vertical/tone whitelists,
AI 503 friendly error, AbortController on AiGenerateButton unmount, env docs.

---

## P0 — `imports/design` multipart upload sends `Content-Type: application/json`, breaks every upload

**File:** `apps/web/src/app/[schoolId]/settings/imports/page.tsx:67-71`

```tsx
const res = await apiFetch<UploadResult>('/imports/design', {
  method: 'POST',
  body: fd,
  headers: {}, // let browser set the multipart boundary
});
```

Comment is wrong. `apiFetch` (`apps/web/src/lib/api-client.ts:74-83`) hard-sets
`Content-Type: application/json` first, then spreads `options.headers` on top.
An empty `{}` adds nothing, so the JSON content-type stays. Browser will NOT
auto-attach the multipart boundary because Content-Type is already present.
Multer on the API parses an `application/json` body containing raw multipart
bytes → `file` is undefined → 400 "No file uploaded or unsupported type."

Same comment-vs-reality drift is already documented in
`apps/web/src/hooks/use-api.ts:1451-1452` ("Bypass apiFetch for multipart — its
default Content-Type: application/json header would mangle the multipart
boundary"). The fix there is to use raw `fetch`. The imports page never got
that treatment.

**Effect:** the entire imports feature is broken. No PDF / PPTX / image upload
works. Stage-1 Canva flow ships dead.

**Fix:** use raw `fetch` like `useCreateFloorPlan` at use-api.ts:1453-1459, or
make `apiFetch` skip the Content-Type when `body instanceof FormData`.

---

## P0 — PPTX / PPT uploads will fail at Supabase even after passing imports' MIME filter

**File:** `apps/api/src/storage/supabase-storage.service.ts:51-57` vs
`apps/api/src/imports/imports.controller.ts:56-63`

Imports accepts:
- `application/vnd.openxmlformats-officedocument.presentationml.presentation` (PPTX)
- `application/vnd.ms-powerpoint` (PPT)

Supabase bucket `allowedMimeTypes` only includes:
- images, video, audio, `application/pdf`

Supabase enforces `allowedMimeTypes` server-side regardless of which key signs
the request. So once the multipart bug above is fixed, every PPTX upload will
still fail at the storage layer with a 400 from Supabase. The friendly
"PowerPoint→PDF→PNG pipeline ships in a follow-up" message in the controller
(`imports.controller.ts:174`) never reaches the user — they hit "Upload failed:
mime type not allowed" first.

**Fix:** add the two PPTX/PPT mimes to `ALLOWED_MIMES` in
supabase-storage.service.ts. Both `createBucket` and `updateBucket` calls need
to be re-run, which they are on every boot (lines 61-85), so a redeploy after
the change suffices.

---

## P1 — Imports: `originalName` and playlist `name` not sanitized or length-capped

**File:** `apps/api/src/imports/imports.controller.ts:125, 135, 151`

```ts
const niceName = basename(file.originalname, ext) || 'Imported design';
// ...
originalName: file.originalname,
// ...
data: { tenantId, name: niceName, createdByUserId: userId },
```

`file.originalname` is operator-controlled. `path.basename` strips directory
components but not script-tag or quote characters. `niceName` then becomes the
Playlist's `name`, rendered in the dashboard playlist list and in the success
message returned to the operator. No length cap (200KB filename is legal in
HTTP) and no character filtering.

Spec says: "filename sanitization: blocks path traversal, caps length." Not
done.

**Risks:** stored content corruption (quirky chars break list rendering),
length-cap absence means a 50-character UI column gets a 4KB string.
XSS only if a downstream view uses `dangerouslySetInnerHTML`, which most don't —
hence P1 not P0.

**Fix:** clamp to 80 chars, strip control chars, replace path separators with `_`.

---

## P1 — Sample retail items get mixed into the "Restaurant menu" connection

**File:** `apps/api/src/sample-data/sample-data.controller.ts:152-163, 238-249`

`PosProviderConnection` has `@@unique([tenantId, providerId])`
(`schema.prisma:1046`). Both `loadSampleRestaurantPos` and
`loadSampleRetailPos` use `providerId: 'custom-webhook'`. So the second loader
that runs always finds the existing connection and re-uses it without changing
its `displayName`.

Sequence to reproduce:
1. POST `/sample-data/pos/sample-restaurant` → creates `[Sample] Restaurant menu`
   connection + 24 burger items.
2. POST `/sample-data/pos/sample-retail` → finds existing
   `[Sample] Restaurant menu` connection, INSERTS 18 retail SKUs into it. Now
   the connection labelled "Restaurant menu" contains a mix of burgers and
   sneakers. `lastSyncItemCount` overwrites to 18.

Wipe still works because both connections share `[Sample]` prefix, but the
operator demoing live sees an incoherent menu.

**Fix:** either (a) use a distinct `providerId` per loader (e.g.
`custom-webhook-restaurant` vs `custom-webhook-retail` if the catalog allows it
— need to add to the providers list), or (b) delete the existing connection
when the other loader runs, or (c) document that they're mutually exclusive
and surface a clear error.

---

## P1 — `imports/page.tsx` dropzone has no keyboard / screen-reader path

**File:** `apps/web/src/app/[schoolId]/settings/imports/page.tsx:111-123`

`<div onClick={...}>` with no `role="button"`, `tabIndex={0}`, or `onKeyDown`.
Keyboard users can't activate the only upload control on the page. axe-core
will flag this; spec calls it out under common methodology a11y.

`<input type="file" hidden>` exists but is `display: hidden` (line 128) so
keyboard tab cannot focus it either. The "click to browse" text is dead for
non-mouse users.

**Fix:** put the actual `<input>` visually hidden (`sr-only`), label it, focus
it from the dropzone keyboard handler.

---

## P1 — `AiGenerateModal` missing dialog ARIA + focus trap

**File:** `apps/web/src/components/ai/AiGenerateButton.tsx:184-282`

Modal has no `role="dialog"`, no `aria-modal="true"`, no `aria-labelledby`, no
focus trap. ESC closes it (`useEffect` line 124) but tab cycles through the
underlying page, not the modal. Click-on-backdrop closes it (line 184) but
backdrop is rendered as a `<div>` not button so SR can't trigger.

axe-core will report a critical violation.

---

## P2 — AI rate-limit counter consumed by failed Anthropic calls

**File:** `apps/api/src/ai/ai.service.ts:121-175`

```ts
recent.push(now);
this.recentByTenant.set(opts.tenantId, recent);
// ... fetch, may throw 503
```

Counter is incremented BEFORE the upstream call. If Anthropic returns 4xx/5xx
(or the network blips), the failed attempt still costs the tenant a slot in
their 30/hour cap. Spec asks "verify the math doesn't over/under count" — this
over-counts on errors.

**Fix:** push to `recent` only after a successful 2xx response, OR roll back
the push in the catch.

---

## P2 — AI rate-limit Map leaks tenants forever

**File:** `apps/api/src/ai/ai.service.ts:80, 124-131`

`recentByTenant: Map<string, number[]>` is never cleaned up. When a tenant
hasn't generated for >1h their slot is empty after `.filter(...)` but the
key + empty array stay in the Map. Long-lived pod + N tenants = unbounded
growth. Comment says "cleared on pod restart" but production pods rarely
restart.

**Fix:** when `recent.length === 0` after the filter, `delete` the key.

---

## P2 — AI service docstring promises `aiGenerationCount` BillingService log; nothing logs it

**File:** `apps/api/src/ai/ai.service.ts:22-23`

> "BillingService logs them as an `aiGenerationCount`"

Grep across `apps/api/src/`: zero hits for `aiGenerationCount`. Dead promise.
Either implement (so paid-tier caps actually work) or remove from comments.

---

## P2 — Re-importing the same file creates duplicate Playlists

**File:** `apps/api/src/imports/imports.controller.ts:148-162`

`Playlist` model has no uniqueness on `(tenantId, name)`. Each import call
unconditionally calls `playlist.create`, so re-uploading "spring-menu.pdf"
five times yields five identical playlists. Spec asks "what if the import is
re-uploaded with the same name?" — current answer: silent duplication.

Side effect: the Asset is also duplicated (Supabase upload + Asset row), but
that's correct for distinct file hashes. The Playlist dup is the wasteful one.

**Fix:** look up `findFirst({ where: { tenantId, name: niceName } })` and
either reuse or append `(2)` `(3)` to the name.

---

## P2 — Imports controller leaks Supabase error text to client

**File:** `apps/api/src/imports/imports.controller.ts:117-122`

```ts
throw new HttpException(`Upload failed: ${err.message}`, 500);
```

`err.message` from Supabase REST often includes the bucket path or service
internals. Minor info disclosure; replace with a generic message and `console.error`
the underlying detail server-side.

---

## P2 — `count` non-numeric input pollutes AI prompt

**File:** `apps/api/src/ai/ai.service.ts:133, 141`

`Math.min(Math.max(opts.count ?? 3, 1), 5)` returns `NaN` for string input
(e.g. `count: "five"` from a buggy client). Prompt then reads "Generate NaN
distinct options." Anthropic returns 0 results, fallback empty, throws "AI
returned an empty result." Not a security issue (caps prevent cost), just a
weird error path.

**Fix:** explicit `Number.isFinite(parsed)` check, default to 3.

---

## GREEN — verified working

- All 6 SYSTEM_PROMPTS present (`announcement / quote / menu_item / promo /
  daypart / ticker`) — `ai.service.ts:58-71`.
- Vertical whitelist matches `VERTICALS` (`packages/api-types/src/verticals.ts:40-48`)
  with both upper- and lowercase variants.
- Tone whitelist matches `AiGenerateRequest['tone']` exactly.
- Sample-data wipe scopes by `displayName: { startsWith: '[Sample]' }` so
  production rows are safe.
- `addChannel` / `posMenuItem.create` swallow duplicate-key errors → loaders
  are idempotent on second call.
- `AppRole` checks present on every controller method (AI, imports,
  sample-data).
- AbortController unmount cleanup in `AiGenerateButton` works as designed.
- 503 path when `ANTHROPIC_API_KEY` unset returns a helpful message and the
  frontend has a friendly translation (`AiGenerateButton.tsx:171-172`).
- Module wiring confirmed in `app.module.ts:47-91`.
