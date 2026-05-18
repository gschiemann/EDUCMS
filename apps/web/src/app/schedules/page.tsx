"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/store/ui-store';

export default function SchedulesRedirect() {
  const router = useRouter();
  const user = useUIStore((state) => state.user);

  useEffect(() => {
    if (!user) {
      router.replace('/login');
    } else {
      // Scheduling lives inside the Playlists page — there is no
      // standalone /[schoolId]/schedules route, so redirecting there 404s.
      router.replace(`/${user.tenantSlug || user.tenantId}/playlists`);
    }
  }, [user, router]);

  return null;
}
