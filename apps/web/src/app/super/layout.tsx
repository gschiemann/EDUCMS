'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAppStore } from '@/lib/store';
import { MobileTabBar } from '@/components/layout/MobileTabBar';

/** Standalone owner pages still need an exit and the phone's primary navigation. */
export default function SuperLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const activeTenant = useAppStore((s) => s.activeTenant);
  const user = useAppStore((s) => s.user);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const tenant = activeTenant || user?.tenantSlug || user?.tenantId;
  return (
    <div className="pb-[calc(80px+env(safe-area-inset-bottom))] md:pb-0">
      {mounted && (
        <div className="sticky top-0 z-[60] bg-white border-b border-slate-200 px-4 sm:px-6">
          <Link href={tenant ? `/${tenant}/dashboard` : '/login'} className="inline-flex items-center gap-2 min-h-11 text-sm font-semibold text-slate-700">
            <ArrowLeft className="h-4 w-4" aria-hidden /> {t('toolbar.backToDashboard')}
          </Link>
        </div>
      )}
      {children}
      {mounted && user && <MobileTabBar />}
    </div>
  );
}
