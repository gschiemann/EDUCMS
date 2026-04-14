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
  const setActiveSchoolId = useAppStore((state) => state.setActiveSchoolId);

  useEffect(() => {
    if (params?.schoolId) {
      setActiveSchoolId(params.schoolId as string);
    }
  }, [params?.schoolId, setActiveSchoolId]);

  return <DashboardLayout>{children}</DashboardLayout>;
}
