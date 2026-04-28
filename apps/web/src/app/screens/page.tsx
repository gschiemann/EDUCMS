"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/store/ui-store';

export default function ScreensRedirect() {
  const router = useRouter();
  const user = useUIStore((state) => state.user);

  useEffect(() => {
    if (!user) {
      router.replace('/login');
    } else {
      router.replace(`/${user.tenantSlug || user.tenantId}/screens`);
    }
  }, [user, router]);

  return null;
}
