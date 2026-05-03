/**
 * Browser / WebView capability detection — Android 7 → 14, all in one
 * codebase, no feature loss on the latest devices.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Sprint 8d (2026-05-03). The player APK ships a single Next.js bundle
 * to every Android WebView from system Chromium 60 (Android 7 stock)
 * through Chromium 120+ (Android 14). Older devices crash on newer
 * CSS / Web APIs; newer devices waste their capabilities on a
 * lowest-common-denominator render. We need both: max features when
 * the device supports them, automatic fallbacks when it doesn't.
 *
 * USAGE PATTERN — three flavors:
 *
 *   1. Inline component fallback:
 *      ```tsx
 *      const caps = useCapabilities();
 *      return caps.containerQueries
 *        ? <ModernLayout />
 *        : <FallbackLayout />;
 *      ```
 *
 *   2. CSS-only fallback via `@supports`:
 *      ```tsx
 *      <style>{`
 *        @supports (container-type: inline-size) {
 *          .grid { container-type: inline-size; }
 *        }
 *        @supports not (container-type: inline-size) {
 *          .grid { width: 100%; }
 *        }
 *      `}</style>
 *      ```
 *
 *   3. Lazy polyfill load for missing APIs:
 *      ```ts
 *      await ensurePolyfill('intersection-observer');
 *      ```
 *
 * RULES OF THE ROAD:
 *
 *   • Detection happens ONCE at boot via `detectCapabilities()`. The
 *     result is memoized for the page lifetime — Chromium version
 *     doesn't change between renders.
 *
 *   • Detection is FEATURE-BASED, not version-based. We test for
 *     CSS.supports / `'X' in window` / `typeof X === 'function'`.
 *     User-agent sniffing is a last resort and only used to surface
 *     a Chromium version hint in diagnostics.
 *
 *   • Falsy result = "graceful degradation required." NEVER throw.
 *     The widget renderer treats missing capabilities as "render the
 *     simpler version" — never as "crash the player."
 *
 *   • Capability checks are SAFE to run server-side (SSR). They
 *     return `false` for everything when `window` / `document` are
 *     undefined. Components should only branch on caps inside
 *     useEffect / event handlers, OR pre-render the modern version
 *     and let CSS @supports handle the fallback.
 *
 * SUPPORTED ANDROID/CHROMIUM MATRIX (rough — verify per-device):
 *
 *   Android 7  / Chromium 60-78    → minimum support; many fallbacks
 *   Android 8  / Chromium 65-83    → most modern CSS; no container queries
 *   Android 9  / Chromium 70-90    → backdrop-filter; no :has()
 *   Android 10 / Chromium 79-100   → ResizeObserver, IntersectionObserver
 *   Android 11 / Chromium 84-110   → most modern features
 *   Android 12 / Chromium 94-115   → container queries (105+)
 *   Android 13 / Chromium 105-120  → :has(), oklch
 *   Android 14 / Chromium 115+     → all current features
 */

export interface Capabilities {
  // ─── CSS ─────────────────────────────────────────────────
  /** `container-type: inline-size` (Chromium 105+) */
  containerQueries: boolean;
  /** `:has()` selector (Chromium 105+) */
  hasSelector: boolean;
  /** `backdrop-filter: blur()` (Chromium 76+) */
  backdropFilter: boolean;
  /** `oklch()` / `oklab()` colors (Chromium 111+) */
  oklchColors: boolean;
  /** `color-mix()` (Chromium 111+) */
  colorMix: boolean;
  /** Subgrid (Chromium 117+) */
  subgrid: boolean;
  /** `aspect-ratio` (Chromium 88+) */
  aspectRatio: boolean;
  /** Logical properties (margin-block-start etc.) (Chromium 87+) */
  logicalProperties: boolean;

  // ─── Web APIs ────────────────────────────────────────────
  /** `IntersectionObserver` (Chromium 51+ — present everywhere we ship) */
  intersectionObserver: boolean;
  /** `ResizeObserver` (Chromium 64+) */
  resizeObserver: boolean;
  /** `requestVideoFrameCallback` on HTMLVideoElement (Chromium 83+) */
  requestVideoFrameCallback: boolean;
  /** Service Worker (Chromium 40+ — universal) */
  serviceWorker: boolean;
  /** `WebGL2` (Chromium 56+) */
  webgl2: boolean;
  /** `WebAssembly` (Chromium 57+) */
  webassembly: boolean;
  /** `OffscreenCanvas` (Chromium 69+) */
  offscreenCanvas: boolean;
  /** `crypto.subtle` (Chromium 37+ — universal under HTTPS) */
  cryptoSubtle: boolean;
  /** `Cache` API (Chromium 40+ — universal) */
  cacheApi: boolean;
  /** `BroadcastChannel` (Chromium 54+) */
  broadcastChannel: boolean;

  // ─── Media / codecs ──────────────────────────────────────
  /** H.264 / AVC playback (universal) */
  codecH264: boolean;
  /** H.265 / HEVC playback (Chromium 107+ on Android, varies by device) */
  codecH265: boolean;
  /** VP9 (Chromium 30+ — universal) */
  codecVp9: boolean;
  /** AV1 (Chromium 70+ on Android, varies) */
  codecAv1: boolean;
  /** WebP image format (Chromium 32+ — universal) */
  imageWebp: boolean;
  /** AVIF image format (Chromium 85+) */
  imageAvif: boolean;

  // ─── Touch / input ───────────────────────────────────────
  /** Touch events (any Android Display) */
  touch: boolean;
  /** Pointer events (Chromium 55+) */
  pointerEvents: boolean;

  // ─── Diagnostics ─────────────────────────────────────────
  /** Parsed Chromium major version (e.g. 78). 0 if unknown / SSR. */
  chromiumMajor: number;
  /** True iff Chromium ≥ 95. Convenience flag for "modern enough." */
  modernChromium: boolean;
}

const SSR_DEFAULTS: Capabilities = {
  containerQueries: false,
  hasSelector: false,
  backdropFilter: false,
  oklchColors: false,
  colorMix: false,
  subgrid: false,
  aspectRatio: false,
  logicalProperties: false,
  intersectionObserver: false,
  resizeObserver: false,
  requestVideoFrameCallback: false,
  serviceWorker: false,
  webgl2: false,
  webassembly: false,
  offscreenCanvas: false,
  cryptoSubtle: false,
  cacheApi: false,
  broadcastChannel: false,
  codecH264: true,
  codecH265: false,
  codecVp9: false,
  codecAv1: false,
  imageWebp: false,
  imageAvif: false,
  touch: false,
  pointerEvents: false,
  chromiumMajor: 0,
  modernChromium: false,
};

let memo: Capabilities | null = null;

function safeCssSupports(prop: string, value: string): boolean {
  try {
    if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
    return CSS.supports(prop, value);
  } catch {
    return false;
  }
}

function safeCssSupportsSelector(selector: string): boolean {
  try {
    if (typeof CSS === 'undefined' || typeof (CSS as any).supports !== 'function') return false;
    return CSS.supports(`selector(${selector})`);
  } catch {
    return false;
  }
}

function detectChromiumMajor(): number {
  try {
    const ua = navigator.userAgent || '';
    // Match "Chrome/120.0.0.0" or "CrMo/120.0" etc. WebView is reported
    // as "Chrome" by Android (even though it's a separate process).
    const m = /Chrom(?:e|ium)\/(\d+)\./.exec(ua);
    if (m) return parseInt(m[1], 10);
    return 0;
  } catch {
    return 0;
  }
}

function detectVideoCodec(mime: string): boolean {
  try {
    const v = document.createElement('video');
    return v.canPlayType(mime) !== '';
  } catch {
    return false;
  }
}

async function detectImageFormat(format: 'webp' | 'avif'): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  // Tiny inline test image. Decoded → format supported.
  const data: Record<string, string> = {
    webp: 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
    avif: 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=',
  };
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.width > 0 && img.height > 0);
    img.onerror = () => resolve(false);
    img.src = data[format];
  });
}

/**
 * Snapshot the current device's capabilities. Memoized — call as
 * many times as you want; detection only runs once.
 */
export function detectCapabilities(): Capabilities {
  if (memo) return memo;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return SSR_DEFAULTS;
  }
  const chromiumMajor = detectChromiumMajor();
  const result: Capabilities = {
    // CSS
    containerQueries: safeCssSupports('container-type', 'inline-size'),
    hasSelector: safeCssSupportsSelector('html:has(body)'),
    backdropFilter:
      safeCssSupports('backdrop-filter', 'blur(1px)') ||
      safeCssSupports('-webkit-backdrop-filter', 'blur(1px)'),
    oklchColors: safeCssSupports('color', 'oklch(50% 0 0)'),
    colorMix: safeCssSupports('color', 'color-mix(in srgb, red, blue)'),
    subgrid: safeCssSupports('grid-template-columns', 'subgrid'),
    aspectRatio: safeCssSupports('aspect-ratio', '1 / 1'),
    logicalProperties: safeCssSupports('margin-block-start', '1px'),

    // Web APIs
    intersectionObserver: typeof (window as any).IntersectionObserver === 'function',
    resizeObserver: typeof (window as any).ResizeObserver === 'function',
    requestVideoFrameCallback:
      typeof HTMLVideoElement !== 'undefined' &&
      'requestVideoFrameCallback' in HTMLVideoElement.prototype,
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    webgl2: (() => {
      try {
        const c = document.createElement('canvas');
        return !!c.getContext('webgl2');
      } catch {
        return false;
      }
    })(),
    webassembly: typeof (window as any).WebAssembly === 'object',
    offscreenCanvas: typeof (window as any).OffscreenCanvas === 'function',
    cryptoSubtle:
      typeof (window as any).crypto === 'object' &&
      typeof (window as any).crypto.subtle === 'object',
    cacheApi: typeof (window as any).caches === 'object',
    broadcastChannel: typeof (window as any).BroadcastChannel === 'function',

    // Codecs
    codecH264: detectVideoCodec('video/mp4; codecs="avc1.42E01E"'),
    codecH265:
      detectVideoCodec('video/mp4; codecs="hvc1.1.6.L93.B0"') ||
      detectVideoCodec('video/mp4; codecs="hev1.1.6.L93.B0"'),
    codecVp9: detectVideoCodec('video/webm; codecs="vp9"'),
    codecAv1:
      detectVideoCodec('video/mp4; codecs="av01.0.05M.08"') ||
      detectVideoCodec('video/webm; codecs="av01.0.05M.08"'),
    // Image formats — start as false; an async detector below upgrades
    // them once decoded. Components that need to make a SYNCHRONOUS
    // choice should default to fallback (jpg/png) until the upgrade.
    imageWebp: false,
    imageAvif: false,

    // Touch / input
    touch:
      'ontouchstart' in window ||
      (typeof navigator !== 'undefined' && (navigator as any).maxTouchPoints > 0),
    pointerEvents: typeof (window as any).PointerEvent === 'function',

    chromiumMajor,
    modernChromium: chromiumMajor >= 95,
  };
  memo = result;

  // Async-upgrade the image-format flags once the test images decode.
  // No await — this runs in the background and updates the memo.
  Promise.all([detectImageFormat('webp'), detectImageFormat('avif')]).then(
    ([webp, avif]) => {
      if (memo) {
        memo.imageWebp = webp;
        memo.imageAvif = avif;
      }
    },
  );

  return result;
}

/** Re-detect capabilities (test override hook). Production code should
 *  not call this — the device's Chromium version doesn't change between
 *  page loads. */
export function _resetCapabilitiesForTest() {
  memo = null;
}

// ─── Polyfill loader ───────────────────────────────────────────────────

const polyfillsLoaded = new Set<string>();

/**
 * Lazy-load a polyfill for a missing capability. Returns immediately
 * if the polyfill already loaded OR the native API is present.
 *
 * Uses dynamic `import()` so the polyfill bytes only ship to the
 * subset of devices that actually need them. Each polyfill is its
 * own NPM package — add to apps/web/package.json deps as needed.
 */
export async function ensurePolyfill(
  feature: 'intersection-observer' | 'resize-observer' | 'broadcast-channel',
): Promise<void> {
  if (polyfillsLoaded.has(feature)) return;
  const caps = detectCapabilities();
  switch (feature) {
    case 'intersection-observer':
      if (caps.intersectionObserver) return;
      try {
        await import('intersection-observer' as any);
        polyfillsLoaded.add(feature);
      } catch {
        // Polyfill not installed — caller must provide a fallback.
        // eslint-disable-next-line no-console
        console.warn('[capabilities] intersection-observer polyfill missing; install with `pnpm add intersection-observer` if you need IO on Chromium <51.');
      }
      return;
    case 'resize-observer':
      if (caps.resizeObserver) return;
      try {
        await import('resize-observer-polyfill' as any);
        polyfillsLoaded.add(feature);
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[capabilities] resize-observer-polyfill missing; install if needed for Chromium <64.');
      }
      return;
    case 'broadcast-channel':
      if (caps.broadcastChannel) return;
      try {
        await import('broadcast-channel' as any);
        polyfillsLoaded.add(feature);
      } catch {
        // eslint-disable-next-line no-console
        console.warn('[capabilities] broadcast-channel polyfill missing.');
      }
      return;
  }
}

/**
 * Pick the best media URL the device can play, given a list of
 * candidates in preferred-quality order (e.g. AV1 → H.265 → H.264).
 * Returns the FIRST candidate whose codec is supported.
 *
 * Use case: a video upload generates multiple transcodes; the player
 * picks the best the device supports without burning bandwidth on a
 * codec it has to fall back from.
 */
export function pickBestVideo(candidates: Array<{ url: string; codec: 'av1' | 'h265' | 'vp9' | 'h264' }>): string | null {
  const caps = detectCapabilities();
  for (const c of candidates) {
    if (c.codec === 'av1' && caps.codecAv1) return c.url;
    if (c.codec === 'h265' && caps.codecH265) return c.url;
    if (c.codec === 'vp9' && caps.codecVp9) return c.url;
    if (c.codec === 'h264' && caps.codecH264) return c.url;
  }
  // Last resort — return whatever we got.
  return candidates[0]?.url ?? null;
}

/**
 * Same idea for images.
 */
export function pickBestImage(candidates: Array<{ url: string; format: 'avif' | 'webp' | 'jpg' | 'png' }>): string | null {
  const caps = detectCapabilities();
  for (const c of candidates) {
    if (c.format === 'avif' && caps.imageAvif) return c.url;
    if (c.format === 'webp' && caps.imageWebp) return c.url;
    if (c.format === 'jpg' || c.format === 'png') return c.url;
  }
  return candidates[0]?.url ?? null;
}
