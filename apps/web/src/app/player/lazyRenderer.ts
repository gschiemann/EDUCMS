'use client';

/**
 * The ONE gate between the pairing path and the renderer graph (P0-3).
 *
 * `page.tsx` must be able to register + pair without the widget/template
 * world in its module graph, so it may never `import` `./rendererBundle`
 * statically — only through this file, which reaches it exclusively via
 * `import('./rendererBundle')`.
 *
 * TWO consumers, one chunk:
 *   • `LazyPlayerZoneWidget` — React.lazy, rendered inside a Suspense
 *     boundary that wraps ONLY the template zone list. Nothing outside that
 *     boundary (splash, pairing UI, emergency overlay, soft-blank overlay,
 *     every escape surface) can be suspended by it.
 *   • `preloadPlayerRenderer()` — an explicit warm-up fired the moment we
 *     know a renderer will be wanted: registration succeeded, the first
 *     manifest was applied (including a cold-offline apply straight off the
 *     localStorage manifest cache), or an emergency was raised. Idempotent,
 *     single-flight, and it never rejects — a failed warm-up simply leaves
 *     the render-time `lazy()` to try again.
 *
 * Both use the SAME specifier so the bundler emits one chunk and the
 * browser/service-worker serve one URL.
 */

import { lazy } from 'react';

/** In-flight (or settled) warm-up promise; `null` means "not started". */
let warming: Promise<unknown> | null = null;

/**
 * Start downloading the renderer chunk. Safe to call any number of times
 * from any trigger; safe to call before the page has mounted; never throws.
 *
 * Returns the in-flight promise so callers may await it, but no caller is
 * REQUIRED to — the render path is already guarded by Suspense.
 */
export function preloadPlayerRenderer(): Promise<unknown> {
  if (!warming) {
    warming = import('./rendererBundle').catch(() => {
      // Offline with no cached chunk, or a transient CDN failure. Clear the
      // latch so the next trigger (or the render-time lazy) retries rather
      // than inheriting a permanently-rejected promise.
      warming = null;
      return null;
    });
  }
  return warming;
}

/** Test/diagnostic hook: has the warm-up been started this page-load? */
export function rendererPreloadStarted(): boolean {
  return warming !== null;
}

/**
 * The lazily-loaded zone widget. Render inside `<Suspense>`; see
 * `rendererBundle.tsx` for what lives behind it.
 */
export const LazyPlayerZoneWidget = lazy(() => import('./rendererBundle'));

/**
 * The same chunk, for `TouchNavOverlay`'s cross-template zones. Same
 * specifier ⇒ same chunk ⇒ one download, one cached URL.
 */
export const LazyTouchZoneWidget = lazy(() =>
  import('./rendererBundle').then((m) => ({ default: m.TouchZoneWidget })),
);
