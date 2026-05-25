"use client";

import { useAppStore } from '@/lib/store';
import { RoleGate } from '../RoleGate';
import { fullName as userFullName, initials as userInitials } from '@/lib/user-display';
import { ShieldAlert, LogOut, Menu, UserCog } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { EmergencyTriggerModal } from '../emergency/EmergencyTriggerModal';
import { HelpDrawer } from '../help/HelpDrawer';
import { NotificationsBell } from './NotificationsBell';
import { SchoolSwitcher } from './SchoolSwitcher';
import { ProfileEditModal } from './ProfileEditModal';

export function TopToolbar() {
  const router = useRouter();
  const isEmergencyActive = useAppStore((state) => state.isEmergencyActive);
  const user = useAppStore((state) => state.user);
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
      <header className="h-[73px] bg-white/60 backdrop-blur-xl px-4 sm:px-8 flex items-center justify-between sticky top-0 z-20 transition-all duration-300">
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
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">
          <SchoolSwitcher />
          <NotificationsBell />
          {/* Emergency button lives in the Sidebar now (design spec update).
              Active-state indicator stays here as a small chip so the
              emergency status is visible even when the sidebar is
              collapsed on mobile. */}
          <RoleGate allowedRoles={['admin']}>
            {isEmergencyActive && (
              <div className="px-3 py-1.5 bg-red-50 text-red-600 text-[11px] font-bold rounded-lg flex items-center gap-1.5 animate-pulse">
                <ShieldAlert className="w-3.5 h-3.5" />
                Emergency Active
              </div>
            )}
          </RoleGate>

          {/* In-app help drawer */}
          <HelpDrawer />

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
              <div className="absolute right-0 top-12 w-56 bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50">
                <div className="px-4 py-2 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-800 truncate">{fullDisplayName || user?.email}</p>
                  {fullDisplayName && user?.email && (
                    <p className="text-[10px] text-slate-400 mt-0.5 truncate">{user.email}</p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-0.5">{user?.role?.replace(/_/g, ' ')}</p>
                </div>
                {/* 2026-05-11 — Edit profile lives here, not in
                    /settings (operator: "settings page is fucking
                    crazy now"). Opens a small modal with name fields
                    + live "Hi, Greg" preview. */}
                <button
                  onClick={() => { setShowUserMenu(false); setShowProfileModal(true); }}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <UserCog className="w-3.5 h-3.5 text-slate-400" /> Edit profile
                </button>
                <button
                  onClick={() => { setShowUserMenu(false); logout(); router.push('/login'); }}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-slate-100"
                >
                  <LogOut className="w-3.5 h-3.5" /> Sign Out
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

