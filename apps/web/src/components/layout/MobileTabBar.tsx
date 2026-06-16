"use client";

import { useState } from 'react';
import { usePathname, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Home, FolderOpen, ListMusic, MonitorPlay,
  LayoutGrid, Trophy, LayoutTemplate, Settings, ClipboardCheck, FileClock, User, X,
  UtensilsCrossed,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useNotifications } from '@/hooks/use-api';
import { useTenantCopy } from '@/hooks/use-tenant-copy';

/**
 * Bottom-tab navigation for mobile. Renders only when the viewport is
 * narrower than the `md` Tailwind breakpoint (768px). Replaces the
 * desktop sidebar on phones.
 *
 * Four primary tabs (Home, Assets, Playlists, Screens) plus a
 * "More" tab that opens a sheet for everything else the desktop
 * sidebar reaches — Sports, Templates, Reviews, Audit Log, Settings,
 * Account. Without "More" those sections were UNREACHABLE on a phone:
 * a sports-venue operator running the whole show from their phone
 * (the product's "no laptop needed" promise) had no way to open the
 * game-day console at all. The tab bar can only hold ~6 items, so the
 * overflow sheet is the scalable fix.
 *
 * Emergency does NOT live in the bottom bar — operator 2026-06-03:
 * "that alert button at the bottom is really the emergency trigger; put
 * it top-right and clear up space at the bottom." Emergency now sits in
 * the top-right of the header (TopToolbar, mobile) — the always-available
 * safety control, off the thumb-reach nav so it can't be tapped by
 * accident while navigating.
 */
export function MobileTabBar() {
  const pathname = usePathname() || '';
  const params = useParams<{ schoolId?: string }>();
  const schoolId = params?.schoolId || '';
  const user = useAppStore((s) => s.user);
  // 2026-05-28 — when the mobile sidebar drawer (Sidebar.tsx, z-40) is
  // open, its footer Sign-out button sits UNDER this tab bar (z-60),
  // so it was untappable. Hide the tab bar while the drawer is open so
  // exactly ONE mobile nav surface is usable at a time. The drawer has
  // its own backdrop + ESC + route-change auto-close, so closing it
  // brings the tab bar straight back.
  const mobileSidebarOpen = useAppStore((s) => s.mobileSidebarOpen);
  // 2026-05-29 — same problem, generalized. ANY open overlay (modal,
  // bottom-sheet, drawer, full-screen picker) registers via useOverlayLock,
  // bumping overlayOpenCount. While an overlay is up we hide the tab bar so
  // its footer (Cancel / Confirm / "Choose folder" / Upload) always clears
  // the bottom of the screen — the tab bar was covering action buttons on
  // bottom-anchored sheets (operator's asset-upload screenshot). The drawer
  // case below (mobileSidebarOpen) predates this and is kept for clarity;
  // an open overlay is the superset.
  const overlayOpenCount = useAppStore((s) => s.overlayOpenCount);
  // Badge for pending reviews on the Home tab. Same hook the desktop
  // bell uses, so totals match what the operator sees on web.
  const { data: notifications } = useNotifications();
  const unreadCount = notifications?.unreadCount ?? 0;
  // Sports is a sports-vertical surface — gate it exactly as the
  // desktop Sidebar does so mobile + desktop nav stay consistent.
  const { vertical } = useTenantCopy();
  const [moreOpen, setMoreOpen] = useState(false);

  // Hide the tab bar on:
  //   - the public marketing root (/)
  //   - auth pages (/login, /signup, /reset-password)
  //   - the panic page (it's its own immersive surface)
  //   - the player (kiosk surface)
  //   - the template builder (fullscreen workspace)
  //   - onboarding (its own flow)
  const isHidden =
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/panic') ||
    pathname.startsWith('/player') ||
    pathname.startsWith('/onboarding') ||
    /\/templates\/builder\//.test(pathname) ||
    // Drawer open → drawer owns the screen; hide the tab bar so its
    // footer Sign-out isn't occluded.
    mobileSidebarOpen ||
    // Any overlay open → it owns the screen; hide the tab bar so its
    // bottom-anchored footer buttons aren't occluded.
    overlayOpenCount > 0;
  if (isHidden) return null;

  // Routes prefixed with the schoolId since most tenant-scoped pages
  // live under /[schoolId]/...
  const base = schoolId ? `/${schoolId}` : '';
  const isAdmin =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'DISTRICT_ADMIN' ||
    user?.role === 'SCHOOL_ADMIN';
  const isSportsVertical = vertical === 'SPORTS';
  const isMenuVertical = vertical === 'RESTAURANT' || vertical === 'RETAIL';

  type Tab = { key: string; label: string; icon: typeof Home; href: string; badge?: number; danger?: boolean };
  // The five primary tabs. Labels match the desktop Sidebar's exact
  // strings so muscle memory transfers between surfaces.
  //
  // 2026-05-27 — operator: "the home button on our mobile app gives a
  // 404 error". Cause: this row had `href: \`${base}\` || '/'`, which
  // for any tenant-scoped session pointed at `/<schoolId>` directly.
  // There is no page.tsx at apps/web/src/app/[schoolId]/ — only
  // subroutes (dashboard, assets, playlists, screens, ...) — so Next
  // 404'd. Pointing to `${base}/dashboard` matches the desktop
  // Sidebar's "Dashboard" item (Sidebar.tsx ~L228) and gives the same
  // surface on phone + laptop. Empty-base case (operator landed pre-
  // tenant) still falls back to `/`.
  const homeHref = base ? `${base}/dashboard` : '/';
  const primaryTabs: Tab[] = [
    { key: 'home',      label: 'Home',      icon: Home,        href: homeHref, badge: unreadCount },
    { key: 'assets',    label: 'Assets',    icon: FolderOpen,  href: `${base}/assets` },
    { key: 'playlists', label: 'Playlists', icon: ListMusic,   href: `${base}/playlists` },
    { key: 'screens',   label: 'Screens',  icon: MonitorPlay, href: `${base}/screens` },
  ];

  // The "More" sheet — everything the desktop sidebar reaches that is
  // not a primary tab. RBAC-filtered; Sports follows the desktop's
  // sports-vertical gate exactly.
  type MoreItem = { key: string; label: string; icon: typeof Home; href: string };
  const moreItems: MoreItem[] = [
    ...(isSportsVertical
      ? [{ key: 'sports', label: 'Sports', icon: Trophy, href: `${base}/sports` }]
      : []),
    ...(isMenuVertical
      ? [{ key: 'menu', label: 'Menu', icon: UtensilsCrossed, href: `${base}/menu` }]
      : []),
    { key: 'templates', label: 'Templates', icon: LayoutTemplate, href: `${base}/templates` },
    ...(isAdmin
      ? [
          { key: 'reviews', label: 'Reviews', icon: ClipboardCheck, href: `${base}/reviews` },
          { key: 'audit', label: 'Audit Log', icon: FileClock, href: `${base}/audit` },
        ]
      : []),
    { key: 'settings', label: 'Settings', icon: Settings, href: `${base}/settings` },
    { key: 'account', label: 'Account', icon: User, href: `${base}/account` },
  ];

  // Smart "active" detection — prefix match, with a couple of special
  // cases:
  //   - "/" is a strict match (marketing root only — never highlight
  //     the home tab when sitting on a tenant subroute).
  //   - The Home tab (homeHref = `${base}/dashboard` for a tenant
  //     session, "/" otherwise) lights up on the dashboard AND on the
  //     legacy `${base}` exact path that 404s today (so during the
  //     window where a deployed client might still hold the broken
  //     URL in their history we still treat it as Home, not as nothing).
  //   - /panic prefix-matches because the query-string variant
  //     (`/panic?schoolId=...`) shouldn't unhighlight the tab.
  const isActive = (href: string): boolean => {
    if (href === '/') return pathname === '/';
    if (href === homeHref) {
      return pathname === homeHref || (!!base && pathname === base);
    }
    if (href.startsWith('/panic')) return pathname.startsWith('/panic');
    return pathname.startsWith(href);
  };
  // "More" reads as active whenever the current route is one of its
  // sections, so the operator always sees where they are.
  const moreActive = moreItems.some((m) => pathname.startsWith(m.href));

  return (
    <>
      {/* "More" overflow sheet — slides up over the tab bar */}
      {moreOpen && (
        <div
          className="md:hidden fixed top-0 right-0 bottom-0 left-0 z-[61]"
          role="dialog"
          aria-modal="true"
          aria-label="More navigation"
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/40 animate-in fade-in duration-150"
          />
          <div
            // 2026-06-16 mobile-perf: will-change hints the compositor to
            // promote the sheet to its own layer up-front so the slide-up
            // animation runs on the GPU without a layout/paint stall on the
            // first frame ("doesn't pop up right away"). contain:paint isolates
            // its repaint from the rest of the page.
            style={{ willChange: 'transform', contain: 'paint' }}
            className="absolute bottom-0 right-0 left-0 bg-white rounded-t-2xl shadow-[0_-8px_30px_rgba(0,0,0,0.14)] pb-[calc(64px+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-200"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-1.5">
              <span className="text-sm font-bold text-slate-800">More</span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="p-1.5 -mr-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-2 pb-2">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-3 rounded-xl transition-colors active:bg-slate-50',
                      active ? 'text-indigo-600 bg-indigo-50' : 'text-slate-600',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="w-5 h-5 shrink-0" aria-hidden />
                    <span className="text-sm font-semibold">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav
        // Hidden above the md breakpoint where the sidebar takes over.
        // pb-safe respects the iOS home indicator inset so the labels
        // don't get cut off on iPhone X+ devices.
        // 2026-06-16 mobile-perf: was `bg-white/95 backdrop-blur-md`. The bar
        // is already opaque, so the backdrop-blur was an imperceptible but
        // real per-repaint GPU cost on a position:fixed element that repaints
        // on every scroll/animation frame. Solid bg-white, no backdrop-filter.
        className="md:hidden fixed bottom-0 right-0 left-0 z-[60] bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(0,0,0,0.04)]"
        aria-label="Primary"
      >
        <div className="flex items-stretch justify-around">
          {primaryTabs.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={cn(
                  'relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-1 min-h-[56px] active:bg-slate-50 transition-colors',
                  tab.danger && active && 'text-rose-600',
                  tab.danger && !active && 'text-rose-500 hover:text-rose-600',
                  !tab.danger && active && 'text-indigo-600',
                  !tab.danger && !active && 'text-slate-500 hover:text-slate-700',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <span className="relative">
                  <Icon className={cn('w-5 h-5 transition-transform', active && 'scale-110')} aria-hidden />
                  {tab.badge && tab.badge > 0 ? (
                    <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                      {tab.badge > 99 ? '99+' : tab.badge}
                    </span>
                  ) : null}
                </span>
                <span className={cn('text-[10px] font-bold tracking-wide leading-none', active && 'text-current')}>
                  {tab.label}
                </span>
                {active && (
                  <span
                    className={cn(
                      'absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full',
                      tab.danger ? 'bg-rose-500' : 'bg-indigo-500',
                    )}
                    aria-hidden
                  />
                )}
              </Link>
            );
          })}

          {/* "More" tab — opens the overflow sheet. A button, not a
              Link: it toggles the sheet rather than navigating. */}
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(
              'relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 px-1 min-h-[56px] active:bg-slate-50 transition-colors',
              moreActive || moreOpen ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <LayoutGrid
              className={cn('w-5 h-5 transition-transform', (moreActive || moreOpen) && 'scale-110')}
              aria-hidden
            />
            <span className="text-[10px] font-bold tracking-wide leading-none">More</span>
            {moreActive && (
              <span
                className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-indigo-500"
                aria-hidden
              />
            )}
          </button>
        </div>
      </nav>
    </>
  );
}
