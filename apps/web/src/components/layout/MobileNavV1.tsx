"use client";

import { useRef, useState } from 'react';
import { usePathname, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Home, FolderOpen, ListMusic, MonitorPlay, MoreHorizontal,
  Trophy, LayoutTemplate, Settings, ClipboardCheck, FileClock, User, X,
  UtensilsCrossed, Tag, LifeBuoy, Crown, LogOut, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useNotifications } from '@/hooks/use-api';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { useTranslations } from 'next-intl';
import { useBottomSheet } from '@/hooks/use-bottom-sheet';
import type { MobileShell } from '@/lib/mobile-shell-pref';

/**
 * Mobile navigation v1 — ONE nav system (mobile design package §6.1–6.3).
 *
 * WHAT CHANGED AND WHY.
 *
 * The phone used to carry TWO navigation systems at once: a hamburger in the
 * header opening the desktop Sidebar as a drawer, AND a More tab opening an
 * overflow sheet. §6.3 is blunt about it — "Do not retain both a hamburger
 * menu and a More tab. That creates two navigation systems." They also
 * disagreed: the drawer reached Dashboard/Screens/Assets/Templates/Playlists/
 * Settings/Reviews plus sign-out and the owner console; the sheet reached a
 * different set and no sign-out. Which nav you used decided where you could
 * go.
 *
 * So the tab bar is now the only mobile nav, and this More sheet is a
 * SUPERSET of what the drawer reached — every drawer destination plus the
 * account row, language, help, and the rollback link. The hamburger is gone
 * from the v1 header (TopToolbar).
 *
 * §6.1 rules honored here:
 *   - five equal-width destinations: Home · Media · Playlists · Screens · More
 *   - active state = icon + label + a 2px top indicator; colour is never the
 *     only cue
 *   - 64px bar + safe-area-inset-bottom; every target ≥ 48×56
 *   - the bar hides when a full-screen workflow, modal or emergency surface
 *     owns the screen (overlayOpenCount, via the shared lock)
 *   - the badge counts actionable unread items, not raw system noise
 *
 * "Media" is §6.1's mandated tab label ("Use **Media** in the tab label and
 * **Media Library** as the page title"), and the page it opens already titles
 * itself Media Library.
 */
export function MobileNavV1({ onSwitchShell }: { onSwitchShell: (v: MobileShell) => void }) {
  const t = useTranslations();
  const pathname = usePathname() || '';
  const params = useParams<{ schoolId?: string }>();
  const schoolId = params?.schoolId || '';
  const user = useAppStore((s) => s.user);
  const logout = useAppStore((s) => s.logout);
  const overlayOpenCount = useAppStore((s) => s.overlayOpenCount);
  const mobileSidebarOpen = useAppStore((s) => s.mobileSidebarOpen);
  const { data: notifications } = useNotifications();
  const unreadCount = notifications?.unreadCount ?? 0;
  const { vertical } = useTenantCopy();
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  // §6.2 / §15: shared overlay lock, focus trap, inert background, Escape,
  // focus restored to More.
  useBottomSheet({
    open: moreOpen,
    onClose: () => setMoreOpen(false),
    sheetRef,
    triggerRef: moreBtnRef,
    // The overlay lock unmounts this very tab bar while the sheet is open, so
    // the trigger has to be re-found by id once it comes back.
    restoreFocusSelector: '#mobile-more-tab',
  });

  const isHidden =
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/launch') ||
    pathname.startsWith('/panic') ||
    pathname.startsWith('/player') ||
    pathname.startsWith('/onboarding') ||
    /\/templates\/builder\//.test(pathname) ||
    mobileSidebarOpen ||
    // The sheet raises this itself through useBottomSheet, so an open More
    // sheet hides the bar underneath it exactly like any other overlay.
    overlayOpenCount > 0;

  const base = schoolId ? `/${schoolId}` : '';
  const homeHref = base ? `${base}/dashboard` : '/';
  const isAdmin =
    user?.role === 'SUPER_ADMIN' || user?.role === 'DISTRICT_ADMIN' || user?.role === 'SCHOOL_ADMIN';
  const isSportsVertical = vertical === 'SPORTS';
  const isMenuVertical = ['QSR', 'RESTAURANT', 'BAR', 'RETAIL'].includes(vertical);
  const isRetailPricing = vertical === 'RETAIL';
  const isContributor = user?.role === 'CONTRIBUTOR';

  const primaryTabs = [
    { key: 'home', label: t('nav.home'), icon: Home, href: homeHref, badge: unreadCount },
    { key: 'assets', label: t('nav.media'), icon: FolderOpen, href: `${base}/assets` },
    { key: 'playlists', label: t('nav.playlists'), icon: ListMusic, href: `${base}/playlists` },
    { key: 'screens', label: t('nav.screens'), icon: MonitorPlay, href: `${base}/screens` },
  ];

  // §6.2 order: Templates → Sports/Menu → Reviews or My submissions →
  // Activity log → Settings → Account and language → Help and support.
  type MoreItem = { key: string; label: string; icon: typeof Home; href: string; badge?: number };
  const moreItems: MoreItem[] = [
    { key: 'templates', label: t('nav.templates'), icon: LayoutTemplate, href: `${base}/templates` },
    ...(isSportsVertical
      ? [{ key: 'sports', label: t('nav.sports'), icon: Trophy, href: `${base}/sports` }]
      : []),
    ...(isMenuVertical
      ? [{
          key: 'menu',
          label: isRetailPricing ? t('nav.pricing') : t('nav.menu'),
          icon: isRetailPricing ? Tag : UtensilsCrossed,
          href: `${base}/menu`,
        }]
      : []),
    // A contributor cannot approve, so the row is THEIR queue, not the
    // reviewer's (§10: "Never make a user discover permissions by receiving a
    // 403 after a high-stakes tap").
    ...(isAdmin
      ? [{ key: 'reviews', label: t('nav.reviews'), icon: ClipboardCheck, href: `${base}/reviews` }]
      : isContributor
        ? [{ key: 'mine', label: t('nav.mySubmissions'), icon: ClipboardCheck, href: `${base}/reviews?tab=mine` }]
        : []),
    ...(isAdmin
      ? [{ key: 'audit', label: t('nav.audit'), icon: FileClock, href: `${base}/audit` }]
      : []),
    { key: 'settings', label: t('nav.settings'), icon: Settings, href: `${base}/settings` },
    { key: 'account', label: t('nav.account'), icon: User, href: `${base}/account` },
    // Language lives on the account page; §6.2 groups them as one entry.
    // /help is a top-level route, not tenant-scoped.
    { key: 'help', label: t('nav.help'), icon: LifeBuoy, href: '/help' },
    ...(user?.role === 'SUPER_ADMIN'
      ? [{ key: 'owner', label: t('nav.ownerConsole'), icon: Crown, href: '/super' }]
      : []),
  ];

  const isActive = (href: string): boolean => {
    if (href === '/') return pathname === '/';
    if (href === homeHref) return pathname === homeHref || (!!base && pathname === base);
    return pathname.startsWith(href);
  };
  const moreActive = moreItems.some((m) => pathname.startsWith(m.href.split('?')[0]));

  return (
    <>
      {moreOpen && (
        <div
          className="md:hidden fixed top-0 right-0 bottom-0 left-0 z-[61]"
          role="dialog"
          aria-modal="true"
          aria-label={t('toolbar.moreNavigation')}
        >
          <button
            type="button"
            aria-label={t('toolbar.closeMenu')}
            onClick={() => setMoreOpen(false)}
            className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/40 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
          />
          <div
            ref={sheetRef}
            data-testid="more-sheet"
            // will-change/contain promote the sheet to its own layer so the
            // slide-up runs on the compositor (mobile-perf standard #4).
            style={{ willChange: 'transform', contain: 'paint' }}
            className="absolute bottom-0 right-0 left-0 bg-white rounded-t-[20px] shadow-[0_-8px_30px_rgba(0,0,0,0.14)] max-h-[85dvh] overflow-y-auto motion-safe:animate-in motion-safe:slide-in-from-bottom motion-safe:duration-200"
          >
            <div className="sticky top-0 bg-white flex items-center justify-between px-5 pt-4 pb-2 border-b border-slate-100">
              <span className="text-[15px] font-bold text-slate-900">{t('nav.more')}</span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label={t('toolbar.close')}
                // 44×44 minimum (§15).
                className="min-w-[44px] min-h-[44px] -mr-2 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-2 py-2">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.href.split('?')[0]);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 min-h-[48px] rounded-xl transition-colors active:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400',
                      active ? 'text-indigo-700 bg-indigo-50' : 'text-slate-700',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="w-5 h-5 shrink-0" aria-hidden />
                    <span className="text-[14px] font-semibold">{item.label}</span>
                  </Link>
                );
              })}
            </div>
            {/* Sign-out was reachable ONLY from the drawer this sheet
                replaces. Losing it would have stranded every phone session. */}
            <div className="px-2 pb-2 pt-1 border-t border-slate-100">
              <button
                type="button"
                onClick={() => { setMoreOpen(false); logout(); window.location.replace('/login'); }}
                className="w-full flex items-center gap-3 px-3 min-h-[48px] rounded-xl text-rose-600 hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-400"
              >
                <LogOut className="w-5 h-5 shrink-0" aria-hidden />
                <span className="text-[14px] font-semibold">{t('toolbar.signOut')}</span>
              </button>
            </div>
            {/* ROLLBACK CONTRACT — one tap back to the previous mobile
                navigation, persisted in this browser, no deploy. */}
            <div
              className="px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-1"
            >
              <button
                type="button"
                data-testid="switch-classic-nav"
                onClick={() => { setMoreOpen(false); onSwitchShell('classic'); }}
                className="w-full flex items-center justify-center gap-2 min-h-[44px] rounded-xl text-[12px] font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden />
                {t('nav.classicNavigation')}
              </button>
            </div>
          </div>
        </div>
      )}

      {!isHidden && (
        <nav
          data-testid="mobile-tabbar-v1"
          // Solid background, no backdrop-filter — this repaints on every
          // scroll frame and it is always mounted (mobile-perf standard #3).
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
                  // §6.1 minimum target 48×56; the bar's own visual height is
                  // 64px so labels never crowd the icons.
                  className={cn(
                    'relative flex-1 flex flex-col items-center justify-center gap-1 px-1 min-w-[48px] min-h-[64px] active:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
                    active ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-700',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="relative">
                    <Icon className="w-[22px] h-[22px]" aria-hidden />
                    {tab.badge && tab.badge > 0 ? (
                      <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center">
                        {tab.badge > 99 ? '99+' : tab.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[11px] font-bold tracking-wide leading-none">{tab.label}</span>
                  {active && (
                    <span
                      className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 rounded-full bg-indigo-600"
                      aria-hidden
                    />
                  )}
                </Link>
              );
            })}

            <button
              ref={moreBtnRef}
              id="mobile-more-tab"
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={cn(
                'relative flex-1 flex flex-col items-center justify-center gap-1 px-1 min-w-[48px] min-h-[64px] active:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
                moreActive || moreOpen ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <MoreHorizontal className="w-[22px] h-[22px]" aria-hidden />
              <span className="text-[11px] font-bold tracking-wide leading-none">{t('nav.more')}</span>
              {moreActive && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 rounded-full bg-indigo-600"
                  aria-hidden
                />
              )}
            </button>
          </div>
        </nav>
      )}
    </>
  );
}
