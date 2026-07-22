"use client";

import { useAppStore } from '@/lib/store';
import { RoleGate } from '../RoleGate';
import { fullName as userFullName, initials as userInitials } from '@/lib/user-display';
import { ShieldAlert, LogOut, Menu, UserCog } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LanguageMenuRows } from './LanguageMenu';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTenantStatus } from '@/hooks/use-api';
import { useState, useEffect } from 'react';
import { EmergencyTriggerModal } from '../emergency/EmergencyTriggerModal';
import { HelpDrawer } from '../help/HelpDrawer';
import { NotificationsBell } from './NotificationsBell';
import { SchoolSwitcher } from './SchoolSwitcher';
import { ProfileEditModal } from './ProfileEditModal';
import { useTenantCopy } from '@/hooks/use-tenant-copy';

export function TopToolbar() {
  const t = useTranslations();
  const isEmergencyActive = useAppStore((state) => state.isEmergencyActive);
  const user = useAppStore((state) => state.user);
  // 2026-05-25 — resolve user.role through useTenantCopy so the
  // dropdown label reads "Super Admin" / "Admin" / etc. instead of
  // raw "DISTRICT_ADMIN" / "SCHOOL_ADMIN".
  const topToolbarTenantCopy = useTenantCopy();
  const params = useParams<{ schoolId?: string }>();
  const schoolId = params?.schoolId || '';
  // Mirror the Sidebar's gate: only ARM the trigger once the tenant has
  // wired at least one emergency playlist, otherwise a trigger would push
  // empty content to every screen. No content → a "set up alerts" nudge.
  const { data: tenantInfo } = useTenantStatus();
  const tenantInfoAny = tenantInfo as any;
  const hasEmergencyContent = !!(
    tenantInfoAny?.panicLockdownPlaylistId ||
    tenantInfoAny?.panicWeatherPlaylistId ||
    tenantInfoAny?.panicEvacuatePlaylistId
  );
  const logout = useAppStore((state) => state.logout);
  const toggleMobileSidebar = useAppStore((state) => state.toggleMobileSidebar);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // 2026-05-11 — operator: "say Hi Greg not gschiemann." Use the
  // user-display helper so initials prefer firstName+lastName, with
  // email-prefix as a graceful fallback for legacy accounts.
  const initials = mounted ? userInitials(user) : '··';
  const fullDisplayName = mounted ? userFullName(user) : '';

  return (
    <>
      {/* 2026-06-16 mobile-perf: backdrop-blur-xl is one of the most expensive
          mobile composites (it re-samples + blurs everything behind the sticky
          header on every repaint). On phones use a near-opaque solid bg and NO
          backdrop-filter; keep the premium glass on md+ where it's cheap. */}
      <header className="h-[73px] bg-white/90 backdrop-blur-none md:bg-white/60 md:backdrop-blur-xl px-4 sm:px-8 flex items-center justify-between sticky top-0 z-20 transition-all duration-300">
        {/* Left — hamburger on mobile, spacer on desktop */}
        <div className="flex-1 flex items-center">
          <button
            type="button"
            onClick={toggleMobileSidebar}
            // 2026-05-25 — restored takeover sprint #1: hover/focus
            // colors read var(--brand-primary) so the tenant's
            // primary tint shows in the chrome instead of fixed
            // indigo. Falls back to #4f46e5 when no brand adopted.
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2"
            style={{
              ['--tw-ring-color' as any]: 'var(--brand-primary, #4f46e5)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--brand-primary, #4f46e5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '';
            }}
            aria-label={t('toolbar.openNav')}
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Right Side. Tighter gap on phones so the switcher + bell +
            emergency + avatar all fit once the emergency control is added. */}
        <div className="flex items-center gap-2 sm:gap-3">
          <SchoolSwitcher />
          <NotificationsBell />
          {/* Emergency control — TOP-RIGHT on MOBILE. Operator 2026-06-03:
              "that alert button at the bottom is really the emergency trigger;
              put it top-right and clear up space at the bottom." On desktop the
              Sidebar already carries the emergency control, so this is md:hidden
              to avoid a duplicate. Three states mirror the Sidebar exactly:
                • active   → pulsing "Emergency Active" status
                • armed    → red trigger button → opens EmergencyTriggerModal
                            (the same typed-confirm modal the Sidebar uses)
                • no setup → "set up alerts" nudge so we never arm a trigger
                            that would broadcast empty content. */}
          <RoleGate allowedRoles={['admin']}>
            <div className="md:hidden">
              {isEmergencyActive ? (
                <span className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl bg-red-600 text-white text-xs font-bold animate-pulse">
                  <ShieldAlert className="w-4 h-4" aria-hidden />
                  <span className="hidden sm:inline">{t('emergency.active')}</span>
                </span>
              ) : hasEmergencyContent ? (
                <button
                  type="button"
                  onClick={() => setIsModalOpen(true)}
                  aria-label={t('emergency.triggerAria')}
                  className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-400"
                >
                  <ShieldAlert className="w-4 h-4" aria-hidden />
                  <span className="hidden sm:inline">{t('emergency.trigger')}</span>
                </button>
              ) : (
                <Link
                  href={`/${schoolId}/settings/emergency`}
                  aria-label={t('emergency.setUpAria')}
                  title={t('emergency.setUpTitle')}
                  className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-rose-500 hover:bg-rose-50 transition-colors"
                >
                  <ShieldAlert className="w-5 h-5" aria-hidden />
                </Link>
              )}
            </div>
          </RoleGate>

          {/* In-app help drawer — desktop only. On a phone we keep the header
              compact (hamburger + switcher + bell + emergency + avatar) so the
              new top-right emergency control fits without pushing the avatar
              off-screen; help stays reachable on tablet/desktop. */}
          <div className="hidden sm:block">
            <HelpDrawer />
          </div>

          {/* User avatar + menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              // 2026-05-25 — restored takeover sprint #1: avatar
              // gradient reads var(--brand-primary) + mix toward
              // violet so the chrome picks up the tenant primary
              // instead of hardcoded indigo. ProfileEditModal +
              // Sidebar use this exact same gradient recipe so the
              // avatar reads consistently across surfaces.
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-bold shadow-md hover:scale-105 transition-transform"
              style={{
                background:
                  'linear-gradient(135deg, var(--brand-primary, #4f46e5), color-mix(in srgb, var(--brand-primary, #4f46e5) 60%, #8b5cf6))',
                boxShadow:
                  '0 4px 12px color-mix(in srgb, var(--brand-primary, #4f46e5) 25%, transparent)',
              }}
              title={mounted ? user?.email : undefined}
            >
              {initials}
            </button>

            {showUserMenu && (
              <div className="absolute right-0 left-auto top-12 w-56 max-w-[calc(100vw-1rem)] bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50">
                <div className="px-4 py-2 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-800 truncate">{fullDisplayName || user?.email}</p>
                  {fullDisplayName && user?.email && (
                    <p className="text-[10px] text-slate-400 mt-0.5 truncate">{user.email}</p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-0.5">{topToolbarTenantCopy.roleLabel(user?.role || '')}</p>
                </div>
                {/* 2026-05-11 — Edit profile lives here, not in
                    /settings (operator: "settings page is fucking
                    crazy now"). Opens a small modal with name fields
                    + live "Hi, Greg" preview. */}
                <button
                  onClick={() => { setShowUserMenu(false); setShowProfileModal(true); }}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <UserCog className="w-3.5 h-3.5 text-slate-400" /> {t('toolbar.editProfile')}
                </button>
                <LanguageMenuRows onPicked={() => setShowUserMenu(false)} />
                <button
                  onClick={() => { setShowUserMenu(false); logout(); window.location.replace('/login'); }}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-slate-100"
                >
                  <LogOut className="w-3.5 h-3.5" /> {t('toolbar.signOut')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {isModalOpen && <EmergencyTriggerModal onClose={() => setIsModalOpen(false)} />}
      {showProfileModal && <ProfileEditModal onClose={() => setShowProfileModal(false)} />}
    </>
  );
}

