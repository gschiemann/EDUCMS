"use client";

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Sidebar } from './Sidebar';
import { TopToolbar } from './TopToolbar';
import { EmergencyOverlay } from './EmergencyOverlay';
import { useTenantStatus } from '@/hooks/use-api';
import { AppDialogHost } from '@/components/ui/app-dialog';
import { BrandStyleInjector } from '@/components/branding/BrandStyleInjector';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const isEmergencyActive = useAppStore((state) => state.isEmergencyActive);
  const setEmergencyActive = useAppStore((state) => state.setEmergencyActive);
  const { data: tenant } = useTenantStatus();
  const pathname = usePathname() || '';

  // Universally lock the dashboard when backend reports an emergency
  // NOTE: this hook MUST run on every render (hook-rule), so it stays above
  // any conditional return.
  useEffect(() => {
    if (tenant) {
      if (tenant.emergencyStatus && tenant.emergencyStatus !== 'INACTIVE') {
        setEmergencyActive(true);
      } else {
        setEmergencyActive(false);
      }
    }
  }, [tenant, setEmergencyActive]);

  // The V2 template builder is a full-screen workspace — strip global chrome
  // (sidebar, top toolbar, decorative blobs) so it can use the entire viewport.
  const isFullscreenWorkspace = /\/templates\/builder\//.test(pathname);
  if (isFullscreenWorkspace) {
    return (
      <>
        {/* Desktop-only notice for the builder on small viewports */}
        <div className="lg:hidden fixed inset-0 z-[9999] flex items-center justify-center p-8 bg-slate-50 text-center">
          <div className="max-w-sm space-y-4">
            <h2 className="text-xl font-bold text-slate-800">Larger screen required</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              The template builder needs at least a 1024px wide display. Please switch to a tablet in landscape or a desktop to continue editing.
            </p>
            <a href={pathname.replace(/\/templates\/builder\/.*$/, '/templates')} className="inline-block px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors">
              Back to Templates
            </a>
          </div>
        </div>
        <div className="hidden lg:block">
          {children}
          <AppDialogHost />
        </div>
      </>
    );
  }

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden text-slate-900 font-sans relative">
      {/* Tenant brand paint — scoped to authed dashboard only so the
          public marketing site + /login stay in the vendor palette. */}
      <BrandStyleInjector />
      {/* Skip-to-content link — visible only on focus */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[10001] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-indigo-600 focus:text-white focus:text-sm focus:font-bold focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        Skip to main content
      </a>

      {/* Decorative blob for pure EDU feel */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-100/50 rounded-full blur-[100px] pointer-events-none -z-0" />
      <div className="absolute bottom-0 left-64 w-[500px] h-[500px] bg-emerald-50/50 rounded-full blur-[120px] pointer-events-none -z-0" />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 relative">
        <TopToolbar />
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 transition-all duration-300 relative z-10",
            isEmergencyActive ? "pointer-events-none opacity-50 blur-sm" : ""
          )}
        >
          <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
            {children}
          </div>
        </main>
      </div>

      {isEmergencyActive && <EmergencyOverlay />}
      <AppDialogHost />
    </div>
  );
}
