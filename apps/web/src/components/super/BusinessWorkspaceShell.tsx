"use client";

import Link from "next/link";
import { useBusinessHydrated } from "@/hooks/use-customer-console";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ChartNoAxesCombined,
  FileText,
  LayoutDashboard,
  Loader2,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useAppStore } from "@/lib/store";
import { AppDialogHost } from "@/components/ui/app-dialog";

/** The business workspace never mounts privileged children before hydration and role checks. */
export default function BusinessWorkspaceShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("businessConsole");
  const user = useAppStore((s) => s.user);
  const tenant =
    useAppStore((s) => s.activeTenant) || user?.tenantSlug || user?.tenantId;
  const pathname = usePathname();
  const mounted = useBusinessHydrated();
  if (!mounted)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2
          className="h-6 w-6 animate-spin text-indigo-600"
          aria-label={t("loading")}
        />
      </div>
    );
  if (user?.role !== "SUPER_ADMIN")
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <ShieldCheck
            className="mx-auto mb-3 h-9 w-9 text-indigo-600"
            aria-hidden
          />
          <h1 className="text-xl font-semibold text-slate-900">
            {t("restricted")}
          </h1>
          <p className="mt-2 text-sm text-slate-600">{t("restrictedBody")}</p>
          <Link
            href={tenant ? `/${tenant}/dashboard` : "/login"}
            className="mt-4 inline-flex min-h-11 items-center font-semibold text-indigo-700"
          >
            {t("dashboard")}
          </Link>
        </div>
      </div>
    );
  const links = [
    { href: "/super", key: "overview", icon: LayoutDashboard },
    { href: "/super/customers", key: "customers", icon: Users },
    { href: "/super/invoices", key: "invoices", icon: FileText },
    { href: "/super/profit", key: "profit", icon: ChartNoAxesCombined },
    { href: "/super/efficiency", key: "efficiency", icon: ShieldCheck },
  ];
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/super" className="flex min-h-11 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <Building2 className="h-5 w-5" aria-hidden />
            </span>
            <span className="font-semibold tracking-tight">
              VenueOS{" "}
              <span className="ml-2 hidden border-l border-slate-200 pl-3 text-sm font-normal text-slate-500 sm:inline">
                {t("workspace")}
              </span>
            </span>
          </Link>
          <Link
            href={tenant ? `/${tenant}/dashboard` : "/login"}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600 hover:text-indigo-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            <span>{t("dashboard")}</span>
          </Link>
        </div>
        <nav
          aria-label={t("navigation")}
          className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-4 lg:hidden"
        >
          {links.map(({ href, key, icon: Icon }) => (
            <Link
              key={key}
              href={href}
              aria-current={
                (
                  href === "/super"
                    ? pathname === href
                    : pathname.startsWith(href)
                )
                  ? "page"
                  : undefined
              }
              className="flex min-h-12 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-slate-600 aria-[current=page]:border-indigo-600 aria-[current=page]:text-indigo-700"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t(key)}
            </Link>
          ))}
        </nav>
        <details className="border-t border-slate-100 px-4 lg:hidden">
          <summary className="min-h-10 cursor-pointer py-2 text-xs font-semibold text-slate-500">
            {t("tools")}
          </summary>
          <div className="flex flex-wrap gap-x-5 pb-2">
            {[
              ["/super?tools=1#platform-tools", "tools"],
              ["/super/ai", "ai"],
              ["/super/bugs", "bugs"],
              ["/super/cts-simulator", "simulator"],
              ["/super/field-builds", "fieldBuilds"],
            ].map(([href, key]) => (
              <Link
                key={key}
                href={href}
                onClick={() => {
                  if (href.includes("tools=1"))
                    window.dispatchEvent(
                      new Event("venueos-open-platform-tools"),
                    );
                }}
                className="inline-flex min-h-10 items-center text-xs font-medium text-slate-600"
              >
                {t(key)}
              </Link>
            ))}
          </div>
        </details>
      </header>
      <div className="mx-auto flex max-w-[1600px]">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-56 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-6 lg:flex">
          <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            {t("workspace")}
          </p>
          <nav aria-label={t("navigation")} className="space-y-1">
            {links.map(({ href, key, icon: Icon }) => (
              <Link
                key={key}
                href={href}
                aria-current={
                  (
                    href === "/super"
                      ? pathname === href
                      : pathname.startsWith(href)
                  )
                    ? "page"
                    : undefined
                }
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 aria-[current=page]:bg-indigo-50 aria-[current=page]:text-indigo-700"
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden />
                {t(key)}
              </Link>
            ))}
          </nav>
          <div className="mt-7 border-t border-slate-100 pt-5">
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              {t("operations")}
            </p>
            {[
              ["/super?tools=1#platform-tools", "tools"],
              ["/super/ai", "ai"],
              ["/super/bugs", "bugs"],
              ["/super/cts-simulator", "simulator"],
              ["/super/field-builds", "fieldBuilds"],
            ].map(([href, key]) => (
              <Link
                key={key}
                href={href}
                onClick={() => {
                  if (href.includes("tools=1"))
                    window.dispatchEvent(
                      new Event("venueos-open-platform-tools"),
                    );
                }}
                className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              >
                <Settings2 className="h-4 w-4" aria-hidden />
                {t(key)}
              </Link>
            ))}
          </div>
          <div className="mt-auto rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">
              {t("ownerWorkspace")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {t("auditNote")}
            </p>
          </div>
        </aside>
        <main id="business-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      <AppDialogHost />
    </div>
  );
}
