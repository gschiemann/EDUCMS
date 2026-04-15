"use client";

import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';

interface RoleGateProps {
  allowedRoles: string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Conditionally renders children based on the current user's role.
 * Deferred to client-side only to avoid hydration mismatches.
 */
export function RoleGate({ allowedRoles, children, fallback = null }: RoleGateProps) {
  const user = useAppStore((state) => state.user);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // On server and first client render, return null to match
  if (!mounted || !user) return <>{fallback}</>;

  const roleMap: Record<string, string> = {
    SUPER_ADMIN: 'admin',
    DISTRICT_ADMIN: 'admin',
    SCHOOL_ADMIN: 'admin',
    CONTRIBUTOR: 'teacher',
    RESTRICTED_VIEWER: 'viewer',
  };

  const mappedRole = roleMap[user.role] || user.role;

  if (!allowedRoles.includes(mappedRole) && !allowedRoles.includes(user.role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

