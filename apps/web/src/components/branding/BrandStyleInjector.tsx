/**
 * <BrandStyleInjector /> — client-side theme painter.
 *
 * Renders into the React tree; on mount (and on every branding update
 * event) writes the tenant's palette into `document.documentElement`
 * CSS custom properties and loads the Google Fonts stylesheet. Also
 * swaps the favicon + document title to the tenant's displayName.
 *
 * We deliberately do this on the client (not SSR) because the tenant
 * isn't known until after auth — layout.tsx runs before the user's
 * token is read. For unauthenticated pages we expose
 * getBrandingBySlug() for SSR via the `[schoolId]` route.
 */
'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { TenantBranding, cssVarsFromPalette, brandDefaultPalette } from '@/lib/branding';
import { getClientBrand } from '@/lib/brand';
import { useTenantBranding } from '@/hooks/use-api';

// Per-tenant cache prefix. The key used to be a single global
// `edu-cms-branding-cache-v1` which caused a cross-tenant theme bleed:
// Tenant A's palette would paint over Tenant B on tenant switch (or
// after SUPER_ADMIN impersonation) until /branding/me returned, and
// would stick permanently if that fetch errored. Scoping the cache per
// tenantId means each tenant — root or child, parent or sibling —
// hydrates its own theme and never sees another tenant's.
const LS_KEY_PREFIX = 'edu-cms-branding-cache-v1:';
const LS_KEY_LEGACY = 'edu-cms-branding-cache-v1';

function cacheKeyFor(tenantId: string) {
  return `${LS_KEY_PREFIX}${tenantId}`;
}

export function BrandStyleInjector() {
  const activeTenant = useAppStore((s) => s.activeTenant);
  const user = useAppStore((s) => s.user);
  const tenantId = user?.tenantId || null;

  // Shared cache fetch — same hook every other branding consumer uses.
  // 60s staleTime + 5min gcTime means the Sidebar's self-heal, the
  // BrandingProvider context, the dashboard hero, and the
  // BrandingSettingsCard all dedupe to ONE network call. See
  // `useTenantBranding()` in `hooks/use-api.ts`.
  //
  // 2026-05-26 dedup pass: before this, each component called
  // /branding/me independently → ~8 round trips per navigation. The
  // hook holds the result; effects below react to it.
  const { data: brandingFromQuery, isSuccess, isError } = useTenantBranding();

  // Pre-paint phase — runs on every tenant change. Synchronous; happens
  // before the network round-trip resolves so the user sees the cached
  // palette instantly. Separated from the query-result effect so the
  // sync paint isn't gated on React Query's lifecycle.
  useEffect(() => {
    try { localStorage.removeItem(LS_KEY_LEGACY); } catch {}

    // Repaint the vendor default palette before painting the current
    // tenant. Without this, switching A→B would briefly show A's palette
    // (vars still on :root) until B's cache/fetch overwrote them — and a
    // brand-new tenant with no branding would show no palette at all.
    applyBrandDefault();

    if (!tenantId || !user) return;

    // Paint from this tenant's LS cache first (zero-flicker on route
    // changes). LS is intentionally a separate layer from the React
    // Query cache — it survives page reloads / new tabs where the
    // in-memory query cache is cold.
    try {
      const cached = localStorage.getItem(cacheKeyFor(tenantId));
      if (cached) applyBranding(JSON.parse(cached));
    } catch {}

    // Listen for live updates from the wizard (Adopt button) — fires
    // immediately so the operator sees the new palette before the
    // React Query refetch lands.
    const onUpdate = (e: Event) => {
      const b = (e as CustomEvent<TenantBranding>).detail;
      applyBranding(b);
    };
    window.addEventListener('branding:update', onUpdate as EventListener);
    return () => {
      window.removeEventListener('branding:update', onUpdate as EventListener);
      // Repaint the vendor default on unmount — when the user signs out
      // and the dashboard unmounts, the public marketing site / login
      // must render in the vendor's default palette (not the last
      // tenant's red theme). Without this the tenant style attributes
      // the injector wrote to document.documentElement persist for the
      // lifetime of the page load.
      applyBrandDefault();
    };
  }, [tenantId, activeTenant, user]);

  // React-Query-result effect: when the shared `/branding/me` query
  // resolves, mirror the result into LS cache + apply CSS vars +
  // dispatch the `branding:update` event so subscribers that listen
  // for the event (Sidebar, etc.) repaint without their own fetch.
  //
  // Tracks the last applied row so we don't re-dispatch on every
  // re-render — only when the query data actually changes.
  const lastAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tenantId || !user) return;
    if (!isSuccess && !isError) return;
    const key = cacheKeyFor(tenantId);

    // Error path mirrors the original behavior: drop this tenant's
    // stale cache so a broken backend can't leave a neighbor-tenant's
    // theme on screen, and repaint vendor defaults.
    if (isError) {
      try { localStorage.removeItem(key); } catch {}
      applyBrandDefault();
      lastAppliedRef.current = null;
      return;
    }

    const branding = brandingFromQuery ?? null;
    const serialized = branding ? JSON.stringify(branding) : '__null__';
    if (lastAppliedRef.current === serialized) return;
    lastAppliedRef.current = serialized;

    if (branding) {
      try { localStorage.setItem(key, JSON.stringify(branding)); } catch {}
      applyBranding(branding);
      // Notify other components (Sidebar logo/name, header) that
      // depend on the LS cache or the event bus. Without this dispatch,
      // components that read the cache only on mount stay on their
      // default brand for the entire session on a fresh device — the LS
      // cache was empty when they mounted, and `applyBranding` only
      // sets CSS vars on `:root`, which Sidebar doesn't read. First
      // seen on a clean Mac migration where colors painted correctly
      // via CSS vars but logo + displayName stayed at defaults until
      // the user reloaded. (gh #branding-mac-bug)
      window.dispatchEvent(new CustomEvent('branding:update', { detail: branding }));
    } else {
      try { localStorage.removeItem(key); } catch {}
      applyBrandDefault();
    }
  }, [brandingFromQuery, isSuccess, isError, tenantId, user]);

  return null;
}

// The VenueOS default tab favicon. The ?v=3 cache-bust matches the root
// `icons` metadata in app/layout.tsx — see the comment there for why the
// pre-rebrand triangle kept showing up.
const DEFAULT_FAVICON = '/favicon.ico?v=3';

/**
 * Point the browser tab at exactly ONE app-controlled <link rel="icon">.
 *
 * Why "exactly one": Chrome keeps the FIRST-resolved <link rel="icon"> for a
 * page (often the cached one) and frequently ignores a second, later-appended
 * icon link. The pre-rebrand build shipped a triangle /favicon.ico; on tenant
 * tabs the cached triangle therefore beat the brand-favicon link the injector
 * appended, so the operator saw the OLD logo even though the brand favicon was
 * "set". Removing the Next-emitted root icon links (everything `rel~="icon"`
 * that isn't ours) leaves our single `data-brand` link as the only candidate,
 * so the chosen favicon — brand or default — is deterministic.
 *
 * Note: `rel~="icon"` matches `rel="icon"` and `rel="shortcut icon"` only; it
 * does NOT match `apple-touch-icon` (a single token), so PWA / home-screen
 * icons are left intact.
 */
function setBrandFavicon(href: string) {
  if (typeof document === 'undefined') return;
  document
    .querySelectorAll('link[rel~="icon"]:not([data-brand="1"])')
    .forEach((el) => el.remove());
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][data-brand="1"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.setAttribute('data-brand', '1');
    document.head.appendChild(link);
  }
  link.href = href;
}

function applyBranding(b: TenantBranding | null) {
  if (!b) return;
  const root = document.documentElement;
  const vars = cssVarsFromPalette(b.palette, b.fontHeading, b.fontBody);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);

  // Load Google Fonts (once)
  if (b.fontHeadingUrl || b.fontBodyUrl) {
    const urls = [b.fontHeadingUrl, b.fontBodyUrl].filter((u): u is string => !!u);
    for (const href of new Set(urls)) {
      const id = `gf-${btoa(href).slice(0, 16)}`;
      if (!document.getElementById(id)) {
        const link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
      }
    }
  }

  // Favicon swap. Always reconcile (not just when a faviconUrl exists) so
  // switching to a tenant WITHOUT a custom favicon falls back to the VenueOS
  // default instead of keeping the previous tenant's icon.
  setBrandFavicon(b.faviconUrl || DEFAULT_FAVICON);

  // Document title prefix
  if (b.displayName) {
    const base = document.title.split(' · ')[0];
    document.title = `${base} · ${b.displayName}`;
  }
}

/**
 * Paint the VENDOR default palette (VenueOS indigo) onto :root.
 *
 * This is what a tenant with no custom TenantBranding row sees — and
 * it's also the pre-paint state before a tenant's cache/fetch lands,
 * and the post-sign-out state for the public marketing chrome. We
 * deliberately SET the full `--brand-*` var block (rather than the old
 * behavior of REMOVING it): with the vars unset, every component fell
 * through to its own hard-coded fallback, and those drifted — some
 * were indigo, some were the stale emerald `#059669`. Painting the
 * brand default guarantees a fresh account's dashboard matches the
 * signup / landing chrome from the first login.
 */
function applyBrandDefault() {
  const root = document.documentElement;
  // Tenant fonts are not part of the vendor default — clear any left
  // over from a prior tenant so the default falls back to the base
  // system font stack.
  root.style.removeProperty('--brand-font-heading');
  root.style.removeProperty('--brand-font-body');
  const vars = cssVarsFromPalette(brandDefaultPalette(getClientBrand().colors));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  // Revert any tenant brand favicon back to the VenueOS default so sign-out /
  // public chrome / a no-branding tenant never keeps a prior tenant's icon.
  setBrandFavicon(DEFAULT_FAVICON);
}

/** Fire a live-preview update event. Used by the wizard. */
export function pushBrandingPreview(b: TenantBranding) {
  window.dispatchEvent(new CustomEvent('branding:update', { detail: b }));
}
