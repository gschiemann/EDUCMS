"use client";

import { usePathname, useParams } from 'next/navigation';
import Link from 'next/link';
import { Home, FolderOpen, ListMusic, MonitorPlay, Siren, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { useNotifications } from '@/hooks/use-api';

/**
 * Bottom-tab navigation for mobile. Renders only when the viewport is
 * narrower than the `md` Tailwind breakpoint (768px). Replaces the
 * desktop sidebar on phones — operator gets 5 primary actions (Home,
 * Content, Playlists, Screens, Alerts) plus a self-explanatory icon.
 *
 * The "Alerts" tab is the safety surface: from there an admin can
 * hit the emergency triggers. Highlighted indigo so it reads as the
 * always-available safety control. Per competitor research
 * (docs/research/MOBILE_COMPETITOR_REPORT.md, 2026-05-14):
 *
 *   "OptiSigns reviewers explicitly ask for emergency control on
 *    mobile. No competitor signage CMS ships this."
 *
 * Making panic-reach the most visible chrome on every page is the
 * cheapest way to materialize that differentiator while we build
 * the per-zone-trigger phase-3 features.
 */
export function MobileTabBar() {
  const pathname = usePathname() || '';
  const params = useParams<{ schoolId?: string }>();
  const schoolId = params?.schoolId || '';
  const user = useAppStore((s) => s.user);
  // Badge for pending reviews on the Home tab. Same hook the desktop
  // bell uses, so totals match what the operator sees on web.
  const { data: notifications } = useNotifications();
  const unreadCount = notifications?.unreadCount ?? 0;

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
    /\/templates\/builder\//.test(pathname);
  if (isHidden) return null;

  // Tab definitions. Routes prefixed with the schoolId since most
  // tenant-scoped pages live under /[schoolId]/...
  const base = schoolId ? `/${schoolId}` : '';
  const isViewer = user?.role === 'RESTRICTED_VIEWER';
  type Tab = { key: string; label: string; icon: typeof Home; href: string; badge?: number; danger?: boolean };
  // 2026-05-14 — terminology aligned with desktop sidebar: "Assets"
  // (not "Content"), "Playlists" (not "Lists"). Operator: "we say
  // asset in the dashboard...lets just keep everything consisitent
  // mobile and desktop app". Tab labels also match the desktop
  // Sidebar's exact strings so muscle memory transfers between
  // surfaces.
  const tabs: Tab[] = [
    { key: 'home',      label: 'Home',      icon: Home,        href: `${base}` || '/', badge: unreadCount },
    { key: 'assets',    label: 'Assets',    icon: FolderOpen,  href: `${base}/assets` },
    { key: 'playlists', label: 'Playlists', icon: ListMusic,   href: `${base}/playlists` },
    { key: 'screens',   label: 'Screens',  icon: MonitorPlay, href: `${base}/screens` },
    // Alerts is the always-available safety surface. Even for viewers
    // we link to /panic — the page itself enforces RBAC; viewers see
    // a read-only "active alerts" list instead of trigger UI.
    { key: 'alerts',    label: 'Alerts',   icon: Siren,       href: `/panic${schoolId ? `?schoolId=${schoolId}` : ''}`, danger: true },
    { key: 'account',   label: 'Account',  icon: User,        href: `${base}/account` },
  ];

  // Smart "active" detection — exact match for home + prefix match for
  // the others. Avoids /screens highlighting on /screens/abc detail
  // pages by accident.
  const isActive = (href: string): boolean => {
    if (href === '/' || href === base) return pathname === '/' || pathname === base;
    if (href.startsWith('/panic')) return pathname.startsWith('/panic');
    return pathname.startsWith(href);
  };

  return (
    <nav
      // Hidden above the md breakpoint where the sidebar takes over.
      // pb-safe respects the iOS home indicator inset so the labels
      // don't get cut off on iPhone X+ devices.
      className="md:hidden fixed bottom-0 inset-x-0 z-[60] bg-white/95 backdrop-blur-md border-t border-slate-200 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(0,0,0,0.04)]"
      aria-label="Primary"
    >
      <div className="flex items-stretch justify-around">
        {tabs.filter((t) => !(isViewer && t.key === 'alerts')).map((tab) => {
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
                !tab.danger && !active && 'text-slate-500 hover:text-slate-700'
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
                    tab.danger ? 'bg-rose-500' : 'bg-indigo-500'
                  )}
                  aria-hidden
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
