import type { CSSProperties } from 'react';

export interface BroadcastLayout { width: number; height: number; bannerHeight: number }

/** The canvas transform under a banner: x' = left + x·scale, y' = top + y·scale. */
export interface BroadcastCanvasTransform { top: number; left: number; scale: number }

/** The one formula, shared by the style below and its inverse. Null = no banner. */
export function broadcastCanvasTransform(layout: BroadcastLayout | null): BroadcastCanvasTransform | null {
  if (!layout || layout.width <= 0 || layout.height <= 0) return null;
  const top = Math.min(layout.height * 0.4, Math.max(0, layout.bannerHeight));
  const scale = (layout.height - top) / layout.height;
  return { top, left: (layout.width * (1 - scale)) / 2, scale };
}

/** Scale the existing canvas, including its iframes, without changing their
 * layout viewport or remounting anything. Preserve the complete content. */
export function broadcastContentStyle(layout: BroadcastLayout | null): CSSProperties {
  const t = broadcastCanvasTransform(layout);
  if (!t) return {};
  return { top: t.top, left: t.left, transform: `scale(${t.scale})`, transformOrigin: 'top left' };
}

// ── The layout the page has APPLIED (2026-11-23) ─────────────────────────
//
// A native view laid over the page from a measured rectangle (Website Tabs'
// `webTabsShow` bounds) must be measured in CANVAS coordinates — the page
// before the banner transform — on an app that applies the same banner
// transform to that view itself (`BroadcastContentViews.kt`: x' = bounds.left
// + left·scale). `getBoundingClientRect()` under a banner already includes
// the page's transform, so on such an app the site was shrunk and shifted
// TWICE whenever the widget (re)measured under a banner — after an alert's
// all-clear while a broadcast was still up, or on a tab tap. The page
// publishes the layout it has committed (a layout effect, so the DOM and this
// value agree), and the widget undoes exactly that transform.
//
// ONLY on such an app. An app that does not transform its site views (stable
// player 1.1.29 has Website Tabs and no BroadcastContentViews) needs the glass
// rectangle, exactly as before; a canvas rectangle would put the site over the
// tab bar and a strip of the banner. The app says which it is on the existing
// `sharedVideoState` reply: `broadcastBannerVersion` ≥ 1 arrived in the same
// change as BroadcastContentViews (8a2d8aa88 follows f51896253 directly). In
// doubt (no reply yet, a browser, an old app) the page posts the glass
// rectangle — today's behaviour.
let appliedLayout: BroadcastLayout | null = null;
let appTransformsSiteViews = false;

/**
 * One `sharedVideoState` reply (string or object) → note whether the app
 * applies the banner transform to its native site views itself. Only ever
 * turns it ON (an app does not lose a capability within a document). Total.
 */
export function noteNativeBannerSupport(reply: unknown): void {
  try {
    const state = typeof reply === 'string' ? (reply.length <= 65_536 ? JSON.parse(reply) : null) : reply;
    const version = (state as { broadcastBannerVersion?: unknown } | null)?.broadcastBannerVersion;
    if (typeof version === 'number' && Number.isFinite(version) && version >= 1) appTransformsSiteViews = true;
  } catch { /* not a state reply: nothing learned */ }
}

/** Test-only: forget what the app said. */
export function resetNativeBannerSupportForTest(): void {
  appTransformsSiteViews = false;
}

export function publishBroadcastLayout(layout: BroadcastLayout | null): void {
  appliedLayout = layout;
}

export function appliedBroadcastLayout(): BroadcastLayout | null {
  return appliedLayout;
}

export interface CssRect { left: number; top: number; width: number; height: number }

/** A rectangle measured on the glass (CSS px) → the same rectangle on the untransformed canvas. */
export function canvasRectFromGlass(rect: CssRect, layout: BroadcastLayout | null = appliedLayout): CssRect {
  const t = broadcastCanvasTransform(layout);
  if (!t || !(t.scale > 0) || !Number.isFinite(t.scale)) return rect;
  return {
    left: (rect.left - t.left) / t.scale,
    top: (rect.top - t.top) / t.scale,
    width: rect.width / t.scale,
    height: rect.height / t.scale,
  };
}

/**
 * The rectangle to post for a native site view measured on the glass: canvas
 * coordinates when the app transforms the view under a banner itself, else
 * the glass rectangle unchanged (see above).
 */
export function nativeSiteViewRect(rect: CssRect, layout: BroadcastLayout | null = appliedLayout): CssRect {
  return appTransformsSiteViews ? canvasRectFromGlass(rect, layout) : rect;
}
