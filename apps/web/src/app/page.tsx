"use client"

import { useUIStore } from "@/store/ui-store"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function RootPage() {
  const token = useUIStore((state) => state.token);
  const user = useUIStore((state) => state.user);
  const router = useRouter();

  useEffect(() => {
    if (!token) {
      router.push('/login');
    } else if (user?.tenantId) {
      router.push(`/${user.tenantSlug || user.tenantId}/dashboard`);
    } else {
      // Token exists but user is corrupted/missing tenantId -> Force cleanup
      useUIStore.getState().logout();
      router.push('/login');
    }
  }, [token, user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-lg font-medium text-slate-500">
        Redirecting...
      </div>
    </div>
  );
}
