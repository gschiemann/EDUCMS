"use client";

/**
 * /super/customers/[id] — one customer. SUPER_ADMIN only (denied here by default, enforced by the
 * API). The view itself is components/super/customers/CustomerDetailView.tsx.
 */
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import {
  useBusinessHydrated,
  useCustomerDetail,
} from "@/hooks/use-customer-console";
import { CustomerView } from "@/components/super/customers/CustomerDetailView";

export default function CustomerDetailPage() {
  const t = useTranslations("customerConsole");
  const params = useParams();
  const id = String(params?.id ?? "");
  const user = useAppStore((s) => s.user);
  const mounted = useBusinessHydrated();
  const isOwner = mounted && user?.role === "SUPER_ADMIN";
  const detail = useCustomerDetail(id, isOwner);

  if (!mounted)
    return (
      <Centered>
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" aria-hidden />
      </Centered>
    );
  if (!isOwner) {
    return (
      <Centered>
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-sm">
          <AlertCircle
            className="w-10 h-10 text-rose-500 mx-auto mb-3"
            aria-hidden
          />
          <h1 className="text-lg font-bold text-slate-900">
            {t("ownerOnlyTitle")}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{t("ownerOnlyBody")}</p>
        </div>
      </Centered>
    );
  }
  if (detail.isError)
    return (
      <Centered>
        <p role="alert" className="text-sm text-rose-700">
          {t("detail.loadFailed")}
        </p>
      </Centered>
    );
  if (!detail.data)
    return (
      <Centered>
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" aria-hidden />
      </Centered>
    );
  return <CustomerView c={detail.data} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      {children}
    </div>
  );
}
