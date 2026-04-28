"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/store/ui-store';

export default function AssetsRedirect() {
  const router = useRouter();
  const user = useUIStore((state) => state.user);

  useEffect(() => {
    if (!user) {
      router.replace('/login');
    } else {
      router.replace(`/${user.tenantSlug || user.tenantId}/assets`);
    }
  }, [user, router]);

  return null;
}
