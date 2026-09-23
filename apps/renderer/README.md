# apps/renderer — the board renderer

A complete board HTML document in; a WebP screenshot and objective design
measurements out. It is the eyes of the AI Designer's look-and-fix loop: the
API renders each draft here, shows GPT-6 Sol the picture plus the numbers,
applies its patches and renders again.

It is its own Railway service (Greg, 2026-09-22: "If it gives us way better
quality do it") so a browser pointed at model-written HTML never shares
memory, CPU or secrets with the process that owns emergency delivery.

```
POST /render   { html, canvasWidth, canvasHeight, viewportScale?, settleMs?, fullWidth? }
            →  { contractVersion, image, thumb, metrics, timings, chromium, … }
GET  /health   →  { status: 'ok', chromium: 'Chrome/…', queue, memoryMb, … }
```

The wire contract — every request, response, error and metric type — is
[`src/contract.ts`](src/contract.ts). It has no imports: the API can import
it or copy it verbatim.

---

## Deploying on Railway (the lead does this — nothing is deployed from here)

1. **New service** in the VenueOS project → *Deploy from GitHub repo* → this
   repository, branch `master`.
2. **Settings → Source**: leave *Root Directory* empty (the build context must
   be the repo root; the pnpm lockfile lives there).
3. **Settings → Config-as-code → Railway config file**:
   `apps/renderer/railway.json`. That file sets the Dockerfile
   (`apps/renderer/Dockerfile`), the healthcheck (`/health`), restart
   `ON_FAILURE` × 10, one replica, and watch patterns so an API or web push
   does not rebuild the renderer.
4. **Settings → Service name**: `renderer`. Its private hostname becomes
   `renderer.railway.internal`.
5. **Variables**: set `PORT=8080` (a fixed port is what makes the private URL
   stable). Nothing else is required. **Do not add any secret** — this
   service must never hold one; the tuning knobs below are optional.
6. **Settings → Networking**: **do NOT generate a public domain** and do not
   add a TCP proxy. Private networking only. (It is safe even if reached —
   see *Security* — but there is no reason to expose a CPU-heavy endpoint.)
7. **Settings → Resources**: memory limit **1–2 GB** (2 GB recommended).
   Measured on macOS with Chromium 147: the browser's physical footprint is
   ~180 MB idle and ~265–270 MB while rendering a 4K board; Node's RSS is
   ~90 MB idle and ~170–210 MB at peak (two decoded frames + the base64
   answer). So a normal render needs ~0.5 GB; the rest is headroom for a
   hostile page, which the memory watchdog kills at 85 % of the container
   limit — the limit you set here IS that budget. (The in-container figure is
   not yet measured: Docker was not available where this was built.)
8. Deploy. The healthcheck passes only once Chromium has launched
   (`/health` answers 503 until then), so a build whose browser cannot
   start never takes traffic.
9. **On the API service**, add `RENDERER_URL=http://renderer.railway.internal:8080`
   (the job/critique agent reads it; nothing reads it yet).

Verify from the API service's shell (Railway → API → *Shell*):

```bash
curl -s http://renderer.railway.internal:8080/health
# {"status":"ok","chromium":"Chrome/…","contractVersion":1,"uptimeS":…,"rendersServed":0,"queue":{"active":0,"waiting":0,"max":4},"memoryMb":…}
```

Railway's private network is IPv6 on older environments; the server listens on
`::` (dual-stack), so both IPv6 and IPv4 callers reach it.

### Tuning knobs (all optional; a bad value falls back to the default and is logged)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Listen port. |
| `RENDERER_TIMEOUT_MS` | `30000` | Wall clock per render (queue wait excluded). Over → 504, Chromium killed and restarted. |
| `RENDERER_QUEUE_MAX` | `4` | Renders waiting behind the one in flight. More → 429 `Retry-After: 5`. |
| `RENDERER_RECYCLE_AFTER` | `50` | Restart Chromium after this many renders. |
| `RENDERER_MEMORY_LIMIT_MB` | 85 % of the cgroup limit | Kill Chromium past this container memory charge (mid-render → 503 `memory_limit`). |
| `RENDERER_MAX_BODY_BYTES` | `4194304` | Request body cap. Over → 413. |
| `PUPPETEER_EXECUTABLE_PATH` / `CHROME_PATH` | `/usr/bin/chromium-browser` in the image | Chromium binary. |

---

## Calling it (the API side)

```ts
import type { RenderRequest, RenderResponse, RenderErrorBody } from './contract'; // copied from apps/renderer/src/contract.ts

const body: RenderRequest = {
  html,               // the COMPLETE document a screen gets: board + fit engine + stage-scale runtime + CSP
  canvasWidth: 3840,
  canvasHeight: 2160, // viewportScale 0.5 → rendered at 1920×1080, what a 1080p screen shows
};
const res = await fetch(`${process.env.RENDERER_URL}/render`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(45_000), // queue wait + 30 s render + encode
});
if (res.status === 429) { /* busy: back off (Retry-After: 5) and try again */ }
if (!res.ok) {
  const err = (await res.json()) as RenderErrorBody; // { contractVersion, error, message }
  // render_timeout (504), memory_limit / browser_unavailable (503), render_failed (500):
  // skip the review and return the draft labelled "not reviewed".
}
const shot = (await res.json()) as RenderResponse;
// shot.image  — base64 WebP, 1920 wide: what the critic looks at
// shot.thumb  — base64 WebP, 480 wide: what the picker shows
// shot.metrics — see below; every length is CANVAS px
```

Rules the caller must follow:

- **Inline every image as a `data:` URI first** (fetch through `safeFetch`,
  never let the renderer fetch). The renderer has no network: an `https://`
  image is blocked and reported in `metrics.blockedRequests`, and the board
  renders without it.
- **Send the document the screen gets** — `injectDesignerLayoutEngine` then
  the web's `buildSafeDesignerSrcdoc` (CSP + `VOS-STAGE-SCALE`). The
  integration suite renders exactly that pipeline, transpiled from source.
- **One request at a time per job**; the service runs one render and queues 4.
- **Treat metrics as evidence, not authority**: they measure a document that
  ran its own CSS. Re-run the API's sanitizer and fact guard on anything a
  critic proposes.

Timing, measured on an M-series Mac with Chromium 147 (Railway CPUs are
slower — budget ~2×): **3.1–4.2 s per 4K board with a warm browser**, of
which 2.2 s is the settle window (the fit engine re-runs at 400 / 1200 /
2000 ms) and ~0.1 s the backplate frame; +0.9–1.3 s when Chromium has to
launch. Encoded sizes for the Super Taco boards: 170–195 KB image, 20–22 KB
thumb (a flatter board: ~120 KB / 15 KB).

---

## What `metrics` measures

All in canvas px (a 94 px headline on a 3840 × 2160 board reads 94 even
though the 1920 screenshot drew it 47 px tall). Types: `RenderMetrics` in
[`src/contract.ts`](src/contract.ts).

| Field | What | Rubric hook |
|---|---|---|
| `text.minFont`, `belowFloor`, `sizeTiers`, `topTwoRatio` | rendered font sizes (computed size × every transform in the chain), floor = 2.4 % of the short side | readable at distance, hierarchy |
| `overflow` | text spilling out of its own box (or that box's parent) where it is VISIBLE, and text off the canvas | overflow & clipping |
| `clipped` | text cut by an overflow box, `text-overflow: ellipsis` or line-clamp — a cut inside the measured descender band is tolerated, one into the letter bodies is not | overflow & clipping |
| `overlaps` | glyph boxes (trimmed to real ink with canvas `measureText`) intersecting > 6 px on both axes; aria-hidden / opacity < 0.2 text ignored | overflow & clipping |
| `fitRepairs` | what the fit engine had to do: `data-vos-fs` (shrunk / raised to the floor), `data-vgw` (decorations shrunk / dimmed), `data-fit-col` (columns scaled), `data-fit` (text shrunk below its stylesheet size); `overcrowded` when any scale < 0.9 | overcrowding |
| `images` | per `<img>` / background: natural vs DRAWN size (object-fit / background-size aware), `upscale` (> 1.3 = `blurry`), `distortion`, `broken` | brand, blur |
| `fonts`, `fontFallbacks` | which platform font actually drew each family (CDP), bundled vs look-alike vs fallback; unbundled Google families; css2 selectors Google would 400 | brand |
| `counts`, `menu` | `data-field` / `data-imgslot` / `data-menu-row` / `data-pos-item` / `data-action`; menu rows and `item.N` groups with a VISIBLE name AND price | real content, POS binding |
| `contrast` | WCAG ratio of each text vs the background under its glyphs, read from TWO frames (as shown, and with every glyph fill transparent) — `ratio` vs the dominant background, `minRatio` vs its worst 10 %; `occluded` when text should show but inks nothing | contrast |
| `emptySpace` | 16 × 9 grid (9 × 16 portrait) of cells that are one flat colour with no text or image; target ≤ 0.35; `largestVoidPct` (rubric: no void over ~12 %) | dead space |
| `blockedRequests` | every attempted exit: network, navigation, CSP refusals, popups, unbundled fonts | security, broken assets |

---

## Security

The renderer runs model-written HTML in a real browser. It is built to be
useless to an attacker even if one reached it:

1. **No network, four layers deep** ([`src/network.ts`](src/network.ts)):
   request interception serves the document from memory, answers Google Fonts
   CSS and font files from the bundle, 204s every navigation, aborts the rest;
   a `connect-src 'none'` CSP header closes fetch / XHR / WebSocket /
   EventSource / beacons (WebSockets are invisible to interception); launch
   flags map every host to NOTFOUND and point the proxy at a dead loopback port
   with the loopback bypass removed; WebRTC may use proxied UDP only (none).
   Chromium is driven over a pipe — no DevTools port.
   `test/integration/network-lockdown.test.ts` proves it against local
   TCP + UDP listeners: a stock Chromium reaches them (control), the renderer
   lets nothing out, and the launch flags alone still let nothing out.
2. **No secrets.** `src/config.ts` is the only environment reader: PORT and
   the knobs above.
3. **Bounded.** 4 MB bodies, one render at a time + 4 queued, a 30 s wall
   clock that kills Chromium, a fresh incognito context per render, a
   container-memory watchdog, a 512 MB V8 heap per page, recycling every 50
   renders, a non-root user, no package manager in the image.

`--no-sandbox` is required in the container for the reason
`apps/api/src/proxy/render-pipeline.ts` measured (the runtime's seccomp
profile denies the namespaces Chromium's sandbox needs). The service boundary
is the isolation.

---

## Fonts

- **Designer fonts** — `DESIGNER_FONTS` in `apps/api/src/ai/designer-prompt.ts`,
  mirrored into `fonts/manifest.json` and shipped from `@fontsource(-variable)`
  5.3.0 packages. Google Fonts `<link>`s are answered locally and faithfully:
  css2 is strict like Google (one impossible weight 400s the whole link — and
  a screen would then fall back on every family in it), discrete weights stay
  discrete, `opsz`/`wdth` requests get the file that carries the axis.
- **System-font look-alikes** for the exemplar boards: Impact → Anton,
  Arial / Helvetica / Helvetica Neue → Arimo, Georgia → Gelasio, Times /
  Times New Roman → Tinos (registered as page FontFaces, so a render looks the
  same on a Mac, on CI and in the image). Reported as `substituted`: an
  Android player has no Impact and draws its own fallback, so a board that
  names one is not using a Designer font.
- **When the prompt's font list changes**: add the fontsource package
  (`pnpm --filter renderer add @fontsource-variable/<id>@5.3.0`, or
  `@fontsource/<id>` when there is no variable build), then
  `pnpm --filter renderer gen:fonts`. `test/unit/font-manifest.test.ts` fails
  until the manifest matches the prompt.

---

## Developing

```bash
pnpm --filter renderer build                  # tsc → dist/
CHROME_PATH=/path/to/chrome pnpm --filter renderer start   # listens on :8080
pnpm --filter renderer test                   # unit + real-Chromium integration
pnpm --filter renderer exec tsc -p tsconfig.test.json \
  && node dist-test/test/tools/render-file.js <board.html> .renders   # render one file to .renders/
```

Integration tests find Chromium via `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`,
the Playwright Chromium the repo's e2e suite installs, or the usual system
paths — and skip loudly when there is none. CI sets
`RENDERER_REQUIRE_CHROMIUM=1` so a missing browser is a failure, not a skip.
