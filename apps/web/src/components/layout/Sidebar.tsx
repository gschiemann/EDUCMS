'use client';

import Link from 'next/link';
import { usePathname, useParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { fullName as userFullName, initials as userInitials } from '@/lib/user-display';
import { ShieldAlert, LayoutDashboard, MonitorPlay, Folders, Settings, Upload, LayoutTemplate, LogOut, X, Crown, ClipboardCheck, Map, Trophy } from 'lucide-react';
import { RoleGate } from '../RoleGate';
import { EmergencyTriggerModal } from '../emergency/EmergencyTriggerModal';
import { usePendingAssets, useSubmissions, useTenantBranding } from '@/hooks/use-api';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { useTenantStatus } from '@/hooks/use-api';
import type { TenantBranding } from '@/lib/branding';
import { useLogoTone } from '@/components/branding/useLogoTone';

// Must match the PER-TENANT key format BrandStyleInjector writes to.
// Mobile-Claude's cross-tenant fix moved the injector to per-tenant
// keys but the Sidebar was still reading the legacy global key, which
// is always empty after migration. That left the sidebar stuck on
// default "VenueOS" branding no matter what the tenant adopted.
const BRAND_LS_PREFIX = 'edu-cms-branding-cache-v1:';
const BRAND_LS_LEGACY = 'edu-cms-branding-cache-v1';

export function Sidebar() {
  const pathname = usePathname() || '';
  const activeTenant = useAppStore((state) => state.activeTenant);
  const user = useAppStore((state) => state.user);
  const logout = useAppStore((state) => state.logout);
  const mobileSidebarOpen = useAppStore((state) => state.mobileSidebarOpen);
  const setMobileSidebarOpen = useAppStore((state) => state.setMobileSidebarOpen);
  const router = useRouter();

  // Client-only hydration gate — prevents SSR/client mismatch for user-dependent content
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Emergency modal trigger (moved from TopToolbar to match design spec)
  const [emergencyModalOpen, setEmergencyModalOpen] = useState(false);
  const isEmergencyActive = useAppStore((s) => s.isEmergencyActive);
  // 2026-05-25 — operator: "we dont show the emergency button by
  // default unless you enable the emergency content, becuase then
  // you could trigger something that doesnt exist." Tenant exposes
  // panicLockdownPlaylistId / panicWeatherPlaylistId /
  // panicEvacuatePlaylistId on GET /tenants. If any is set, the
  // tenant has wired up at least one emergency type and the
  // trigger is safe to show. If none is set (a brand-new tenant
  // who hasn't configured anything yet), hide the trigger and
  // show a small "Set up alerts" link in its place — turns the
  // dead button into a setup nudge.
  const sidebarParams = useParams();
  const sidebarSchoolId = sidebarParams?.schoolId as string | undefined;
  const { data: tenantInfo } = useTenantStatus();
  const tenantInfoAny = tenantInfo as any;
  const hasEmergencyContent = !!(
    tenantInfoAny?.panicLockdownPlaylistId ||
    tenantInfoAny?.panicWeatherPlaylistId ||
    tenantInfoAny?.panicEvacuatePlaylistId
  );

  // Tenant branding for sidebar header. Reads from the PER-TENANT LS
  // cache written by <BrandStyleInjector> + re-fires on the
  // 'branding:update' event so newly-adopted brands repaint the header
  // live. Defaults to VenueOS when no branding is set for this
  // tenant. The cache key depends on the active tenantId; re-reads
  // whenever that changes so tenant-switch picks up the other
  // tenant's brand immediately.
  //
  // Network self-heal goes through the shared `useTenantBranding()`
  // hook (60s staleTime + 3-retry backoff). Pre-2026-05-26 every
  // branding-aware component ran its own raw `/branding/me` fetch on
  // mount — Sidebar, BrandStyleInjector, BrandingProvider, dashboard,
  // templates, settings card. That added up to ~8 round trips per
  // navigation. The hook collapses them to ONE per minute per tab.
  const userTenantId = user?.tenantId || null;
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  // Shared cache subscription. If another component has already loaded
  // /branding/me within the last 60s, this returns instantly without a
  // network call. Otherwise React Query fires one fetch with the
  // 3-retry backoff that used to live inline in this file.
  const { data: brandingFromQuery } = useTenantBranding();

  // LS-first read (zero-flicker on route changes / new tabs where the
  // React Query cache is still cold). Same per-tenant key the
  // BrandStyleInjector writes to.
  useEffect(() => {
    const read = () => {
      try {
        if (userTenantId) {
          const raw = localStorage.getItem(BRAND_LS_PREFIX + userTenantId);
          if (raw) {
            setBranding(JSON.parse(raw));
            return;
          }
        }
        // Legacy single-key fallback (mobile-Claude's migration wipes
        // this on BrandStyleInjector mount; read in case the injector
        // hasn't run yet on a fresh tab).
        const legacy = localStorage.getItem(BRAND_LS_LEGACY);
        if (legacy) {
          setBranding(JSON.parse(legacy));
        } else {
          setBranding(null);
        }
      } catch { setBranding(null); }
    };
    read();

    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<TenantBranding>).detail;
      if (detail) setBranding(detail);
    };
    window.addEventListener('branding:update', onUpdate as EventListener);
    window.addEventListener('storage', read);
    return () => {
      window.removeEventListener('branding:update', onUpdate as EventListener);
      window.removeEventListener('storage', read);
    };
  }, [userTenantId]);

  // Cross-tab self-heal: when the shared React Query fetch lands (or
  // returns from cache), reflect it into local state + LS cache.
  // Mirrors the old inline self-fetch but with one network call shared
  // across the whole app instead of one per component.
  //
  // Null is a legitimate state (tenant has no branding row) — fall
  // back to VenueOS default by clearing the state. Errors are handled
  // by useTenantBranding's retry config so we don't need a catch.
  useEffect(() => {
    if (brandingFromQuery && userTenantId) {
      setBranding(brandingFromQuery);
      try {
        localStorage.setItem(BRAND_LS_PREFIX + userTenantId, JSON.stringify(brandingFromQuery));
      } catch {}
    }
  }, [brandingFromQuery, userTenantId]);

  // 2026-05-03 — VenueOS rebrand. Brand name fallback chain:
  //   1. Tenant's custom branding.displayName (if they set one)
  //   2. Vertical-aware default ("VenueOS" for K12, "VenueOS" for
  //      everyone else — gym/retail/corporate/qsr/fashion don't want
  //      "VenueOS" branding everywhere when they signed up as
  //      something else entirely).
  const tenantCopyForBrand = useTenantCopy();
  // 2026-05-26 — operator: "the & sign shows in text in the actual app"
  // after scraping dominos.com. Branding cached BEFORE the scraper's
  // entity-decode fix may have "Pizza Delivery &amp; Carryout" sitting
  // in the DB. Defensive client-side decode covers that AND any other
  // surface that drops an undecoded meta-tag value into the brand.
  // Belt-and-suspenders with the server-side decode in the scraper.
  const decodeBrandText = (s: string | undefined | null): string => {
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
  };
  const brandName = decodeBrandText((mounted && branding?.displayName) || tenantCopyForBrand.defaultBrandName);
  const brandTagline = decodeBrandText(mounted ? branding?.tagline : '');
  const brandLogoUrl = mounted ? branding?.logoUrl || null : null;
  const brandLogoSvg = mounted && branding?.logoSvgInline
    ? (DOMPurify.sanitize(branding.logoSvgInline, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['script', 'style', 'foreignObject'],
      }) as unknown as string)
    : '';
  // If the rehosted logoUrl 404s (Supabase rehost failed silently on
  // adopt; common when the rehost bucket / policy is misconfigured), we
  // get a broken-image icon. Track a load error so we can fall back to
  // the inline SVG or the MonitorPlay default.
  const [logoImgBroken, setLogoImgBroken] = useState(false);
  // 2026-05-26 — operator still doesn't see the Dodgers logo even
  // after the silent-zero fallback fix. Root cause turned out to be
  // different: the wordmark PNG loads SUCCESSFULLY (naturalWidth > 0)
  // — it's a WHITE script on transparent. The sidebar header is
  // white. White-on-white is invisible. Same root cause as the
  // wizard preview problem we solved with useLogoTone + a
  // var(--brand-primary) chip wrapper. The sidebar didn't use that
  // hook. Now it does. Light/unknown tone → wrap in brand-primary
  // chip with white text-color so currentColor-using SVGs also
  // pick up the inverse. Dark logos render directly as before.
  const logoTone = useLogoTone(brandLogoUrl, brandLogoSvg);
  const logoNeedsDarkBacking = logoTone === 'light' || logoTone === 'unknown';

  // Close the mobile sidebar whenever the route changes
  useEffect(() => { setMobileSidebarOpen(false); }, [pathname, setMobileSidebarOpen]);

  // Close on Escape while open
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileSidebarOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileSidebarOpen, setMobileSidebarOpen]);

  // Order: Dashboard → Screens → Assets → Templates → Playlists →
  // Settings. Assets sits between Screens and Templates because the
  // operator's day-to-day flow is "check my screens, upload content,
  // then build/tweak templates" — not the reverse. (Integration Lead
  // asked for the swap.)
  //
  // Hydration safety: `activeTenant` is a Zustand value backed by
  // sessionStorage and is unavailable during SSR. Building hrefs from it
  // unconditionally produced server markup like `/null/templates` that
  // mismatched the post-hydration `/springfield-elementary/templates`,
  // throwing a hydration warning in every console. Gate the tenant slug
  // on `mounted` so the server + first client paint render the same
  // stable href ("#"), then re-render with the real path after hydration.
  const tenantSlug = mounted && activeTenant ? activeTenant : null;
  const hrefFor = (path: string) => (tenantSlug ? `/${tenantSlug}${path}` : '#');
  // VenueOS Sports — the live scoreboard + game-day control surface
  // is only relevant to SPORTS-vertical tenants, so the nav entry is
  // gated on the tenant's vertical. `mounted` gate keeps SSR + first
  // client paint identical (same hydration-safety pattern as isAdmin
  // below) — the Sports item appears one render tick after mount.
  // Operator (2026-05-19): "the sports menu should only show when you
  // pick the sports venue type, not the others."
  const isSportsVertical = mounted && tenantCopyForBrand.vertical === 'SPORTS';
  const navItems = [
    { name: 'Dashboard', href: hrefFor('/dashboard'), icon: LayoutDashboard },
    // Floor-plans is now a tab inside Screens (List | Floor Plans toggle),
    // not a standalone sidebar entry — operator pointed out the duplicate
    // "this is just another way to look at screens" was sidebar bloat.
    { name: 'Screens', href: hrefFor('/screens'), icon: MonitorPlay },
    { name: 'Assets', href: hrefFor('/assets'), icon: Upload },
    { name: 'Templates', href: hrefFor('/templates'), icon: LayoutTemplate },
    { name: 'Playlists', href: hrefFor('/playlists'), icon: Folders },
    // Sports (live scoreboard + game-day control) — only for
    // SPORTS-vertical tenants. K-12 / GYM / RESTAURANT / etc. don't
    // see it. /sports is still reachable by typing the URL.
    ...(isSportsVertical
      ? [{ name: 'Sports', href: hrefFor('/sports'), icon: Trophy }]
      : []),
    { name: 'Settings', href: hrefFor('/settings'), icon: Settings },
  ];

  // Hydration safety: `user` is loaded from localStorage on the client
  // only, so SSR sees `isAdmin = false`. Without the `mounted` gate the
  // admin links would appear on the client only after hydration,
  // producing a "extra element" hydration mismatch error. Always
  // render the same nav set on server + client's first paint; flip
  // to the admin set on the next render after mount.
  const isAdmin = mounted && (user?.role === 'SUPER_ADMIN' || user?.role === 'DISTRICT_ADMIN' || user?.role === 'SCHOOL_ADMIN');

  // Pending-review badge count. Hooks are gated on isAdmin so they
  // stay dormant for CONTRIBUTOR / RESTRICTED_VIEWER tabs (otherwise
  // every non-admin would fire a recurring 403 against /assets/pending
  // and /submissions every 30s just to render a sidebar they don't
  // even see).
  //
  // 2026-05-23 launch audit P1 #10 fix: the badge used to call ONLY
  // usePendingAssets, so any CONTRIBUTOR Submission (Sprint 1.5 path)
  // never surfaced as a pending-review notification to admins —
  // exactly the case the original "BOTH pending sources" comment
  // intended to handle. Now we also call useSubmissions({status:
  // 'PENDING'}) and sum both counts. Either source firing raises the
  // badge; submissions are counted as "items awaiting your review."
  const pendingAssetsQ = usePendingAssets(isAdmin);
  const pendingSubmissionsQ = useSubmissions({ status: 'PENDING', enabled: isAdmin });
  const pendingAssetCount = Array.isArray(pendingAssetsQ.data) ? pendingAssetsQ.data.length : 0;
  const pendingSubmissionCount = Array.isArray(pendingSubmissionsQ.data) ? pendingSubmissionsQ.data.length : 0;
  const pendingCount = pendingAssetCount + pendingSubmissionCount;

  // One reviews entry, not two. Operator reported the duplicate
  // ("Review Queue" + "Reviews") was confusing. The Sprint 1.5
  // reviewer workflow (bundled submissions) is now the primary path.
  // Standalone-asset approval still works at /assets/review but isn't
  // surfaced in the sidebar — submissions cover the workflow gap.
  // Badge counts BOTH pending sources so operators see a unified
  // "stuff awaiting your review" number.
  // 2026-05-19 — operator: "put audit logs under settings, no need for
  // its own tab." Audit Log dropped from the standalone sidebar nav; it
  // now lives as a card on the Settings page (→ /audit route unchanged).
  const adminNavItems = [
    { name: 'Reviews', href: hrefFor('/reviews'), icon: ClipboardCheck, badge: pendingCount > 0 ? pendingCount : null },
  ];

  return (
    <>
      {/* Brand-aware hover rule injected inline so Tailwind arbitrary-value
          classes don't fight with the CSS var. Scoped to this sidebar only. */}
      <style>{`
        .sidebar-nav-item:hover { color: var(--brand-primary, #4f46e5); }
      `}</style>
      {/* Mobile backdrop — only shown when drawer is open */}
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileSidebarOpen(false)}
          className="md:hidden fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150"
        />
      )}

      <aside
        className={cn(
          "flex flex-col bg-white border-r border-slate-100/50 shadow-[4px_0_24px_rgba(0,0,0,0.02)]",
          // Desktop: part of the flex flow
          "md:static md:h-full md:w-72 md:translate-x-0 md:z-20",
          // Mobile: fixed drawer, slide in/out
          // 2026-05-28 mobile-UX: h-screen → h-dvh so the drawer tracks the
          // live mobile viewport (URL-bar chrome) and its footer Sign-out
          // isn't pushed below the fold on iOS Safari.
          "fixed top-0 left-0 h-dvh w-72 max-w-[85vw] z-40 transition-transform duration-300 ease-out",
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
        aria-label="Primary navigation"
        aria-hidden={!mobileSidebarOpen && typeof window !== 'undefined' && window.innerWidth < 768 ? true : undefined}
      >
        <div className="min-h-[73px] flex items-start px-5 pt-4 pb-3 justify-between gap-2">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800 flex items-start gap-3 min-w-0 flex-1">
            {brandLogoUrl && !logoImgBroken && !/\.(ico|icns)(\?|#|$)/i.test(brandLogoUrl) ? (
              // 2026-05-26 — light-toned logos (white wordmark on
              // transparent like the Dodgers script) get wrapped in
              // a var(--brand-primary) chip so they have contrast
              // against the white sidebar surface. Dark logos render
              // directly. Same pattern as BrandingLivePreview.tsx so
              // the wizard preview and the real sidebar match
              // exactly. The chip has its own h-12 box; the inner
              // image's max-h-full keeps it scaled to the box height.
              // 2026-05-26 — defensive sizing fix. The chip was
              // collapsing to 0px wide when the inner img loaded with
              // bad / tiny / not-yet-loaded dimensions (flex container
              // with no min-width takes the width of its content; an
              // img scaling to `max-w-full` of a 0-wide parent stays 0).
              // Result: operator saw NO logo, no fallback, no chip —
              // just blank space next to the brand name. Adding
              // min-w-[48px] AND a backdrop on every chip (light OR
              // dark tone) guarantees something visible always renders.
              // Also widened the silent-zero check from 0px → <16px so
              // a near-zero natural dimension trips the fallback too.
              <div
                className={cn(
                  // 2026-05-26 — operator: "the dodgers logo in the sample looks
// better than the one thats placed in the actual app...the text is
// larger and its easier to see." Bumped the chip h-12→h-14 (48→56
// px) and max-w-140→max-w-160 + reduced inner padding px-2→px-1.5
// so the wordmark fills more visual area inside the chip — matches
// the prominence the operator sees in BrandingLivePreview's mock.
'flex-shrink-0 h-14 min-w-[56px] max-w-[160px] flex items-center justify-center overflow-hidden rounded-lg px-1.5',
                  logoNeedsDarkBacking ? '' : 'bg-slate-50 border border-slate-200',
                )}
                style={
                  logoNeedsDarkBacking
                    ? { background: 'var(--brand-primary, #4f46e5)' }
                    : undefined
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={brandLogoUrl}
                  alt=""
                  onError={() => setLogoImgBroken(true)}
                  onLoad={(e) => {
                    // 2026-05-26 round 7 — loosened threshold from `<16`
                    // to `===0`. Operator's Dodgers PNG was tripping the
                    // <16 check (real-world 14×30 favicon variants exist)
                    // and falling all the way to "LA" initials despite
                    // the URL being perfectly fine. LogoThumbnail on the
                    // same page uses ===0; the divergence is what kept
                    // breaking the sidebar specifically. Match it.
                    const img = e.currentTarget;
                    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                      setLogoImgBroken(true);
                    }
                  }}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : brandLogoSvg && /<(path|circle|rect|polygon|polyline|ellipse|image|use)\b/i.test(brandLogoSvg) ? (
              <div
                className={cn(
                  // 2026-05-26 — bumped sizing to match the IMG branch
                  // above (h-12→h-14, max-w-140→max-w-160, px-2→px-1.5)
                  // so inline-SVG logos and IMG logos have the same
                  // visual prominence in the sidebar.
                  'flex-shrink-0 h-14 min-w-[56px] max-w-[160px] flex items-center justify-center rounded-lg px-1.5 [&_svg]:h-full [&_svg]:max-h-14 [&_svg]:w-auto',
                  // currentColor-using SVGs inherit text color → set
                  // white on dark chip, slate-800 on light chip.
                  logoNeedsDarkBacking
                    ? 'text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-800',
                )}
                style={
                  logoNeedsDarkBacking
                    ? { background: 'var(--brand-primary, #4f46e5)' }
                    : undefined
                }
                aria-hidden
                dangerouslySetInnerHTML={{ __html: brandLogoSvg }}
              />
            ) : brandLogoUrl && logoImgBroken ? (
              // 2026-05-26 round 7 — IMG failed to load (404 from
              // Supabase rehost, CORS-blocked, etc) but the operator
              // DID adopt a brand. Don't punish them by reverting to
              // "LA" initials — show a brand-primary chip with the
              // Paintbrush icon, matching LogoThumbnail's fallback
              // visual. The operator at least sees "your brand color
              // is being honored" instead of "we forgot you exist".
              <div className="flex-shrink-0 h-14 min-w-[56px] max-w-[160px] flex items-center justify-center overflow-hidden rounded-lg px-1.5"
                style={{ background: 'var(--brand-primary, #4f46e5)' }}
                aria-hidden
                title={brandName}
              >
                <span className="text-white text-[13px] font-bold tracking-wider">
                  {brandName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                </span>
              </div>
            ) : brandName && brandName !== tenantCopyForBrand.defaultBrandName ? (
              // No logo set OR brand has only a name. Show initials on
              // brand-primary so the chrome still feels like their tenant.
              <div className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-white text-[15px] font-black shadow-sm"
                style={{ background: 'var(--brand-primary, #4f46e5)' }}
                aria-hidden
              >
                {brandName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
              </div>
            ) : (
              // Default (unbranded tenant) — the VenueOS hexagonal mark,
              // the same logo used on the signup / login / landing
              // chrome (see BrandMark.tsx). A brand-new account's
              // dashboard now reads as the same product as the
              // marketing site, not a generic monitor icon.
              <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center" aria-hidden>
                <svg width="34" height="34" viewBox="0 0 32 32">
                  <polygon points="30,16 23,28.12 9,28.12 2,16 9,3.88 23,3.88" fill="#4f46e5" />
                  <polygon points="22,16 19,21.2 13,21.2 10,16 13,10.8 19,10.8" fill="#a5b4fc" />
                </svg>
              </div>
            )}
            {/* 2026-05-25 — restored takeover sprint #1 (originally
                d7bc089, lost in the 2026-05-07 NUCLEAR REVERT). Brand
                name + tagline subtitle stacked. Tagline only renders
                when the tenant explicitly set one in the wizard so
                unbranded tenants stay clean. */}
            <div className="flex flex-col min-w-0 flex-1 gap-0.5">
              <span
                title={brandName}
                // 2026-05-09 — operator's "Los Medanos College" was
                // truncating to "Los Medanos Col..." in the sidebar
                // header. Real-world school names commonly run 18-30
                // chars; allow wrapping to 2 lines with leading-tight
                // so the row stays compact. Font size scales down
                // when the name is long enough to wrap.
                className={cn(
                  'bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700',
                  'line-clamp-2 leading-[1.1] break-words',
                  // 2026-05-26 — "Los Angeles Dodgers" (19 chars) was
                  // tripping the smaller font at >18 and looked tiny
                  // next to the logo chip. Bumped threshold to >24
                  // (covers names like "Los Medanos Community College")
                  // and softened the shrink to text-base so the visual
                  // weight stays consistent with the logo.
                  brandName.length > 24 ? 'text-base' : 'text-xl',
                )}
              >
                {brandName}
              </span>
              {brandTagline && (
                <span
                  className="text-[11px] font-medium text-slate-500 leading-snug truncate"
                  title={brandTagline}
                >
                  {brandTagline}
                </span>
              )}
            </div>
          </h1>
          {/* Close button — only on mobile */}
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-4 px-4">
            Main Menu
          </div>
          {/*
            BULLETPROOF HYDRATION GATE
            ──────────────────────────
            Two prior attempts at fixing the SSR/CSR mismatch failed:

              v1 (35a504e): gated navItems hrefs on `mounted` via
                hrefFor() returning "#" until client hydration. This
                fixed the /null/templates SSR mismatch BUT made all 6
                Link children share the same key="#" during the SSR →
                first-paint window, which React's reconciler can't
                match 1:1 to the post-mount unique-keyed list. Result:
                operator saw 2 of every nav entry, and only one of
                each set actually navigated.

              v2 (5d57339): switched key={item.href} to key={item.name}
                so keys stay unique. Still landed double DOM in some
                hydration paths because the value transition on `href`
                between SSR and client triggers Next.js's Link to
                remount in a way that interacts badly with the rest
                of the tree.

            v3 (this commit): pre-mount render a SKELETON list — 6+
            placeholder rows with stable unique keys (`placeholder-N`)
            and no Link / no href at all. Server-side and first
            client-side paint render IDENTICAL DOM. After `mounted`
            flips to true, the placeholder set unmounts and the real
            Link list mounts in one clean transition. Zero key
            collision, zero href mismatch, zero double-DOM window.
          */}
          {!mounted ? (
            // 6 main + 2 admin = 8 placeholder rows. Render the 8
            // even when not admin so the layout-shift on tenant
            // hydration is consistent for everyone (admin/contributor/
            // viewer) — the right column gets its content first; this
            // sidebar size stays steady.
            Array.from({ length: 8 }, (_, i) => (
              <div
                key={`sidebar-placeholder-${i}`}
                aria-hidden="true"
                className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
              >
                <div className="w-5 h-5 rounded bg-slate-100" />
                <div className="h-4 w-28 rounded bg-slate-100" />
              </div>
            ))
          ) : (
          (navItems.map(i => ({ ...i, badge: null as number | null })).concat(isAdmin ? adminNavItems : [])).map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setMobileSidebarOpen(false)}
                className={cn(
                  // P0-9 (mobile-UX audit 2026-05-29): the active item was
                  // `bg-[color-mix(in_srgb,var(--brand-primary)_8%,transparent)]`
                  // — a Tailwind arbitrary `color-mix()` class that the dev
                  // codegen renders as the SOLID brand color, not the intended
                  // 8% tint (same arbitrary-class-codegen failure as the
                  // Fredoka/logo bugs). With the label also set to
                  // `var(--brand-primary)` that was indigo-text-on-indigo-bg —
                  // an invisible active label. Fixed with a standard, codegen-
                  // safe `bg-indigo-50` tint pill + a dark, always-legible
                  // label (`text-slate-900`); the brand color is still carried
                  // by the left indicator bar and the icon (inline styles
                  // below), so the active state stays on-brand AND readable on
                  // any palette. Applies to desktop static sidebar + mobile
                  // drawer (shared render block).
                  "flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-[14px] font-bold transition-all duration-300 group relative overflow-hidden",
                  isActive
                    ? "bg-indigo-50 text-slate-900 shadow-[0_2px_10px_rgba(99,102,241,0.05)]"
                    : "sidebar-nav-item text-slate-500 hover:bg-slate-50"
                )}
              >
                {/* Active Indicator Bar */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full" style={{ background: 'var(--brand-primary, #6366f1)', boxShadow: '0 0 8px color-mix(in srgb, var(--brand-primary, #6366f1) 50%, transparent)' }} />
                )}
                <item.icon
                  className={cn(
                    "w-[22px] h-[22px] transition-transform duration-300",
                    isActive ? "scale-110 drop-shadow-sm" : "group-hover:scale-110"
                  )}
                  // Keep the active icon on-brand for color identity while the
                  // label stays a high-contrast slate-900 (set on the Link).
                  style={isActive ? { color: 'var(--brand-primary, #3730a3)' } : undefined}
                />
                <span className="flex-1">{item.name}</span>
                {/* Admin-only pending-review count. Shown on the Review
                    Queue row when there's at least one asset waiting on
                    approval so admins don't have to navigate in to check. */}
                {item.badge != null && item.badge > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-bold shadow-sm">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </Link>
            );
          })
          )}

          {/* Emergency trigger — sits right under the last nav item
              (Audit Log for admins, Settings otherwise), matching the
              live-preview mockup.

              2026-05-25 — hidden by default when no emergency content
              has been configured. Triggering a panic on a tenant with
              no Lockdown / Weather / Evacuate playlist would push
              empty content to every screen — worse than no alert
              because the screens still go to the override view but
              show nothing. Replaced the dead button with a small
              "Set up alerts" link that points to the configure page.
              Once ANY of the three is set, the real trigger replaces
              the setup link. ALWAYS rendered when an emergency is
              already active (it becomes "Emergency Active" status
              instead of a trigger) regardless of config state. */}
          <RoleGate allowedRoles={['admin']}>
            <div className="pt-3 mt-3 border-t border-slate-100 px-4">
              {isEmergencyActive ? (
                <div className="inline-flex px-5 py-2 rounded-full bg-red-600 text-white text-xs font-bold items-center gap-1.5 shadow-md shadow-red-600/20 animate-pulse">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Emergency Active
                </div>
              ) : hasEmergencyContent ? (
                <button
                  type="button"
                  onClick={() => setEmergencyModalOpen(true)}
                  // P1 (mobile-UX audit 2026-05-29): was `py-2` ≈ 32px tall —
                  // below the 44px touch minimum for a LIFE-SAFETY control.
                  // `min-h-[44px]` guarantees a ≥44px tap target; the pill
                  // still reads compact on desktop.
                  className="inline-flex px-5 py-2 min-h-[44px] rounded-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold items-center gap-1.5 shadow-md shadow-red-600/20 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Emergency
                </button>
              ) : (
                <Link
                  href={`/${sidebarSchoolId}/settings/emergency`}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-rose-600 transition-colors"
                  title="No emergency content configured yet — set it up so the trigger button is safe to use"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Set up alerts
                </Link>
              )}
            </div>
          </RoleGate>
        </nav>

        <div className="px-4 pb-5 space-y-2">
          {/* User info + Logout */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0 shadow-sm" style={{ background: 'linear-gradient(135deg, var(--brand-primary, #4f46e5), color-mix(in srgb, var(--brand-primary, #4f46e5) 60%, #8b5cf6))' }} suppressHydrationWarning>
              {mounted ? userInitials(user) : ''}
            </div>
            <div className="flex-1 min-w-0" suppressHydrationWarning>
              {/* 2026-05-11 \u2014 show "Greg Schiemann" (or email if name not set)
                  on the primary line, email subdued underneath when we have
                  a real name. Operator: "say Hi Greg not gschiemann." */}
              <p className="text-[11px] font-semibold text-slate-700 truncate">
                {mounted ? (userFullName(user) || 'User') : '\u00A0'}
              </p>
              {mounted && (user?.firstName || user?.lastName) && user?.email && (
                <p className="text-[9px] text-slate-400 truncate">{user.email}</p>
              )}
              {mounted && user?.role === 'SUPER_ADMIN' ? (
                <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-[1px] rounded bg-amber-500 text-amber-950 text-[8px] font-bold uppercase tracking-wider">
                  <Crown className="w-2.5 h-2.5" aria-hidden="true" />
                  Super Admin
                </span>
              ) : (
                <p className="text-[9px] text-slate-400">{mounted ? (tenantCopyForBrand.roleLabel(user?.role || '') || 'Role') : '\u00A0'}</p>
              )}
            </div>
            <button
              onClick={() => { logout(); router.push('/login'); }}
              // P1 (mobile-UX audit 2026-05-29): was `p-1.5` ≈ 28px — below
              // the 44px touch minimum, and it's the only sign-out on the
              // mobile drawer. `min-w-[44px] min-h-[44px]` + centering gives a
              // ≥44px tap target without enlarging the icon; the `-mr-1.5`
              // pulls the wider hit box back to the row's right edge so the
              // visual layout is unchanged on desktop.
              className="flex items-center justify-center min-w-[44px] min-h-[44px] -mr-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {emergencyModalOpen && <EmergencyTriggerModal onClose={() => setEmergencyModalOpen(false)} />}
    </>
  );
}
