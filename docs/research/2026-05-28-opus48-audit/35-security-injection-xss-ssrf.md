# Security Audit — Injection / XSS / SSRF / Input Validation

> Opus 4.8 read-only, 2026-05-29. Every sink traced; guards verified not assumed.

## Bottom line
XSS hygiene + the branding-scraper SSRF guard are genuinely strong (verified). **One confirmed
launch-blocker SSRF** in the outbound-webhook delivery path, with a response-body exfil twist
(the documented task #58 gap). Everything else guarded or a non-issue.

## 🔴 LAUNCH-BLOCKER — Outbound webhook delivery: unguarded SSRF + response-body exfil
- **Sink:** `webhook-dispatch.service.ts:209` — raw `fetch(row.url, {POST})`, **never `safeFetch`**. Retry worker re-hits the same path on backoff.
- **Weak control:** `webhooks.service.ts:65-84` create-time validates only http(s) scheme + (ONLY in prod) literal string-match `localhost`/`127.0.0.1`/`.local`. NO block for `169.254.169.254` (IMDS), `10/8`, `192.168/16`, `172.16/12`, `::1`, IPv4-mapped, alt-encodings, or a public DNS name resolving to a private IP (no connect-time pin).
- **Exfil:** on non-2xx, `:224-225` reads `res.text()` → stored in `WebhookDelivery.lastError` + `TenantWebhook.lastDeliveryError` → returned to operator UI (`webhooks.service.ts:46`). **200 bytes of any internal HTTP response reflected back.**
- **Exploit:** DISTRICT_ADMIN/SUPER_ADMIN creates webhook url=`http://169.254.169.254/latest/meta-data/` → trigger emergency → GET /webhooks reads the metadata in lastDeliveryError. Authenticated (not anon) but DISTRICT_ADMIN is a CUSTOMER role → reaches cloud-internal.
- **Fix:** route `:209` through `safeFetch` (re-resolve per attempt to defeat rebinding) + stop reflecting upstream bodies into operator-visible fields. (= task #58.)

## XSS — CLEAN (DOMPurify everywhere; verified)
- EXTERNAL_HTML shim params (`?text/img/brand/textStyles`) NOT injectable: `applyTextAndStyles` uses `textContent`/`createTextNode`; style via CSSOM (rejects javascript:); `applyImages` strips `["'()\s]` + url() can't execute; iframe `sandbox="allow-scripts"` WITHOUT `allow-same-origin` → null origin (`WidgetRenderer.tsx:2784`). Holiday/style bridges use textContent/CSSOM + same-origin postMessage checks.
- Every widget `dangerouslySetInnerHTML` of operator content wrapped in `sanitizeWidgetHtml()` (isomorphic-dompurify). The `<style dangerouslySetInnerHTML>` cases are static CSS constants.
- Inline-SVG logo (scraped from external sites) sanitized BOTH ends: write `sanitizeLogoSvg` (`branding.controller.ts:152,876`) + render re-sanitize (`Sidebar.tsx:169`, `BrandingSettingsCard.tsx:83`, `BrandingLivePreview.tsx:42`).
- Announcements preview DOMPurify'd. 
- ⚠️ minor: `proxy.controller.ts:640` interpolates server-built `err.message` into `<p>${message}</p>` unescaped — low (server strings, not user HTML) but HTML-escape for hygiene.

## SSRF — other surfaces VERIFIED-SAFE (guards hold)
- Branding scraper → `safe-fetch.ts`: up-front validatePublicUrl (scheme allowlist, port 80/443, private-IP literal block) PLUS **connect-time `ssrfSafeLookup` pin** (re-resolve at socket → reject private) = closes DNS-rebinding TOCTOU; redirects manually re-validated each hop; full v4/v6 private+CGNAT+metadata coverage; 30-stylesheet/512KB-CSS/5MB-HTML/10s caps. Strong.
- Proxy (safeFetch + 60/min/IP + uniform error), YouTube resolver (host-locked + safeFetch), streaming/discovery/geocoder/USB-export (all safeFetch), AI providers + Clever (fixed vendor hosts). Safe.

## SQL / CSV / OAuth / validation — clean
- SQL: every `$queryRawUnsafe/$executeRawUnsafe` static or `$1`-parameterized; all else typed Prisma. None injectable.
- CSV export (audit log) prefixes `=+-@`/TAB/CR + quote-wraps (OWASP). Sponsor report is JSON. Roster CSV is input-parse (bounded).
- OAuth redirects all env-derived (Square/Clever/SSO/OTA/Spotify), state CSRF/HMAC-validated — no open redirect.
- No mass-assignment (writes use explicit Prisma `data:{}` field lists, not `req.body` spread). Zod still not uniform (Sprint-1 goal) but manual service validation covers traced controllers — the webhook URL validator is the one materially-too-weak case.

## FIX LIST
1. **🔴 Webhook SSRF** `webhook-dispatch.service.ts:209` → safeFetch + re-resolve per attempt + stop reflecting upstream body into lastDeliveryError. (task #58)
2. ⚪ HTML-escape `proxy.controller.ts:640` message; extend create-time webhook URL validator to the safe-fetch private-range check (belt-and-suspenders).
