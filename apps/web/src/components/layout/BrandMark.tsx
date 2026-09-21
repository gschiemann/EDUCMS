'use client';

/**
 * BrandMark — the ONE tenant logo renderer.
 *
 * Operator (2026-09-21, iPhone): "Why do we carry none of the branding over to
 * the mobile version? Dashboard should still look good and have the logo and
 * name… make sure branding is all over mobile".
 *
 * They were right, and the reason was structural: every branch of the logo
 * (inline SVG, <img> with its 404 fallback, initials chip, the default VenueOS
 * hex mark) lived inline inside `Sidebar.tsx` — a `md:`-only surface. A phone
 * renders no sidebar, so a phone rendered no logo, anywhere, ever.
 *
 * So the branches move here and the Sidebar renders THROUGH this component.
 * Two hard rules that come with that:
 *
 *   1. The Sidebar's output must not change by a pixel. Its geometry is the
 *      `size="md"` column below, class-for-class, including the differences
 *      between the img branch (overflow-hidden) and the SVG branch (the
 *      `[&_svg]:*` sizing selectors and the backdrop's inkClass, which
 *      currentColor marks inherit).
 *   2. The Sidebar keeps owning its own branding read (per-tenant localStorage
 *      + the shared `useTenantBranding()` query + the `branding:update` event)
 *      and hands the result in as `identity`. Moving that read in here would
 *      have changed WHEN the sidebar repaints, which is a behaviour change
 *      wearing a refactor's clothes.
 *
 * Everything else — the phone header, the More sheet, the mobile home — passes
 * no `identity` and lets `useBrandIdentity()` resolve one. That path reads the
 * BrandingProvider CONTEXT plus the same localStorage cache and calls NO data
 * hook, deliberately: it keeps this component mountable in a bare render (no
 * QueryClient, no providers) and adds zero network subscribers to the
 * always-mounted mobile chrome (mobile-perf standard #4).
 */

import { useEffect, useState, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useBranding } from '@/lib/branding-context';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { useLogoTone } from '@/components/branding/useLogoTone';
import { logoBackdrop, readLogoBackground, type LogoBackground } from '@/components/branding/logo-backdrop';

/** Per-tenant branding cache key — written by <BrandStyleInjector />. */
const BRAND_LS_PREFIX = 'edu-cms-branding-cache-v1:';
const BRAND_LS_LEGACY = 'edu-cms-branding-cache-v1';

export type BrandMarkSize = 'sm' | 'md';

/** What a render site needs to draw the mark. Resolution is the caller's or ours. */
export interface BrandIdentity {
  /** Hydration gate — false until the client has read its own storage. */
  mounted: boolean;
  /** Display name, entity-decoded. Falls back to the vertical default. */
  brandName: string;
  /** True when the tenant actually named themselves (not the vertical default). */
  isCustomName: boolean;
  logoUrl: string | null;
  /** RAW inline SVG — sanitized here, never at the call site. */
  logoSvgInline: string | null;
  logoBackground: LogoBackground | null;
}

/**
 * 2026-05-26 — operator: "the & sign shows in text in the actual app" after
 * scraping dominos.com. Branding cached BEFORE the scraper's entity-decode fix
 * can still hold "Pizza Delivery &amp; Carryout" in the DB, so every surface
 * that prints a brand name decodes defensively.
 */
export function decodeBrandText(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&lt;|&#60;/gi, '<')
    .replace(/&gt;|&#62;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—');
}

/**
 * Resolve the active tenant's identity without touching the network.
 *
 * Order: BrandingProvider context (already fed by the shared
 * `useTenantBranding()` query, so it is as fresh as the Sidebar's copy) →
 * per-tenant localStorage → legacy global key → nothing. The `branding:update`
 * event repaints live when the wizard adopts a brand, which is the same signal
 * the Sidebar and the style injector listen for.
 */
export function useBrandIdentity(): BrandIdentity {
  const snapshot = useBranding();
  const copy = useTenantCopy();
  // One primitive selector — combining selectors into an object literal without
  // useShallow re-renders the always-mounted chrome on every store write
  // (mobile-perf standard #4).
  const tenantId = useAppStore((s) => s.user?.tenantId) || null;
  const [mounted, setMounted] = useState(false);
  const [cached, setCached] = useState<Record<string, unknown> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    // PER-TENANT key only. Scanning for "any brand cache" would re-create the
    // cross-tenant theme bleed the prefixed keys exist to prevent — the
    // injector does not evict a previous tenant's entry on switch.
    const read = () => {
      try {
        if (tenantId) {
          const raw = localStorage.getItem(BRAND_LS_PREFIX + tenantId);
          if (raw) { setCached(JSON.parse(raw)); return; }
        }
        const legacy = localStorage.getItem(BRAND_LS_LEGACY);
        setCached(legacy ? JSON.parse(legacy) : null);
      } catch { setCached(null); }
    };
    read();

    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<Record<string, unknown>>).detail;
      if (detail) setCached(detail);
    };
    window.addEventListener('branding:update', onUpdate as EventListener);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('branding:update', onUpdate as EventListener);
      window.removeEventListener('storage', read);
    };
  }, [tenantId]);

  // Context wins — it is the live query result. LS is the zero-flicker layer
  // for a cold tab where the query has not resolved yet.
  const displayName = snapshot?.displayName ?? (cached?.displayName as string | undefined) ?? null;
  const logoUrl = snapshot?.logoUrl ?? (cached?.logoUrl as string | undefined) ?? null;
  const logoSvgInline = snapshot?.logoSvgInline ?? (cached?.logoSvgInline as string | undefined) ?? null;
  const logoBackground =
    readLogoBackground(snapshot) ?? readLogoBackground(cached);

  // `defaultBrandName` can be absent when a caller mocks useTenantCopy with a
  // partial object; an empty brand name would silently disable the initials
  // branch, so pin the product default.
  const fallbackName = copy?.defaultBrandName || 'VenueOS';
  const decoded = decodeBrandText(mounted ? displayName : null);

  return {
    mounted,
    brandName: decoded || fallbackName,
    isCustomName: !!decoded && decoded !== fallbackName,
    logoUrl: mounted ? logoUrl : null,
    logoSvgInline: mounted ? logoSvgInline : null,
    logoBackground,
  };
}

/**
 * Geometry per size. `md` is the Sidebar's existing markup, unchanged —
 * h-14 chip / w-11 initials / w-10 default mark, from the 2026-05-26 round of
 * "the logo is too small to read" fixes. `sm` is the phone variant: the chip
 * never goes below 36px (the spec's 28px floor with room to breathe) and caps
 * its width so a wide wordmark cannot crowd the bell + emergency controls.
 */
const SIZES = {
  md: {
    chip: 'flex-shrink-0 h-14 min-w-[56px] max-w-[160px] flex items-center justify-center rounded-lg px-1.5',
    svgFit: '[&_svg]:h-full [&_svg]:max-h-14 [&_svg]:w-auto',
    brokenInitials: 'text-white text-[13px] font-bold tracking-wider',
    nameChip: 'flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-white text-[15px] font-black shadow-sm',
    defaultBox: 'flex-shrink-0 w-10 h-10 flex items-center justify-center',
    defaultDim: 34,
    nameText: 'text-base font-bold text-slate-900 truncate',
  },
  sm: {
    chip: 'flex-shrink-0 h-9 min-w-[36px] max-w-[104px] flex items-center justify-center rounded-lg px-1',
    svgFit: '[&_svg]:h-full [&_svg]:max-h-9 [&_svg]:w-auto',
    brokenInitials: 'text-white text-[11px] font-bold tracking-wider',
    nameChip: 'flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white text-[12px] font-black shadow-sm',
    defaultBox: 'flex-shrink-0 w-9 h-9 flex items-center justify-center',
    defaultDim: 28,
    nameText: 'text-[14px] font-bold text-slate-900 truncate',
  },
} as const;

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export interface BrandMarkProps {
  size?: BrandMarkSize;
  /** Extra classes on the mark's own box (not the name row). */
  className?: string;
  /** Render the brand name beside the mark. The mark then becomes decorative. */
  showName?: boolean;
  /**
   * The caller already prints the brand name next to this mark, so the mark
   * itself must not be announced again. The Sidebar does exactly that.
   */
  decorative?: boolean;
  /** Pre-resolved identity. Omit to resolve from context + storage. */
  identity?: BrandIdentity;
}

export function BrandMark({
  size = 'md',
  className,
  showName = false,
  decorative = false,
  identity,
}: BrandMarkProps) {
  const resolved = useBrandIdentity();
  const id = identity ?? resolved;
  const S = SIZES[size];

  const logoSvg = id.logoSvgInline
    ? (DOMPurify.sanitize(id.logoSvgInline, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['script', 'style', 'foreignObject'],
      }) as unknown as string)
    : '';

  // If the rehosted logoUrl 404s (Supabase rehost failed silently on adopt),
  // we would otherwise render a broken-image icon. Track the failure and fall
  // through to the initials chip.
  const [logoImgBroken, setLogoImgBroken] = useState(false);

  // 2026-05-26 — a white wordmark on transparent is invisible on white chrome.
  // The tone hook + the operator's backdrop picker decide the chip behind it;
  // `logoBackdrop()` falls back to the old tone rule when nothing is stored.
  const tone = useLogoTone(id.logoUrl, logoSvg);
  const backdrop = logoBackdrop(id.logoBackground, tone);

  // A mark the caller already labels (Sidebar) or labels itself (showName) is
  // decorative; a standalone mark carries the organisation name as its label.
  const silent = decorative || showName;
  const label = silent ? undefined : id.brandName;

  let mark: ReactNode;

  if (id.logoUrl && !logoImgBroken && !/\.(ico|icns)(\?|#|$)/i.test(id.logoUrl)) {
    mark = (
      <div
        className={cn(S.chip, 'overflow-hidden', backdrop.className, className)}
        style={backdrop.style}
        role={silent ? undefined : 'img'}
        aria-label={label}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={id.logoUrl}
          // Decorative whenever the name is adjacent; otherwise the wrapper
          // carries the label, so the img stays alt="" either way.
          alt=""
          onError={() => setLogoImgBroken(true)}
          onLoad={(e) => {
            // 2026-05-26 round 7 — `=== 0` only. A 14×30 favicon variant is a
            // real logo; a stricter threshold sent the operator's wordmark all
            // the way down to initials.
            const img = e.currentTarget;
            if (img.naturalWidth === 0 || img.naturalHeight === 0) setLogoImgBroken(true);
          }}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  } else if (logoSvg && /<(path|circle|rect|polygon|polyline|ellipse|image|use)\b/i.test(logoSvg)) {
    mark = (
      <div
        className={cn(S.chip, S.svgFit, backdrop.className, backdrop.inkClass, className)}
        style={backdrop.style}
        role={silent ? undefined : 'img'}
        aria-label={label}
        aria-hidden={silent ? true : undefined}
        dangerouslySetInnerHTML={{ __html: logoSvg }}
      />
    );
  } else if (id.logoUrl && logoImgBroken) {
    // They DID adopt a brand; the rehost just failed. Show a brand-primary
    // chip with their initials rather than reverting to the product mark.
    mark = (
      <div
        className={cn(S.chip, 'overflow-hidden', className)}
        style={{ background: 'var(--brand-primary, #4f46e5)' }}
        role={silent ? undefined : 'img'}
        aria-label={label}
        aria-hidden={silent ? true : undefined}
        title={id.brandName}
      >
        <span className={S.brokenInitials}>{initialsOf(id.brandName)}</span>
      </div>
    );
  } else if (id.isCustomName) {
    // Named, but no logo. Initials on brand primary so the chrome still reads
    // as their tenant.
    mark = (
      <div
        className={cn(S.nameChip, className)}
        style={{ background: 'var(--brand-primary, #4f46e5)' }}
        role={silent ? undefined : 'img'}
        aria-label={label}
        aria-hidden={silent ? true : undefined}
      >
        {initialsOf(id.brandName)}
      </div>
    );
  } else {
    // Unbranded — the VenueOS hexagonal mark, the same one on the signup /
    // login / marketing chrome.
    mark = (
      <div
        className={cn(S.defaultBox, className)}
        role={silent ? undefined : 'img'}
        aria-label={label}
        aria-hidden={silent ? true : undefined}
        data-testid="brandmark-default"
      >
        <svg width={S.defaultDim} height={S.defaultDim} viewBox="0 0 32 32" aria-hidden>
          <polygon points="30,16 23,28.12 9,28.12 2,16 9,3.88 23,3.88" fill="#4f46e5" />
          <polygon points="22,16 19,21.2 13,21.2 10,16 13,10.8 19,10.8" fill="#a5b4fc" />
        </svg>
      </div>
    );
  }

  if (!showName) return <>{mark}</>;

  return (
    <span className="flex items-center gap-2 min-w-0">
      {mark}
      <span className={S.nameText} title={id.brandName}>{id.brandName}</span>
    </span>
  );
}
