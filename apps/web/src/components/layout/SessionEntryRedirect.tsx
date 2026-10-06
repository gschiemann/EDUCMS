'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/store/ui-store';
import { hasRememberMarker } from '@/lib/session-client';

/** Older Home Screen shortcuts still start at /. Installed launches use the
 * checked launch flow even when signed out; ordinary website visitors stay here. */
export function SessionEntryRedirect() {
  const router = useRouter();
  const token = useUIStore(state => state.token);
  const restoring = useUIStore(state => state.authRestoring);
  useEffect(() => {
    const installed = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (installed || token || restoring || hasRememberMarker()) router.replace('/launch');
  }, [token, restoring, router]);
  return null;
}
