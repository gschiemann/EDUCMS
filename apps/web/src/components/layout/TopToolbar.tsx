"use client";

import { useAppStore } from '@/lib/store';
import { hasPanicAuthority } from '@/lib/emergency-capability';
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
import { useMobileShell } from '@/lib/mobile-shell-pref';
import { cn } from '@/lib/utils';

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
  // Which mobile shell this browser gets. `shellLoaded` gates every v1/classic
  // branch below so the header never paints one and swaps to the other.
  const { shell, loaded: shellLoaded } = useMobileShell();

  useEffect(() => { setMounted(true); }, []);

  /**
   * The active alert's own name, when the tenant row carries one
   * ("Lockdown"), so the strip says WHICH emergency rather than a generic
   * word. `emergencyStatus` is the same field DashboardLayout reads to set
   * `isEmergencyActive`; anything other than a recognizable type falls back
   * to the generic label rather than printing a raw enum at an operator.
   */
  const emergencyTypeLabel = (() => {
    const raw = String((tenantInfoAny as any)?.emergencyStatus || '').trim();
    if (!raw || raw.toUpperCase() === 'INACTIVE' || raw.toUpperCase() === 'ACTIVE') return null;
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  })();

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
        {/* Left — mobile v1 puts the compact location switcher here (§6.3:
            "Left: compact active-location switcher"); classic keeps the
            hamburger. Desktop is a spacer in both, unchanged. */}
        <div className="flex-1 flex items-center min-w-0">
          {shellLoaded && shell === 'v1' && (
            <div className="md:hidden min-w-0">
              <SchoolSwitcher />
            </div>
          )}
          {shellLoaded && shell === 'classic' && (
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
          )}
        </div>

        {/* Right Side. Tighter gap on phones so the switcher + bell +
            emergency + avatar all fit once the emergency control is added. */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* v1 moved the switcher to the left on phones (§6.3), so the
              right-hand copy is desktop-only there. Classic keeps it here. */}
          <div className={shellLoaded && shell === 'v1' ? 'hidden md:block' : undefined}>
            <SchoolSwitcher />
          </div>
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
          {/* CAPABILITY, NOT ROLE (2026-09-01 — mobile design package §10:
              "Emergency discovery follows `canTriggerPanic`, not administrator
              role"). This was `<RoleGate allowedRoles={['admin']}>`, which hid
              Emergency from a CONTRIBUTOR whose administrator had granted
              canTriggerPanic — the delegated staffer the flag exists for. The
              API would have accepted their trigger (@AllowPanicBypass); only
              the phone's navigation refused to show them the way in. `mounted`
              gates the read so SSR and the first client paint agree. */}
          {mounted && hasPanicAuthority(user) && (
            <div className="md:hidden">
              {isEmergencyActive ? (
                <span className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl bg-red-600 text-white text-xs font-bold animate-pulse">
                  <ShieldAlert className="w-4 h-4" aria-hidden />
                  <span className="hidden sm:inline">{t('emergency.active')}</span>
                </span>
              ) : hasEmergencyContent ? (
                // §6.3: "It opens the safe trigger surface; it never triggers
                // directly." v1 routes to /panic — the immersive M17 surface
                // with the 3-second hold, hidden app navigation and (since
                // wave 0) silence by default — so the phone has ONE emergency
                // surface instead of a modal here and a full page there.
                // Classic keeps the typed-confirm modal it always had.
                shellLoaded && shell === 'v1' ? (
                  <Link
                    href={`/panic?schoolId=${schoolId}`}
                    aria-label={t('emergency.triggerAria')}
                    className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-400"
                  >
                    <ShieldAlert className="w-4 h-4" aria-hidden />
                    <span className="hidden sm:inline">{t('emergency.trigger')}</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(true)}
                    aria-label={t('emergency.triggerAria')}
                    className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xs font-bold shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-400"
                  >
                    <ShieldAlert className="w-4 h-4" aria-hidden />
                    <span className="hidden sm:inline">{t('emergency.trigger')}</span>
                  </button>
                )
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
          )}

          {/* In-app help drawer — desktop only. On a phone we keep the header
              compact (hamburger + switcher + bell + emergency + avatar) so the
              new top-right emergency control fits without pushing the avatar
              off-screen; help stays reachable on tablet/desktop. */}
          <div className="hidden sm:block">
            <HelpDrawer />
          </div>

          {/* User avatar + menu.
              §6.3: "Move profile/account into More." On v1 phones this is
              desktop-only — Account, language and sign-out all live in the
              More sheet, so the header keeps exactly the three controls the
              spec names (location · notifications · emergency). Classic keeps
              the avatar where it was. */}
          <div className={cn('relative', shellLoaded && shell === 'v1' && 'hidden md:block')}>
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

      {/* ACTIVE-EMERGENCY STRIP (§6.3) — "When an emergency is active, replace
          the ordinary emergency icon with a full-width status strip
          immediately beneath the header."

          The spec's own example line is
            LOCKDOWN ACTIVE · 42/45 screens confirmed · View incident
          and this deliberately does NOT print that fraction. §11.5 forbids
          "Confirmed" without a matching expected and rendered revision, and
          no per-screen emergency acknowledgement exists in any payload this
          component can read — so a count here would be invented. It states
          what the tenant row actually proves (an alert is active, of this
          type) and routes to the surface that can say more. When a real
          acknowledgement count lands, this is the one line to change. */}
      {mounted && isEmergencyActive && (
        <div
          role="status"
          aria-live="polite"
          className="sticky top-[73px] z-20 md:hidden bg-red-700 text-white px-4 py-2 flex items-center gap-2"
        >
          <ShieldAlert className="w-4 h-4 shrink-0 motion-safe:animate-pulse" aria-hidden />
          <span className="text-[12px] font-black uppercase tracking-wide truncate">
            {emergencyTypeLabel ? `${emergencyTypeLabel} active` : t('emergency.active')}
          </span>
          <Link
            href={`/panic?schoolId=${schoolId}`}
            className="ml-auto shrink-0 text-[12px] font-bold underline underline-offset-2 min-h-[44px] flex items-center px-1"
          >
            {t('emergency.viewIncident')}
          </Link>
        </div>
      )}

      {isModalOpen && <EmergencyTriggerModal onClose={() => setIsModalOpen(false)} />}
      {showProfileModal && <ProfileEditModal onClose={() => setShowProfileModal(false)} />}
    </>
  );
}

