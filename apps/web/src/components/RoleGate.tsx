"use client";

import { useAppStore } from '@/lib/store';

interface RoleGateProps {
  allowedRoles: Array<'admin' | 'teacher'>;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function RoleGate({ allowedRoles, children, fallback = null }: RoleGateProps) {
  const userRole = useAppStore((state) => state.userRole);

  if (!userRole || !allowedRoles.includes(userRole)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
