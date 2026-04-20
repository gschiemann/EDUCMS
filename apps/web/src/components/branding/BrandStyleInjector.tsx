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

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { apiFetch } from '@/lib/api-client';
import { TenantBranding, cssVarsFromPalette } from '@/lib/branding';

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

  useEffect(() => {
    // One-time migration: purge the legacy global cache on every mount.
    // Harmless once it's gone; prevents the old value ever being applied.
    try { localStorage.removeItem(LS_KEY_LEGACY); } catch {}

    // Always wipe vars left over from a prior tenant before painting the
    // current one. Without this, switching A→B would briefly show A's
    // palette (vars still on :root) until B's cache/fetch overwrote them.
    resetBranding();

    if (!tenantId || !user) return;

    const key = cacheKeyFor(tenantId);

    // Paint from this tenant's cache first (zero-flicker on route changes)
    try {
      const cached = localStorage.getItem(key);
      if (cached) applyBranding(JSON.parse(cached));
    } catch {}

    let cancelled = false;
    (async () => {
      try {
        const branding = await apiFetch<TenantBranding | null>('/branding/me');
        if (cancelled) return;
        if (branding) {
          localStorage.setItem(key, JSON.stringify(branding));
          applyBranding(branding);
        } else {
          localStorage.removeItem(key);
          resetBranding();
        }
      } catch {
        // Fetch failed — drop this tenant's stale cache so a broken
        // backend can't leave a neighbor-tenant's theme on screen.
        localStorage.removeItem(key);
        resetBranding();
      }
    })();

    // Listen for live updates from the wizard
    const onUpdate = (e: Event) => {
      const b = (e as CustomEvent<TenantBranding>).detail;
      applyBranding(b);
    };
    window.addEventListener('branding:update', onUpdate as EventListener);
    return () => {
      cancelled = true;
      window.removeEventListener('branding:update', onUpdate as EventListener);
      // Reset tenant CSS vars on unmount — when the user signs out and
      // the dashboard unmounts, the public marketing site / login must
      // render in the vendor's default palette (not the last tenant's
      // red theme). Without this the style attributes the injector wrote
      // to document.documentElement persist for the lifetime of the
      // page load.
      resetBranding();
    };
  }, [tenantId, activeTenant, user]);

  return null;
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

  // Favicon swap
  if (b.faviconUrl) {
    let link: HTMLLinkElement | null = document.querySelector('link[rel="icon"][data-brand="1"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.setAttribute('data-brand', '1');
      document.head.appendChild(link);
    }
    link.href = b.faviconUrl;
  }

  // Document title prefix
  if (b.displayName) {
    const base = document.title.split(' · ')[0];
    document.title = `${base} · ${b.displayName}`;
  }
}

function resetBranding() {
  const root = document.documentElement;
  const keys = [
    '--brand-primary','--brand-primary-hover','--brand-primary-active','--brand-primary-soft','--brand-primary-ink',
    '--brand-accent','--brand-accent-hover','--brand-accent-soft','--brand-accent-ink',
    '--brand-ink','--brand-ink-muted','--brand-surface','--brand-surface-alt','--brand-border',
    '--brand-font-heading','--brand-font-body',
  ];
  for (const k of keys) root.style.removeProperty(k);
}

/** Fire a live-preview update event. Used by the wizard. */
export function pushBrandingPreview(b: TenantBranding) {
  window.dispatchEvent(new CustomEvent('branding:update', { detail: b }));
}
