"use client";

import { useAppStore } from '@/lib/store';
import { RoleGate } from '../RoleGate';
import { ShieldAlert, LogOut, Menu } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { EmergencyTriggerModal } from '../emergency/EmergencyTriggerModal';

export function TopToolbar() {
  const router = useRouter();
  const isEmergencyActive = useAppStore((state) => state.isEmergencyActive);
  const user = useAppStore((state) => state.user);
  const logout = useAppStore((state) => state.logout);
  const toggleMobileSidebar = useAppStore((state) => state.toggleMobileSidebar);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Get user initials from email
  const initials = mounted && user?.email
    ? user.email.split('@')[0].substring(0, 2).toUpperCase()
    : '··';

  return (
    <>
      <header className="h-[73px] bg-white/60 backdrop-blur-xl px-4 sm:px-8 flex items-center justify-between sticky top-0 z-20 transition-all duration-300">
        {/* Left — hamburger on mobile, spacer on desktop */}
        <div className="flex-1 flex items-center">
          <button
            type="button"
            onClick={toggleMobileSidebar}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-xl text-slate-600 hover:text-indigo-600 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">
          <RoleGate allowedRoles={['admin']}>
            {isEmergencyActive ? (
              <div className="px-4 py-2 bg-red-50 text-red-600 text-xs font-bold rounded-lg flex items-center gap-2 animate-pulse">
                <ShieldAlert className="w-4 h-4" />
                Emergency Active
              </div>
            ) : (
              <button
                onClick={() => setIsModalOpen(true)}
                className="px-4 py-2 bg-white border border-red-200 hover:bg-red-50 text-red-600 text-xs font-bold rounded-lg transition-all flex items-center gap-2"
              >
                <ShieldAlert className="w-4 h-4" />
                Emergency
              </button>
            )}
          </RoleGate>

          {/* User avatar + menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white text-xs font-bold shadow-md shadow-indigo-500/20 hover:scale-105 transition-transform"
              title={mounted ? user?.email : undefined}
            >
              {initials}
            </button>

            {showUserMenu && (
              <div className="absolute right-0 top-12 w-56 bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50">
                <div className="px-4 py-2 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-800 truncate">{user?.email}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{user?.role?.replace(/_/g, ' ')}</p>
                </div>
                <button
                  onClick={() => { setShowUserMenu(false); logout(); router.push('/login'); }}
                  className="w-full text-left px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <LogOut className="w-3.5 h-3.5" /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {isModalOpen && <EmergencyTriggerModal onClose={() => setIsModalOpen(false)} />}
    </>
  );
}

