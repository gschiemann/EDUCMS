'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useUploadJobStore } from '@/lib/upload-job-store';
import { useUIStore } from '@/store/ui-store';

/** One cheap, app-wide progress summary; no pollers and no blur. */
export function UploadActivity() {
  const items = useUploadJobStore(state => state.items);
  const user = useUIStore(state => state.user);
  const overlays = useUIStore(state => state.overlayOpenCount);
  const path = usePathname() ?? '';
  const t = useTranslations('assetsLib');
  const own = useMemo(() => items.filter(item => item.ownerUserId === user?.id && item.ownerTenantId === user?.tenantId), [items, user]);
  if (!user || overlays || path.endsWith('/assets') || !own.some(item => ['idle', 'uploading', 'processing'].includes(item.phase))) return null;
  const done = own.filter(item => ['success', 'pending-review'].includes(item.phase)).length;
  return <Link href={`/${user.tenantSlug || user.tenantId}/assets`} aria-label={t('uploads')} data-testid="upload-activity"
    className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-5 right-4 left-4 md:left-auto z-50 rounded-xl border border-indigo-200 bg-white px-4 py-3 text-sm font-semibold text-indigo-800 shadow-md">
    {t('uploadActivity', { done, total: own.length })}
  </Link>;
}
