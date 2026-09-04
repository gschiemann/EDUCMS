"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/store/ui-store';

export default function DashboardRedirect() {
  const router = useRouter();
  const user = useUIStore((state) => state.user);

  useEffect(() => {
    if (!user) {
      router.replace('/login');
    } else {
      router.replace(`/${user.tenantSlug || user.tenantId}/dashboard`);
    }
  }, [user, router]);

  return null;
}
