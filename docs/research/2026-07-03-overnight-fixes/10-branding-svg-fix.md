# #223 — branding SVG logo rasterized on adopt (Dominos) — FIXED (2026-07-03)

Root cause (downgrade path c): the general `assets` Supabase bucket had `image/svg+xml`
REMOVED from its allowlist on 2026-05-29 (Audit 37-infra U-1) to close a stored-XSS hole
in the media library's presign→direct-to-Supabase upload path. A month later the branding
logo rehost (server-mediated, sanitized) still uploaded SVG to `assets` → Supabase rejected
it with "mime type not allowed" → the try/catch swallowed it → adopt fell back to a raster
(og:image/favicon). So the Domino's SVG was correctly SELECTED (select-vector-logo.ts) but
never STORED.

Fix: new dedicated `branding-logos` Supabase bucket (public, allows image/svg+xml + raster,
2MB) created idempotently at boot (onModuleInit, same pattern as floor-plans) + a
`storage.uploadLogo()` method; routed all branding logo/favicon/og rehost sites through it.
Safe to allow SVG here (unlike the media library) because this bucket is written ONLY by
authenticated server-mediated uploads — never a presigned/direct-to-Supabase URL — so the
XSS vector U-1 closed does not apply. `assets` stays SVG-free (no regression). SVG stays
VECTOR end-to-end (DOMPurify sanitizeLogoSvg for the inline copy; raw served via <img>,
browser-sandboxed). PUBLIC_BUCKETS generalizes the public-URL shape. Web unchanged (already
renders SVG via <img> + inline fallback — just needed a working logoUrl).

5 new tests + 68/68 branding + 6/6 assets/storage pass; api tsc clean. Commit d4ce1ec0.
POST-DEPLOY: confirm Railway logs show the `branding-logos` bucket created ("... ready").
