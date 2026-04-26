'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { ShieldAlert, LayoutDashboard, MonitorPlay, Folders, Settings, Upload, LayoutTemplate, LogOut, X, FileClock, Crown, ClipboardCheck } from 'lucide-react';
import { RoleGate } from '../RoleGate';
import { EmergencyTriggerModal } from '../emergency/EmergencyTriggerModal';
import { usePendingAssets } from '@/hooks/use-api';
import type { TenantBranding } from '@/lib/branding';

// Must match the PER-TENANT key format BrandStyleInjector writes to.
// Mobile-Claude's cross-tenant fix moved the injector to per-tenant
// keys but the Sidebar was still reading the legacy global key, which
// is always empty after migration. That left the sidebar stuck on
// default "EduSignage" branding no matter what the tenant adopted.
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

  // Tenant branding for sidebar header. Reads from the PER-TENANT LS
  // cache written by <BrandStyleInjector> + re-fires on the
  // 'branding:update' event so newly-adopted brands repaint the header
  // live. Defaults to EduSignage when no branding is set for this
  // tenant. The cache key depends on the active tenantId; re-reads
  // whenever that changes so tenant-switch picks up the other
  // tenant's brand immediately.
  const userTenantId = user?.tenantId || null;
  const [branding, setBranding] = useState<TenantBranding | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        if (userTenantId) {
          const raw = localStorage.getItem(BRAND_LS_PREFIX + userTenantId);
          if (raw) { setBranding(JSON.parse(raw)); return; }
        }
        // Legacy single-key fallback (mobile-Claude's migration wipes
        // this on BrandStyleInjector mount; read in case the injector
        // hasn't run yet on a fresh tab).
        const legacy = localStorage.getItem(BRAND_LS_LEGACY);
        setBranding(legacy ? JSON.parse(legacy) : null);
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

  const brandName = (mounted && branding?.displayName) || 'EduSignage';
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
  const navItems = [
    { name: 'Dashboard', href: `/${activeTenant}/dashboard`, icon: LayoutDashboard },
    { name: 'Screens', href: `/${activeTenant}/screens`, icon: MonitorPlay },
    { name: 'Assets', href: `/${activeTenant}/assets`, icon: Upload },
    { name: 'Templates', href: `/${activeTenant}/templates`, icon: LayoutTemplate },
    { name: 'Playlists', href: `/${activeTenant}/playlists`, icon: Folders },
    { name: 'Settings', href: `/${activeTenant}/settings`, icon: Settings },
  ];

  // Hydration safety: `user` is loaded from localStorage on the client
  // only, so SSR sees `isAdmin = false`. Without the `mounted` gate the
  // admin links would appear on the client only after hydration,
  // producing a "extra element" hydration mismatch error. Always
  // render the same nav set on server + client's first paint; flip
  // to the admin set on the next render after mount.
  const isAdmin = mounted && (user?.role === 'SUPER_ADMIN' || user?.role === 'DISTRICT_ADMIN' || user?.role === 'SCHOOL_ADMIN');

  // Pending-review badge count. Hook is gated on isAdmin so the query
  // stays dormant for CONTRIBUTOR / RESTRICTED_VIEWER tabs (otherwise
  // every non-admin would fire a recurring 403 against /assets/pending
  // every 30s just to render a sidebar they don't even see).
  const pendingAssetsQ = usePendingAssets(isAdmin);
  const pendingCount = Array.isArray(pendingAssetsQ.data) ? pendingAssetsQ.data.length : 0;

  const adminNavItems = [
    { name: 'Review Queue', href: `/${activeTenant}/assets/review`, icon: ClipboardCheck, badge: pendingCount > 0 ? pendingCount : null },
    // Sprint 1.5 — submission inbox for the submit-for-review workflow.
    // Distinct from "Review Queue" (which is just pending assets) — this
    // is the bundled-submission inbox where contributors submit a
    // playlist + assets + schedule together for one approval click.
    { name: 'Reviews', href: `/${activeTenant}/reviews`, icon: ClipboardCheck, badge: null as number | null },
    { name: 'Audit Log', href: `/${activeTenant}/audit`, icon: FileClock, badge: null as number | null },
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
          "fixed top-0 left-0 h-screen w-72 max-w-[85vw] z-40 transition-transform duration-300 ease-out",
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
        aria-label="Primary navigation"
        aria-hidden={!mobileSidebarOpen && typeof window !== 'undefined' && window.innerWidth < 768 ? true : undefined}
      >
        <div className="h-[73px] flex items-center px-5 justify-between gap-2">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-800 flex items-center gap-3 min-w-0">
            {brandLogoUrl && !logoImgBroken && !/\.(ico|icns)(\?|#|$)/i.test(brandLogoUrl) ? (
              // Wider box lets wide wordmarks (Chardon's tree + "CHARDON
              // LOCAL SCHOOLS") render at actual aspect ratio instead of
              // being squished into a 44px square.  max-w-[140px] caps
              // the width so a ridiculously wide logo can't push the
              // tenant name off the sidebar.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brandLogoUrl}
                alt=""
                onError={() => setLogoImgBroken(true)}
                className="flex-shrink-0 h-12 max-w-[140px] object-contain"
              />
            ) : brandLogoSvg && /<(path|circle|rect|polygon|polyline|ellipse|image|use)\b/i.test(brandLogoSvg) ? (
              <div
                className="flex-shrink-0 h-12 max-w-[140px] [&_svg]:h-full [&_svg]:max-h-12 [&_svg]:w-auto"
                aria-hidden
                dangerouslySetInnerHTML={{ __html: brandLogoSvg }}
              />
            ) : brandName && brandName !== 'EduSignage' ? (
              // Last-resort: branded tenant but logo scrape failed or
              // hasn't been adopted yet. Show initials in a circle using
              // the brand primary color so the chrome still feels like
              // their tenant, not like a broken-image placeholder.
              <div className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-white text-[15px] font-black shadow-sm"
                style={{ background: 'var(--brand-primary, #4f46e5)' }}
                aria-hidden
              >
                {brandName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
              </div>
            ) : (
              <div className="p-2 rounded-2xl text-white shadow-md flex-shrink-0 w-10 h-10 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--brand-primary, #6366f1), color-mix(in srgb, var(--brand-primary, #6366f1) 70%, #8b5cf6))' }}>
                <MonitorPlay className="w-5 h-5" />
              </div>
            )}
            <span
              title={brandName}
              className="bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 truncate"
            >
              {brandName}
            </span>
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
          {(navItems.map(i => ({ ...i, badge: null as number | null })).concat(isAdmin ? adminNavItems : [])).map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-[14px] font-bold transition-all duration-300 group relative overflow-hidden",
                  isActive
                    ? "bg-[color-mix(in_srgb,var(--brand-primary,#4f46e5)_8%,transparent)] shadow-[0_2px_10px_rgba(99,102,241,0.05)]"
                    : "sidebar-nav-item text-slate-500 hover:bg-slate-50"
                )}
                style={isActive ? { color: 'var(--brand-primary, #3730a3)' } : undefined}
              >
                {/* Active Indicator Bar */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full" style={{ background: 'var(--brand-primary, #6366f1)', boxShadow: '0 0 8px color-mix(in srgb, var(--brand-primary, #6366f1) 50%, transparent)' }} />
                )}
                <item.icon className={cn(
                  "w-[22px] h-[22px] transition-transform duration-300",
                  isActive ? "scale-110 drop-shadow-sm" : "group-hover:scale-110"
                )} />
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
          })}

          {/* Emergency trigger — sits right under the last nav item
              (Audit Log for admins, Settings otherwise), matching the
              live-preview mockup. Keeps it in the eye-scan-path of the
              menu rather than buried at the bottom. */}
          <RoleGate allowedRoles={['admin']}>
            {/* Wrapper matches the nav-item padding (px-4) so the button's
                left edge and icon line up with 'Audit Log' above it, not
                floated to the center. User asked for left-justified
                alignment with the nav text. */}
            <div className="pt-3 mt-3 border-t border-slate-100 px-4">
              {isEmergencyActive ? (
                <div className="inline-flex px-5 py-2 rounded-full bg-red-600 text-white text-xs font-bold items-center gap-1.5 shadow-md shadow-red-600/20 animate-pulse">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Emergency Active
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEmergencyModalOpen(true)}
                  className="inline-flex px-5 py-2 rounded-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold items-center gap-1.5 shadow-md shadow-red-600/20 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Emergency
                </button>
              )}
            </div>
          </RoleGate>
        </nav>

        <div className="px-4 pb-5 space-y-2">
          {/* User info + Logout */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold shrink-0 shadow-sm" style={{ background: 'linear-gradient(135deg, var(--brand-primary, #4f46e5), color-mix(in srgb, var(--brand-primary, #4f46e5) 60%, #8b5cf6))' }} suppressHydrationWarning>
              {mounted ? (user?.email?.substring(0, 2).toUpperCase() || '??') : ''}
            </div>
            <div className="flex-1 min-w-0" suppressHydrationWarning>
              <p className="text-[11px] font-semibold text-slate-700 truncate">{mounted ? (user?.email || 'User') : '\u00A0'}</p>
              {mounted && user?.role === 'SUPER_ADMIN' ? (
                <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-[1px] rounded bg-amber-500 text-amber-950 text-[8px] font-bold uppercase tracking-wider">
                  <Crown className="w-2.5 h-2.5" aria-hidden="true" />
                  Super Admin
                </span>
              ) : (
                <p className="text-[9px] text-slate-400">{mounted ? (user?.role?.replace(/_/g, ' ') || 'Role') : '\u00A0'}</p>
              )}
            </div>
            <button
              onClick={() => { logout(); router.push('/login'); }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
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
