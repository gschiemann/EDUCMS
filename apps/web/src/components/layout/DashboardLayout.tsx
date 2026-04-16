"use client";

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Sidebar } from './Sidebar';
import { TopToolbar } from './TopToolbar';
import { EmergencyOverlay } from './EmergencyOverlay';
import { useTenantStatus } from '@/hooks/use-api';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const isEmergencyActive = useAppStore((state) => state.isEmergencyActive);
  const setEmergencyActive = useAppStore((state) => state.setEmergencyActive);
  const { data: tenant } = useTenantStatus();

  // Universally lock the dashboard when backend reports an emergency
  useEffect(() => {
    if (tenant) {
      if (tenant.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE') {
        setEmergencyActive(true);
      } else {
        setEmergencyActive(false);
      }
    }
  }, [tenant, setEmergencyActive]);

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden text-slate-900 font-sans relative">
      {/* Decorative blob for pure EDU feel */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-100/50 rounded-full blur-[100px] pointer-events-none -z-0" />
      <div className="absolute bottom-0 left-64 w-[500px] h-[500px] bg-emerald-50/50 rounded-full blur-[120px] pointer-events-none -z-0" />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative">
        <TopToolbar />
        <main className={cn(
          "flex-1 overflow-y-auto p-8 transition-all duration-300 relative z-10",
          isEmergencyActive ? "pointer-events-none opacity-50 blur-sm" : ""
        )}>
          <div className="max-w-7xl mx-auto space-y-8">
            {children}
          </div>
        </main>
      </div>
      
      {isEmergencyActive && <EmergencyOverlay />}
    </div>
  );
}
