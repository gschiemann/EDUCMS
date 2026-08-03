# Fix Report — iframe sandbox, CSP, and server-side spatial-nav shim

> Agent report, verbatim. **Lead review status: verification in progress.**
> Note: this agent REFUTED three premises in the lead's brief — see its 'Refutations' section.

BRANCH: `worktree-wf_814aca52-f7b-5` — one commit, `789b5973`. Not pushed, not merged.

# Sandbox third-party frames + CSP, without breaking remote control

## THE HARD REQUIREMENT — done, and verified in a real browser

Remote-control spatial nav still works. The shim moved server-side; the eval is gone.

| Piece | File + symbol |
|---|---|
| Shim source (server) | `apps/api/src/proxy/spatial-nav-shim.ts` — `buildSpatialNavShim()`, `resolveParentOrigins()`, `OPAQUE_STORAGE_POLYFILL` |
| Injection | `apps/api/src/proxy/proxy.controller.ts` — `spatialNavShim()` + `navInjection` folded into `headInjection` (both interactive **and** static mode) |
| Parent half | `apps/web/src/components/widgets/webpage-spatial-nav.ts` — `attachSpatialNavBridge()`, `isVosNavFrameMessage()`, `postSpatialNavCommand()`, `commandForKey()`. `injectSpatialNav`/`WEBPAGE_SPATIAL_NAV_SHIM` **deleted**. |

Guards added: frame side checks `e.source === window.parent` **and** `PARENTS.indexOf(e.origin)` against a **server-baked** ALLOWED_ORIGINS list (never request-derived), **and** `d.vosnav === 'vosnav/1'`, **and** `CMDS.indexOf(cmd)` against a closed 7-value enum. Parent side checks `event.source === iframe.contentWindow` (origin is useless — a null-origin frame reports `"null"`, which I confirmed empirically). No `eval`/`Function`/`innerHTML` in either half; asserted by test.

Two things I changed beyond the brief, both load-bearing:
- **The shim installs INERT** and only wakes on `arm`. A server-injected shim can't see the parent's pathname, so the 2026-06-08 "every menu click needs two clicks" gate would have been lost. Dashboard preview frames never arm it.
- **`OPAQUE_STORAGE_POLYFILL`** — a null-origin document throws `SecurityError` on `localStorage`, which kills a site's bundle at import time and blanks the screen. Measured: without it `localStorage THREW: SecurityError`; with it, storage works and the rest of the bundle runs; unsandboxed frames keep **real** storage (probe short-circuits).

Real-browser end-to-end against a genuine null-origin sandboxed frame, using the actual shipped code: `origin` observed as `"null"`; `arm` accepted; `down`/`up` returned `moved:true`; `cmd:'eval'`, `cmd:"up; alert(1)"`, wrong-namespace all ignored; a message from a different frame rejected by the parent.

## Per-fix results

**INJ-001a** — sandboxed **without** `allow-same-origin`: `WidgetRenderer.tsx` `WebpageWidget` proxy iframe; `player/page.tsx` `ScaledWebFrame` (both branches, via new `SCALED_WEB_SANDBOX`).

**INJ-006** — `StreamingWidget.tsx` `normalizeEmbedUrl` + new `isAllowedStreamingHost`/`STREAMING_EMBED_HOSTS`. Fall-through now requires https + a dot-boundary host match; unsupported hosts get a visible placeholder. Also removed a loopback exemption I'd briefly added — it was the only way `src` could become same-origin.

**INJ-005 — fully shipped, `allow-same-origin` dropped.** My first pass documented it as un-droppable; that was wrong and I corrected it. `HolidayWidget.tsx`: `sandbox="allow-scripts"`, source check now unconditional (`iframeRef.current && …` skipped the check whenever the ref was null), origin check accepts `"null"`, six outbound posts switched to `HOLIDAY_FRAME_TARGET_ORIGIN`. **Zero board files changed.** Verified against the real `hs-christmas.html`: `holiday:ready` received with 46 fields at `origin="null"`, `setField`/`apply-styles`/`set-hotspots` all applied on screen. Two independent scans over all 50 board files found no `localStorage`/`cookie`/`parent.document`/`top.*`/`<form>`/`alert`/`window.open`/fullscreen.

**INJ-004** — `designer-safe-srcdoc.ts` `isTrustedScriptBlock` + `TRUSTED_RUNTIMES` + `sha256Hex`. Trust = leading `/*MARKER*/` at index 0 **and** byte-exact SHA-256. Registry pins **all 5 historical** `VOS-FIT-ENGINE` bodies (it was rewritten 5× without a marker bump — hash-pinning only the current one would have silently stripped the fit engine from every pre-2026-06-30 board).

**INJ-002** — `next.config.ts` `playerCspReportOnly()` on `/player` + `/player/:path*`, `Content-Security-Policy-Report-Only`. Honest `script-src`: **`'self' 'unsafe-inline'`** — Next's App Router emits unnonced inline flight scripts, so nonce-only breaks hydration instantly. Real nonces need Next middleware threading a per-request nonce into the header and every inline script we emit, plus `strict-dynamic`. No `report-uri` (no collector; console-only).

## Refutations — three brief premises were wrong

1. **"FitnessLiveTVWidget:342 already does exactly this without `allow-same-origin`."** It is `sandbox="allow-scripts allow-same-origin allow-presentation"`. The token is *safe there* because the src is foreign — it restores the frame's own origin, not ours. That asymmetry is now documented at each site.
2. **"HolidayWidget checks origin but not source."** A source check existed (`HolidayWidget.tsx:~173`) but was skipped when the ref was null. Hardened rather than added.
3. **`allow-popups-to-escape-sandbox` is inert** without `allow-popups`. Kept on the proxy frames as specified, documented as intent-pinning.

## DEGRADED / NOT SHIPPED — read this

**The player's PDF iframe (`page.tsx` ~:7765) is NOT sandboxed.** Measured, not assumed: a 4-cell probe against one PDF — no sandbox / `allow-scripts allow-popups-to-escape-sandbox` / `allow-scripts allow-same-origin` / **every** sandbox token — rendered the viewer **only** in the unsandboxed cell. Sandboxing deletes "PDF on the lobby screen". Residual risk is bounded (Supabase host ⇒ already cross-origin ⇒ SOP denies parent access); the real gap is an asset stored as `application/pdf` but *served* as HTML, which belongs in upload validation. I removed the dead `injectSpatialNav` call there (it always threw `SecurityError`).

**StreamingWidget keeps `allow-same-origin`.** Measured: a real YouTube embed renders **black** without it; Vimeo survived either way. Dropping it deletes YouTube streaming. Safe here because `normalizeEmbedUrl` guarantees a foreign allowlisted host.

## Reviewer must double-check
- **Run `tests/e2e/holiday-hotzone.spec.ts` and the WebKit `holiday-bridge` cross-browser suite.** I could not drive real Playwright here. Click-to-edit (`holiday:fieldClicked`) never fired under my synthetic clicks — **but neither did an unsandboxed control frame**, so it's my click missing a `[data-field]`, not the sandbox. It rides the identical `postMessage` call that `holiday:ready` demonstrably delivers.
- **Interactive-mode WEBPAGE on a real upstream site.** My CORS reasoning (`ACAO: *` matches `Origin: null`) is sound but untested against a live third-party page.
- **Pre-existing, unrelated:** `src/components/widgets/__tests__/signage-templates-quarantine.test.ts` fails on master too (confirmed by stashing my work).
- **Pre-existing bug I did not touch:** the proxy's `<base href="upstream">` makes the interactive shim's relative `/api/v1/proxy/web?...` resolve against the *upstream* origin in `fetch`/XHR. Out of scope; flagging it.

## Commands run

`pnpm --filter api exec tsc --noEmit --project tsconfig.build.json` (after `rm tsconfig.build.tsbuildinfo`) → **clean** (needed `pnpm --filter @cms/signage-design run build` + `@cms/scoreboard-cts` first; without them 12 pre-existing module-resolution errors, none in `src/proxy`).
`pnpm --filter web exec tsc --noEmit` → **clean, no output**.
`node apps/web/tools/check-inset-serialization.cjs` → `OK — clean (286 files, 0 confirmed landmines)`.
`node apps/web/tools/check-mobile-perf.cjs` → `OK — clean`.
`pnpm --filter api exec jest src/proxy` → **17 passed, 2 suites**.
`pnpm --filter web exec jest src/components/widgets src/lib` → **256 passed / 257**, sole failure the pre-existing quarantine spec.

Tests added: `apps/api/src/proxy/spatial-nav-shim.spec.ts` (13), `apps/api/src/proxy/proxy.controller.spec.ts` (4 — proves the shim lands in the response before `<body>` in **both** modes and that a hostile `?url=` cannot widen the allowlist), `apps/web/src/components/widgets/__tests__/spatial-nav-protocol.test.ts` (21 — both directions, executing the real API shim in jsdom), `.../streaming-embed-allowlist.test.ts` (11), and `designer-safe-srcdoc.test.ts` grew to 26 including a SHA-256-vs-node-crypto correctness check and a registry-drift guard that reads the live API constants.