"use client";

import { useAppStore } from '@/lib/store';
import { RoleGate } from '../RoleGate';
import { ShieldAlert, Bell, Search } from 'lucide-react';
import { useState } from 'react';
import { EmergencyTriggerModal } from '../emergency/EmergencyTriggerModal';

export function TopToolbar() {
  const isEmergencyActive = useAppStore((state) => state.isEmergencyActive);
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-20">
        
        {/* Left Side - Search */}
        <div className="flex-1 max-w-md">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search screens, playlists..." 
              className="w-full pl-10 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border-none rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
          </div>
        </div>

        {/* Right Side - Actions & Profile */}
        <div className="flex items-center gap-4">
          <RoleGate allowedRoles={['admin']}>
            {isEmergencyActive ? (
              <div className="px-4 py-2 bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-semibold rounded-md border border-red-500/20 flex items-center gap-2 animate-pulse">
                <ShieldAlert className="w-4 h-4" />
                Emergency Active
              </div>
            ) : (
              <button 
                onClick={() => setIsModalOpen(true)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-md transition-all shadow-sm shadow-red-600/20 flex items-center gap-2"
              >
                <ShieldAlert className="w-4 h-4" />
                Trigger Emergency
              </button>
            )}
          </RoleGate>

          <button className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            <Bell className="w-4 h-4" />
          </button>

          <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm font-bold shadow-sm">
            T
          </div>
        </div>
      </header>
      
      {isModalOpen && <EmergencyTriggerModal onClose={() => setIsModalOpen(false)} />}
    </>
  );
}
