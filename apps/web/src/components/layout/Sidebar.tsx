'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { ShieldAlert, LayoutDashboard, MonitorPlay, Folders, Settings, Upload, LayoutTemplate, LogOut, X } from 'lucide-react';
import { RoleGate } from '../RoleGate';

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

  // Close the mobile sidebar whenever the route changes
  useEffect(() => { setMobileSidebarOpen(false); }, [pathname, setMobileSidebarOpen]);

  // Close on Escape while open
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileSidebarOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileSidebarOpen, setMobileSidebarOpen]);

  const navItems = [
    { name: 'Dashboard', href: `/${activeTenant}/dashboard`, icon: LayoutDashboard },
    { name: 'Screens', href: `/${activeTenant}/screens`, icon: MonitorPlay },
    { name: 'Templates', href: `/${activeTenant}/templates`, icon: LayoutTemplate },
    { name: 'Assets', href: `/${activeTenant}/assets`, icon: Upload },
    { name: 'Playlists', href: `/${activeTenant}/playlists`, icon: Folders },
    { name: 'Settings', href: `/${activeTenant}/settings`, icon: Settings },
  ];

  return (
    <>
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
        <div className="h-[73px] flex items-center px-6 justify-between">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2.5">
            <div className="bg-gradient-to-br from-indigo-500 to-violet-500 p-2 rounded-2xl text-white shadow-md shadow-indigo-500/20">
              <MonitorPlay className="w-5 h-5" />
            </div>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700">EduSignage</span>
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
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-[14px] font-bold transition-all duration-300 group relative overflow-hidden",
                  isActive
                    ? "text-indigo-700 bg-indigo-50/80 shadow-[0_2px_10px_rgba(99,102,241,0.05)]"
                    : "text-slate-500 hover:text-indigo-600 hover:bg-slate-50"
                )}
              >
                {/* Active Indicator Bar */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-500 rounded-r-full shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                )}
                <item.icon className={cn(
                  "w-[22px] h-[22px] transition-transform duration-300",
                  isActive ? "scale-110 drop-shadow-sm" : "group-hover:scale-110"
                )} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 pb-5 space-y-2">
          <RoleGate allowedRoles={['admin']}>
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Admin</span>
            </div>
          </RoleGate>

          {/* User info + Logout */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0 shadow-sm" suppressHydrationWarning>
              {mounted ? (user?.email?.substring(0, 2).toUpperCase() || '??') : ''}
            </div>
            <div className="flex-1 min-w-0" suppressHydrationWarning>
              <p className="text-[11px] font-semibold text-slate-700 truncate">{mounted ? (user?.email || 'User') : '\u00A0'}</p>
              <p className="text-[9px] text-slate-400">{mounted ? (user?.role?.replace(/_/g, ' ') || 'Role') : '\u00A0'}</p>
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
    </>
  );
}
