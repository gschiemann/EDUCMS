# Android 7 → 14 Compatibility — Design + Operating Manual

**Sprint 8d (2026-05-03).** Operator ask: "support Android 7 all the way to
14 while giving the max out of each OS and not removing features from more
current versions."

This doc is the load-bearing reference for how we keep one bundle running
across the entire Android Chromium WebView range without dumbing-down
features on newer devices OR crashing on older ones.

## Why this is one of the hardest things we ship

The player APK ships a single Next.js bundle to every Android WebView,
from system Chromium 60 (Android 7 stock) through Chromium 120+ (Android
14). The APK doesn't bundle its own Chromium runtime — it uses whatever
WebView the OS provides, which the user can't update on locked-down
kiosks. So:

- **Android 7 stock** = Chromium 60. No `:has()`, no container queries,
  no backdrop-filter, no AV1, no H.265, no subgrid, no `oklch()`,
  no `color-mix()`, sometimes no `ResizeObserver`.
- **Android 14** = Chromium 120+. Everything works.

We can't ship two APKs. We can't ask schools to upgrade their wall-mount
hardware. So the same JS + CSS has to gracefully degrade — and on the
modern devices, run at full polish.

## The approach: feature-detection, not version-detection

Three layers, in order of preference:

### 1. CSS `@supports` (preferred — zero JS overhead)

```css
.glassy-card {
  background: rgba(255, 255, 255, 0.5);
  /* fallback always renders */
}
@supports (backdrop-filter: blur(10px)) {
  .glassy-card {
    backdrop-filter: blur(10px);
    background: rgba(255, 255, 255, 0.3);
  }
}
```

Browsers that don't recognize the `@supports` rule skip it. Browsers
that do, conditionally apply the modern style. No JS branching, no
SSR/CSR split, no extra payload.

### 2. JS capability detection at boot (`apps/web/src/lib/capabilities.ts`)

```ts
import { detectCapabilities } from '@/lib/capabilities';

const caps = detectCapabilities();
if (caps.containerQueries) {
  // render the modern grid
} else {
  // render the resize-observer fallback
}
```

Detection is feature-based (`CSS.supports(...)`, `'X' in window`) — never
version-based. The result is memoized for the page lifetime; no
re-detection cost on re-render.

**SSR-safe**: returns all-`false` when `window` / `document` are undefined.
Components that branch on caps should either render the modern version
and let CSS `@supports` handle the fallback, OR branch inside `useEffect`.

### 3. Lazy polyfill load for missing Web APIs

```ts
import { ensurePolyfill } from '@/lib/capabilities';

await ensurePolyfill('intersection-observer');
// IntersectionObserver is now safe to use on Chromium <51
```

Polyfills are lazy-imported so the bytes only ship to devices that
need them. Each polyfill is a separate NPM package — install on demand.

## Picking the best codec / image format per device

```ts
import { pickBestVideo, pickBestImage } from '@/lib/capabilities';

const url = pickBestVideo([
  { url: '/v/intro.av1.mp4',  codec: 'av1' },
  { url: '/v/intro.h265.mp4', codec: 'h265' },
  { url: '/v/intro.h264.mp4', codec: 'h264' }, // fallback always
]);
```

Returns the FIRST candidate the device can play. Production transcode
pipeline (Sprint 10) generates AV1 + H.265 + H.264 from each upload;
old WebViews fall through to H.264 automatically.

Same for images — AVIF / WebP / PNG.

## Capability matrix by Android version

Approximate; verify per-device when targeting a specific kiosk model.

| Android | Chromium  | Container queries | Backdrop filter | `:has()` | H.265 | AV1   | Container WebView updatable? |
|---------|-----------|-------------------|-----------------|----------|-------|-------|------------------------------|
| 7       | 60-78     | ❌                | ❌ (76+)        | ❌       | ❌    | ❌    | No (system Chromium)         |
| 8       | 65-83     | ❌                | ✅              | ❌       | ❌    | ❌    | No                           |
| 9       | 70-90     | ❌                | ✅              | ❌       | ❌    | ❌    | No                           |
| 10      | 79-100    | ❌                | ✅              | ❌       | ❌    | ✅    | Yes                          |
| 11      | 84-110    | partial (105+)    | ✅              | partial  | ❌    | ✅    | Yes                          |
| 12      | 94-115    | ✅                | ✅              | ✅       | ✅    | ✅    | Yes                          |
| 13      | 105-120   | ✅                | ✅              | ✅       | ✅    | ✅    | Yes                          |
| 14      | 115-130+  | ✅                | ✅              | ✅       | ✅    | ✅    | Yes                          |

## Per-screen diagnostics

The player reports its capability snapshot on every device-info push to
the server (see `getDeviceInfo()` in `apps/web/src/app/player/page.tsx`).
Operators can see per-screen capabilities in the dashboard once the UI
piece lands. Use cases:

- **"Why does this one TV look weird?"** — Filter screens by
  `capabilities.containerQueries=false` to find the Chromium <105
  devices that fell back to the simpler layout.
- **"Why is video stuttering on the lobby TV?"** — Check
  `capabilities.codecAv1` + `codecH265`. If both false, the device
  is decoding H.264 in software → upgrade firmware or downgrade
  template assets.
- **"Should we support a new feature?"** — Filter the screen fleet by
  capability before adopting an experimental CSS/JS feature.

## Rules for new features

When you add a widget / theme / animation that uses a bleeding-edge
feature, follow this checklist:

1. **Default to graceful degradation.** Modern feature with zero
   fallback = blank screen on Android 7. Forbidden.
2. **Use CSS `@supports` whenever possible.** Pure CSS fallbacks are
   the lowest risk, smallest bytes, and zero hydration mismatch.
3. **For JS-driven features, gate behind `useCapabilities()`.** Branch
   before render; never throw on missing API.
4. **Add the capability to `Capabilities` interface** if it's not
   already there. Every new `if (caps.X)` should have a corresponding
   `X: boolean` flag detected at boot.
5. **Document in this matrix** which Android versions get the new
   path vs the fallback so ops can predict per-screen behavior.
6. **Test on a real Android 7 device** (or BrowserStack equivalent)
   before merging. The Chromium emulator's behavior diverges from
   real WebView in subtle ways (touch events, video codecs).

## What NEVER to do

- ❌ Use a CSS feature without `@supports` fallback (silent blank-out
  on old WebView).
- ❌ Use a Web API without `if ('X' in window)` guard.
- ❌ Sniff `navigator.userAgent` for version branching. WebView lies
  in many ways; feature-detect instead.
- ❌ Ship an animated widget that runs `@keyframes` on properties
  Chromium 60 can't animate (e.g. `aspect-ratio`, `inset`). Use
  `transform` + `opacity` for backwards-compat.
- ❌ Drop the H.264 transcode in favor of "modern-only" codecs. The
  H.264 fallback is the load-bearing safety net.

## File map

- `apps/web/src/lib/capabilities.ts` — detection + polyfill loader +
  best-media pickers. **Single source of truth for what the device can
  do.**
- `apps/web/src/hooks/use-capabilities.ts` — React hook wrapper.
- `apps/web/src/app/player/page.tsx` (in `getDeviceInfo()`) — boot-time
  log + server-side reporting.

## Future work

- Per-tenant capability dashboard at `/super/screens?caps=...` — show
  which tenants have devices below a configurable Chromium floor.
- Auto-flag widget templates that target capabilities >50% of the
  fleet doesn't have, with a "fallback preview" toggle in the editor.
- Server-side transcoding pipeline (Sprint 10) generates AV1 + H.265
  + H.264 + WebP + AVIF + JPEG variants from each upload so the
  best-media pickers always have something to pick from.
