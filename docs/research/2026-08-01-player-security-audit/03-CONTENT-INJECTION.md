# Content Injection & XSS Audit — 2026-08-01

> **Provenance:** single Opus agent under the audit ground rules (read-only, evidence-with-file:line,
> two-methods-for-absence, self-refutation before reporting). Dispatched to resolve the severity of
> `AND-002` from `02-ANDROID-WEBVIEW-JS-BRIDGE.md`.
> **⚠️ LEAD CORRECTION (verified 2026-08-01) — INJ-001 step 9 does NOT hold in the default
> production config. Severity is HIGH, not CRITICAL, pending one env check. See "Lead verification"
> at the bottom of this file BEFORE acting on the CRITICAL label below.**

## VERDICT ON AND-002

**CONFIRMED — and the real chain is worse and shorter than AND-002 described.**

AND-002 rested its severity on an unresolved Android platform question ("does a null-origin sandboxed child frame see `window.EduCmsNative`?"). **That question does not need to be answered.** The player mounts attacker-reachable content in iframes that carry **no `sandbox` attribute at all**, and one of those paths serves attacker-chosen HTML **from the player's own origin** — a plain same-origin XSS on the player document, bridge or no bridge.

### Evidence chain: CONTRIBUTOR account → attacker JS in a player frame

| # | Step | Evidence |
|---|---|---|
| 1 | CONTRIBUTOR may replace the zone list of any non-system template in their tenant — **including one already bound to a live schedule**. Ownership is not checked, only `tenantId` + `isSystem`. | `apps/api/src/templates/templates.controller.ts:2361-2380` |
| 2 | Zone bodies are shape-bounded only. `widgetType` is a free 64-char string; `defaultConfig` is `z.any()`. | `packages/api-types/src/index.ts:534-548` |
| 3 | Server-side zone validation is **geometry only**. `defaultConfig` is persisted verbatim. | `templates.controller.ts:2423`; `validateZoneBounds` at `:2768-2775` |
| 4 | The global `SanitizationPipe` does **not** touch a URL — it early-returns on any string with no `<` or `>`. | `apps/api/src/security/sanitization.pipe.ts:46` |
| 5 | Template zones reach the manifest with **no approval gate**. Only `Asset` rows are status-filtered. | `apps/api/src/screens/screens.controller.ts:3206-3210` vs `:3212-3221`, `:3351-3372` |
| 6 | The player renders every manifest zone through `WidgetPreview … live={true}`. | `apps/web/src/app/player/page.tsx:7071` |
| 7 | `WEBPAGE` with `live=true` builds `${API_BASE}/api/v1/proxy/web?url=<attacker>&v=3&interactive=true` in an iframe with **no `sandbox`**, deliberately. `interactive` is the default. | `WidgetRenderer.tsx:4059-4064`, `:4077-4093`, `:4118-4126` |
| 8 | The proxy fetches the attacker's page, **strips framing headers, leaves scripts intact in interactive mode**, serves it from our origin with `frame-ancestors *`. It is unauthenticated. | `apps/api/src/proxy/proxy.controller.ts:26-38`, `:59-73`, `:597-602` |
| 9 | **That iframe is same-origin with the player.** `vercel.json` rewrites `/api/v1/:path*` to Railway, and the code depends on it: it calls `iframe.contentWindow.eval(...)`. | `apps/web/vercel.json`; `webpage-spatial-nav.ts:22-26`, `:249-265` |

**Result:** attacker JS executes with the player document's origin. From there: `parent.localStorage.getItem('edu_device_token')` (`player/page.tsx:59`), `parent.window.EduCmsNative.*` (all 18 bridge methods incl. `unpair()`), and full DOM control — including removing or forging the emergency overlay. Per the severity anchor (fake/suppressed emergency alert = CRITICAL), this is CRITICAL.

The same unsandboxed iframe exists twice more in the playback path: `player/page.tsx:749`/`:759` (`ScaledWebFrame`, `text/html` asset path) and `:7765` (PDF/web fallback; the comment at `:7771` explicitly documents "No sandbox attribute").

### The single weakest link

**Serving `/api/v1/proxy/web` output — attacker HTML with scripts intact — from our own origin into an unsandboxed iframe.** Move the proxy to a distinct sandbox origin *and* add `sandbox="allow-scripts"`, and the chain collapses from "same-origin player takeover" to "third-party JS in a null-origin frame" — which then rests entirely on the Android bridge question, a much narrower and separately fixable problem.

### On the Android sub-question — HONEST ANSWER

- **Verified from the repo:** the bridge is attached once to the main player WebView with no origin scoping and never removed (`MainActivity.kt:906-930`; 18 methods in `WebAppBridge.kt:67-303`). Two independent greps for `removeJavascriptInterface` across `apps/player/**` return nothing. The *overlay* WebView is correctly bridge-free (`MainActivity.kt:1259-1290`).
- **Asserted from platform knowledge, NOT verified here:** Android injects the bound object into **all frames**, which is why AndroidX added `WebViewCompat.addWebMessageListener` with `allowedOriginRules`. For an opaque-origin sandboxed child, Chromium installs bridge objects per-RenderFrame on `DidClearWindowObject` with no sandbox-flag gating, so the object is *expected* to be present — but this could not be confirmed from the repository and no device was run.
- **Status: UNVERIFIED.** Settle with a 60-second on-device test: load `/player` on a paired unit and, in an EXTERNAL_HTML board frame, report `typeof window.EduCmsNative`. **The AND-002 verdict does not depend on this** — steps 7-9 bypass sandboxing entirely.
- **A tempting "mitigation" that is refuted in-repo:** `SafePlayerWebViewClient.shouldOverrideUrlLoading` (`:105-113`) blocks hosts that aren't `PLAYER_BASE_URL` and does *not* check `isForMainFrame`. If it fired for subframes, off-host iframes would be blocked. It demonstrably does not — the API/proxy origin differs from the player host, yet WEBPAGE widgets and URL assets are operator-confirmed to render on kiosks. **Do not count this as a control.**

---

## Posture: **CRITICAL_GAPS**

The individual defenses that exist are genuinely good — AI Designer containment, the source-bound `educms-action` registry, `safeFetch`'s SSRF gate, DOMPurify on every content sink, the asset approval gate. But they are **point defenses around a hole they were never scoped to cover**: `TemplateZone.defaultConfig` is an unvalidated, unapproved, CONTRIBUTOR-writable channel feeding unsandboxed same-origin iframes on a life-safety surface, with **no CSP on the player route** as a backstop.

---

## Authoring-path table

| Path | Min role | Approval gate? | Reaches a player frame? | JS executes? | Notes |
|---|---|---|---|---|---|
| **WEBPAGE widget** (`config.url`) | **CONTRIBUTOR** | **NO** | **YES** — unsandboxed | **YES, SAME-ORIGIN** | `WidgetRenderer.tsx:4059-4126`. **The chain.** |
| **STREAMING widget** (`config.embedUrl`) | **CONTRIBUTOR** | **NO** | **YES** — unsandboxed | **YES** (attacker origin) | `StreamingWidget.tsx:271-277`, `:281-320`. No sandbox, no allowlist. |
| **WEBPAGE direct mode** | CONTRIBUTOR | NO | YES — unsandboxed | Ours only | **Correctly gated** to `/board/`,`/ribbon/`,`/scorebug/` + `..` check (`:4032-4038`). |
| **EXTERNAL_HTML `config.url`** | **CONTRIBUTOR** | **NO** | **YES** — `sandbox="allow-scripts"` | YES, **null-origin** | `:3804`, `:4005-4014`. No server allowlist. Contained *unless* the bridge reaches sandboxed frames. |
| **EXTERNAL_HTML `config.html`** (srcdoc) | CONTRIBUTOR | NO | YES — sandboxed | **NO** | Double-contained: `SanitizationPipe` + `buildSafeDesignerSrcdoc`. |
| **AI Designer** (`htmlBase64`) | CONTRIBUTOR | NO | YES — sandboxed | **NO** | Strongest path in the codebase. Strip at persist + nonce CSP at render. |
| **RICH_TEXT / TEXT / themed HTML** | CONTRIBUTOR | NO | YES (in-DOM) | **NO** | DOMPurify on every sink — `lib/sanitize-html.ts:35-44`. |
| **RSS_FEED** (remote content) | CONTRIBUTOR sets URL | NO | YES | **NO** | `safeFetch` server-side; rendered as React text nodes. Clean. |
| **SOCIAL_FEED** | — | — | Stub | NO | Not built. N-A. |
| **URL asset** (`text/html`) | CONTRIBUTOR | **YES** — `PENDING_APPROVAL` | After approval | YES, same-origin | Gate holds. |
| **Design imports** (PDF/PPTX) | CONTRIBUTOR | **YES** | After approval | NO | `imports.controller.ts:262`. |
| **Uploaded assets** | CONTRIBUTOR | **YES** | After approval | NO (SVG sanitized) | `asset-sanitizer.service.ts:15-32`. |
| **Touch action `open-url`** | CONTRIBUTOR | NO | YES — unsandboxed | YES (attacker origin) | Gated on scheme + private IPs, then `TouchOverlay.tsx:161-165` renders with no sandbox. Needs a tap. |
| **Holiday boards** | CONTRIBUTOR | NO | YES — **`allow-same-origin allow-scripts`** | Ours only | `HolidayWidget.tsx:334`. Sandbox provides **zero** isolation → INJ-005. |
| **Emergency `mediaUrls`** | SCHOOL_ADMIN+ | NO | YES | NO | Rendered as `<img>`/`<video>`. |

---

## Findings

### [CRITICAL] INJ-001 — CONTRIBUTOR-authored WEBPAGE zone executes attacker JS in the player's own origin

**Attacker:** any CONTRIBUTOR in a tenant with at least one live schedule (i.e. every real tenant).

**Key evidence:**
> `// In interactive mode (v1.0.16+) the iframe runs the upstream page's JS. We still don't sandbox — sandbox=allow-scripts + null-origin would CORS-break every XHR the upstream site makes back to its own API.` — `WidgetRenderer.tsx:4083-4087`

> `Because we route every WEBPAGE iframe through our same-origin /api/v1/proxy/web proxy, the iframe is same-origin with the React app and we can call iframe.contentWindow.eval(SHIM_JS) legally.` — `webpage-spatial-nav.ts:22-26`

> `res.setHeader('Content-Security-Policy', "frame-ancestors *");` — `proxy.controller.ts:601`

**Attack:**
1. Authenticate as CONTRIBUTOR. `GET /api/v1/templates` → pick a non-system template on a live schedule.
2. `PUT /api/v1/templates/:id/zones` with a `WEBPAGE` zone whose `defaultConfig.url` is attacker-controlled. No approval, no admin.
3. Manifest rebuild → the zone ships to every screen on that schedule.
4. Player renders `<iframe src="/api/v1/proxy/web?url=…&interactive=true">` with no `sandbox`.
5. The proxy serves the attacker's HTML — scripts intact — from the player's own origin.
6. Attacker JS runs same-origin: exfiltrate `edu_device_token`; call `EduCmsNative.unpair()`; remove the emergency overlay to **suppress a live lockdown**; or paint a forged all-clear.

**Impact:** schedule-wide screen takeover, device-token theft, and suppression or forgery of a life-safety emergency alert — from the lowest content-authoring role.

**Fix (priority order):**
1. Serve `/api/v1/proxy/web` from a **distinct origin** (exclude `proxy/*` from the `/api/v1/:path*` rewrite).
2. Add `sandbox="allow-scripts allow-popups-to-escape-sandbox"` (no `allow-same-origin`) to `WidgetRenderer.tsx:4118` and `player/page.tsx:749/759/7765`. `injectSpatialNav` dies — replace with a server-injected `postMessage` shim.
3. Server-side allowlist on `defaultConfig.url` for `WEBPAGE`/`EXTERNAL_HTML`/`STREAMING` at write time, reusing `validatePublicUrl` from `safe-fetch.ts`.
4. Gate zone writes introducing a *new remote origin* behind SCHOOL_ADMIN, or route through the existing submission queue.

**Confidence:** High for steps 1-8 (read directly). High for step 9 (the codebase asserts same-origin and calls `contentWindow.eval`, dead code otherwise). **If `NEXT_PUBLIC_API_URL` is an absolute cross-origin Railway URL this degrades from CRITICAL same-origin XSS to HIGH** — still a finding, same fix. Note `https://venue-os.app/api/v1/proxy/web?url=…` is same-origin and unauthenticated regardless.

---

### [HIGH] INJ-002 — No CSP on the player route

**File:** `apps/web/next.config.ts:48-56` — only `frame-ancestors 'self'` is emitted.
> `A full content CSP (script-src / style-src) is deliberately NOT set here: the widget system renders pervasive inline styles and inline <style> blocks` — `:43-47`

With no `script-src`/`connect-src`/`frame-src`, injected JS can load remote scripts, exfiltrate the device token anywhere, and frame anything. No second line of defense behind INJ-001.

**Recommended policy, on `/player` only:**
```
default-src 'self';
script-src 'self' 'nonce-<per-request>';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' https: data: blob:;
media-src 'self' https: blob:;
connect-src 'self' https://<api-host> wss://<api-host>;
frame-src 'self' blob:;
child-src 'self' blob:;
object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'
```
`style-src 'unsafe-inline'` is unavoidable (the widget system is built on inline styles — a legitimate blocker; inline *styles* are not the vector). Once INJ-001's fix moves the proxy to a separate origin, add that origin to `frame-src` and **not** `script-src`. Ship as `Content-Security-Policy-Report-Only` first and watch a real Taurus unit; Chromium 83 supports CSP2 + nonces, so this is safe on the LED floor.

**Verification:** read `next.config.ts` in full; independently confirmed no `middleware.ts` under `apps/web`, no `http-equiv` CSP meta outside `designer-safe-srcdoc.ts`, no headers block in `vercel.json`.

---

### [HIGH] INJ-003 — The CONTRIBUTOR publish gate covers new schedules but not edits to already-live content

**Files:** `schedules.controller.ts:56-64`, `:108-110`; `templates.controller.ts:2361-2362`; `playlists.controller.ts:209-210`
> `// CONTRIBUTOR (Editor) schedules are ALWAYS staged as drafts — they cannot push content live directly.` — `schedules.controller.ts:108-110`

The draft gate only intercepts `POST /schedules`. `PUT /templates/:id/zones` and `PUT /playlists/:id/items` are CONTRIBUTOR-allowed and check only `tenantId` — not authorship, not "is this bound to an active schedule". A CONTRIBUTOR edits an *already live* template and it is on-screen at the next manifest poll with zero review. **This is what makes INJ-001 reachable without an admin ever clicking anything.**

**Fix:** in `replaceZones`/`reorderItems`, detect whether the target is referenced by an `isActive` schedule; if so and the actor is CONTRIBUTOR, write to the submission queue (machinery exists — `submissions.controller.ts:284-302`). At minimum require SCHOOL_ADMIN to edit a live-bound template.

---

### [MEDIUM] INJ-004 — `buildSafeDesignerSrcdoc` trusts any script block containing a marker substring

**File:** `apps/web/src/lib/designer-safe-srcdoc.ts:37`, `:88-93`, `:119-124`

A script block whose *body* merely contains `/*EDUCMS-SHIM-V6*/` is classified trusted, survives the strip, **and gets the render nonce stamped on it** — so the injected CSP explicitly permits it. One comment defeats both layers.

**Refutation attempted (holds today):** every write path into `defaultConfig.html` was traced. `create-designer`/`refine-designer` run `sanitizeDesignerHtml`, which strips **all** scripts unconditionally server-side with no marker exception (`designer-prompt.ts:544-552`). `PUT /:id/zones` and `POST /templates` route through `SanitizationPipe`, and sanitize-html's `nonTextTags` drops `<script>` content. `create-from-candidate`/`import` are SCHOOL_ADMIN+ and re-sanitize. **Latent defense-in-depth bug, not a live chain** — fix before it becomes one.

**Fix:** anchor trust to structure, not substring — inject runtimes with a per-render marker attribute the sanitizer generates, or hash-verify runtime bodies and only nonce-stamp exact matches.

---

### [MEDIUM] INJ-005 — Holiday boards use the sandbox-voiding `allow-same-origin allow-scripts` pair

**File:** `HolidayWidget.tsx:325-337`
> `sandbox="allow-same-origin allow-scripts"`

The comment misstates the attribute. On a document that *is* same-origin with the parent, this pair restores full parent access — `parent.localStorage`, `parent.window.EduCmsNative`. The sandbox is decorative. Mitigating: `src` is path-constrained to `/holiday-templates/…` (`:159-162`) and the content is ours.

Separately the `message` listener at `:172-173` checks `e.origin` but **not** `e.source`, so any same-origin window can forge `holiday:fieldClicked`. Builder-only impact.

**Fix:** drop `allow-same-origin` (field delivery already rides `postMessage` at `:262-272`), or delete the misleading comment. Add an `e.source === iframeRef.current?.contentWindow` check.

---

### [MEDIUM] INJ-006 — STREAMING widget frames any URL, unsandboxed, no allowlist

**File:** `StreamingWidget.tsx:271-277`, `:281-320`
> `// Fall through — assume the URL is already an embed URL. return u;`

Any URL not matching the YouTube/Twitch/Vimeo patterns is used verbatim as an unsandboxed iframe src. Same bridge exposure as INJ-001, minus same-origin escalation.

**Fix:** allowlist the fall-through, and add `sandbox="allow-scripts allow-presentation"` — `FitnessLiveTVWidget.tsx:342` already does exactly this for the same class of content.

---

### [LOW] INJ-007 — `?api=` query param repoints the player's API root
**File:** `player/page.tsx:598-610`. **Already fixed** in commit `5f19ee96` (branch `security/player-fixes-2026-08-01`) — host allowlist with dot-boundary matching, validation on read as well as write, self-healing of a poisoned stored value. Retained here for the record.

---

## What's already strong

- **`safeFetch` SSRF gate** — `apps/api/src/branding/safe-fetch.ts`. Scheme denylist + http(s)-only (`:26`,`:67-70`), port allowlist (`:72-73`), IP-literal check (`:77-79`), full DNS resolution (`:96-107`), **connect-time re-resolution closing the DNS-rebind TOCTOU** (`:113-120`), manual redirect handling re-validating every hop with a 3-hop cap (`:269-353`). Metadata IP, localhost, RFC1918, CGNAT, IPv6 ULA + link-local all covered. A bypass was attempted and not found. Genuinely good code.
- **AI Designer containment (W0-02)** — strongest thing in the surface. Server strips every model-authored script/`on*`/`javascript:`/`<meta refresh>`/`<base>`/nested frame at persist (`designer-prompt.ts:544-560`); render re-strips and injects per-render nonce CSP with `default-src 'none'` (`designer-safe-srcdoc.ts:113-173`); kill switch `AI_DESIGNER_DISABLED`. **The AI Designer is not the AND-002 vector.**
- **`educms-action` hardening** — `lib/kiosk-frame-registry.ts` + `player/page.tsx:5934-5951`. Source-bound (WeakMap of frames we mounted) *and* key-resolved against the operator-saved map, with the message's own `action` object ignored. A forged `educms-action` from a hostile frame is rejected at the source check; even a registered frame can only fire operator-wired actions.
- **Touch-action URL gate** — `player/page.tsx:204-235`, `:311-330`. Rejects `javascript:`/`data:`/`file:`; blocks localhost/`.local`/private IPv4/IPv6/CGNAT.
- **WEBPAGE `direct` mode** — `WidgetRenderer.tsx:4026-4038`. Anticipates a hand-edited zone config; restricts to three root-relative prefixes with a `..` check.
- **Bridge-free overlay WebView** — `MainActivity.kt:1259-1290`. `showUrlOverlay` targets a *separate* WebView with no `addJavascriptInterface`, and rejects non-http(s) (`WebAppBridge.kt:181-194`).
- **Content HTML sanitization** — `lib/sanitize-html.ts:35-44` (DOMPurify, browser-only by design, returns `''` server-side rather than emitting unsanitized markup). Every `dangerouslySetInnerHTML` content sink in player/widget paths routes through it (verified two ways).
- **Asset approval gate** — `screens.controller.ts:3206-3210` + `assets.controller.ts:1310` + `imports.controller.ts:262`. It works; it just doesn't cover template zones.
- **Tenant scoping on content joins** — `playlists.controller.ts:150-168`, `:222-235`; `schedules.controller.ts:78-105`. Consistent and well-commented.
- **WebView hardening** — `MainActivity.kt:891-897`: `allowFileAccess=false`, `allowContentAccess=false`, `MIXED_CONTENT_NEVER_ALLOW`; `onPermissionRequest { deny() }` on both WebViews; `setSupportMultipleWindows(false)` on the overlay.
- **SVG upload sanitization + extension allowlist** — `asset-sanitizer.service.ts:8-32`.

---

## Not checked / UNVERIFIED

- **Android bridge injection into opaque-origin sandboxed subframes** — UNVERIFIED. Needs an on-device test; the main verdict does not depend on it.
- **Deployed value of `NEXT_PUBLIC_API_URL`** — not in the repo. Determines whether INJ-001 is same-origin (CRITICAL) or cross-origin (HIGH). *Lead is verifying — see note below.*
- **`RendererService` (Puppeteer) SSRF** — `apps/api/src/proxy/renderer.service.ts` not read. `safe-fetch.ts:83-91` exports `assertPublicUrl` specifically to guard `page.goto`; not confirmed the renderer calls it. 5-minute follow-up.
- **The proxy's HTML-rewriting pipeline** (`proxy.controller.ts:140-597`) — only entry conditions and response headers read, not the rewrite/`fetch`-shim body.
- **The baked `EDUCMS-SHIM-V6` / kiosk `_edit-shim.js` in-board runtimes** — not read.
- **Dashboard-side XSS surfaces** — scoped out.
- **Line drift:** `player/page.tsx` line numbers shifted ~46 lines during this session (the unsandboxed asset iframe moved 7675 → 7765). **Cite by symbol, not line, when acting on this.**
- **Functional note, not security:** `imports.controller.ts:262` writes `status:'APPROVED'` but the manifest filters `status:'PUBLISHED'` — `playlist-distribution.service.ts:214` already documents `'APPROVED'` as "an orphan value that silently never played". Admin-imported designs likely never reach a screen.

---

## Lead verification (2026-08-01) — INJ-001 step 9 is WRONG in the default production config

The agent correctly flagged step 9 as its one unverified link and named the exact check. I ran it.

**`apps/web/vercel.json` — the rewrite is real:**
```json
{ "rewrites": [ { "source": "/api/v1/:path*",
  "destination": "https://api-production-39a1.up.railway.app/api/v1/:path*" } ] }
```
So `https://venue-os.app/api/v1/proxy/web?url=…` IS same-origin with the player page. That much holds.

**But that is not the URL the widget builds.** `WidgetRenderer.tsx:4063` composes the iframe src from
`API_BASE`, and `API_BASE` (`WidgetRenderer.tsx:292-294`) is:
```ts
const API_BASE = (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_API_URL)
  ? process.env.NEXT_PUBLIC_API_URL.replace('/api/v1', '')
  : 'http://localhost:8080';
```
`.env.example:71` documents production as
`NEXT_PUBLIC_API_URL=https://<your-railway-app>.up.railway.app/api/v1`, which makes `API_BASE` the
**Railway origin** — cross-origin from the Vercel-served player page. The iframe therefore does NOT
inherit the player's origin, and `parent.localStorage.getItem('edu_device_token')` does NOT work.

### Corrected severity: **HIGH**, not CRITICAL — with one open question

What the attacker still gets, unchanged:
- Attacker-controlled JS running **unsandboxed** in a frame of the bridged Android WebView. Whether
  that reaches `window.EduCmsNative` is now the *decisive* question, not a secondary one — so the
  60-second on-device test (`typeof window.EduCmsNative` inside a WEBPAGE frame) is the highest-value
  outstanding verification in this whole audit.
- JS on the **API origin** — the origin that serves the manifest and the emergency endpoints.
- Everything reachable without the parent handle: covering the screen with arbitrary content,
  network access from inside the fleet.

What it no longer gets directly: the device token from the player's localStorage, and `parent.*`
DOM access to remove or forge the emergency overlay.

### The open question only Greg can answer

**Is `NEXT_PUBLIC_API_URL` in Vercel set to the Railway host, or to the Vercel origin?** If it is set
to the app's own origin (relying on the `vercel.json` rewrite), `API_BASE` becomes same-origin and
INJ-001 is **CRITICAL exactly as the agent wrote it**.

There is real evidence pointing that way and it should not be dismissed:
`apps/web/src/components/widgets/webpage-spatial-nav.ts:22-26` states the iframe "is same-origin with
the React app" and `:249-265` calls `iframe.contentWindow.eval(SHIM_JS)` — which throws on a
cross-origin frame. Either that spatial-nav feature is silently broken in production, or the
deployment really is same-origin. Both are worth knowing.

**Check: Vercel → project → Settings → Environment Variables → `NEXT_PUBLIC_API_URL`.**

### This does not change the fix

Sandbox the frame and move the proxy to a dedicated origin either way. Cross-origin-but-unsandboxed
inside a bridged WebView is still a screen-takeover primitive; it is simply one step longer than the
agent's chain. INJ-002 (no CSP on the player route) and INJ-003 (CONTRIBUTOR can edit already-live
templates with no review) are unaffected by this correction and stand as written.
