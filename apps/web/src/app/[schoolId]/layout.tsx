"use client";

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAppStore } from '@/lib/store';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';

export default function SchoolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const setActiveTenant = useAppStore((state) => state.setActiveTenant);

  useEffect(() => {
    if (params?.schoolId) {
      setActiveTenant(params.schoolId as string);
    }
  }, [params?.schoolId, setActiveTenant]);

  return <DashboardLayout>{children}</DashboardLayout>;
}
